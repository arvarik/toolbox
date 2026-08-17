/**
 * @fileoverview Provider definitions and model-listing fetchers.
 *
 * Each cloud provider is a plain metadata object. The AI SDK
 * (server/ai/engine.js) makes the actual model calls; this module only
 * describes providers (branding, config keys, static model fallbacks)
 * and lists their live model catalogs over plain fetch.
 *
 * Adding a new key-based provider requires:
 *   1. Add a definition object to PROVIDER_DEFS below.
 *   2. Add a model factory to server/ai/engine.js.
 * The registry, routes, and settings UI discover the rest.
 */

/** Timeout for model-listing requests. */
const LIST_TIMEOUT_MS = 15_000

// ═══════════════════════════════════════════════════════════════
// Custom endpoint model ID namespace
// ═══════════════════════════════════════════════════════════════

/** Brand color used for all custom endpoint groups in the UI. */
export const CUSTOM_ENDPOINT_COLOR = '#8B5CF6'

/**
 * Build the namespaced picker ID for a model on a custom endpoint.
 * @param {string} endpointId
 * @param {string} upstreamModelId
 * @returns {string}
 */
export function customModelId(endpointId, upstreamModelId) {
  return `custom:${endpointId}:${upstreamModelId}`
}

/**
 * Parse a namespaced custom model ID (`custom:<endpointId>:<model>`).
 * @param {string} modelId
 * @returns {{ endpointId: string, upstreamModelId: string }|null}
 */
export function parseCustomModelId(modelId) {
  if (typeof modelId !== 'string' || !modelId.startsWith('custom:')) return null
  const parts = modelId.split(':')
  if (parts.length < 3) return null
  return { endpointId: parts[1], upstreamModelId: parts.slice(2).join(':') }
}

// ═══════════════════════════════════════════════════════════════
// Model-listing fetchers
// ═══════════════════════════════════════════════════════════════

/** Pull a useful error message out of a failed HTTP response. */
async function extractErrorMessage(res) {
  let detail = ''
  try {
    const body = await res.json()
    detail = body?.error?.message || body?.message || ''
  } catch {
    // Non-JSON error body
  }
  return detail || `Request failed with status ${res.status}`
}

/**
 * Live model discovery via the Gemini model listing API.
 * Keeps only models that support generateContent (chat-capable).
 * @param {string} apiKey
 * @returns {Promise<Array<{id, name, description, releasedAt}>>}
 */
async function fetchGeminiModels(apiKey) {
  const models = []
  let pageToken = ''
  do {
    const url = new URL('https://generativelanguage.googleapis.com/v1beta/models')
    url.searchParams.set('key', apiKey)
    url.searchParams.set('pageSize', '200')
    if (pageToken) url.searchParams.set('pageToken', pageToken)

    const res = await fetch(url, { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
    if (!res.ok) throw new Error(await extractErrorMessage(res))

    const data = await res.json()
    for (const m of data.models || []) {
      const methods = m.supportedGenerationMethods || []
      if (!methods.includes('generateContent')) continue
      models.push({
        id: (m.name || '').replace(/^models\//, ''),
        name: m.displayName || (m.name || '').replace(/^models\//, ''),
        description: (m.description || '').slice(0, 140),
        releasedAt: null,
      })
    }
    pageToken = data.nextPageToken || ''
  } while (pageToken)

  return models
}

/**
 * Live model discovery via the Anthropic model listing API.
 * Returns release timestamps (created_at) for the recency guardrail.
 * @param {string} apiKey
 * @returns {Promise<Array<{id, name, description, releasedAt}>>}
 */
async function fetchClaudeModels(apiKey) {
  const models = []
  let afterId = ''
  let pages = 0
  do {
    const url = new URL('https://api.anthropic.com/v1/models')
    url.searchParams.set('limit', '100')
    if (afterId) url.searchParams.set('after_id', afterId)

    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(await extractErrorMessage(res))

    const data = await res.json()
    for (const m of data.data || []) {
      const releasedAt = m.created_at ? Date.parse(m.created_at) : null
      models.push({
        id: m.id,
        name: m.display_name || m.id,
        description: '',
        releasedAt: Number.isNaN(releasedAt) ? null : releasedAt,
      })
    }
    afterId = data.has_more ? data.last_id : ''
    pages += 1
  } while (afterId && pages < 10)

  return models
}

/**
 * GET /models from an OpenAI-compatible server (api.openai.com, Ollama,
 * LM Studio, vLLM, OpenRouter, Groq, ...).
 *
 * @param {string} apiKey - Bearer token (may be empty for local servers)
 * @param {string} baseUrl - The server base URL (e.g. https://api.openai.com/v1)
 * @returns {Promise<Array<{id: string, releasedAt: number|null}>>}
 */
export async function fetchEndpointModels(apiKey, baseUrl) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  const headers = {}
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

  let res
  try {
    res = await fetch(`${base}/models`, { headers, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  } catch (err) {
    throw new Error(`Could not reach ${base} — ${err.message}`, { cause: err })
  }
  if (!res.ok) throw new Error(await extractErrorMessage(res))

  const data = await res.json()
  const rawModels = Array.isArray(data?.data) ? data.data : Array.isArray(data) ? data : []
  return rawModels
    .filter((m) => m && (m.id || m.name))
    .map((m) => ({
      id: m.id || m.name,
      // OpenAI-style `created` is unix seconds
      releasedAt: typeof m.created === 'number' ? m.created * 1000 : null,
    }))
}

// ═══════════════════════════════════════════════════════════════
// Provider definitions
// ═══════════════════════════════════════════════════════════════

export const PROVIDER_DEFS = [
  {
    id: 'gemini',
    name: 'Google Gemini',
    shortName: 'Gemini',
    color: '#4285F4',
    configKey: 'gemini_api_key',
    envKey: 'GEMINI_API_KEY',
    keyPlaceholder: 'AIza...',
    keyHelpUrl: 'https://aistudio.google.com/apikey',
    keyHelpLabel: 'Google AI Studio',
    capabilities: { streaming: true, toolCalling: true, jsonMode: true, embeddings: true },
    // Static fallback catalog, replaced by live discovery once a key is verified.
    models: [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Fast and efficient — best for most tasks', family: 'Flash' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', description: 'Advanced reasoning, stable and reliable', family: 'Pro' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Budget-friendly, high-speed for simple tasks', family: 'Flash-Lite' },
    ],
    ownsModelId: (modelId) => /^(gemini|gemma)/i.test(modelId || ''),
    fetchModels: fetchGeminiModels,
  },
  {
    id: 'claude',
    name: 'Anthropic Claude',
    shortName: 'Claude',
    color: '#D97757',
    configKey: 'claude_api_key',
    envKey: 'CLAUDE_API_KEY',
    keyPlaceholder: 'sk-ant-...',
    keyHelpUrl: 'https://console.anthropic.com/settings/keys',
    keyHelpLabel: 'Anthropic Console',
    capabilities: { streaming: true, toolCalling: true, jsonMode: true, embeddings: false },
    models: [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Best balance of speed and intelligence', family: 'Sonnet' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest, most cost-effective', family: 'Haiku' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', description: 'Most capable, complex reasoning', family: 'Opus' },
    ],
    ownsModelId: (modelId) => /^claude/i.test(modelId || ''),
    fetchModels: fetchClaudeModels,
  },
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    color: '#10A37F',
    configKey: 'openai_api_key',
    envKey: 'OPENAI_API_KEY',
    keyPlaceholder: 'sk-...',
    keyHelpUrl: 'https://platform.openai.com/api-keys',
    keyHelpLabel: 'OpenAI Platform',
    capabilities: { streaming: true, toolCalling: true, jsonMode: true, embeddings: false },
    models: [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Flagship — hardest coding, agents, and research', family: 'Flagship' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Balanced quality and cost for most tasks', family: 'Balanced' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Fastest and most cost-effective', family: 'Fast' },
    ],
    ownsModelId: (modelId) => /^(gpt|o\d|chatgpt|codex)/i.test(modelId || ''),
    fetchModels: (apiKey) => fetchEndpointModels(apiKey, 'https://api.openai.com/v1'),
  },
]

/** The model the app uses when a request names no model. */
export const DEFAULT_MODEL_ID = PROVIDER_DEFS[0].models[0].id
