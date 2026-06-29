import { Router } from 'express'
import db from '../db.js'
import {
  getAvailableModels,
  getApiKeyStatus,
  getProviderByIdWithKey,
  getProviderDefinitions,
  getApiKeyFields,
} from '../providers/index.js'

const router = Router()

/**
 * GET /api/config
 * Returns all config values (with API keys masked) and provider status.
 */
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM config').all()
  const apiKeyFields = getApiKeyFields()
  const config = {}
  for (const row of rows) {
    if (apiKeyFields.includes(row.key)) {
      // Mask the key for client display
      config[row.key] = row.value ? `${row.value.slice(0, 8)}...${row.value.slice(-4)}` : ''
    } else {
      config[row.key] = row.value
    }
  }
  // Add per-provider key status
  config.api_keys_configured = getApiKeyStatus()
  // Backward compat: api_key_configured is true if ANY provider is configured
  config.api_key_configured = Object.values(config.api_keys_configured).some(Boolean)
  res.json(config)
})

/**
 * PUT /api/config
 * Update configuration values.
 * Accepts any key-value pairs. API key fields are handled alongside other config.
 */
router.put('/', (req, res) => {
  const upsert = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(req.body)) {
      upsert.run(key, String(value))
    }
  })

  transaction()
  res.json({ success: true })
})

/**
 * POST /api/config/test-key
 * Test if an API key is valid for a specific provider.
 * Body: { key: string, provider: 'gemini' | 'claude' | ... }
 */
router.post('/test-key', async (req, res) => {
  const { key, provider = 'gemini' } = req.body

  if (!key) {
    return res.status(400).json({ message: 'API key is required' })
  }

  try {
    const providerInstance = getProviderByIdWithKey(provider, key)
    await providerInstance.testApiKey(key)

    // Derive the config key from the provider's static metadata
    const providerDefs = getProviderDefinitions()
    const providerDef = providerDefs.find(p => p.id === provider)
    const configKey = providerDef ? providerDef.configKey : `${provider}_api_key`

    // Save the verified key
    db.prepare(`
      INSERT INTO config (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(configKey, key)

    res.json({ valid: true })
  } catch (err) {
    res.status(400).json({ valid: false, message: err.message || 'Invalid API key' })
  }
})

/**
 * GET /api/config/available-models
 * Returns all available models based on configured API keys, grouped by provider.
 * Also returns full provider metadata for the settings UI.
 */
router.get('/available-models', (req, res) => {
  const models = getAvailableModels()
  const providers = getProviderDefinitions()
  res.json({ providers, groups: models })
})

export default router
