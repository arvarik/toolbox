import { Router } from 'express'
import { v4 as uuid } from 'uuid'
import db from '../db.js'

const router = Router()

/**
 * GET /api/boards
 * List all boards sorted by position, then by updated_at DESC.
 */
router.get('/', (req, res) => {
  const boards = db.prepare(
    'SELECT id, name, position, created_at, updated_at FROM boards ORDER BY position ASC, updated_at DESC'
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

  // Get max position to append at end
  const maxPos = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM boards').get()
  const position = (maxPos?.maxPos ?? -1) + 1

  db.prepare(
    'INSERT INTO boards (id, name, data, position) VALUES (?, ?, ?, ?)'
  ).run(id, name || 'Untitled Board', JSON.stringify(data || {}), position)

  const board = db.prepare('SELECT * FROM boards WHERE id = ?').get(id)
  board.data = JSON.parse(board.data)
  res.status(201).json(board)
})

/**
 * PUT /api/boards/:id
 * Update a board (name and/or data).
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
 * PATCH /api/boards/:id/rename
 * Rename a board (convenience endpoint).
 */
router.patch('/:id/rename', (req, res) => {
  const { name } = req.body
  if (!name || !name.trim()) {
    return res.status(400).json({ message: 'Name is required' })
  }
  const existing = db.prepare('SELECT * FROM boards WHERE id = ?').get(req.params.id)
  if (!existing) return res.status(404).json({ message: 'Board not found' })

  db.prepare(
    'UPDATE boards SET name = ?, updated_at = datetime(\'now\') WHERE id = ?'
  ).run(name.trim(), req.params.id)

  const board = db.prepare('SELECT id, name, position, created_at, updated_at FROM boards WHERE id = ?').get(req.params.id)
  res.json(board)
})

/**
 * PATCH /api/boards/reorder
 * Update the position of all boards.
 * Body: { ids: [id1, id2, id3, ...] }
 */
router.patch('/reorder', (req, res) => {
  const { ids } = req.body
  if (!Array.isArray(ids)) {
    return res.status(400).json({ message: 'ids must be an array' })
  }

  const updateStmt = db.prepare('UPDATE boards SET position = ? WHERE id = ?')
  const updateAll = db.transaction((orderedIds) => {
    orderedIds.forEach((id, index) => {
      updateStmt.run(index, id)
    })
  })

  updateAll(ids)

  const boards = db.prepare(
    'SELECT id, name, position, created_at, updated_at FROM boards ORDER BY position ASC'
  ).all()
  res.json(boards)
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
