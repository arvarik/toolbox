import { Router } from 'express'
import db from '../db.js'
import logger from '../utils/logger.js'

const router = Router()

/**
 * GET /api/search?q=query
 * Unified cross-domain search index endpoint.
 */
router.get('/', (req, res) => {
  const { q } = req.query

  if (!q || typeof q !== 'string' || q.trim() === '') {
    return res.json({ flashcards: [], guideContent: [], boards: [], decks: [] })
  }

  const query = `%${q.trim()}%`

  try {
    // Search flashcards
    const flashcards = db.prepare(`
      SELECT id, deck_id, front, back, state 
      FROM flashcards 
      WHERE front LIKE ? OR back LIKE ? 
      LIMIT 10
    `).all(query, query)

    // Search guide content
    const guideContent = db.prepare(`
      SELECT pillar_id, topic_id, section_id, content 
      FROM guide_content 
      WHERE content LIKE ? OR section_id LIKE ? OR topic_id LIKE ?
      LIMIT 10
    `).all(query, query, query)

    // Search boards
    const boards = db.prepare(`
      SELECT id, name 
      FROM boards 
      WHERE name LIKE ? 
      LIMIT 10
    `).all(query)

    // Search decks
    const decks = db.prepare(`
      SELECT id, name, description, tags 
      FROM decks 
      WHERE name LIKE ? OR description LIKE ? OR tags LIKE ? 
      LIMIT 10
    `).all(query, query, query)

    res.json({
      flashcards,
      guideContent,
      boards,
      decks
    })
  } catch (err) {
    logger.error('[search] Error running global search:', err.message)
    res.status(500).json({ message: 'Failed to run global search' })
  }
})

export default router
