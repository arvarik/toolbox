import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router()

/**
 * GET /api/decks
 * List all decks with card counts.
 */
router.get('/', (req, res) => {
  const decks = db.prepare(`
    SELECT d.*, COUNT(f.id) as card_count
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

  res.json({ ...deck, cards })
})

/**
 * POST /api/decks
 * Create a new deck.
 */
router.post('/', (req, res) => {
  const { name, description, color_index } = req.body
  if (!name) return res.status(400).json({ message: 'Name is required' })

  const id = uuid()
  db.prepare(
    'INSERT INTO decks (id, name, description, color_index) VALUES (?, ?, ?, ?)'
  ).run(id, name, description || '', color_index || 0)

  const deck = db.prepare('SELECT * FROM decks WHERE id = ?').get(id)
  res.status(201).json(deck)
})

/**
 * PUT /api/decks/:id
 * Update a deck.
 */
router.put('/:id', (req, res) => {
  const { name, description, color_index } = req.body
  const existing = db.prepare('SELECT * FROM decks WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ message: 'Deck not found' })

  db.prepare(`
    UPDATE decks SET
      name = COALESCE(?, name),
      description = COALESCE(?, description),
      color_index = COALESCE(?, color_index),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, description, color_index, req.params.id)

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

  // Update deck timestamp
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
 * DELETE /api/decks/:deckId/cards/:cardId
 */
router.delete('/:deckId/cards/:cardId', (req, res) => {
  db.prepare('DELETE FROM flashcards WHERE id = ? AND deck_id = ?')
    .run(req.params.cardId, req.params.deckId)
  db.prepare("UPDATE decks SET updated_at = datetime('now') WHERE id = ?").run(req.params.deckId)
  res.status(204).send()
})

export default router
