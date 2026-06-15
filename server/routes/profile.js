import { Router } from 'express'
import db from '../db.js'
import logger from '../utils/logger.js'

const router = Router()

/**
 * GET /api/profile
 * Retrieves the user's shadow memory / profile text.
 */
router.get('/', (req, res) => {
  try {
    const row = db.prepare('SELECT profile_text FROM user_profile WHERE id = 1').get()
    res.json({ profileText: row?.profile_text || '' })
  } catch (err) {
    logger.error('[profile] Error fetching profile:', err.message)
    res.status(500).json({ message: 'Failed to fetch profile' })
  }
})

/**
 * PUT /api/profile
 * Overwrites the user's shadow memory.
 * Body: { profileText }
 */
router.put('/', (req, res) => {
  const { profileText } = req.body

  if (typeof profileText !== 'string') {
    return res.status(400).json({ message: 'profileText must be a string' })
  }

  try {
    db.prepare(`
      INSERT INTO user_profile (id, profile_text, updated_at) 
      VALUES (1, ?, datetime('now')) 
      ON CONFLICT(id) DO UPDATE SET 
        profile_text = excluded.profile_text, 
        updated_at = excluded.updated_at
    `).run(profileText)
    
    res.json({ success: true, profileText })
  } catch (err) {
    logger.error('[profile] Error updating profile:', err.message)
    res.status(500).json({ message: 'Failed to update profile' })
  }
})

/**
 * DELETE /api/profile
 * Clears the user's shadow memory.
 */
router.delete('/', (req, res) => {
  try {
    db.prepare('DELETE FROM user_profile WHERE id = 1').run()
    res.json({ success: true, message: 'Profile cleared' })
  } catch (err) {
    logger.error('[profile] Error clearing profile:', err.message)
    res.status(500).json({ message: 'Failed to clear profile' })
  }
})

export default router
