import type Database from "better-sqlite3";
import type { Scope } from "../platform/tenancy/scope.ts";
import type { ActiveKitContext } from "../kits/kitContext.ts";
import {
  nodeMap,
  prerequisitesOf,
  nodesForCard,
  type GraphEdge,
  type GraphNodeLike,
  type CardForNodeMatching,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";

export const MAX_REMEDIATION_CARDS = 3;
export const MAX_CARDS_PER_LAPSE = MAX_REMEDIATION_CARDS;
export const SHAKY_EASE = 2.3;
export const SHAKY_INTERVAL_DAYS = 4;

export interface RemediationCardRow extends CardForNodeMatching {
  id: string;
  state?: number | null;
  ease_factor?: number | null;
  interval?: number | null;
  next_review?: string | null;
  prerequisite_id?: string | null;
}

export interface RemediationPlanItem {
  cardId: string;
  nodeId: string | null;
  nodeName: string | null;
  reason: string;
}

export interface QueuedRemediationItem {
  cardId: string;
  front: string;
  nodeId: string | null;
  nodeName: string | null;
  reason: string;
}

export function isShaky(
  card: Pick<
    RemediationCardRow,
    "state" | "ease_factor" | "interval" | "next_review"
  >,
  now: Date = new Date(),
): boolean {
  const state = card.state || 0;
  if (state === 0) return true;
  if (state === 1 || state === 3) return true;
  const ease = card.ease_factor ?? 2.5;
  if (ease < SHAKY_EASE) return true;
  if ((card.interval || 0) < SHAKY_INTERVAL_DAYS) return true;
  if (card.next_review && new Date(card.next_review) <= now) return true;
  return false;
}

function byWeakness(a: RemediationCardRow, b: RemediationCardRow): number {
  const easeA = a.ease_factor ?? 2.5;
  const easeB = b.ease_factor ?? 2.5;
  if (easeA !== easeB) return easeA - easeB;
  const nextA = a.next_review ? Date.parse(a.next_review) : 0;
  const nextB = b.next_review ? Date.parse(b.next_review) : 0;
  return nextA - nextB;
}

export function planRemediation(
  failedCard: RemediationCardRow,
  allCards: readonly RemediationCardRow[],
  {
    now = new Date(),
    nodes = SYSTEM_DESIGN_KIT_SKELETON.graph.nodes,
    edges = SYSTEM_DESIGN_KIT_SKELETON.graph.edges,
  }: {
    now?: Date;
    nodes?: readonly GraphNodeLike[];
    edges?: readonly GraphEdge[];
  } = {},
): RemediationPlanItem[] {
  const plan: RemediationPlanItem[] = [];
  const planned = new Set<string>();
  const byId = nodeMap(nodes);

  if (failedCard.prerequisite_id) {
    const prereqCard = allCards.find((c) => c.id === failedCard.prerequisite_id);
    if (prereqCard && prereqCard.id !== failedCard.id && isShaky(prereqCard, now)) {
      plan.push({
        cardId: prereqCard.id,
        nodeId: null,
        nodeName: null,
        reason: "Linked prerequisite card of the concept you missed",
      });
      planned.add(prereqCard.id);
    }
  }

  const failedNodes = nodesForCard(failedCard, nodes);
  const prereqIndex = prerequisitesOf(edges);
  const prereqNodeIds = new Set<string>();
  for (const nodeId of failedNodes) {
    for (const p of prereqIndex.get(nodeId) || []) prereqNodeIds.add(p);
  }
  for (const nodeId of failedNodes) prereqNodeIds.delete(nodeId);

  if (prereqNodeIds.size > 0) {
    const candidates: Array<{ card: RemediationCardRow; nodeId: string }> = [];
    for (const card of allCards) {
      if (card.id === failedCard.id || planned.has(card.id)) continue;
      const cardNodes = nodesForCard(card, nodes);
      const hitNode = cardNodes.find((n) => prereqNodeIds.has(n));
      if (!hitNode) continue;
      if (!isShaky(card, now)) continue;
      candidates.push({ card, nodeId: hitNode });
    }
    candidates.sort((a, b) => byWeakness(a.card, b.card));

    for (const { card, nodeId } of candidates) {
      if (plan.length >= MAX_REMEDIATION_CARDS) break;
      if (planned.has(card.id)) continue;
      plan.push({
        cardId: card.id,
        nodeId,
        nodeName: byId.get(nodeId)?.name || nodeId,
        reason: `Foundation for ${failedNodes.map((n) => byId.get(n)?.name || n).join(", ")}`,
      });
      planned.add(card.id);
    }
  }

  return plan.slice(0, MAX_REMEDIATION_CARDS);
}

/**
 * Downward remediation triggered when failing a node's `GuidedDrill` (`score < 0.6`).
 * Queues up to `MAX_CARDS_PER_LAPSE` shaky prerequisite (or same-node fallback) cards
 * into `remediation_queue` without duplicating already-open remediation items.
 */
export function planNodeFailureRemediation(
  db: Database.Database,
  scope: Scope,
  kit: Pick<ActiveKitContext, "id" | "skeleton">,
  opts: {
    failedNodeId: string;
    sourceRefId: string;
    now?: Date;
  },
): QueuedRemediationItem[] {
  const now = opts.now ?? new Date();
  const { nodes, edges } = kit.skeleton.graph;
  const byId = nodeMap(nodes);
  if (!byId.has(opts.failedNodeId)) return [];

  const allCards = db
    .prepare(
      `SELECT f.id, f.node_id, f.front, f.back, f.state, f.ease_factor, f.interval,
              f.next_review, f.prerequisite_id, f.source_topic_id
       FROM flashcards f
       JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
       WHERE f.ownerId = ? AND d.kit_id = ?`,
    )
    .all(scope.ownerId, kit.id) as RemediationCardRow[];

  if (allCards.length === 0) return [];

  let plan = planRemediation(
    {
      id: opts.sourceRefId,
      node_id: opts.failedNodeId,
      front: "",
      back: "",
    },
    allCards,
    { now, nodes, edges },
  );

  // If prerequisite nodes had no shaky cards (e.g., root node), fall back to shaky cards on the failed node itself.
  if (plan.length === 0) {
    const nodeName = byId.get(opts.failedNodeId)?.name || opts.failedNodeId;
    const directCandidates = allCards
      .filter(
        (c) =>
          nodesForCard(c, nodes).includes(opts.failedNodeId) && isShaky(c, now),
      )
      .sort(byWeakness)
      .slice(0, MAX_CARDS_PER_LAPSE);

    plan = directCandidates.map((c) => ({
      cardId: c.id,
      nodeId: opts.failedNodeId,
      nodeName,
      reason: `Reinforce ${nodeName} after missed drill`,
    }));
  }

  if (plan.length === 0) return [];

  const hasOpenRow = db.prepare(
    "SELECT 1 FROM remediation_queue WHERE ownerId = ? AND card_id = ? AND resolved_at IS NULL",
  );
  const insert = db.prepare(
    `INSERT INTO remediation_queue (ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const queued: QueuedRemediationItem[] = [];
  const enqueueTx = db.transaction(() => {
    for (const item of plan.slice(0, MAX_CARDS_PER_LAPSE)) {
      if (hasOpenRow.get(scope.ownerId, item.cardId)) continue;
      insert.run(
        scope.ownerId,
        kit.id,
        item.cardId,
        opts.sourceRefId,
        item.nodeId,
        item.nodeName,
        item.reason,
      );
      const cardRow = allCards.find((c) => c.id === item.cardId);
      queued.push({
        cardId: item.cardId,
        front: cardRow?.front || "",
        nodeId: item.nodeId,
        nodeName: item.nodeName,
        reason: item.reason,
      });
    }
  });

  enqueueTx();
  return queued;
}
