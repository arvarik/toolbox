/**
 * @fileoverview Provider registry.
 *
 * Central lookup layer over the provider definitions (defs.js):
 * resolves model IDs to provider IDs, stores/reads API keys, and
 * orchestrates model-catalog refreshes. The AI SDK engine
 * (server/ai/engine.js) uses this registry to build model instances.
 *
 * ┌────────────────────────────────────────────────────────────────┐
 * │  Model → provider resolution (getProviderIdForModel)           │
 * │                                                                │
 * │  1. Static catalog exact match                                 │
 * │  2. Discovered (cached) catalog match                          │
 * │  3. Provider namespace heuristics (ownsModelId)                │
 * │  4. null (callers surface a clear "unknown model" error)       │
 * └────────────────────────────────────────────────────────────────┘
 */

import db from '../db.js'
import { PROVIDER_DEFS, fetchEndpointModels, CUSTOM_ENDPOINT_COLOR } from './defs.js'
import {
  saveCatalog,
  loadCatalog,
  clearCatalog,
  buildProviderCatalogEntries,
  buildEndpointCatalogEntries,
  listCustomEndpoints,
} from './catalog.js'
import logger from '../utils/logger.js'

/** Map: providerId → definition */
const PROVIDERS = Object.fromEntries(PROVIDER_DEFS.map((p) => [p.id, p]))

/** Map: modelId → providerId (static fallback catalogs) */
const MODEL_TO_PROVIDER = {}
for (const def of PROVIDER_DEFS) {
  for (const model of def.models) {
    MODEL_TO_PROVIDER[model.id] = def.id
  }
}

// ═══════════════════════════════════════════════════════════════
// Core lookups
// ═══════════════════════════════════════════════════════════════

/**
 * Get a provider definition by ID.
 * @param {string} providerId
 * @returns {Object|undefined}
 */
export function getProviderDef(providerId) {
  return PROVIDERS[providerId]
}

/**
 * Get the API key for a given provider from the database config.
 * @param {string} providerId - e.g. 'gemini', 'claude', 'openai'
 * @returns {string|null} The API key or null if not configured
 */
export function getApiKeyForProvider(providerId) {
  const def = PROVIDERS[providerId]
  if (!def) return null
  const config = db.prepare('SELECT value FROM config WHERE key = ?').get(def.configKey)
  return config?.value || null
}

/**
 * Determine which provider a model ID belongs to.
 * Checks static catalogs, then discovered catalogs, then namespace
 * heuristics. Returns null when no provider matches — callers must
 * surface a clear error instead of guessing.
 *
 * @param {string} modelId - e.g. 'gemini-3.5-flash' or 'claude-sonnet-4-6'
 * @returns {string|null} Provider ID or null
 */
export function getProviderIdForModel(modelId) {
  if (MODEL_TO_PROVIDER[modelId]) {
    return MODEL_TO_PROVIDER[modelId]
  }
  for (const def of PROVIDER_DEFS) {
    const cached = loadCatalog(def.id)
    if (cached?.models?.some((m) => m.id === modelId)) {
      return def.id
    }
  }
  for (const def of PROVIDER_DEFS) {
    if (def.ownsModelId(modelId)) {
      return def.id
    }
  }
  return null
}

/**
 * Verify an API key by listing the provider's model catalog.
 * Costs no tokens and fails fast on an invalid key.
 * @param {string} providerId
 * @param {string} apiKey
 * @returns {Promise<true>}
 * @throws {Error} When the provider is unknown or the key is invalid
 */
export async function testProviderKey(providerId, apiKey) {
  const def = PROVIDERS[providerId]
  if (!def) {
    throw new Error(`Unknown provider: "${providerId}"`)
  }
  await def.fetchModels(apiKey)
  return true
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
  const def = PROVIDERS[providerId]
  if (!def) {
    throw new Error(`Unknown provider: "${providerId}"`)
  }
  const apiKey = apiKeyOverride || getApiKeyForProvider(providerId)
  if (!apiKey) {
    throw new Error(`${def.name} API key not configured.`)
  }

  const rawModels = await def.fetchModels(apiKey)
  const entries = buildProviderCatalogEntries(providerId, rawModels)
  saveCatalog(providerId, entries)
  logger.info(`[providers] Discovered ${entries.length} ${def.name} models`)
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
  const rawModels = await fetchEndpointModels(endpoint.api_key || '', endpoint.base_url)
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

  for (const def of PROVIDER_DEFS) {
    if (!getApiKeyForProvider(def.id)) continue
    try {
      await refreshProviderCatalog(def.id)
      refreshed.push(def.id)
    } catch (err) {
      errors[def.id] = err.message
      logger.warn(`[providers] Catalog refresh failed for ${def.id}: ${err.message}`)
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
 * Clean up after a provider's API key is removed: drop its discovered catalog.
 * @param {string} providerId
 */
export function handleProviderKeyRemoved(providerId) {
  clearCatalog(providerId)
}

/**
 * Clean up after a custom endpoint is removed or edited:
 * drop its discovered catalog.
 * @param {string} endpointId
 */
export function handleEndpointRemoved(endpointId) {
  clearCatalog(`custom:${endpointId}`)
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

  for (const def of PROVIDER_DEFS) {
    const apiKey = getApiKeyForProvider(def.id)
    if (!apiKey) continue

    const cached = loadCatalog(def.id)
    const models = cached?.models?.length ? cached.models : def.models

    result.push({
      provider: { id: def.id, name: def.name, color: def.color },
      models: models.map((m) => ({
        ...m,
        providerId: def.id,
        providerName: def.name,
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
      models: (cached?.models || []).map((m) => ({
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
  for (const def of PROVIDER_DEFS) {
    status[def.id] = !!getApiKeyForProvider(def.id)
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
  return PROVIDER_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    configKey: def.configKey,
    color: def.color,
    keyPlaceholder: def.keyPlaceholder,
    keyHelpUrl: def.keyHelpUrl,
    keyHelpLabel: def.keyHelpLabel,
    capabilities: def.capabilities,
  }))
}

/**
 * Get all config keys that contain sensitive API credentials.
 * Used by routes to mask these values in GET responses.
 * @returns {string[]}
 */
export function getApiKeyFields() {
  return PROVIDER_DEFS.map((def) => def.configKey)
}

/**
 * Map a config key (e.g. 'openai_api_key') back to its provider ID.
 * @param {string} configKey
 * @returns {string|null}
 */
export function getProviderIdForConfigKey(configKey) {
  const def = PROVIDER_DEFS.find((p) => p.configKey === configKey)
  return def ? def.id : null
}

/**
 * Seed API keys from environment variables for all registered providers.
 * Called during server startup.
 */
export function seedApiKeysFromEnv() {
  for (const def of PROVIDER_DEFS) {
    const envValue = process.env[def.envKey]
    if (envValue) {
      const existing = db.prepare('SELECT value FROM config WHERE key = ?').get(def.configKey)
      if (!existing?.value) {
        db.prepare(`
          INSERT INTO config (key, value, updated_at)
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
        `).run(def.configKey, envValue)
        logger.info(`[db] Seeded ${def.name} API key from environment`)
      }
    }
  }
}
