import { Router } from 'express'
import db from '../db.js'

const router = Router()

/**
 * GET /api/study_sessions
 * List all study session counts (for heatmap).
 */
router.get('/', (req, res) => {
  const results = db.prepare(`
    SELECT date, count
    FROM study_sessions
    ORDER BY date ASC
  `).all()

  // Convert to an array or an object map, array is fine
  res.json(results)
})

export default router
