/**
 * @fileoverview Adaptive prerequisite remediation engine.
 *
 * When a learner fails an advanced card ("Again"), the engine checks
 * whether the failure likely comes from a broken foundation:
 *
 *   1. Find the graph nodes the failed card belongs to.
 *   2. Look one level up — the direct prerequisite nodes.
 *   3. Among the cards of those prerequisite nodes, pick the SHAKY ones
 *      (never studied, still learning, lapsed, overdue, or low ease).
 *      Rock-solid foundations produce no remediation — the failure is
 *      then intrinsic to the card itself.
 *   4. Queue at most MAX_REMEDIATION_CARDS of them for the next session,
 *      weakest first.
 *
 * `planRemediation` is pure (rows in, plan out). The route layer owns
 * all database writes.
 */

import {
  GRAPH_NODES,
  GRAPH_EDGES,
  nodeMap,
  prerequisitesOf,
  nodesForCard,
} from '../../src/utils/knowledgeGraph.js'

/** Cap per failure so one bad session cannot flood the queue. */
export const MAX_REMEDIATION_CARDS = 3
/** Ease below this marks a foundation card as shaky even in Review state. */
export const SHAKY_EASE = 2.3
/** Review cards younger than this interval (days) are not yet stable. */
export const SHAKY_INTERVAL_DAYS = 4

/**
 * Is this prerequisite card a plausible broken foundation?
 * @param {Object} card - Flashcard row.
 * @param {Date} [now]
 */
export function isShaky(card, now = new Date()) {
  const state = card.state || 0
  if (state === 0) return true // never studied
  if (state === 1 || state === 3) return true // learning / relearning
  const ease = card.ease_factor ?? 2.5
  if (ease < SHAKY_EASE) return true
  if ((card.interval || 0) < SHAKY_INTERVAL_DAYS) return true
  if (card.next_review && new Date(card.next_review) <= now) return true // overdue
  return false
}

/** Sort shaky cards weakest-first: lowest ease, then most overdue. */
function byWeakness(a, b) {
  const easeA = a.ease_factor ?? 2.5
  const easeB = b.ease_factor ?? 2.5
  if (easeA !== easeB) return easeA - easeB
  const nextA = a.next_review ? Date.parse(a.next_review) : 0
  const nextB = b.next_review ? Date.parse(b.next_review) : 0
  return nextA - nextB
}

/**
 * Build the remediation plan for one failed card.
 *
 * @param {Object} failedCard - The card just rated "Again" (full row).
 * @param {Array} allCards - Every flashcard row (for prerequisite lookup).
 * @param {Object} [options]
 * @param {Date} [options.now]
 * @param {Array} [options.nodes] - Graph nodes (injectable for tests).
 * @param {Array} [options.edges] - Graph edges (injectable for tests).
 * @returns {Array<{cardId: string, nodeId: string|null, nodeName: string|null, reason: string}>}
 */
export function planRemediation(failedCard, allCards, {
  now = new Date(),
  nodes = GRAPH_NODES,
  edges = GRAPH_EDGES,
} = {}) {
  const plan = []
  const planned = new Set()
  const byId = nodeMap(nodes)

  // Explicit card-level prerequisite link wins first.
  if (failedCard.prerequisite_id) {
    const prereqCard = allCards.find((c) => c.id === failedCard.prerequisite_id)
    if (prereqCard && prereqCard.id !== failedCard.id && isShaky(prereqCard, now)) {
      plan.push({
        cardId: prereqCard.id,
        nodeId: null,
        nodeName: null,
        reason: 'Linked prerequisite card of the concept you missed',
      })
      planned.add(prereqCard.id)
    }
  }

  // Graph-level prerequisites: one hop up from the failed card's nodes.
  const failedNodes = nodesForCard(failedCard, nodes)
  const prereqIndex = prerequisitesOf(edges)
  const prereqNodeIds = new Set()
  for (const nodeId of failedNodes) {
    for (const p of prereqIndex.get(nodeId) || []) prereqNodeIds.add(p)
  }
  // A node is never its own foundation.
  for (const nodeId of failedNodes) prereqNodeIds.delete(nodeId)

  if (prereqNodeIds.size > 0) {
    const candidates = []
    for (const card of allCards) {
      if (card.id === failedCard.id || planned.has(card.id)) continue
      const cardNodes = nodesForCard(card, nodes)
      const hitNode = cardNodes.find((n) => prereqNodeIds.has(n))
      if (!hitNode) continue
      if (!isShaky(card, now)) continue
      candidates.push({ card, nodeId: hitNode })
    }
    candidates.sort((a, b) => byWeakness(a.card, b.card))

    for (const { card, nodeId } of candidates) {
      if (plan.length >= MAX_REMEDIATION_CARDS) break
      if (planned.has(card.id)) continue
      plan.push({
        cardId: card.id,
        nodeId,
        nodeName: byId.get(nodeId)?.name || nodeId,
        reason: `Foundation for ${failedNodes.map((n) => byId.get(n)?.name || n).join(', ')}`,
      })
      planned.add(card.id)
    }
  }

  return plan.slice(0, MAX_REMEDIATION_CARDS)
}
