import { Router } from 'express'
import db from '../db.js'

const router = Router()

/**
 * GET /api/config
 * Returns all config values (with API key masked).
 */
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM config').all()
  const config = {}
  for (const row of rows) {
    if (row.key === 'gemini_api_key') {
      // Mask the key for client display
      config[row.key] = row.value ? `${row.value.slice(0, 8)}...${row.value.slice(-4)}` : ''
      config.api_key_configured = !!row.value
    } else {
      config[row.key] = row.value
    }
  }
  res.json(config)
})

/**
 * PUT /api/config
 * Update configuration values.
 */
router.put('/', (req, res) => {
  const { gemini_api_key, ...rest } = req.body

  const upsert = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  const transaction = db.transaction(() => {
    if (gemini_api_key !== undefined) {
      upsert.run('gemini_api_key', gemini_api_key)
    }
    for (const [key, value] of Object.entries(rest)) {
      upsert.run(key, String(value))
    }
  })

  transaction()
  res.json({ success: true })
})

/**
 * POST /api/config/test-key
 * Test if a Gemini API key is valid.
 */
router.post('/test-key', async (req, res) => {
  const { key } = req.body

  if (!key) {
    return res.status(400).json({ message: 'API key is required' })
  }

  try {
    // Attempt a simple API call to verify the key
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(key)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })

    // Quick test with a minimal prompt
    await model.generateContent('Say "ok"')

    // Save the verified key
    db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES ('gemini_api_key', ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key)

    res.json({ valid: true })
  } catch (err) {
    res.status(400).json({ valid: false, message: 'Invalid API key' })
  }
})

export default router
