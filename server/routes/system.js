import { Router } from 'express'
import db from '../db.js'

const router = Router()

/**
 * GET /api/system/stats
 * Returns database aggregates and system limits.
 */
router.get('/stats', (req, res) => {
  try {
    const flashcardsCount = db.prepare('SELECT COUNT(*) as c FROM flashcards').get().c
    const decksCount = db.prepare('SELECT COUNT(*) as c FROM decks').get().c
    const boardsCount = db.prepare('SELECT COUNT(*) as c FROM boards').get().c
    const guideCount = db.prepare('SELECT COUNT(*) as c FROM guide_content').get().c
    const cachedStartersCount = db.prepare('SELECT COUNT(*) as c FROM chat_starters').get().c
    const profileRow = db.prepare('SELECT profile_text FROM user_profile WHERE id = 1').get()
    const profileSize = profileRow?.profile_text ? profileRow.profile_text.length : 0

    res.json({
      flashcardsCount,
      decksCount,
      boardsCount,
      guideCount,
      cachedStartersCount,
      profileSize
    })
  } catch (err) {
    console.error('[system] Error fetching stats:', err.message)
    res.status(500).json({ message: 'Failed to fetch system stats' })
  }
})

/**
 * POST /api/system/clear-cache
 * Flushes the AI chat_starters cache table.
 */
router.post('/clear-cache', (req, res) => {
  try {
    db.prepare('DELETE FROM chat_starters').run()
    res.json({ success: true, message: 'AI Starter Cache cleared.' })
  } catch (err) {
    console.error('[system] Error clearing cache:', err.message)
    res.status(500).json({ message: 'Failed to clear cache' })
  }
})

export default router
