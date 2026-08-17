import { Router } from 'express'
import db from '../db.js'
import {
  getAvailableModels,
  getApiKeyStatus,
  testProviderKey,
  getProviderDefinitions,
  getApiKeyFields,
  getProviderIdForConfigKey,
  refreshProviderCatalog,
  refreshAllCatalogs,
  handleProviderKeyRemoved,
} from '../providers/index.js'
import { maskSecret, isMaskedValue } from '../utils/mask.js'
import logger from '../utils/logger.js'

const router = Router()

/**
 * GET /api/config
 * Returns all config values (with API keys masked) and provider status.
 * Keys are never returned in plain text — only as '••••' + last 4 chars.
 */
router.get('/', (req, res) => {
  const rows = db.prepare('SELECT key, value FROM config').all()
  const apiKeyFields = getApiKeyFields()
  const config = {}
  for (const row of rows) {
    if (apiKeyFields.includes(row.key)) {
      config[row.key] = maskSecret(row.value)
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
 * API key fields get special handling:
 *   - Masked values ('••••1234') are ignored so a form save never
 *     overwrites a real key with its own mask.
 *   - Empty values remove the key and drop that provider's discovered
 *     catalog + cached instances (safe deactivation).
 */
router.put('/', (req, res) => {
  const apiKeyFields = getApiKeyFields()
  const upsert = db.prepare(`
    INSERT INTO config (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `)

  const removedProviders = []
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(req.body)) {
      const strValue = String(value ?? '')
      if (apiKeyFields.includes(key)) {
        if (isMaskedValue(strValue)) continue
        if (strValue === '') {
          const providerId = getProviderIdForConfigKey(key)
          if (providerId) removedProviders.push(providerId)
        }
      }
      upsert.run(key, strValue)
    }
  })

  transaction()
  for (const providerId of removedProviders) {
    handleProviderKeyRemoved(providerId)
  }
  res.json({ success: true })
})

/**
 * POST /api/config/test-key
 * Verify an API key against the provider's API before saving.
 * On success the key is saved and that provider's model catalog is
 * refreshed immediately (live discovery). Invalid keys are never saved.
 *
 * Body: { key: string, provider: 'gemini' | 'claude' | 'openai' }
 */
router.post('/test-key', async (req, res) => {
  const { key, provider = 'gemini' } = req.body

  if (!key) {
    return res.status(400).json({ message: 'API key is required' })
  }

  try {
    await testProviderKey(provider, key)

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

    // Discover this provider's live model catalog right away.
    // The key is already verified — a discovery hiccup must not fail the save.
    let modelsDiscovered = 0
    try {
      const models = await refreshProviderCatalog(provider, key)
      modelsDiscovered = models.length
    } catch (err) {
      logger.warn(`[config] Model discovery after key save failed for ${provider}: ${err.message}`)
    }

    res.json({ valid: true, modelsDiscovered })
  } catch (err) {
    res.status(400).json({ valid: false, message: err.message || 'Invalid API key' })
  }
})

/**
 * GET /api/config/available-models
 * Returns all available models grouped by provider (discovered catalog
 * when present, static fallback otherwise), plus custom endpoint groups
 * and full provider metadata for the settings UI.
 */
router.get('/available-models', (req, res) => {
  const models = getAvailableModels()
  const providers = getProviderDefinitions()
  res.json({ providers, groups: models })
})

/**
 * POST /api/config/refresh-models
 * Re-sync the model catalog with every configured provider and custom
 * endpoint. Per-catalog failures are reported without aborting the sweep.
 */
router.post('/refresh-models', async (req, res) => {
  const { refreshed, errors } = await refreshAllCatalogs()
  const models = getAvailableModels()
  const providers = getProviderDefinitions()
  res.json({ refreshed, errors, providers, groups: models })
})

export default router
