import { Router } from "express";
import db from "../db.ts";
import { scopeOf, type Scope } from "../platform/tenancy/scope.ts";
import { ensureDefaultSystemDesignKit } from "../kits/kitsSchema.ts";
import {
  nodeMap,
  prerequisitesOf,
  dependentsOf,
  expandTrack,
  validateGraph,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import { computeGraphHealth, type HealthCardRow } from "../graph/health.ts";
import {
  getCardPreviews,
  parseDeckSettings,
  type DeckSettings,
} from "../srs/scheduler.ts";
import logger from "../utils/logger.ts";

// Fail fast at boot when the shipped starter graph is broken.
validateGraph(
  SYSTEM_DESIGN_KIT_SKELETON.graph.nodes,
  SYSTEM_DESIGN_KIT_SKELETON.graph.edges,
);

const router = Router();

interface GraphCardRow extends HealthCardRow {
  deck_id: string;
  repetitions: number;
  last_reviewed: string | null;
  prerequisite_id: string | null;
  source_pillar_id: string | null;
  source_section_id: string | null;
}

const CARD_COLUMNS =
  "id, deck_id, node_id, front, back, state, ease_factor, interval, repetitions, next_review, last_reviewed, prerequisite_id, source_pillar_id, source_topic_id, source_section_id";

function loadCards(scope: Scope): GraphCardRow[] {
  return db
    .prepare(`SELECT ${CARD_COLUMNS} FROM flashcards WHERE ownerId = ?`)
    .all(scope.ownerId) as GraphCardRow[];
}

function openRemediationIds(scope: Scope): Set<string> {
  const rows = db
    .prepare(
      "SELECT card_id FROM remediation_queue WHERE ownerId = ? AND resolved_at IS NULL",
    )
    .all(scope.ownerId) as Array<{ card_id: string }>;
  return new Set(rows.map((r) => r.card_id));
}

function loadDeckIndex(
  scope: Scope,
): Map<string, { name: string; settings: DeckSettings }> {
  const decks = db
    .prepare("SELECT id, name, settings FROM decks WHERE ownerId = ?")
    .all(scope.ownerId) as Array<{ id: string; name: string; settings: string }>;
  return new Map(
    decks.map((d) => [
      d.id,
      { name: d.name, settings: parseDeckSettings(d.settings) },
    ]),
  );
}

function isStudyableNow(card: GraphCardRow, now: Date = new Date()): boolean {
  const state = card.state || 0;
  if (state === 0) return true;
  return !card.next_review || new Date(card.next_review) <= now;
}

function toSessionCard(
  card: GraphCardRow,
  deckIndex: Map<string, { name: string; settings: DeckSettings }>,
  nodeName: string,
) {
  const deck = deckIndex.get(card.deck_id);
  return {
    ...card,
    deckName: deck?.name || "",
    nodeName,
    srs_previews: getCardPreviews(
      card,
      deck?.settings || parseDeckSettings(null),
    ),
  };
}

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { pillars, graph: graphDef } = kit.skeleton;

  try {
    const cards = loadCards(scope);
    const remediationCardIds = openRemediationIds(scope);
    const { byNode } = computeGraphHealth(cards, {
      remediationCardIds,
      nodes: graphDef.nodes,
      edges: graphDef.edges,
    });

    const pillarNames = new Map(pillars.map((p) => [p.id, p.name]));
    const pillarColors = new Map(pillars.map((p) => [p.id, p.color]));

    const nodes = graphDef.nodes.map((node) => {
      const entry = byNode.get(node.id)!;
      return {
        id: node.id,
        name: node.name,
        pillarId: node.pillarId,
        pillarName: pillarNames.get(node.pillarId) || node.pillarId,
        pillarColor: pillarColors.get(node.pillarId) || "#818cf8",
        topicId: node.topicId,
        summary: node.summary,
        health: entry.health,
        strength: Math.round(entry.strength * 100) / 100,
        counts: entry.counts,
        ready: entry.ready,
        locked: entry.locked,
      };
    });

    const stats = { mastered: 0, due: 0, decayed: 0, unseen: 0 };
    for (const n of nodes) stats[n.health] += 1;

    const tracks = graphDef.tracks.map((track) => {
      const nodeIds = expandTrack(track, graphDef.nodes, graphDef.edges);
      const mastered = nodeIds.filter(
        (id) => byNode.get(id)?.health === "mastered",
      ).length;
      return {
        id: track.id,
        name: track.name,
        emoji: track.emoji,
        description: track.description,
        nodeIds,
        nodeCount: nodeIds.length,
        masteredCount: mastered,
      };
    });

    res.json({
      nodes,
      edges: graphDef.edges,
      tracks,
      stats,
      remediationCount: remediationCardIds.size,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[graph] Error:", msg);
    res.status(500).json({ message: "Failed to compute knowledge graph." });
  }
});

router.get("/nodes/:id", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { pillars, graph: graphDef, canvasConfig } = kit.skeleton;
  const nodesById = nodeMap(graphDef.nodes);
  const node = nodesById.get(req.params.id);
  if (!node) {
    res.status(404).json({ message: "Node not found" });
    return;
  }

  try {
    const cards = loadCards(scope);
    const remediationCardIds = openRemediationIds(scope);
    const now = new Date();
    const { byNode, cardNodeIndex } = computeGraphHealth(cards, {
      remediationCardIds,
      now,
      nodes: graphDef.nodes,
      edges: graphDef.edges,
    });
    const deckIndex = loadDeckIndex(scope);

    const linkedCards = cards
      .filter((c) => (cardNodeIndex.get(c.id) || []).includes(node.id))
      .map((c) => ({
        id: c.id,
        deck_id: c.deck_id,
        deckName: deckIndex.get(c.deck_id)?.name || "",
        front: c.front,
        state: c.state || 0,
        ease_factor: c.ease_factor ?? 2.5,
        interval: c.interval || 0,
        next_review: c.next_review,
        due: isStudyableNow(c, now),
        remediation: remediationCardIds.has(c.id),
      }));

    const healthOf = (id: string) => {
      const e = byNode.get(id)!;
      return {
        id,
        name: nodesById.get(id)?.name || id,
        health: e.health,
        strength: e.strength,
      };
    };
    const prereqs = (prerequisitesOf(graphDef.edges).get(node.id) || []).map(
      healthOf,
    );
    const dependents = (dependentsOf(graphDef.edges).get(node.id) || []).map(
      healthOf,
    );

    let guide: {
      pillarId: string;
      topicId: string;
      topicName: string;
      filledSections: number;
    } | null = null;
    if (node.topicId) {
      const pillar = pillars.find((p) => p.id === node.pillarId);
      const topic = pillar?.topics.find((t) => t.id === node.topicId);
      if (topic) {
        const filled = (
          db
            .prepare(
              "SELECT COUNT(*) AS count FROM guide_content WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND content != ''",
            )
            .get(scope.ownerId, kit.id, node.pillarId, node.topicId) as {
            count: number;
          }
        ).count;
        guide = {
          pillarId: node.pillarId,
          topicId: node.topicId,
          topicName: topic.name,
          filledSections: filled,
        };
      }
    }

    const componentNames = new Set<string>();
    for (const item of canvasConfig?.components ?? []) {
      if (node.components.includes(item.type)) componentNames.add(item.name);
    }
    const boards: Array<{ id: string; name: string }> = [];
    if (componentNames.size > 0) {
      const boardRows = db
        .prepare("SELECT id, name, data FROM boards WHERE ownerId = ? AND kit_id = ?")
        .all(scope.ownerId, kit.id) as Array<{
        id: string;
        name: string;
        data: string;
      }>;
      for (const board of boardRows) {
        try {
          const data = JSON.parse(board.data || "{}") as {
            nodes?: Array<{ name?: string }>;
          };
          if ((data.nodes || []).some((n) => n.name && componentNames.has(n.name))) {
            boards.push({ id: board.id, name: board.name });
          }
        } catch {
          // Unreadable board data — skip
        }
      }
    }

    const entry = byNode.get(node.id)!;
    res.json({
      node: {
        ...node,
        health: entry.health,
        strength: entry.strength,
        counts: entry.counts,
        ready: entry.ready,
        locked: entry.locked,
        unsatisfiedPrereqs: entry.unsatisfiedPrereqs,
      },
      cards: linkedCards,
      prereqs,
      dependents,
      guide,
      boards,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[graph/nodes] Error:", msg);
    res.status(500).json({ message: "Failed to load node details." });
  }
});

router.post("/nodes/:id/session", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { graph: graphDef } = kit.skeleton;
  const node = nodeMap(graphDef.nodes).get(req.params.id);
  if (!node) {
    res.status(404).json({ message: "Node not found" });
    return;
  }

  try {
    const cards = loadCards(scope);
    const now = new Date();
    const { cardNodeIndex } = computeGraphHealth(cards, {
      now,
      nodes: graphDef.nodes,
      edges: graphDef.edges,
    });
    const deckIndex = loadDeckIndex(scope);

    const linked = cards.filter((c) =>
      (cardNodeIndex.get(c.id) || []).includes(node.id),
    );
    const studyable = linked.filter((c) => isStudyableNow(c, now));
    const session = studyable
      .slice(0, 20)
      .map((c) => toSessionCard(c, deckIndex, node.name));

    res.json({ cards: session, nodeName: node.name });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[graph/session] Error:", msg);
    res.status(500).json({ message: "Failed to build node session." });
  }
});

router.post("/tracks/:id/session", (req, res) => {
  const scope = scopeOf(req);
  const kit = ensureDefaultSystemDesignKit(db, scope);
  const { graph: graphDef } = kit.skeleton;
  const track = graphDef.tracks.find((t) => t.id === req.params.id);
  if (!track) {
    res.status(404).json({ message: "Track not found" });
    return;
  }

  try {
    const cards = loadCards(scope);
    const now = new Date();
    const { cardNodeIndex } = computeGraphHealth(cards, {
      now,
      nodes: graphDef.nodes,
      edges: graphDef.edges,
    });
    const deckIndex = loadDeckIndex(scope);
    const byId = nodeMap(graphDef.nodes);

    const orderedNodeIds = expandTrack(track, graphDef.nodes, graphDef.edges);
    const session: Array<ReturnType<typeof toSessionCard>> = [];
    const used = new Set<string>();

    for (const nodeId of orderedNodeIds) {
      if (session.length >= 30) break;
      const nodeName = byId.get(nodeId)?.name || nodeId;
      const linked = cards.filter(
        (c) =>
          !used.has(c.id) && (cardNodeIndex.get(c.id) || []).includes(nodeId),
      );
      const studyable = linked.filter((c) => isStudyableNow(c, now));
      studyable.sort(
        (a, b) => (a.state === 0 ? 1 : 0) - (b.state === 0 ? 1 : 0),
      );
      for (const card of studyable) {
        if (session.length >= 30) break;
        used.add(card.id);
        session.push(toSessionCard(card, deckIndex, nodeName));
      }
    }

    res.json({
      cards: session,
      trackName: track.name,
      nodeOrder: orderedNodeIds,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[graph/tracks] Error:", msg);
    res.status(500).json({ message: "Failed to build track session." });
  }
});

export default router;
