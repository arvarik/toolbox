/**
 * @fileoverview Custom endpoint routes ("Bring Your Own Model").
 *
 * CRUD for user-registered OpenAI-compatible endpoints (Ollama,
 * LM Studio, vLLM, OpenRouter, Groq, ...). Every save verifies
 * connectivity first and discovers the endpoint's model list.
 * API keys are always masked in responses.
 */

import { Router } from 'express'
import { randomUUID } from 'crypto'
import db from '../db.js'
import { fetchEndpointModels } from '../providers/defs.js'
import { getCustomEndpoint, listCustomEndpoints, loadCatalog } from '../providers/catalog.js'
import { refreshEndpointCatalog, handleEndpointRemoved } from '../providers/index.js'
import { maskSecret, isMaskedValue } from '../utils/mask.js'

const router = Router()

/** Serialize an endpoint row for the client (key masked, models attached). */
function toClientEndpoint(row) {
  const catalog = loadCatalog(`custom:${row.id}`)
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKeyMasked: maskSecret(row.api_key),
    hasApiKey: !!row.api_key,
    models: catalog?.models || [],
    modelsFetchedAt: catalog?.fetchedAt || null,
    createdAt: row.created_at,
  }
}

/** Validate and normalize a base URL. Returns null when invalid. */
function normalizeBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim()) return null
  const trimmed = baseUrl.trim().replace(/\/+$/, '')
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return trimmed
  } catch {
    return null
  }
}

/**
 * GET /api/endpoints
 * List all custom endpoints with masked keys and cached models.
 */
router.get('/', (req, res) => {
  res.json(listCustomEndpoints().map(toClientEndpoint))
})

/**
 * POST /api/endpoints/test
 * Ping an endpoint without saving it.
 * Body: { baseUrl, apiKey?, endpointId? }
 * When endpointId is set and apiKey is omitted/masked, the stored key
 * is used (lets the UI re-test a saved endpoint).
 */
router.post('/test', async (req, res) => {
  const { baseUrl, apiKey, endpointId } = req.body
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    return res.status(400).json({ ok: false, message: 'A valid http(s) Base URL is required' })
  }

  let effectiveKey = typeof apiKey === 'string' && !isMaskedValue(apiKey) ? apiKey : ''
  if (!effectiveKey && endpointId) {
    const existing = getCustomEndpoint(endpointId)
    if (existing) effectiveKey = existing.api_key || ''
  }

  try {
    const models = await fetchEndpointModels(effectiveKey, normalized)
    res.json({ ok: true, modelCount: models.length })
  } catch (err) {
    res.status(400).json({ ok: false, message: err.message || 'Could not reach the endpoint' })
  }
})

/**
 * POST /api/endpoints
 * Register a custom endpoint. Connectivity is verified and the model
 * list discovered before anything is saved.
 * Body: { name, baseUrl, apiKey? }
 */
router.post('/', async (req, res) => {
  const { name, baseUrl, apiKey } = req.body
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ message: 'A name is required' })
  }
  const normalized = normalizeBaseUrl(baseUrl)
  if (!normalized) {
    return res.status(400).json({ message: 'A valid http(s) Base URL is required' })
  }
  const key = typeof apiKey === 'string' && !isMaskedValue(apiKey) ? apiKey.trim() : ''

  const endpoint = {
    id: randomUUID(),
    name: name.trim(),
    base_url: normalized,
    api_key: key,
  }

  try {
    // Pre-flight: the endpoint must respond before we save it
    await fetchEndpointModels(key, normalized)
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Could not reach the endpoint' })
  }

  db.prepare(`
    INSERT INTO custom_endpoints (id, name, base_url, api_key)
    VALUES (?, ?, ?, ?)
  `).run(endpoint.id, endpoint.name, endpoint.base_url, endpoint.api_key)

  try {
    await refreshEndpointCatalog(endpoint)
  } catch {
    // Discovery hiccup after a successful pre-flight — the endpoint is
    // saved; the user can hit Refresh Models later.
  }

  res.status(201).json(toClientEndpoint(getCustomEndpoint(endpoint.id)))
})

/**
 * PUT /api/endpoints/:id
 * Edit a custom endpoint. Omitted or masked apiKey keeps the stored key.
 * Connectivity is re-verified and the model list re-discovered.
 * Body: { name?, baseUrl?, apiKey? }
 */
router.put('/:id', async (req, res) => {
  const existing = getCustomEndpoint(req.params.id)
  if (!existing) {
    return res.status(404).json({ message: 'Endpoint not found' })
  }

  const { name, baseUrl, apiKey } = req.body
  const nextName = typeof name === 'string' && name.trim() ? name.trim() : existing.name
  const nextUrl = baseUrl !== undefined ? normalizeBaseUrl(baseUrl) : existing.base_url
  if (!nextUrl) {
    return res.status(400).json({ message: 'A valid http(s) Base URL is required' })
  }
  let nextKey = existing.api_key || ''
  if (typeof apiKey === 'string' && !isMaskedValue(apiKey)) {
    nextKey = apiKey.trim()
  }

  try {
    await fetchEndpointModels(nextKey, nextUrl)
  } catch (err) {
    return res.status(400).json({ message: err.message || 'Could not reach the endpoint' })
  }

  db.prepare(`
    UPDATE custom_endpoints
    SET name = ?, base_url = ?, api_key = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(nextName, nextUrl, nextKey, req.params.id)

  // Drop stale cached instances/catalog, then re-discover
  handleEndpointRemoved(req.params.id)
  const updated = getCustomEndpoint(req.params.id)
  try {
    await refreshEndpointCatalog(updated)
  } catch {
    // Discovery hiccup — user can refresh later
  }

  res.json(toClientEndpoint(updated))
})

/**
 * POST /api/endpoints/:id/refresh-models
 * Re-discover the model list for one endpoint.
 */
router.post('/:id/refresh-models', async (req, res) => {
  const endpoint = getCustomEndpoint(req.params.id)
  if (!endpoint) {
    return res.status(404).json({ message: 'Endpoint not found' })
  }
  try {
    await refreshEndpointCatalog(endpoint)
    res.json(toClientEndpoint(getCustomEndpoint(endpoint.id)))
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not reach the endpoint' })
  }
})

/**
 * DELETE /api/endpoints/:id
 * Remove a custom endpoint, its discovered catalog, and cached instances.
 */
router.delete('/:id', (req, res) => {
  const existing = getCustomEndpoint(req.params.id)
  if (!existing) {
    return res.status(404).json({ message: 'Endpoint not found' })
  }
  db.prepare('DELETE FROM custom_endpoints WHERE id = ?').run(req.params.id)
  handleEndpointRemoved(req.params.id)
  res.json({ success: true })
})

export default router
