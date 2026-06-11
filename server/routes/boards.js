import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router()

/**
 * GET /api/boards
 * List all boards.
 */
router.get('/', (req, res) => {
  const boards = db.prepare(
    'SELECT id, name, created_at, updated_at FROM boards ORDER BY updated_at DESC'
  ).all()
  res.json(boards)
})

/**
 * GET /api/boards/:id
 * Get a single board with its data.
 */
router.get('/:id', (req, res) => {
  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id)
  if (!board) return res.status(404).json({ message: 'Board not found' })

  // Parse stored JSON data
  board.data = JSON.parse(board.data || '{}')
  res.json(board)
})

/**
 * POST /api/boards
 * Create a new board.
 */
router.post('/', (req, res) => {
  const { name, data } = req.body
  const id = uuid()

  db.prepare(
    'INSERT INTO boards (id, name, data) VALUES (?, ?, ?)'
  ).run(id, name || 'Untitled Board', JSON.stringify(data || {}))

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id)
  board.data = JSON.parse(board.data)
  res.status(201).json(board)
})

/**
 * PUT /api/boards/:id
 * Update a board.
 */
router.put('/:id', (req, res) => {
  const { name, data } = req.body
  const existing = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ message: 'Board not found' })

  db.prepare(`
    UPDATE boards SET
      name = COALESCE(?, name),
      data = COALESCE(?, data),
      updated_at = datetime('now')
    WHERE id = ?
  `).run(name, data ? JSON.stringify(data) : null, req.params.id)

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id)
  board.data = JSON.parse(board.data)
  res.json(board)
})

/**
 * DELETE /api/boards/:id
 * Delete a board.
 */
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM boards WHERE id = ?').run(req.params.id)
  res.status(204).send()
})

export default router
