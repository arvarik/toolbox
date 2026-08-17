/**
 * @fileoverview AI Provider Registry and Factory.
 *
 * Central entry point for the provider abstraction layer.
 * Resolves model IDs to provider instances, manages the discovered
 * model catalog, and orchestrates catalog refreshes.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Model resolution order (getProvider)                          │
 * │                                                                │
 * │  1. `custom:<endpointId>:<model>` → CustomEndpointProvider     │
 * │  2. Static catalog exact match                                 │
 * │  3. Discovered (cached) catalog match                          │
 * │  4. Provider namespace heuristics (ownsModelId)                │
 * │  5. First registered provider (backward compatibility)         │
 * └────────────────────────────────────────────────────────────────┘
 *
 * Catalogs: each provider ships a small static fallback list, replaced
 * by live discovery (the provider's model listing API) as soon as a key
 * is verified or a refresh runs. Discovered lists persist in SQLite via
 * providers/catalog.js.
 */

import db from '../db.js'
import { GeminiProvider } from './gemini.js'
import { ClaudeProvider } from './claude.js'
import { OpenAIProvider } from './openai.js'
import { CustomEndpointProvider, CUSTOM_ENDPOINT_COLOR, parseCustomModelId } from './custom.js'
import {
  saveCatalog,
  loadCatalog,
  clearCatalog,
  buildProviderCatalogEntries,
  buildEndpointCatalogEntries,
  listCustomEndpoints,
  getCustomEndpoint,
} from './catalog.js'
import logger from '../utils/logger.js'

// ═══════════════════════════════════════════════════════════════
// Provider Registration
//
// To add a new key-based provider:
//   1. Create server/providers/<name>.js extending AIProvider
//   2. Add the class to this array
//   3. Done — everything else auto-discovers it
// ═══════════════════════════════════════════════════════════════

const PROVIDER_CLASSES = [
  GeminiProvider,
  ClaudeProvider,
  OpenAIProvider,
]

// ═══════════════════════════════════════════════════════════════
// Auto-built lookup maps (derived from provider static metadata)
// ═══════════════════════════════════════════════════════════════

/** Map: providerId → ProviderClass */
const PROVIDERS = Object.fromEntries(
  PROVIDER_CLASSES.map(P => [P.providerId, P])
)

/** Map: modelId → providerId (static fallback catalogs) */
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
 * @param {string} providerId - e.g. 'gemini', 'claude', 'openai'
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
 * Checks static catalogs, then discovered catalogs, then namespace
 * heuristics.
 *
 * @param {string} modelId - e.g. 'gemini-3.5-flash' or 'claude-sonnet-4-6'
 * @returns {string} Provider ID
 */
export function getProviderIdForModel(modelId) {
  // Exact match from the static model catalogs
  if (MODEL_TO_PROVIDER[modelId]) {
    return MODEL_TO_PROVIDER[modelId]
  }
  // Match against discovered (cached) catalogs
  for (const ProviderClass of PROVIDER_CLASSES) {
    const cached = loadCatalog(ProviderClass.providerId)
    if (cached?.models?.some(m => m.id === modelId)) {
      return ProviderClass.providerId
    }
  }
  // Namespace heuristics (e.g. 'gpt-*' → openai, 'gemma-*' → gemini)
  for (const ProviderClass of PROVIDER_CLASSES) {
    if (ProviderClass.ownsModelId(modelId)) {
      return ProviderClass.providerId
    }
  }
  // Default to first registered provider for backward compatibility
  return PROVIDER_CLASSES[0].providerId
}

/**
 * Get a provider instance for a given model ID.
 * Resolves the correct provider class and API key, returns a ready-to-use
 * instance. Custom endpoint models (`custom:<endpointId>:<model>`)
 * resolve to a CustomEndpointProvider bound to that endpoint.
 *
 * @param {string} modelId - The model ID
 * @returns {AIProvider} A provider instance
 * @throws {Error} If the provider's API key or endpoint is not configured
 */
export function getProvider(modelId) {
  // Custom endpoint models
  const custom = parseCustomModelId(modelId)
  if (custom) {
    const endpoint = getCustomEndpoint(custom.endpointId)
    if (!endpoint) {
      throw new Error('Custom endpoint not found. It may have been removed — pick another model in Settings.')
    }
    const cacheKey = `custom:${endpoint.id}:${endpoint.base_url}:${(endpoint.api_key || '').slice(0, 8)}`
    if (providerCache.has(cacheKey)) {
      return providerCache.get(cacheKey)
    }
    const instance = new CustomEndpointProvider(endpoint)
    providerCache.set(cacheKey, instance)
    logger.info(`[providers] Created custom endpoint provider for "${endpoint.name}"`)
    return instance
  }

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
 * @param {string} providerId - e.g. 'gemini', 'claude', 'openai'
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
// Catalog refresh orchestration
// ═══════════════════════════════════════════════════════════════

/**
 * Refresh the discovered model catalog for one cloud provider.
 * Queries the provider's model listing API, applies the guardrails
 * (modality, 1-year recency, alias dedupe), and persists the result.
 *
 * @param {string} providerId
 * @param {string} [apiKeyOverride] - Key to use instead of the stored one
 * @returns {Promise<Array<Object>>} The refreshed catalog entries
 * @throws {Error} When no key is configured or discovery fails
 */
export async function refreshProviderCatalog(providerId, apiKeyOverride) {
  const ProviderClass = PROVIDERS[providerId]
  if (!ProviderClass) {
    throw new Error(`Unknown provider: "${providerId}"`)
  }
  const apiKey = apiKeyOverride || getApiKeyForProvider(providerId)
  if (!apiKey) {
    throw new Error(`${ProviderClass.displayName} API key not configured.`)
  }

  const rawModels = await ProviderClass.fetchModels(apiKey)
  const entries = buildProviderCatalogEntries(providerId, rawModels)
  saveCatalog(providerId, entries)
  logger.info(`[providers] Discovered ${entries.length} ${ProviderClass.displayName} models`)
  return entries
}

/**
 * Refresh the discovered model catalog for one custom endpoint.
 *
 * @param {Object} endpoint - A custom_endpoints row
 * @returns {Promise<Array<Object>>} The refreshed catalog entries
 * @throws {Error} When the endpoint is unreachable
 */
export async function refreshEndpointCatalog(endpoint) {
  const rawModels = await CustomEndpointProvider.fetchModels(endpoint.api_key || '', endpoint.base_url)
  const entries = buildEndpointCatalogEntries(endpoint, rawModels)
  saveCatalog(`custom:${endpoint.id}`, entries)
  logger.info(`[providers] Discovered ${entries.length} models on custom endpoint "${endpoint.name}"`)
  return entries
}

/**
 * Refresh every configured provider and custom endpoint.
 * Failures are collected per catalog instead of aborting the sweep.
 *
 * @returns {Promise<{ refreshed: string[], errors: Object<string,string> }>}
 */
export async function refreshAllCatalogs() {
  const refreshed = []
  const errors = {}

  for (const ProviderClass of PROVIDER_CLASSES) {
    const providerId = ProviderClass.providerId
    if (!getApiKeyForProvider(providerId)) continue
    try {
      await refreshProviderCatalog(providerId)
      refreshed.push(providerId)
    } catch (err) {
      errors[providerId] = err.message
      logger.warn(`[providers] Catalog refresh failed for ${providerId}: ${err.message}`)
    }
  }

  for (const endpoint of listCustomEndpoints()) {
    const catalogId = `custom:${endpoint.id}`
    try {
      await refreshEndpointCatalog(endpoint)
      refreshed.push(catalogId)
    } catch (err) {
      errors[catalogId] = err.message
      logger.warn(`[providers] Catalog refresh failed for endpoint "${endpoint.name}": ${err.message}`)
    }
  }

  return { refreshed, errors }
}

/**
 * Clean up after a provider's API key is removed:
 * drop its discovered catalog and cached provider instances.
 * @param {string} providerId
 */
export function handleProviderKeyRemoved(providerId) {
  clearCatalog(providerId)
  for (const key of providerCache.keys()) {
    if (key.startsWith(`${providerId}:`)) providerCache.delete(key)
  }
}

/**
 * Clean up after a custom endpoint is removed or edited:
 * drop its discovered catalog and cached provider instances.
 * @param {string} endpointId
 */
export function handleEndpointRemoved(endpointId) {
  clearCatalog(`custom:${endpointId}`)
  for (const key of providerCache.keys()) {
    if (key.startsWith(`custom:${endpointId}:`)) providerCache.delete(key)
  }
}

// ═══════════════════════════════════════════════════════════════
// Discovery API (for routes and frontend)
// ═══════════════════════════════════════════════════════════════

/**
 * Get all available models grouped by provider / custom endpoint.
 * Uses the discovered catalog when present, falling back to each
 * provider's static list. Custom endpoints appear as their own groups.
 *
 * @returns {Array<{ provider: Object, models: Array<Object> }>}
 */
export function getAvailableModels() {
  const result = []

  for (const ProviderClass of PROVIDER_CLASSES) {
    const providerId = ProviderClass.providerId
    const apiKey = getApiKeyForProvider(providerId)
    if (!apiKey) continue

    const cached = loadCatalog(providerId)
    const models = (cached?.models?.length ? cached.models : ProviderClass.models)

    result.push({
      provider: {
        id: providerId,
        name: ProviderClass.displayName,
        color: ProviderClass.brandColor,
      },
      models: models.map(m => ({
        ...m,
        providerId,
        providerName: ProviderClass.displayName,
      })),
    })
  }

  for (const endpoint of listCustomEndpoints()) {
    const cached = loadCatalog(`custom:${endpoint.id}`)
    result.push({
      provider: {
        id: `custom:${endpoint.id}`,
        name: endpoint.name,
        color: CUSTOM_ENDPOINT_COLOR,
        isCustom: true,
      },
      models: (cached?.models || []).map(m => ({
        ...m,
        providerId: `custom:${endpoint.id}`,
        providerName: endpoint.name,
      })),
    })
  }

  return result
}

/**
 * Get the configured status of each provider's API key.
 * @returns {Object} e.g. { gemini: true, claude: false, openai: false }
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
 * Map a config key (e.g. 'openai_api_key') back to its provider ID.
 * @param {string} configKey
 * @returns {string|null}
 */
export function getProviderIdForConfigKey(configKey) {
  const ProviderClass = PROVIDER_CLASSES.find(P => P.configKey === configKey)
  return ProviderClass ? ProviderClass.providerId : null
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
