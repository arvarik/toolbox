import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router()

/**
 * SM-2 Spaced Repetition Algorithm
 * @param {Object} card - Current card state (ease_factor, interval, repetitions)
 * @param {number} quality - User rating: 0=Again, 3=Hard, 4=Good, 5=Easy
 * @returns {Object} Updated SRS fields
 */
function sm2(card, quality) {
  let { ease_factor = 2.5, interval = 0, repetitions = 0 } = card

  if (quality < 3) {
    // Failed — reset
    repetitions = 0
    interval = 0
  } else {
    // Passed
    if (repetitions === 0) {
      interval = 1
    } else if (repetitions === 1) {
      interval = 6
    } else {
      interval = Math.round(interval * ease_factor)
    }
    repetitions += 1
  }

  // Update ease factor (never below 1.3)
  ease_factor = Math.max(
    1.3,
    ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
  )

  // Calculate next review date
  const now = new Date()
  const nextReview = new Date(now.getTime() + interval * 24 * 60 * 60 * 1000)

  return {
    ease_factor: Math.round(ease_factor * 100) / 100,
    interval,
    repetitions,
    next_review: nextReview.toISOString(),
    last_reviewed: now.toISOString(),
  }
}

/**
 * GET /api/decks
 * List all decks with card counts and due counts.
 */
router.get('/', (req, res) => {
  const decks = db.prepare(`
    SELECT d.*,
      COUNT(f.id) as card_count,
      SUM(CASE WHEN f.next_review IS NULL OR f.next_review <= datetime('now') THEN 1 ELSE 0 END) as due_count
    FROM decks d
    LEFT JOIN flashcards f ON f.deck_id = d.id
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `).all()
  res.json(decks)
})

/**
 * GET /api/decks/:id
 * Get a single deck with its cards.
 */
router.get('/:id', (req, res) => {
  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id)
  if (!deck) return res.status(404).json({ message: 'Deck not found' })

  const cards = db.prepare(
    'SELECT * FROM flashcards WHERE deck_id = ? ORDER BY position'
  ).all(req.params.id)

  const dueCount = cards.filter((c) =>
    !c.next_review || new Date(c.next_review) <= new Date()
  ).length

  res.json({ ...deck, cards, due_count: dueCount })
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
 * Get cards due for review (next_review <= now or never reviewed).
 */
router.get('/:deckId/cards/due', (req, res) => {
  const cards = db.prepare(`
    SELECT * FROM flashcards
    WHERE deck_id = ?
      AND (next_review IS NULL OR next_review <= datetime('now'))
    ORDER BY
      CASE WHEN next_review IS NULL THEN 0 ELSE 1 END,
      next_review ASC
  `).all(req.params.deckId)
  res.json(cards)
})

/**
 * POST /api/decks/:deckId/cards
 */
router.post('/:deckId/cards', (req, res) => {
  const { front, back } = req.body
  if (!front || !back) return res.status(400).json({ message: 'Front and back are required' })

  const id = uuid()
  const maxPos = db.prepare(
    'SELECT MAX(position) as max FROM flashcards WHERE deck_id = ?'
  ).get(req.params.deckId)

  db.prepare(
    'INSERT INTO flashcards (id, deck_id, front, back, position) VALUES (?, ?, ?, ?, ?)'
  ).run(id, req.params.deckId, front, back, (maxPos?.max || 0) + 1)

  db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(req.params.deckId)

  const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id)
  res.status(201).json(card)
})

/**
 * PUT /api/decks/:deckId/cards/:cardId
 */
router.put('/:deckId/cards/:cardId', (req, res) => {
  const { front, back, position } = req.body

  db.prepare(`
    UPDATE flashcards SET
      front = COALESCE(?, front),
      back = COALESCE(?, back),
      position = COALESCE(?, position),
      updated_at = datetime('now')
    WHERE id = ? AND deck_id = ?
  `).run(front, back, position, req.params.cardId, req.params.deckId)

  const card = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(req.params.cardId)
  if (!card) return res.status(404).json({ message: 'Card not found' })
  res.json(card)
})

/**
 * POST /api/decks/:deckId/cards/:cardId/review
 * Submit a review rating for a card (SRS).
 * Body: { quality } — 0=Again, 3=Hard, 4=Good, 5=Easy
 */
router.post('/:deckId/cards/:cardId/review', (req, res) => {
  const { quality } = req.body
  if (quality === undefined || quality < 0 || quality > 5) {
    return res.status(400).json({ message: 'Quality must be 0-5' })
  }

  const card = db.prepare(
    'SELECT * FROM flashcards WHERE id = ? AND deck_id = ?'
  ).get(req.params.cardId, req.params.deckId)

  if (!card) return res.status(404).json({ message: 'Card not found' })

  const updated = sm2(card, quality)

  db.prepare(`
    UPDATE flashcards SET
      ease_factor = ?,
      interval = ?,
      repetitions = ?,
      next_review = ?,
      last_reviewed = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    updated.ease_factor,
    updated.interval,
    updated.repetitions,
    updated.next_review,
    updated.last_reviewed,
    req.params.cardId
  )

  const result = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(req.params.cardId)
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
