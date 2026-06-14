import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router()

/**
 * Anki-style Spaced Repetition Scheduling Algorithm
 * Supports New, Learning, Review, and Relearning states with sub-day step intervals.
 * 
 * Quality maps:
 *   0, 1 -> Again
 *   2, 3 -> Hard
 *   4    -> Good
 *   5    -> Easy
 */
function calculateNextSrsState(card, quality, settings, confidence = 'medium') {
  const ease_factor = card.ease_factor !== undefined && card.ease_factor !== null ? card.ease_factor : 2.5
  const interval = card.interval || 0
  const state = card.state || 0
  const learningStep = card.learning_step || 0

  const steps = settings?.steps ? settings.steps.split(' ').map(s => {
    const val = parseInt(s) || 1
    const unit = s.endsWith('h') ? 'h' : 'm'
    return { val, unit }
  }) : [{ val: 1, unit: 'm' }, { val: 10, unit: 'm' }]

  const lapseSteps = settings?.lapse_steps ? settings.lapse_steps.split(' ').map(s => {
    const val = parseInt(s) || 10
    const unit = s.endsWith('h') ? 'h' : 'm'
    return { val, unit }
  }) : [{ val: 10, unit: 'm' }]

  const easyBonus = settings?.easy_bonus || 1.3

  let nextState = state
  let nextLearningStep = learningStep
  let nextInterval = interval
  let nextRepetitions = card.repetitions || 0
  let nextEase = ease_factor

  const now = new Date()
  let nextReviewDate = new Date()

  const addTime = (date, val, unit) => {
    if (unit === 'h') {
      return new Date(date.getTime() + val * 60 * 60 * 1000)
    }
    return new Date(date.getTime() + val * 60 * 1000)
  }

  if (state === 0) { // New
    if (quality < 3) { // Again
      nextState = 1 // Learning
      nextLearningStep = 0
      nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit)
      nextInterval = 0
      
      // Hypercorrection Penalty
      if (confidence === 'high') {
        nextEase = Math.max(1.3, nextEase - 0.4)
        nextReviewDate = addTime(now, Math.max(1, lapseSteps[0].val / 2), lapseSteps[0].unit)
      } else {
        nextEase = Math.max(1.3, nextEase - 0.2)
      }
      nextRepetitions = 0
    } else if (quality === 3) { // Hard
      nextState = 1 // Learning
      nextLearningStep = 0
      const firstVal = steps[0].val * (steps[0].unit === 'h' ? 60 : 1)
      const secondVal = (steps[1] || steps[0]).val * ((steps[1] || steps[0]).unit === 'h' ? 60 : 1)
      const stepVal = Math.round((firstVal + secondVal) / 2)
      nextReviewDate = addTime(now, stepVal, 'm')
      nextInterval = 0
      nextRepetitions = 0
    } else if (quality === 4) { // Good
      nextState = 1 // Learning
      if (steps.length > 1) {
        nextLearningStep = 1
        nextReviewDate = addTime(now, steps[1].val, steps[1].unit)
        nextRepetitions = 0
      } else {
        // Graduate immediately
        nextState = 2 // Review
        nextLearningStep = 0
        nextInterval = 1
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        nextRepetitions = 1
      }
    } else { // Easy
      nextState = 2 // Review
      nextLearningStep = 0
      nextInterval = 4
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      nextRepetitions = 1
    }
  } 
  else if (state === 1) { // Learning
    if (quality < 3) { // Again
      nextLearningStep = 0
      nextReviewDate = addTime(now, steps[0].val, steps[0].unit)
      nextInterval = 0
    } else if (quality === 3) { // Hard
      const currentVal = steps[nextLearningStep].val * (steps[nextLearningStep].unit === 'h' ? 60 : 1)
      const stepVal = Math.round(currentVal * 1.5)
      nextReviewDate = addTime(now, stepVal, 'm')
      nextInterval = 0
    } else if (quality === 4) { // Good
      if (nextLearningStep < steps.length - 1) {
        nextLearningStep += 1
        nextReviewDate = addTime(now, steps[nextLearningStep].val, steps[nextLearningStep].unit)
        nextInterval = 0
      } else {
        // Graduate
        nextState = 2 // Review
        nextLearningStep = 0
        nextInterval = 1
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        nextRepetitions = 1
      }
    } else { // Easy
      nextState = 2 // Review
      nextLearningStep = 0
      nextInterval = 4
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      nextRepetitions = 1
    }
  } 
  else if (state === 2) { // Review
    if (quality < 3) { // Again (Lapse)
      nextState = 3 // Relearning
      nextLearningStep = 0
      
      // Hypercorrection Penalty
      if (confidence === 'high') {
        nextEase = Math.max(1.3, ease_factor - 0.40)
        nextReviewDate = addTime(now, Math.max(1, lapseSteps[0].val / 2), lapseSteps[0].unit)
      } else {
        nextEase = Math.max(1.3, ease_factor - 0.20)
        nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit)
      }
      
      nextInterval = 0
      nextRepetitions = 0
    } else if (quality === 3) { // Hard
      nextEase = Math.max(1.3, ease_factor - 0.15)
      nextInterval = Math.max(1, Math.round(interval * 1.2))
      nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)
      nextRepetitions += 1
    } else if (quality === 4) { // Good
      nextInterval = Math.max(1, Math.round(interval * ease_factor))
      nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)
      nextRepetitions += 1
    } else { // Easy
      nextEase = ease_factor + 0.15
      nextInterval = Math.max(1, Math.round(interval * ease_factor * easyBonus))
      nextReviewDate = new Date(now.getTime() + nextInterval * 24 * 60 * 60 * 1000)
      nextRepetitions += 1
    }
  } 
  else if (state === 3) { // Relearning
    if (quality < 3) { // Again
      nextLearningStep = 0
      nextReviewDate = addTime(now, lapseSteps[0].val, lapseSteps[0].unit)
      nextInterval = 0
    } else if (quality === 3) { // Hard
      const currentVal = lapseSteps[nextLearningStep].val * (lapseSteps[nextLearningStep].unit === 'h' ? 60 : 1)
      const stepVal = Math.round(currentVal * 1.5)
      nextReviewDate = addTime(now, stepVal, 'm')
      nextInterval = 0
    } else if (quality === 4) { // Good
      if (nextLearningStep < lapseSteps.length - 1) {
        nextLearningStep += 1
        nextReviewDate = addTime(now, lapseSteps[nextLearningStep].val, lapseSteps[nextLearningStep].unit)
        nextInterval = 0
      } else {
        // Graduate
        nextState = 2 // Review
        nextLearningStep = 0
        nextInterval = 1
        nextReviewDate = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000)
        nextRepetitions = 1
      }
    } else { // Easy
      nextState = 2 // Review
      nextLearningStep = 0
      nextInterval = 4
      nextReviewDate = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000)
      nextRepetitions = 1
    }
  }

  return {
    ease_factor: Math.round(nextEase * 100) / 100,
    interval: nextInterval,
    repetitions: nextRepetitions,
    state: nextState,
    learning_step: nextLearningStep,
    next_review: nextReviewDate.toISOString(),
    last_reviewed: now.toISOString(),
  }
}

/**
 * Get visual interval preview string for all 4 ratings (Again, Hard, Good, Easy)
 */
function getCardPreviews(card, settings) {
  const now = new Date()
  
  const againState = calculateNextSrsState(card, 1, settings)
  const hardState = calculateNextSrsState(card, 3, settings)
  const goodState = calculateNextSrsState(card, 4, settings)
  const easyState = calculateNextSrsState(card, 5, settings)

  const formatStr = (nextReviewStr, interval, state) => {
    if (state === 1 || state === 3) {
      const diffMs = new Date(nextReviewStr) - now
      const diffMins = Math.max(1, Math.round(diffMs / (60 * 1000)))
      if (diffMins < 60) return `${diffMins}m`
      const diffHours = Math.round(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h`
      return `${Math.round(diffHours / 24)}d`
    } else {
      if (interval < 30) return `${interval}d`
      if (interval < 365) return `${Math.round(interval / 30)}mo`
      return `${Math.round(interval / 365)}y`
    }
  }

  return {
    again: formatStr(againState.next_review, againState.interval, againState.state),
    hard: formatStr(hardState.next_review, hardState.interval, hardState.state),
    good: formatStr(goodState.next_review, goodState.interval, goodState.state),
    easy: formatStr(easyState.next_review, easyState.interval, easyState.state)
  }
}

/**
 * Format ISO timestamp to relative time string.
 */
function formatRelativeTime(dateStr) {
  if (!dateStr) return 'Never studied'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now - date
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  if (diffDays <= 0) return 'Today'
  if (diffDays === 1) return 'Yesterday'
  return `${diffDays} days ago`
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

    let settings = { new_limit: 20, review_limit: 200, steps: '1m 10m', lapse_steps: '10m', easy_bonus: 1.3 }
    if (row.settings) {
      try {
        settings = { ...settings, ...JSON.parse(row.settings) }
      } catch {
        // ignore
      }
    }

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

  let settings = { new_limit: 20, review_limit: 200, steps: '1m 10m', lapse_steps: '10m', easy_bonus: 1.3 }
  if (deck.settings) {
    try {
      settings = { ...settings, ...JSON.parse(deck.settings) }
    } catch {
      // ignore
    }
  }

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

  for (const deck of allDecks) {
    const deckId = deck.id
    let settings = { new_limit: 20, review_limit: 200, steps: '1m 10m', lapse_steps: '10m', easy_bonus: 1.3 }
    if (deck.settings) {
      try {
        settings = { ...settings, ...JSON.parse(deck.settings) }
      } catch {
        // ignore
      }
    }

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

  res.json(allDueCards)
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

  let settings = { new_limit: 20, review_limit: 200, steps: '1m 10m', lapse_steps: '10m', easy_bonus: 1.3 }
  if (deck.settings) {
    try {
      settings = { ...settings, ...JSON.parse(deck.settings) }
    } catch {
      // ignore
    }
  }

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

  const combined = [...learningCards, ...reviewCards, ...newCards]

  // Attach previews and deck name
  const combinedWithPreviews = combined.map(c => ({
    ...c,
    deckName: deck.name,
    srs_previews: getCardPreviews(c, settings)
  }))

  res.json(combinedWithPreviews)
})

/**
 * POST /api/decks/:deckId/cards
 */
router.post('/:deckId/cards', (req, res) => {
  const { front, back, prerequisite_id } = req.body
  if (!front || !back) return res.status(400).json({ message: 'Front and back are required' })

  const id = uuid()
  const maxPos = db.prepare(
    'SELECT MAX(position) as max FROM flashcards WHERE deck_id = ?'
  ).get(req.params.deckId)

  db.prepare(
    'INSERT INTO flashcards (id, deck_id, front, back, position, prerequisite_id) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(id, req.params.deckId, front, back, (maxPos?.max || 0) + 1, prerequisite_id || null)

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
 * PUT /api/decks/:deckId/cards/:cardId/review
 * Record a review for a card
 */
router.put('/:deckId/cards/:cardId/review', (req, res) => {
  const { quality, confidence } = req.body
  if (quality === undefined || quality < 0 || quality > 5) {
    return res.status(400).json({ message: 'Quality must be 0-5' })
  }

  const card = db.prepare(
    'SELECT * FROM flashcards WHERE id = ? AND deck_id = ?'
  ).get(req.params.cardId, req.params.deckId)

  if (!card) return res.status(404).json({ message: 'Card not found' })

  const deck = db.prepare('SELECT settings FROM decks WHERE id = ?').get(req.params.deckId)
  let settings = { new_limit: 20, review_limit: 200, steps: '1m 10m', lapse_steps: '10m', easy_bonus: 1.3 }
  if (deck?.settings) {
    try {
      settings = { ...settings, ...JSON.parse(deck.settings) }
    } catch {
      // ignore
    }
  }

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

  const result = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(req.params.cardId)
  // Append previews to result
  result.srs_previews = getCardPreviews(result, settings)

  res.json(result)
})

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
