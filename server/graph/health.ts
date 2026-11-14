import {
  prerequisitesOf,
  nodesForCard,
  type GraphEdge,
  type GraphNodeLike,
  type CardForNodeMatching,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import {
  deriveReviewElapsedDays,
  parseUtcTimestampMs,
  retrievability,
} from "../srs/scheduler.ts";

export const MASTERED_MIN_EASE = 2.5;
export const MASTERED_MIN_INTERVAL_DAYS = 21;
export const DUE_SOON_HOURS = 48;
export const FRAGILE_EASE = 2.0;
export const PREREQ_SATISFIED_RATIO = 0.6;

export type CardHealthStatus =
  | "new"
  | "learning"
  | "lapsed"
  | "due"
  | "maturing"
  | "mastered";

export type NodeHealthBucket = "mastered" | "due" | "decayed" | "unseen";

export interface HealthCardRow extends CardForNodeMatching {
  id: string;
  state?: number | null;
  ease_factor?: number | null;
  interval?: number | null;
  next_review?: string | null;
  last_reviewed?: string | null;
  stability?: number | null;
  difficulty?: number | null;
  lapses?: number | null;
}

export interface NodeHealthCounts {
  total: number;
  new: number;
  learning: number;
  lapsed: number;
  due: number;
  maturing: number;
  mastered: number;
}

export interface ComputedNodeHealth {
  health: NodeHealthBucket;
  strength: number;
  counts: NodeHealthCounts;
  cardIds: string[];
  locked: boolean;
  unsatisfiedPrereqs: string[];
  ready: boolean;
}

const SCORE: Record<CardHealthStatus, number> = {
  new: 0,
  learning: 0.25,
  lapsed: 0.1,
  due: 0.4,
  maturing: 0.7,
  mastered: 1,
};

export function cardStatus(
  card: HealthCardRow,
  now: Date = new Date(),
): CardHealthStatus {
  const state = card.state || 0;
  if (state === 0) return "new";
  if (state === 1) return "learning";
  if (state === 3) return "lapsed";
  const ease = card.ease_factor ?? 2.5;
  if (ease < FRAGILE_EASE) return "lapsed";
  const nextMs = parseUtcTimestampMs(card.next_review);
  if (Number.isFinite(nextMs) && nextMs <= now.getTime()) return "due";
  if (
    ease >= MASTERED_MIN_EASE &&
    (card.interval || 0) >= MASTERED_MIN_INTERVAL_DAYS
  ) {
    return "mastered";
  }
  return "maturing";
}

export function cardStrength(
  card: HealthCardRow,
  nowOrMs: Date | number = new Date(),
): number {
  const state = card.state ?? 0;
  if (state === 2 && card.stability != null && card.stability > 0) {
    const nowMs =
      typeof nowOrMs === "number" ? nowOrMs : nowOrMs.getTime();
    const elapsedDays = deriveReviewElapsedDays(card, 0, nowMs, { minDays: 0 });
    return retrievability(elapsedDays, card.stability);
  }
  const nowDate = typeof nowOrMs === "number" ? new Date(nowOrMs) : nowOrMs;
  return SCORE[cardStatus(card, nowDate)];
}

export function nodeHealth(
  cards: readonly HealthCardRow[],
  {
    remediationCardIds = new Set<string>(),
    now = new Date(),
  }: { remediationCardIds?: Set<string>; now?: Date } = {},
): { health: NodeHealthBucket; strength: number; counts: NodeHealthCounts } {
  const counts: NodeHealthCounts = {
    total: cards.length,
    new: 0,
    learning: 0,
    lapsed: 0,
    due: 0,
    maturing: 0,
    mastered: 0,
  };
  if (cards.length === 0) {
    return { health: "unseen", strength: 0, counts };
  }

  let scoreSum = 0;
  let hasRemediation = false;
  let dueSoon = false;
  const soonCutoffMs = now.getTime() + DUE_SOON_HOURS * 3600 * 1000;

  for (const card of cards) {
    const status = cardStatus(card, now);
    counts[status] += 1;
    scoreSum += cardStrength(card, now);
    if (remediationCardIds.has(card.id)) hasRemediation = true;
    const nextMs = parseUtcTimestampMs(card.next_review);
    if (
      (card.state === 2 || card.state === 1 || card.state === 3) &&
      Number.isFinite(nextMs) &&
      nextMs <= soonCutoffMs
    ) {
      dueSoon = true;
    }
  }

  const strength = scoreSum / cards.length;
  let health: NodeHealthBucket;
  if (counts.lapsed > 0 || hasRemediation) {
    health = "decayed";
  } else if (counts.mastered === counts.total && !dueSoon) {
    health = "mastered";
  } else {
    health = "due";
  }
  return { health, strength, counts };
}

export function prereqSatisfied(
  entry:
    | {
        counts: Pick<
          NodeHealthCounts,
          "total" | "due" | "maturing" | "mastered"
        >;
      }
    | undefined,
): boolean {
  if (!entry) return true;
  const { counts } = entry;
  if (counts.total === 0) return true;
  const graduated = counts.due + counts.maturing + counts.mastered;
  return graduated / counts.total >= PREREQ_SATISFIED_RATIO;
}

export function computeGraphHealth(
  cards: readonly HealthCardRow[],
  {
    remediationCardIds = new Set<string>(),
    now = new Date(),
    nodes = SYSTEM_DESIGN_KIT_SKELETON.graph.nodes,
    edges = SYSTEM_DESIGN_KIT_SKELETON.graph.edges,
  }: {
    remediationCardIds?: Set<string>;
    now?: Date;
    nodes?: readonly GraphNodeLike[];
    edges?: readonly GraphEdge[];
  } = {},
): {
  byNode: Map<string, ComputedNodeHealth>;
  cardNodeIndex: Map<string, string[]>;
} {
  const cardsByNode = new Map<string, HealthCardRow[]>(
    nodes.map((n) => [n.id, []]),
  );
  const cardNodeIndex = new Map<string, string[]>();

  for (const card of cards) {
    const nodeIds = nodesForCard(card, nodes);
    cardNodeIndex.set(card.id, nodeIds);
    for (const nodeId of nodeIds) {
      cardsByNode.get(nodeId)?.push(card);
    }
  }

  const byNode = new Map<string, ComputedNodeHealth>();
  for (const node of nodes) {
    const linked = cardsByNode.get(node.id) || [];
    const { health, strength, counts } = nodeHealth(linked, {
      remediationCardIds,
      now,
    });
    byNode.set(node.id, {
      health,
      strength,
      counts,
      cardIds: linked.map((c) => c.id),
      locked: false,
      unsatisfiedPrereqs: [],
      ready: false,
    });
  }

  const prereqs = prerequisitesOf(edges);
  for (const node of nodes) {
    const entry = byNode.get(node.id)!;
    const above = prereqs.get(node.id) || [];
    const unsatisfied = above.filter((p) => !prereqSatisfied(byNode.get(p)));
    entry.locked = unsatisfied.length > 0;
    entry.unsatisfiedPrereqs = unsatisfied;
    entry.ready = entry.health === "unseen" && !entry.locked;
  }

  return { byNode, cardNodeIndex };
}
