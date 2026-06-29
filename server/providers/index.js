/**
 * @fileoverview AI Provider Registry and Factory.
 *
 * Central entry point for the provider abstraction layer.
 * Resolves model IDs to provider instances and manages the model catalog.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Auto-Registration Architecture                                │
 * │                                                                │
 * │  1. Provider classes declare static metadata (providerId,      │
 * │     models, configKey, etc.)                                   │
 * │  2. PROVIDER_CLASSES array lists all available providers       │
 * │  3. Registry auto-builds lookup maps from static metadata      │
 * │  4. Adding a new provider = 1 new file + 1 line here           │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   import { getProvider, getAvailableModels } from '../providers/index.js'
 *
 *   const provider = getProvider('claude-sonnet-4-6')  // → ClaudeProvider instance
 *   const provider = getProvider('gemini-3.5-flash')    // → GeminiProvider instance
 *   const models = getAvailableModels()                 // → grouped model list
 */

import db from '../db.js'
import { GeminiProvider } from './gemini.js'
import { ClaudeProvider } from './claude.js'
import logger from '../utils/logger.js'

// ═══════════════════════════════════════════════════════════════
// Provider Registration
//
// To add a new provider (e.g. OpenAI, Ollama):
//   1. Create server/providers/openai.js extending AIProvider
//   2. Add the class to this array
//   3. Done — everything else auto-discovers it
// ═══════════════════════════════════════════════════════════════

const PROVIDER_CLASSES = [
  GeminiProvider,
  ClaudeProvider,
]

// ═══════════════════════════════════════════════════════════════
// Auto-built lookup maps (derived from provider static metadata)
// ═══════════════════════════════════════════════════════════════

/** Map: providerId → ProviderClass */
const PROVIDERS = Object.fromEntries(
  PROVIDER_CLASSES.map(P => [P.providerId, P])
)

/** Map: modelId → providerId (for fast model→provider resolution) */
const MODEL_TO_PROVIDER = {}
for (const ProviderClass of PROVIDER_CLASSES) {
  for (const model of ProviderClass.models) {
    MODEL_TO_PROVIDER[model.id] = ProviderClass.providerId
  }
}

// Cache provider instances per API key to avoid re-creating on every request
const providerCache = new Map()

// ═══════════════════════════════════════════════════════════════
// Core API
// ═══════════════════════════════════════════════════════════════

/**
 * Get the API key for a given provider from the database config.
 * @param {string} providerId - e.g. 'gemini', 'claude'
 * @returns {string|null} The API key or null if not configured
 */
export function getApiKeyForProvider(providerId) {
  const ProviderClass = PROVIDERS[providerId]
  if (!ProviderClass) return null

  const config = db.prepare("SELECT value FROM config WHERE key = ?").get(ProviderClass.configKey)
  return config?.value || null
}

/**
 * Determine which provider a model ID belongs to.
 * Uses exact match first, then prefix-based fallback.
 *
 * @param {string} modelId - e.g. 'gemini-3.5-flash' or 'claude-sonnet-4-6'
 * @returns {string} Provider ID
 */
export function getProviderIdForModel(modelId) {
  // Exact match from the model catalog
  if (MODEL_TO_PROVIDER[modelId]) {
    return MODEL_TO_PROVIDER[modelId]
  }
  // Prefix-based fallback: check if model ID starts with any registered provider ID
  for (const ProviderClass of PROVIDER_CLASSES) {
    if (modelId.startsWith(ProviderClass.providerId)) {
      return ProviderClass.providerId
    }
  }
  // Default to first registered provider for backward compatibility
  return PROVIDER_CLASSES[0].providerId
}

/**
 * Get a provider instance for a given model ID.
 * Resolves the correct provider class and API key, returns a ready-to-use instance.
 *
 * @param {string} modelId - The model ID (e.g. 'gemini-3.5-flash', 'claude-sonnet-4-6')
 * @returns {AIProvider} A provider instance
 * @throws {Error} If the provider's API key is not configured
 */
export function getProvider(modelId) {
  const providerId = getProviderIdForModel(modelId)
  const ProviderClass = PROVIDERS[providerId]

  if (!ProviderClass) {
    throw new Error(`Unknown provider for model "${modelId}"`)
  }

  const apiKey = getApiKeyForProvider(providerId)
  if (!apiKey) {
    throw new Error(
      `${ProviderClass.displayName} API key not configured. Please add your key in Settings.`
    )
  }

  // Cache by provider + key hash to handle key changes
  const cacheKey = `${providerId}:${apiKey.slice(0, 8)}`
  if (providerCache.has(cacheKey)) {
    return providerCache.get(cacheKey)
  }

  const instance = new ProviderClass(apiKey)
  providerCache.set(cacheKey, instance)
  logger.info(`[providers] Created ${ProviderClass.displayName} provider instance`)
  return instance
}

/**
 * Get a provider instance by provider ID (not model ID).
 * Used for key testing where we know the provider but not a specific model.
 *
 * @param {string} providerId - e.g. 'gemini', 'claude'
 * @param {string} apiKey - The API key to use
 * @returns {AIProvider} A provider instance (not cached)
 */
export function getProviderByIdWithKey(providerId, apiKey) {
  const ProviderClass = PROVIDERS[providerId]
  if (!ProviderClass) {
    throw new Error(`Unknown provider: "${providerId}"`)
  }
  return new ProviderClass(apiKey)
}

// ═══════════════════════════════════════════════════════════════
// Discovery API (for routes and frontend)
// ═══════════════════════════════════════════════════════════════

/**
 * Get all available models based on which API keys are configured.
 * Returns models grouped by provider with metadata.
 *
 * @returns {Array<{ provider: Object, models: Array<Object> }>}
 */
export function getAvailableModels() {
  const result = []

  for (const ProviderClass of PROVIDER_CLASSES) {
    const apiKey = getApiKeyForProvider(ProviderClass.providerId)
    if (apiKey) {
      result.push({
        provider: {
          id: ProviderClass.providerId,
          name: ProviderClass.displayName,
          color: ProviderClass.brandColor,
        },
        models: ProviderClass.models.map(m => ({
          ...m,
          providerId: ProviderClass.providerId,
          providerName: ProviderClass.displayName,
        })),
      })
    }
  }

  return result
}

/**
 * Get the configured status of each provider's API key.
 * @returns {Object} e.g. { gemini: true, claude: false }
 */
export function getApiKeyStatus() {
  const status = {}
  for (const ProviderClass of PROVIDER_CLASSES) {
    const config = db.prepare("SELECT value FROM config WHERE key = ?").get(ProviderClass.configKey)
    status[ProviderClass.providerId] = !!(config?.value)
  }
  return status
}

/**
 * Get all provider definitions (for frontend metadata).
 * Includes everything the settings UI needs to render provider sections.
 *
 * @returns {Array<{ id, name, shortName, configKey, color, keyPlaceholder, keyHelpUrl, keyHelpLabel, capabilities }>}
 */
export function getProviderDefinitions() {
  return PROVIDER_CLASSES.map(P => ({
    id: P.providerId,
    name: P.displayName,
    shortName: P.shortName,
    configKey: P.configKey,
    color: P.brandColor,
    keyPlaceholder: P.keyPlaceholder,
    keyHelpUrl: P.keyHelpUrl,
    keyHelpLabel: P.keyHelpLabel,
    capabilities: P.capabilities,
  }))
}

/**
 * Get all config keys that contain sensitive API credentials.
 * Used by routes to mask these values in GET responses.
 * @returns {string[]}
 */
export function getApiKeyFields() {
  return PROVIDER_CLASSES.map(P => P.configKey)
}

/**
 * Seed API keys from environment variables for all registered providers.
 * Called during database initialization.
 */
export function seedApiKeysFromEnv() {
  for (const ProviderClass of PROVIDER_CLASSES) {
    const envValue = process.env[ProviderClass.envKey]
    if (envValue) {
      const existing = db.prepare("SELECT value FROM config WHERE key = ?").get(ProviderClass.configKey)
      if (!existing?.value) {
        db.prepare(`
          INSERT INTO config (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(ProviderClass.configKey, envValue)
        logger.info(`[db] Seeded ${ProviderClass.displayName} API key from environment`)
      }
    }
  }
}
