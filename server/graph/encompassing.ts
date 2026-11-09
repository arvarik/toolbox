import type Database from "better-sqlite3";
import type { Scope } from "../platform/tenancy/scope.ts";
import type { ActiveKitContext } from "../kits/kitContext.ts";
import {
  prerequisitesOf,
  nodesForCard,
  type CardForNodeMatching,
} from "../../shared/kits/kitSkeleton.ts";
import {
  bootstrapSm2Card,
  easeFromDifficulty,
  nextIntervalDays,
  nextRecallStability,
  parseDeckSettings,
  retrievability,
} from "../srs/scheduler.ts";

export const ALPHA_1_HOP = 0.5;
export const ALPHA_2_HOP = 0.25;
export const MIN_IMPLICIT_DELTA = 0.05;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ImplicitCreditOptions {
  nodeId: string;
  weight?: number;
  excludeCardId?: string;
  now?: Date;
}

export interface ImplicitCreditResult {
  updatedCardIds: string[];
  nodesCredited: string[];
}

interface CandidateCardRow {
  id: string;
  deck_id: string;
  node_id: string | null;
  front: string;
  back: string;
  source_topic_id: string | null;
  state: number;
  ease_factor: number | null;
  interval: number | null;
  stability: number | null;
  difficulty: number | null;
  next_review: string | null;
  last_reviewed: string | null;
  deck_settings: string | null;
}

/**
 * Justin Skycak / Math Academy FIRe-Lite upward implicit credit:
 * Propagates fractional recall stability credit to graduated (`state = 2`),
 * non-remediation 1-hop (`0.5`) and 2-hop (`0.25`) prerequisite cards,
 * discounted by `(1 - R(t, S))` so recently reviewed cards (`R ~ 1`) receive
 * zero artificial stability inflation while due/overdue foundations advance.
 */
export function applyImplicitPrerequisiteCredit(
  db: Database.Database,
  scope: Scope,
  kit: Pick<ActiveKitContext, "id" | "skeleton">,
  opts: ImplicitCreditOptions,
): ImplicitCreditResult {
  const { nodeId, excludeCardId } = opts;
  const weight =
    opts.weight !== undefined && Number.isFinite(opts.weight)
      ? Math.max(0, opts.weight)
      : 1;
  if (weight <= 0) {
    return { updatedCardIds: [], nodesCredited: [] };
  }

  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = now.toISOString();

  const prereqIndex = prerequisitesOf(kit.skeleton.graph.edges);
  const alphaByNode = new Map<string, number>();

  const hop1 = prereqIndex.get(nodeId) ?? [];
  for (const p1 of hop1) {
    if (p1 !== nodeId) {
      alphaByNode.set(p1, ALPHA_1_HOP);
    }
  }
  for (const p1 of hop1) {
    for (const p2 of prereqIndex.get(p1) ?? []) {
      if (p2 !== nodeId && !alphaByNode.has(p2)) {
        alphaByNode.set(p2, ALPHA_2_HOP);
      }
    }
  }

  if (alphaByNode.size === 0) {
    return { updatedCardIds: [], nodesCredited: [] };
  }

  const rows = db
    .prepare(
      `SELECT f.id, f.deck_id, f.node_id, f.front, f.back, f.source_topic_id,
              f.state, f.ease_factor, f.interval, f.stability, f.difficulty,
              f.next_review, f.last_reviewed, d.settings AS deck_settings
       FROM flashcards f
       JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
       WHERE f.ownerId = ?
         AND d.kit_id = ?
         AND f.state = 2
         AND NOT EXISTS (
           SELECT 1 FROM remediation_queue r
           WHERE r.ownerId = f.ownerId
             AND r.card_id = f.id
             AND r.resolved_at IS NULL
         )`,
    )
    .all(scope.ownerId, kit.id) as CandidateCardRow[];

  if (rows.length === 0) {
    return { updatedCardIds: [], nodesCredited: [] };
  }

  const nodes = kit.skeleton.graph.nodes;
  const updateStmt = db.prepare(
    `UPDATE flashcards
     SET stability = ?,
         difficulty = ?,
         ease_factor = ?,
         interval = ?,
         next_review = ?,
         last_reviewed = ?,
         updated_at = datetime('now')
     WHERE ownerId = ? AND id = ?`,
  );

  const updatedCardIds: string[] = [];
  const creditedNodeSet = new Set<string>();

  const applyAll = db.transaction(() => {
    for (const card of rows) {
      if (excludeCardId && card.id === excludeCardId) continue;

      const matched = nodesForCard(card, nodes);
      let bestAlpha = 0;
      let hitNode: string | null = null;
      for (const nid of matched) {
        const a = alphaByNode.get(nid) ?? 0;
        if (a > bestAlpha) {
          bestAlpha = a;
          hitNode = nid;
        }
      }
      if (bestAlpha <= 0 || !hitNode) continue;

      const { stability: s, difficulty: d } = bootstrapSm2Card(card);
      let elapsedDays = s;
      if (card.last_reviewed) {
        const parsed = Date.parse(card.last_reviewed);
        if (Number.isFinite(parsed)) {
          elapsedDays = Math.max(0, (nowMs - parsed) / DAY_MS);
        }
      } else if (card.next_review) {
        const nextMs = Date.parse(card.next_review);
        if (Number.isFinite(nextMs)) {
          const daysUntilDue = (nextMs - nowMs) / DAY_MS;
          elapsedDays = Math.max(0, (card.interval || s) - daysUntilDue);
        }
      }

      const r = retrievability(elapsedDays, s);
      const delta = bestAlpha * weight * (1 - r);
      if (delta < MIN_IMPLICIT_DELTA) continue;

      const sRecall = nextRecallStability(d, s, r, 3);
      const sNew = Math.round((s + delta * (sRecall - s)) * 10000) / 10000;
      const desiredRetention = parseDeckSettings(
        card.deck_settings,
      ).desired_retention;
      const newInterval = Math.max(
        card.interval || 1,
        nextIntervalDays(sNew, desiredRetention),
      );

      const candidateNextMs = nowMs + newInterval * DAY_MS;
      const existingNextMs = card.next_review
        ? Date.parse(card.next_review)
        : 0;
      const finalNextMs = Number.isFinite(existingNextMs)
        ? Math.max(existingNextMs, candidateNextMs)
        : candidateNextMs;

      updateStmt.run(
        sNew,
        Math.round(d * 10000) / 10000,
        easeFromDifficulty(d),
        newInterval,
        new Date(finalNextMs).toISOString(),
        nowIso,
        scope.ownerId,
        card.id,
      );

      updatedCardIds.push(card.id);
      creditedNodeSet.add(hitNode);
    }
  });

  applyAll();

  return {
    updatedCardIds,
    nodesCredited: [...creditedNodeSet],
  };
}

/** Credits every graph node the reviewed card covers, and returns the number of distinct cards credited. */
export function creditReviewedCard(
  db: Database.Database,
  scope: Scope,
  kit: Pick<ActiveKitContext, "id" | "skeleton">,
  card: CardForNodeMatching & { id: string },
): number {
  const creditedIds = new Set<string>();
  for (const nodeId of nodesForCard(card, kit.skeleton.graph.nodes)) {
    const credit = applyImplicitPrerequisiteCredit(db, scope, kit, { nodeId, excludeCardId: card.id });
    for (const id of credit.updatedCardIds) creditedIds.add(id);
  }
  return creditedIds.size;
}
