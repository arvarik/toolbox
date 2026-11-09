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
