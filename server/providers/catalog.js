/**
 * @fileoverview Model catalog cache (SQLite-backed).
 *
 * Discovered model lists persist in the `model_catalog` table so the UI
 * loads instantly without hitting provider APIs on every request.
 *
 * Catalog IDs:
 *   'gemini' | 'claude' | 'openai'  → one row per cloud provider
 *   'custom:<endpointId>'           → one row per custom endpoint
 *
 * Refresh orchestration lives in providers/index.js (it owns the
 * provider classes and API keys). This module owns persistence and
 * entry normalization only.
 */

import db from '../db.js'
import { applyCatalogGuardrails, inferModelFamily, prettyModelName } from './model_filter.js'
import { customModelId } from './custom.js'

/**
 * Persist a discovered model list for a catalog ID.
 * @param {string} catalogId
 * @param {Array<Object>} models - Normalized catalog entries
 */
export function saveCatalog(catalogId, models) {
  db.prepare(`
    INSERT INTO model_catalog (catalog_id, models, fetched_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(catalog_id) DO UPDATE SET models = excluded.models, fetched_at = excluded.fetched_at
  `).run(catalogId, JSON.stringify(models))
}

/**
 * Load a cached model list.
 * @param {string} catalogId
 * @returns {{ models: Array<Object>, fetchedAt: string }|null}
 */
export function loadCatalog(catalogId) {
  const row = db.prepare('SELECT models, fetched_at FROM model_catalog WHERE catalog_id = ?').get(catalogId)
  if (!row) return null
  try {
    return { models: JSON.parse(row.models), fetchedAt: row.fetched_at }
  } catch {
    return null
  }
}

/**
 * Delete a cached model list (e.g. after key removal or endpoint deletion).
 * @param {string} catalogId
 */
export function clearCatalog(catalogId) {
  db.prepare('DELETE FROM model_catalog WHERE catalog_id = ?').run(catalogId)
}

/**
 * Normalize raw discovered models into catalog entries for a cloud provider.
 * Applies the modality/recency/alias guardrails first.
 *
 * @param {string} providerId - 'gemini' | 'claude' | 'openai'
 * @param {Array<{id, name?, description?, releasedAt?}>} rawModels
 * @param {number} [nowMs]
 * @returns {Array<{id, name, description, family, releasedAt}>}
 */
export function buildProviderCatalogEntries(providerId, rawModels, nowMs = Date.now()) {
  const filtered = applyCatalogGuardrails(rawModels, nowMs)
  const entries = filtered.map((m) => {
    const family = inferModelFamily(providerId, m.id)
    return {
      id: m.id,
      name: m.name || prettyModelName(m.id),
      description: m.description || (family ? `${family} family` : ''),
      family,
      releasedAt: m.releasedAt ?? null,
    }
  })
  // Newest first when timestamps exist; stable order otherwise
  entries.sort((a, b) => (b.releasedAt || 0) - (a.releasedAt || 0))
  return entries
}

/**
 * Normalize raw discovered models into catalog entries for a custom endpoint.
 * Model IDs get the `custom:<endpointId>:` namespace so the global picker
 * and provider resolution can route them back to this endpoint.
 *
 * @param {{ id: string, name: string }} endpoint - custom_endpoints row
 * @param {Array<{id, releasedAt?}>} rawModels
 * @param {number} [nowMs]
 * @returns {Array<{id, upstreamId, name, description, family, releasedAt}>}
 */
export function buildEndpointCatalogEntries(endpoint, rawModels, nowMs = Date.now()) {
  const filtered = applyCatalogGuardrails(rawModels, nowMs)
  return filtered.map((m) => ({
    id: customModelId(endpoint.id, m.id),
    upstreamId: m.id,
    name: prettyModelName(m.id),
    description: `Served by ${endpoint.name}`,
    family: null,
    releasedAt: m.releasedAt ?? null,
  }))
}

// ═══════════════════════════════════════════════════════════════
// Custom endpoint rows
// ═══════════════════════════════════════════════════════════════

/**
 * List all registered custom endpoints (with plain-text keys — server-side
 * use only; routes must mask before responding).
 * @returns {Array<Object>}
 */
export function listCustomEndpoints() {
  return db.prepare('SELECT * FROM custom_endpoints ORDER BY created_at ASC').all()
}

/**
 * Fetch one custom endpoint row by ID.
 * @param {string} id
 * @returns {Object|undefined}
 */
export function getCustomEndpoint(id) {
  return db.prepare('SELECT * FROM custom_endpoints WHERE id = ?').get(id)
}
