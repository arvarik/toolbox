import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'
import {
  calculateNextSrsState,
  getCardPreviews,
  formatRelativeTime,
  parseDeckSettings,
} from '../srs/scheduler.js'
import { planRemediation } from '../graph/remediation.js'
import logger from '../utils/logger.js'

const router = Router()

/*
 * SM-2 scheduling lives in server/srs/scheduler.js (shared with the
 * knowledge-graph routes). Prerequisite remediation planning lives in
 * server/graph/remediation.js.
 */

/**
 * Merge unresolved remediation-queue cards into a session queue.
 * These are "foundational checkups" scheduled by the knowledge graph
 * after a lapse on a dependent concept:
 *   - a queued card already in the session gets tagged and moved first
 *   - a queued card missing from the session is prepended
 *
 * @param {Array} sessionCards - Cards already selected for the session.
 * @param {string|null} deckId - Limit checkups to one deck, or null for all.
 * @returns {Array} The reordered session with remediation cards leading.
 */
function applyRemediation(sessionCards, deckId) {
  const rows = deckId
    ? db.prepare(`
        SELECT f.*, r.reason AS remediation_reason, r.node_name AS remediation_node
        FROM remediation_queue r
        JOIN flashcards f ON f.id = r.card_id
        WHERE r.resolved_at IS NULL AND f.deck_id = ?
        ORDER BY r.created_at ASC
        LIMIT 10
      `).all(deckId)
    : db.prepare(`
        SELECT f.*, r.reason AS remediation_reason, r.node_name AS remediation_node
        FROM remediation_queue r
        JOIN flashcards f ON f.id = r.card_id
        WHERE r.resolved_at IS NULL
        ORDER BY r.created_at ASC
        LIMIT 10
      `).all()

  if (rows.length === 0) return sessionCards

  const meta = new Map()
  for (const row of rows) {
    if (!meta.has(row.id)) meta.set(row.id, row)
  }

  const leading = []
  const rest = []
  const present = new Set()
  for (const card of sessionCards) {
    const tag = meta.get(card.id)
    if (tag) {
      present.add(card.id)
      leading.push({
        ...card,
        is_remediation: 1,
        remediation_reason: tag.remediation_reason,
        remediation_node: tag.remediation_node,
      })
    } else {
      rest.push(card)
    }
  }

  // Queued cards that were not otherwise due join the front of the session.
  const missing = rows
    .filter((row) => !present.has(row.id))
    .map((row) => ({ ...row, is_remediation: 1 }))

  return [...missing, ...leading, ...rest]
}


/**
 * GET /api/decks
 * List all decks with card counts and due counts.
 */
router.get('/', (req, res) => {
  const results = db.prepare(`
    SELECT d.*,
      COUNT(f.id) as card_count,
      SUM(CASE WHEN f.state = 0 OR f.state IS NULL THEN 1 ELSE 0 END) as new_count,
      SUM(CASE WHEN f.state IN (1, 3) THEN 1 ELSE 0 END) as learn_count,
      SUM(CASE WHEN f.state = 2 AND (f.next_review IS NULL OR f.next_review <= datetime('now')) THEN 1 ELSE 0 END) as due_count,
      MAX(f.last_reviewed) as last_reviewed_raw,
      SUM(CASE WHEN f.repetitions > 0 THEN 1 ELSE 0 END) as reviewed_count
    FROM decks d
    LEFT JOIN flashcards f ON f.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `).all()

  const decks = results.map(row => {
    const cardCount = row.card_count || 0
    const reviewedCount = row.reviewed_count || 0
    const progress = cardCount > 0 ? Math.round((reviewedCount / cardCount) * 100) : 0

    const deck = { ...row }
    delete deck.last_reviewed_raw
    delete deck.reviewed_count

    const settings = parseDeckSettings(row.settings)

    return {
      ...deck,
      new_count: row.new_count || 0,
      learn_count: row.learn_count || 0,
      due_count: row.due_count || 0,
      settings,
      progress,
      last_studied: formatRelativeTime(row.last_reviewed_raw)
    }
  })

  res.json(decks)
})

/**
 * GET /api/decks/:id
 * Get a single deck with its cards.
 */
router.get('/:id', (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id)
  if (!deck) return res.status(404).json({ message: 'Deck not found' })

  const settings = parseDeckSettings(deck.settings)

  const cards = db.prepare(
    'SELECT * FROM flashcards WHERE deck_id = ? ORDER BY position'
  ).all(req.params.id)

  const cardsWithPreviews = cards.map(c => ({
    ...c,
    srs_previews: getCardPreviews(c, settings)
  }))

  const newCount = cards.filter(c => (c.state || 0) === 0).length
  const learnCount = cards.filter(c => c.state === 1 || c.state === 3).length
  const dueCount = cards.filter(c =>
    (c.state || 0) === 2 && (!c.next_review || new Date(c.next_review) <= new Date())
  ).length

  const reviewedCount = cards.filter(c => c.repetitions > 0).length
  const progress = cards.length > 0 ? Math.round((reviewedCount / cards.length) * 100) : 0
  const maxLastReviewed = cards.reduce((max, c) => {
    if (!c.last_reviewed) return max
    return !max || new Date(c.last_reviewed) > new Date(max) ? c.last_reviewed : max
  }, null)

  res.json({
    ...deck,
    settings,
    cards: cardsWithPreviews,
    new_count: newCount,
    learn_count: learnCount,
    due_count: dueCount,
    progress,
    last_studied: formatRelativeTime(maxLastReviewed)
  })
})

/**
 * POST /api/decks
 * Create a new deck.
 */
router.post('/', (req, res) => {
  const { name, description, color_index, tags } = req.body
  if (!name) return res.status(400).json({ message: 'Name is required' })

  const id = uuid()
  db.prepare(
    'INSERT INTO decks (id, name, description, color_index, tags) VALUES (?, ?, ?, ?, ?)'
  ).run(id, name, description || '', color_index || 0, tags || '')

  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(id)
  res.status(201).json(deck)
})

/**
 * PUT /api/decks/:id
 * Update a deck.
 */
router.put('/:id', (req, res) => {
  const { name, description, color_index, tags } = req.body
  const existing = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ message: 'Deck not found' })

  db.prepare(`
    UPDATE decks SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      color_index = COALESCE(?, color_index),
      tags = COALESCE(?, tags),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, color_index, tags, req.params.id)

  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id)
  res.json(deck)
})

/**
 * PUT /api/decks/:deckId/settings
 * Update settings for a deck.
 */
router.put('/:deckId/settings', (req, res) => {
  const { new_limit, review_limit, steps, lapse_steps, easy_bonus } = req.body

  const existing = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.deckId)
  if (!existing) return res.status(404).json({ message: 'Deck not found' })

  let currentSettings = {}
  if (existing.settings) {
    try {
      currentSettings = JSON.parse(existing.settings)
    } catch {
      // ignore
    }
  }

  const updatedSettings = {
    ...currentSettings,
    new_limit: new_limit !== undefined ? parseInt(new_limit) : currentSettings.new_limit || 20,
    review_limit: review_limit !== undefined ? parseInt(review_limit) : currentSettings.review_limit || 200,
    steps: steps !== undefined ? steps.trim() : currentSettings.steps || '1m 10m',
    lapse_steps: lapse_steps !== undefined ? lapse_steps.trim() : currentSettings.lapse_steps || '10m',
    easy_bonus: easy_bonus !== undefined ? parseFloat(easy_bonus) : currentSettings.easy_bonus || 1.3
  }

  db.prepare(`
    UPDATE decks SET
      settings = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(updatedSettings), req.params.deckId)

  res.json({ id: req.params.deckId, settings: updatedSettings })
})

/**
 * DELETE /api/decks/:id
 * Delete a deck and its cards (cascading).
 */
router.delete('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ message: 'Deck not found' })

  db.prepare('DELETE FROM decks WHERE id = ?').run(req.params.id)
  res.status(204).send()
})

/* ---- Flashcard sub-routes ---- */

/**
 * GET /api/decks/all/cards/due
 * Get cards due for review across ALL decks, scrambled.
 */
router.get('/all/cards/due', (req, res) => {
  const allDecks = db.prepare('SELECT id, name, settings FROM decks').all()
  let allDueCards = []

  const getNewReviewedToday = db.prepare(`
    SELECT COUNT(*) as count FROM flashcards
    WHERE deck_id = ?
      AND last_reviewed IS NOT NULL
      AND date(last_reviewed, 'localtime') = date('now', 'localtime')
      AND repetitions = 1
  `)

  const getReviewsToday = db.prepare(`
    SELECT COUNT(*) as count FROM flashcards
    WHERE deck_id = ?
      AND last_reviewed IS NOT NULL
      AND date(last_reviewed, 'localtime') = date('now', 'localtime')
      AND repetitions > 1
  `)

  const getLearningCards = db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND state IN (1, 3)
      AND (next_review IS NULL OR next_review <= datetime('now'))
      AND (prerequisite_id IS NULL OR prerequisite_id = '' OR EXISTS (SELECT 1 FROM flashcards p WHERE p.id = flashcards.prerequisite_id AND p.state = 2 AND p.ease_factor >= 2.5))
    ORDER BY next_review ASC
  `)

  const getReviewCards = db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND state = 2
      AND (next_review IS NULL OR next_review <= datetime('now'))
      AND (prerequisite_id IS NULL OR prerequisite_id = '' OR EXISTS (SELECT 1 FROM flashcards p WHERE p.id = flashcards.prerequisite_id AND p.state = 2 AND p.ease_factor >= 2.5))
    ORDER BY next_review ASC
    LIMIT ?
  `)

  const getNewCards = db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND state = 0
      AND next_review IS NULL
      AND (prerequisite_id IS NULL OR prerequisite_id = '' OR EXISTS (SELECT 1 FROM flashcards p WHERE p.id = flashcards.prerequisite_id AND p.state = 2 AND p.ease_factor >= 2.5))
    ORDER BY position ASC, id ASC
    LIMIT ?
  `)

  const deckNames = new Map(allDecks.map(d => [d.id, d.name]))
  const deckSettings = new Map(allDecks.map(d => [d.id, parseDeckSettings(d.settings)]))

  for (const deck of allDecks) {
    const deckId = deck.id
    const settings = deckSettings.get(deckId)

    const newReviewedToday = getNewReviewedToday.get(deckId).count
    const reviewsToday = getReviewsToday.get(deckId).count

    const learningCards = getLearningCards.all(deckId)

    const remainingReviews = Math.max(0, settings.review_limit - reviewsToday)
    const reviewCards = remainingReviews > 0 ? getReviewCards.all(deckId, remainingReviews) : []

    const remainingNew = Math.max(0, settings.new_limit - newReviewedToday)
    const newCards = remainingNew > 0 ? getNewCards.all(deckId, remainingNew) : []

    const combined = [...learningCards, ...reviewCards, ...newCards]
    const combinedWithPreviews = combined.map(c => ({
      ...c,
      deckName: deck.name,
      srs_previews: getCardPreviews(c, settings)
    }))

    allDueCards = [...allDueCards, ...combinedWithPreviews]
  }

  // Shuffle all due cards (Fisher-Yates)
  for (let i = allDueCards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allDueCards[i], allDueCards[j]] = [allDueCards[j], allDueCards[i]]
  }

  // Foundational checkups lead the session, ahead of the shuffled queue.
  const withRemediation = applyRemediation(allDueCards, null).map(c => ({
    ...c,
    deckName: c.deckName ?? (deckNames.get(c.deck_id) || ''),
    srs_previews: c.srs_previews ?? getCardPreviews(c, deckSettings.get(c.deck_id) || parseDeckSettings(null)),
  }))

  res.json(withRemediation)
})

/**
 * GET /api/decks/:deckId/cards
 */
router.get('/:deckId/cards', (req, res) => {
  const cards = db.prepare(
    'SELECT * FROM flashcards WHERE deck_id = ? ORDER BY position'
  ).all(req.params.deckId)
  res.json(cards)
})

/**
 * GET /api/decks/:deckId/cards/due
 * Get cards due for review (next_review <= now or never reviewed) adhering to limits.
 */
router.get('/:deckId/cards/due', (req, res) => {
  const deckId = req.params.deckId
  const deck = db.prepare('SELECT name, settings FROM decks WHERE id = ?').get(deckId)
  if (!deck) return res.status(404).json({ message: 'Deck not found' })

  const settings = parseDeckSettings(deck.settings)

  // Count new cards started today
  const newReviewedToday = db.prepare(`
    SELECT COUNT(*) as count FROM flashcards
    WHERE deck_id = ?
      AND last_reviewed IS NOT NULL
      AND date(last_reviewed, 'localtime') = date('now', 'localtime')
      AND repetitions = 1
  `).get(deckId).count

  // Count review cards reviewed today
  const reviewsToday = db.prepare(`
    SELECT COUNT(*) as count FROM flashcards
    WHERE deck_id = ?
      AND last_reviewed IS NOT NULL
      AND date(last_reviewed, 'localtime') = date('now', 'localtime')
      AND repetitions > 1
  `).get(deckId).count

  // 1. Learning/relearning cards are always loaded if due
  const learningCards = db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND state IN (1, 3)
      AND (next_review IS NULL OR next_review <= datetime('now'))
      AND (prerequisite_id IS NULL OR prerequisite_id = '' OR EXISTS (SELECT 1 FROM flashcards p WHERE p.id = flashcards.prerequisite_id AND p.state = 2 AND p.ease_factor >= 2.5))
    ORDER BY next_review ASC
  `).all(deckId)

  // 2. Review cards (due review cards, limited by remaining review limit)
  const remainingReviews = Math.max(0, settings.review_limit - reviewsToday)
  const reviewCards = remainingReviews > 0 ? db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND state = 2
      AND (next_review IS NULL OR next_review <= datetime('now'))
      AND (prerequisite_id IS NULL OR prerequisite_id = '' OR EXISTS (SELECT 1 FROM flashcards p WHERE p.id = flashcards.prerequisite_id AND p.state = 2 AND p.ease_factor >= 2.5))
    ORDER BY next_review ASC
    LIMIT ?
  `).all(deckId, remainingReviews) : []

  // 3. New cards (limited by remaining new limit)
  const remainingNew = Math.max(0, settings.new_limit - newReviewedToday)
  const newCards = remainingNew > 0 ? db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND state = 0
      AND next_review IS NULL
      AND (prerequisite_id IS NULL OR prerequisite_id = '' OR EXISTS (SELECT 1 FROM flashcards p WHERE p.id = flashcards.prerequisite_id AND p.state = 2 AND p.ease_factor >= 2.5))
    ORDER BY position ASC, id ASC
    LIMIT ?
  `).all(deckId, remainingNew) : []

  // Foundational checkups (knowledge-graph remediation) lead the session.
  const combined = applyRemediation(
    [...learningCards, ...reviewCards, ...newCards],
    deckId
  )

  // Attach previews and deck name
  const combinedWithPreviews = combined.map(c => ({
    ...c,
    deckName: deck.name,
    srs_previews: getCardPreviews(c, settings)
  }))

  res.json(combinedWithPreviews)
})

/**
 * POST /api/decks/:deckId/cards/check-duplicates
 * Check incoming cards against existing cards in the deck for duplicates.
 * Uses trigram-based Jaccard similarity for fast text matching.
 * Body: { cards: [{ front, back }] }
 */
router.post('/:deckId/cards/check-duplicates', (req, res) => {
  const { cards } = req.body
  if (!cards || !Array.isArray(cards)) {
    return res.status(400).json({ message: 'cards array is required' })
  }

  const existingCards = db.prepare(
    'SELECT id, front, back FROM flashcards WHERE deck_id = ?'
  ).all(req.params.deckId)

  // Generate trigrams from text for Jaccard similarity
  const trigrams = (text) => {
    const normalized = text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim()
    const tris = new Set()
    for (let i = 0; i <= normalized.length - 3; i++) {
      tris.add(normalized.substring(i, i + 3))
    }
    return tris
  }

  const jaccard = (setA, setB) => {
    if (setA.size === 0 && setB.size === 0) return 1
    let intersection = 0
    for (const item of setA) {
      if (setB.has(item)) intersection++
    }
    const union = setA.size + setB.size - intersection
    return union === 0 ? 0 : intersection / union
  }

  // Pre-compute trigrams for existing cards
  const existingTrigrams = existingCards.map(c => ({
    card: c,
    frontTri: trigrams(c.front),
    backTri: trigrams(c.back),
    combinedTri: trigrams(c.front + ' ' + c.back),
  }))

  const results = cards.map(incoming => {
    const incomingFrontTri = trigrams(incoming.front)
    const incomingCombinedTri = trigrams(incoming.front + ' ' + incoming.back)
    
    let bestMatch = null
    let bestSimilarity = 0

    for (const existing of existingTrigrams) {
      // Check front-to-front similarity (catches rephrased questions)
      const frontSim = jaccard(incomingFrontTri, existing.frontTri)
      // Check combined similarity (catches full card duplication)
      const combinedSim = jaccard(incomingCombinedTri, existing.combinedTri)
      const maxSim = Math.max(frontSim, combinedSim)

      if (maxSim > bestSimilarity) {
        bestSimilarity = maxSim
        bestMatch = existing.card
      }
    }

    const isDuplicate = bestSimilarity > 0.55
    return {
      ...incoming,
      isDuplicate,
      similarity: Math.round(bestSimilarity * 100),
      duplicateOf: isDuplicate ? { front: bestMatch.front, back: bestMatch.back } : null,
    }
  })

  res.json({ results })
})

/**
 * POST /api/decks/:deckId/cards
 */
router.post('/:deckId/cards', (req, res) => {
  const { front, back, prerequisite_id, source_pillar_id, source_topic_id, source_section_id, is_reverse, reverse_of_id } = req.body
  if (!front || !back) return res.status(400).json({ message: 'Front and back are required' })

  const id = uuid()
  const maxPos = db.prepare(
    'SELECT MAX(position) as max FROM flashcards WHERE deck_id = ?'
  ).get(req.params.deckId)

  db.prepare(
    `INSERT INTO flashcards (id, deck_id, front, back, position, prerequisite_id, source_pillar_id, source_topic_id, source_section_id, is_reverse, reverse_of_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id, req.params.deckId, front, back, (maxPos?.max || 0) + 1,
    prerequisite_id || null,
    source_pillar_id || null, source_topic_id || null, source_section_id || null,
    is_reverse ? 1 : 0, reverse_of_id || null
  )

  db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(req.params.deckId)

  const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id)
  res.status(201).json(card)
})

/**
 * PUT /api/decks/:deckId/cards/:cardId
 */
router.put('/:deckId/cards/:cardId', (req, res) => {
  const { front, back, position, prerequisite_id } = req.body

  const current = db.prepare('SELECT prerequisite_id FROM flashcards WHERE id = ?').get(req.params.cardId)
  const newPrereq = prerequisite_id !== undefined ? (prerequisite_id || null) : current?.prerequisite_id

  db.prepare(`
    UPDATE flashcards SET
      front = COALESCE(?, front),
      back = COALESCE(?, back),
      position = COALESCE(?, position),
      prerequisite_id = ?,
      updated_at = datetime('now')
    WHERE id = ? AND deck_id = ?
  `).run(front, back, position, newPrereq, req.params.cardId, req.params.deckId)

  const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(req.params.cardId)
  if (!card) return res.status(404).json({ message: 'Card not found' })
  res.json(card)
})

/**
 * PUT|POST /api/decks/:deckId/cards/:cardId/review
 * Record a review for a card. Registered for both verbs — older clients
 * and queued offline mutations send POST.
 *
 * Side effects beyond SM-2 scheduling:
 *  - Resolves any open remediation-queue rows for this card.
 *  - On a failure (quality < 3), asks the knowledge-graph remediation
 *    engine for shaky prerequisite cards and queues them for the next
 *    session. The response carries the plan so the UI can explain it.
 */
function handleReview(req, res) {
  const { quality, confidence } = req.body
  if (quality === undefined || quality < 0 || quality > 5) {
    return res.status(400).json({ message: 'Quality must be 0-5' })
  }

  const card = db.prepare(
    'SELECT * FROM flashcards WHERE id = ? AND deck_id = ?'
  ).get(req.params.cardId, req.params.deckId)

  if (!card) return res.status(404).json({ message: 'Card not found' })

  const deck = db.prepare('SELECT settings FROM decks WHERE id = ?').get(req.params.deckId)
  const settings = parseDeckSettings(deck?.settings)

  const updated = calculateNextSrsState(card, quality, settings, confidence)

  db.prepare(`
    UPDATE flashcards SET
      ease_factor = ?,
      interval = ?,
      repetitions = ?,
      next_review = ?,
      last_reviewed = ?,
      state = ?,
      learning_step = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updated.ease_factor,
    updated.interval,
    updated.repetitions,
    updated.next_review,
    updated.last_reviewed,
    updated.state,
    updated.learning_step,
    req.params.cardId
  )

  // Increment study sessions for today's heatmap
  db.prepare(`
    INSERT INTO study_sessions (date, count)
    VALUES (date('now', 'localtime'), 1)
    ON CONFLICT(date) DO UPDATE SET count = count + 1
  `).run()

  // Reviewing a card settles its pending foundational checkup, if any.
  db.prepare(`
    UPDATE remediation_queue SET resolved_at = datetime('now')
    WHERE card_id = ? AND resolved_at IS NULL
  `).run(req.params.cardId)

  // On failure, queue shaky prerequisite cards for the next session.
  let remediation = []
  if (quality < 3) {
    try {
      const allCards = db.prepare(
        'SELECT id, front, back, state, ease_factor, interval, next_review, prerequisite_id, source_topic_id FROM flashcards'
      ).all()
      const plan = planRemediation(card, allCards)

      const hasOpenRow = db.prepare(
        'SELECT 1 FROM remediation_queue WHERE card_id = ? AND resolved_at IS NULL'
      )
      const insert = db.prepare(`
        INSERT INTO remediation_queue (card_id, source_card_id, node_id, node_name, reason)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const item of plan) {
        if (hasOpenRow.get(item.cardId)) continue
        insert.run(item.cardId, card.id, item.nodeId, item.nodeName, item.reason)
        const prereqCard = allCards.find((c) => c.id === item.cardId)
        remediation.push({
          cardId: item.cardId,
          front: prereqCard?.front || '',
          nodeName: item.nodeName,
          reason: item.reason,
        })
      }
    } catch (err) {
      // Remediation must never break the review flow.
      logger.error('[decks/review] Remediation planning failed:', err.message)
    }
  }

  const result = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(req.params.cardId)
  // Append previews to result
  result.srs_previews = getCardPreviews(result, settings)
  result.remediation = remediation

  res.json(result)
}

router.put('/:deckId/cards/:cardId/review', handleReview)
router.post('/:deckId/cards/:cardId/review', handleReview)

/**
 * DELETE /api/decks/:deckId/cards/:cardId
 */
router.delete('/:deckId/cards/:cardId', (req, res) => {
  db.prepare('DELETE FROM flashcards WHERE id = ? AND deck_id = ?')
    .run(req.params.cardId, req.params.deckId)
  db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(req.params.deckId)
  res.status(204).send()
})

export default router
