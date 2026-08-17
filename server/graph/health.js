/**
 * @fileoverview Knowledge-graph health engine.
 *
 * Pure functions that turn raw flashcard SRS rows into per-node memory
 * health. No database access here — the route layer feeds card rows in,
 * which keeps every rule unit-testable.
 *
 * Health buckets (spec):
 *   mastered - 🟢 every graded card holds: state=Review, ease ≥ 2.5,
 *              interval > 21 days, and nothing is due within 48h
 *   due      - 🟡 something is learning, new, or scheduled within 48h
 *   decayed  - 🔴 a card lapsed (relearning), sits in the remediation
 *              queue, or carries a hypercorrection-crushed ease
 *   unseen   - ⚪ no cards linked to the node yet
 */

import {
  GRAPH_NODES,
  GRAPH_EDGES,
  prerequisitesOf,
  nodesForCard,
} from '../../src/utils/knowledgeGraph.js'

export const MASTERED_MIN_EASE = 2.5
export const MASTERED_MIN_INTERVAL_DAYS = 21
export const DUE_SOON_HOURS = 48
/** Ease this low means the card keeps lapsing — treat as fragile. */
export const FRAGILE_EASE = 2.0
/** A prereq node counts as "satisfied" when this share of its cards graduated. */
export const PREREQ_SATISFIED_RATIO = 0.6

/**
 * Classify one flashcard row.
 * @param {Object} card - Row with state, ease_factor, interval, next_review.
 * @param {Date} [now]
 * @returns {'new'|'learning'|'lapsed'|'due'|'maturing'|'mastered'}
 */
export function cardStatus(card, now = new Date()) {
  const state = card.state || 0
  if (state === 0) return 'new'
  if (state === 1) return 'learning'
  if (state === 3) return 'lapsed'
  // state === 2 (Review)
  const ease = card.ease_factor ?? 2.5
  if (ease < FRAGILE_EASE) return 'lapsed'
  if (card.next_review && new Date(card.next_review) <= now) return 'due'
  if (ease >= MASTERED_MIN_EASE && (card.interval || 0) > MASTERED_MIN_INTERVAL_DAYS) {
    return 'mastered'
  }
  return 'maturing'
}

/**
 * Aggregate card statuses into one node health bucket plus a 0–1
 * strength score (for the panel's progress bar).
 *
 * @param {Array} cards - Card rows linked to the node.
 * @param {Object} [options]
 * @param {Set<string>} [options.remediationCardIds] - Cards queued for remediation.
 * @param {Date} [options.now]
 * @returns {{ health: string, strength: number, counts: Object }}
 */
export function nodeHealth(cards, { remediationCardIds = new Set(), now = new Date() } = {}) {
  const counts = { total: cards.length, new: 0, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 0 }
  if (cards.length === 0) {
    return { health: 'unseen', strength: 0, counts }
  }

  const SCORE = { new: 0, learning: 0.25, lapsed: 0.1, due: 0.4, maturing: 0.7, mastered: 1 }
  let scoreSum = 0
  let hasRemediation = false
  let dueSoon = false
  const soonCutoff = new Date(now.getTime() + DUE_SOON_HOURS * 3600 * 1000)

  for (const card of cards) {
    const status = cardStatus(card, now)
    counts[status] += 1
    scoreSum += SCORE[status]
    if (remediationCardIds.has(card.id)) hasRemediation = true
    if (
      (card.state === 2 || card.state === 1 || card.state === 3) &&
      card.next_review && new Date(card.next_review) <= soonCutoff
    ) {
      dueSoon = true
    }
  }

  const strength = scoreSum / cards.length
  let health
  if (counts.lapsed > 0 || hasRemediation) {
    health = 'decayed'
  } else if (counts.mastered === counts.total && !dueSoon) {
    health = 'mastered'
  } else {
    health = 'due'
  }
  return { health, strength, counts }
}

/**
 * Link every card to its graph nodes and compute health for all nodes.
 *
 * @param {Array} cards - All flashcard rows.
 * @param {Object} [options]
 * @param {Set<string>} [options.remediationCardIds]
 * @param {Date} [options.now]
 * @param {Array} [options.nodes]
 * @param {Array} [options.edges]
 * @returns {{ byNode: Map<string, Object>, cardNodeIndex: Map<string, string[]> }}
 *   byNode: nodeId → { health, strength, counts, cardIds }
 *   cardNodeIndex: cardId → nodeIds
 */
export function computeGraphHealth(cards, {
  remediationCardIds = new Set(),
  now = new Date(),
  nodes = GRAPH_NODES,
  edges = GRAPH_EDGES,
} = {}) {
  const cardsByNode = new Map(nodes.map((n) => [n.id, []]))
  const cardNodeIndex = new Map()

  for (const card of cards) {
    const nodeIds = nodesForCard(card, nodes)
    cardNodeIndex.set(card.id, nodeIds)
    for (const nodeId of nodeIds) {
      cardsByNode.get(nodeId)?.push(card)
    }
  }

  const byNode = new Map()
  for (const node of nodes) {
    const linked = cardsByNode.get(node.id) || []
    const { health, strength, counts } = nodeHealth(linked, { remediationCardIds, now })
    byNode.set(node.id, { health, strength, counts, cardIds: linked.map((c) => c.id) })
  }

  // Readiness pass — needs every node's health first.
  const prereqs = prerequisitesOf(edges)
  for (const node of nodes) {
    const entry = byNode.get(node.id)
    const above = prereqs.get(node.id) || []
    const unsatisfied = above.filter((p) => !prereqSatisfied(byNode.get(p)))
    entry.locked = unsatisfied.length > 0
    entry.unsatisfiedPrereqs = unsatisfied
    entry.ready = entry.health === 'unseen' && !entry.locked
  }

  return { byNode, cardNodeIndex }
}

/**
 * A prerequisite node is satisfied when the learner has demonstrably
 * worked through it: enough of its cards graduated to Review state.
 * Nodes without any cards can't gate their dependents (no signal ≠ locked).
 */
export function prereqSatisfied(entry) {
  if (!entry) return true
  const { counts } = entry
  if (counts.total === 0) return true
  const graduated = counts.due + counts.maturing + counts.mastered
  return graduated / counts.total >= PREREQ_SATISFIED_RATIO
}
