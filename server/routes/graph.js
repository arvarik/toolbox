/**
 * @fileoverview Knowledge Graph API.
 *
 *   GET  /api/graph                     - full graph with live SRS health
 *   GET  /api/graph/nodes/:id           - node detail for the slide-over panel
 *   POST /api/graph/nodes/:id/session   - study session for one node's cards
 *   POST /api/graph/tracks/:id/session  - study session for a learning track
 *
 * All health math lives in server/graph/health.js (pure). This file only
 * reads rows and shapes responses.
 */

import { Router } from 'express'
import db from '../db.js'
import {
  GRAPH_NODES,
  GRAPH_EDGES,
  LEARNING_TRACKS,
  nodeMap,
  prerequisitesOf,
  dependentsOf,
  expandTrack,
  validateGraph,
} from '../../src/utils/knowledgeGraph.js'
import { computeGraphHealth } from '../graph/health.js'
import { getCardPreviews, parseDeckSettings } from '../srs/scheduler.js'
import { PILLARS, BUILDER_COMPONENTS } from '../../src/utils/constants.js'
import logger from '../utils/logger.js'

// Fail fast at boot when the shipped graph data is broken.
validateGraph(GRAPH_NODES, GRAPH_EDGES)

const router = Router()

const CARD_COLUMNS =
  'id, deck_id, front, back, state, ease_factor, interval, repetitions, next_review, last_reviewed, prerequisite_id, source_pillar_id, source_topic_id, source_section_id'

/** All flashcards with the columns health + matching need. */
function loadCards() {
  return db.prepare(`SELECT ${CARD_COLUMNS} FROM flashcards`).all()
}

/** Card ids sitting in the open remediation queue. */
function openRemediationIds() {
  const rows = db.prepare(
    'SELECT card_id FROM remediation_queue WHERE resolved_at IS NULL'
  ).all()
  return new Set(rows.map((r) => r.card_id))
}

/** Map: deckId → { name, settings } for preview generation. */
function loadDeckIndex() {
  const decks = db.prepare('SELECT id, name, settings FROM decks').all()
  return new Map(decks.map((d) => [d.id, { name: d.name, settings: parseDeckSettings(d.settings) }]))
}

/** Is this card studyable right now (due, learning, or brand new)? */
function isStudyableNow(card, now = new Date()) {
  const state = card.state || 0
  if (state === 0) return true
  return !card.next_review || new Date(card.next_review) <= now
}

/** Shape a card for a review session response. */
function toSessionCard(card, deckIndex, nodeName) {
  const deck = deckIndex.get(card.deck_id)
  return {
    ...card,
    deckName: deck?.name || '',
    nodeName,
    srs_previews: getCardPreviews(card, deck?.settings || parseDeckSettings(null)),
  }
}

/**
 * GET /api/graph
 * The whole graph: node definitions merged with live health, plus edges,
 * tracks (with progress), and aggregate stats.
 */
router.get('/', (req, res) => {
  try {
    const cards = loadCards()
    const remediationCardIds = openRemediationIds()
    const { byNode } = computeGraphHealth(cards, { remediationCardIds })

    const pillarNames = new Map(PILLARS.map((p) => [p.id, p.name]))
    const pillarColors = new Map(PILLARS.map((p) => [p.id, p.color]))

    const nodes = GRAPH_NODES.map((node) => {
      const entry = byNode.get(node.id)
      return {
        id: node.id,
        name: node.name,
        pillarId: node.pillarId,
        pillarName: pillarNames.get(node.pillarId) || node.pillarId,
        pillarColor: pillarColors.get(node.pillarId) || '#818cf8',
        topicId: node.topicId,
        summary: node.summary,
        health: entry.health,
        strength: Math.round(entry.strength * 100) / 100,
        counts: entry.counts,
        ready: entry.ready,
        locked: entry.locked,
      }
    })

    const stats = { mastered: 0, due: 0, decayed: 0, unseen: 0 }
    for (const n of nodes) stats[n.health] += 1

    const tracks = LEARNING_TRACKS.map((track) => {
      const nodeIds = expandTrack(track)
      const mastered = nodeIds.filter((id) => byNode.get(id).health === 'mastered').length
      return {
        id: track.id,
        name: track.name,
        emoji: track.emoji,
        description: track.description,
        nodeIds,
        nodeCount: nodeIds.length,
        masteredCount: mastered,
      }
    })

    res.json({
      nodes,
      edges: GRAPH_EDGES,
      tracks,
      stats,
      remediationCount: remediationCardIds.size,
    })
  } catch (err) {
    logger.error('[graph] Error:', err.message)
    res.status(500).json({ message: 'Failed to compute knowledge graph.' })
  }
})

/**
 * GET /api/graph/nodes/:id
 * Everything the slide-over panel shows for one node: its cards with SRS
 * state, prerequisite/dependent nodes with health, the linked guide topic,
 * and whiteboards containing related components.
 */
router.get('/nodes/:id', (req, res) => {
  const node = nodeMap().get(req.params.id)
  if (!node) return res.status(404).json({ message: 'Node not found' })

  try {
    const cards = loadCards()
    const remediationCardIds = openRemediationIds()
    const now = new Date()
    const { byNode, cardNodeIndex } = computeGraphHealth(cards, { remediationCardIds, now })
    const deckIndex = loadDeckIndex()

    const linkedCards = cards
      .filter((c) => (cardNodeIndex.get(c.id) || []).includes(node.id))
      .map((c) => ({
        id: c.id,
        deck_id: c.deck_id,
        deckName: deckIndex.get(c.deck_id)?.name || '',
        front: c.front,
        state: c.state || 0,
        ease_factor: c.ease_factor ?? 2.5,
        interval: c.interval || 0,
        next_review: c.next_review,
        due: isStudyableNow(c, now),
        remediation: remediationCardIds.has(c.id),
      }))

    const healthOf = (id) => {
      const e = byNode.get(id)
      return { id, name: nodeMap().get(id)?.name || id, health: e.health, strength: e.strength }
    }
    const prereqs = (prerequisitesOf().get(node.id) || []).map(healthOf)
    const dependents = (dependentsOf().get(node.id) || []).map(healthOf)

    // Guide deep link + progress
    let guide = null
    if (node.topicId) {
      const pillar = PILLARS.find((p) => p.id === node.pillarId)
      const topic = pillar?.topics.find((t) => t.id === node.topicId)
      if (topic) {
        const filled = db.prepare(
          "SELECT COUNT(*) AS count FROM guide_content WHERE pillar_id = ? AND topic_id = ? AND content != ''"
        ).get(node.pillarId, node.topicId).count
        guide = { pillarId: node.pillarId, topicId: node.topicId, topicName: topic.name, filledSections: filled }
      }
    }

    // Whiteboards containing any of this node's builder components
    const componentNames = new Set()
    for (const category of BUILDER_COMPONENTS) {
      for (const item of category.items) {
        if (node.components.includes(item.id)) componentNames.add(item.name)
      }
    }
    const boards = []
    if (componentNames.size > 0) {
      for (const board of db.prepare('SELECT id, name, data FROM boards').all()) {
        try {
          const data = JSON.parse(board.data || '{}')
          if ((data.nodes || []).some((n) => componentNames.has(n.name))) {
            boards.push({ id: board.id, name: board.name })
          }
        } catch {
          // Unreadable board data — skip
        }
      }
    }

    const entry = byNode.get(node.id)
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
    })
  } catch (err) {
    logger.error('[graph/nodes] Error:', err.message)
    res.status(500).json({ message: 'Failed to load node details.' })
  }
})

/**
 * POST /api/graph/nodes/:id/session
 * Build a study session from one node's studyable cards (due first).
 */
router.post('/nodes/:id/session', (req, res) => {
  const node = nodeMap().get(req.params.id)
  if (!node) return res.status(404).json({ message: 'Node not found' })

  try {
    const cards = loadCards()
    const now = new Date()
    const { cardNodeIndex } = computeGraphHealth(cards, { now })
    const deckIndex = loadDeckIndex()

    const linked = cards.filter((c) => (cardNodeIndex.get(c.id) || []).includes(node.id))
    const studyable = linked.filter((c) => isStudyableNow(c, now))
    const session = studyable
      .slice(0, 20)
      .map((c) => toSessionCard(c, deckIndex, node.name))

    res.json({ cards: session, nodeName: node.name })
  } catch (err) {
    logger.error('[graph/session] Error:', err.message)
    res.status(500).json({ message: 'Failed to build node session.' })
  }
})

/**
 * POST /api/graph/tracks/:id/session
 * Build a study session for a curated track: cards ordered by the
 * track's prerequisite (topological) node order, due cards first
 * within each node, capped at 30.
 */
router.post('/tracks/:id/session', (req, res) => {
  const track = LEARNING_TRACKS.find((t) => t.id === req.params.id)
  if (!track) return res.status(404).json({ message: 'Track not found' })

  try {
    const cards = loadCards()
    const now = new Date()
    const { cardNodeIndex } = computeGraphHealth(cards, { now })
    const deckIndex = loadDeckIndex()
    const byId = nodeMap()

    const orderedNodeIds = expandTrack(track)
    const session = []
    const used = new Set()

    for (const nodeId of orderedNodeIds) {
      if (session.length >= 30) break
      const nodeName = byId.get(nodeId)?.name || nodeId
      const linked = cards.filter(
        (c) => !used.has(c.id) && (cardNodeIndex.get(c.id) || []).includes(nodeId)
      )
      const studyable = linked.filter((c) => isStudyableNow(c, now))
      // Due/learning cards first, then new cards — both in stable order.
      studyable.sort((a, b) => (a.state === 0 ? 1 : 0) - (b.state === 0 ? 1 : 0))
      for (const card of studyable) {
        if (session.length >= 30) break
        used.add(card.id)
        session.push(toSessionCard(card, deckIndex, nodeName))
      }
    }

    res.json({
      cards: session,
      trackName: track.name,
      nodeOrder: orderedNodeIds,
    })
  } catch (err) {
    logger.error('[graph/tracks] Error:', err.message)
    res.status(500).json({ message: 'Failed to build track session.' })
  }
})

export default router
