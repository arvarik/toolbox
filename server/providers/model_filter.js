/**
 * @fileoverview Model catalog guardrails.
 *
 * Pure functions that filter raw provider model listings down to the
 * set of models the UI should offer. Three passes run in order:
 *
 *   1. Modality filter  — keep chat/reasoning models, drop embeddings,
 *                         audio, image/video generation, and moderation.
 *   2. Recency filter   — drop models released/updated over 1 year ago
 *                         (models without a timestamp pass through).
 *   3. Alias dedupe     — collapse pinned snapshots (gpt-4o-2024-08-06)
 *                         into their floating alias (gpt-4o) when both
 *                         appear in the listing.
 *
 * No database or network access here — the catalog module composes
 * these with provider fetchers. This keeps the guardrails unit-testable.
 */

/** The recency window: 1 year in milliseconds. */
export const RECENCY_WINDOW_MS = 365 * 24 * 60 * 60 * 1000

/**
 * Identifier substrings that mark a model as non-conversational.
 * Matching is case-insensitive against the raw model ID.
 */
const NON_CHAT_PATTERNS = [
  // Embeddings
  /embed/i,
  // Audio: transcription, speech synthesis, realtime voice
  /whisper/i,
  /\btts\b|-tts/i,
  /transcribe/i,
  /-audio/i,
  /realtime/i,
  /speech/i,
  // Image / video generation
  /dall-?e/i,
  /imagen/i,
  /veo/i,
  /-image/i,
  /image-generation/i,
  // Moderation & safety classifiers
  /moderation/i,
  /guard/i,
  // Legacy completion-only engines
  /babbage/i,
  /davinci/i,
  /-instruct/i,
  // Search / retrieval helper models
  /search-preview/i,
  // Gemini attributed question answering (not a chat model)
  /\baqa\b/i,
]

/**
 * Check if a model ID looks like an interactive chat/reasoning model.
 * @param {string} modelId - Raw model identifier from the provider
 * @returns {boolean} True when the model is a chat model
 */
export function isChatModel(modelId) {
  if (!modelId) return false
  return !NON_CHAT_PATTERNS.some((re) => re.test(modelId))
}

/**
 * Check if a release timestamp falls inside the recency window.
 * Models without a timestamp pass the check — several providers
 * (e.g. the Gemini listing API) do not expose release dates, and
 * dropping every undated model would empty the catalog.
 *
 * @param {number|null|undefined} releasedAtMs - Release time (ms epoch), or null
 * @param {number} [nowMs] - Current time (ms epoch); defaults to Date.now()
 * @returns {boolean} True when the model is recent enough to show
 */
export function isWithinRecencyWindow(releasedAtMs, nowMs = Date.now()) {
  if (releasedAtMs === null || releasedAtMs === undefined) return true
  return nowMs - releasedAtMs <= RECENCY_WINDOW_MS
}

/** Matches pinned snapshot suffixes: -2024-08-06, -20250219, -0125, @001 */
const SNAPSHOT_SUFFIX_RE = /[-@](\d{4}-\d{2}-\d{2}|\d{8}|\d{3,4})$/

/**
 * Strip a pinned snapshot suffix from a model ID.
 * @param {string} modelId
 * @returns {string} The base alias (unchanged when no suffix matches)
 */
export function baseAliasOf(modelId) {
  return modelId.replace(SNAPSHOT_SUFFIX_RE, '')
}

/**
 * Collapse alias duplicates in a model list.
 *
 * When the listing contains both a floating alias ("gpt-4o") and its
 * pinned snapshots ("gpt-4o-2024-08-06"), only the floating alias
 * stays. A snapshot with no matching alias stays as-is. Exact
 * duplicate IDs also collapse to one entry.
 *
 * @param {Array<{id: string}>} models
 * @returns {Array<{id: string}>} The deduplicated list (original order kept)
 */
export function dedupeAliases(models) {
  const ids = new Set(models.map((m) => m.id))
  const seen = new Set()
  const result = []
  for (const model of models) {
    if (seen.has(model.id)) continue
    seen.add(model.id)
    const base = baseAliasOf(model.id)
    // Drop this snapshot when its floating alias is also present
    if (base !== model.id && ids.has(base)) continue
    result.push(model)
  }
  return result
}

/**
 * Run all three guardrail passes over a raw model list.
 *
 * @param {Array<{id: string, releasedAt?: number|null}>} models - Raw models.
 *   `releasedAt` is a ms-epoch release/update timestamp, or null when unknown.
 * @param {number} [nowMs] - Current time (ms epoch) for the recency check
 * @returns {Array} The filtered, deduplicated model list
 */
export function applyCatalogGuardrails(models, nowMs = Date.now()) {
  const filtered = models.filter(
    (m) => isChatModel(m.id) && isWithinRecencyWindow(m.releasedAt, nowMs)
  )
  return dedupeAliases(filtered)
}

/**
 * Infer the marketing family of a model from its ID.
 * Used for display grouping/labels in pickers.
 *
 * @param {string} providerId - 'gemini' | 'claude' | 'openai' | other
 * @param {string} modelId
 * @returns {string|null} Family label (e.g. 'Flash', 'Sonnet', 'Reasoning') or null
 */
export function inferModelFamily(providerId, modelId) {
  const id = (modelId || '').toLowerCase()
  if (providerId === 'gemini') {
    if (id.includes('flash-lite')) return 'Flash-Lite'
    if (id.includes('flash')) return 'Flash'
    if (id.includes('pro')) return 'Pro'
    return null
  }
  if (providerId === 'claude') {
    if (id.includes('sonnet')) return 'Sonnet'
    if (id.includes('haiku')) return 'Haiku'
    if (id.includes('opus')) return 'Opus'
    return null
  }
  if (providerId === 'openai') {
    if (id.includes('mini') || id.includes('nano')) return 'Mini'
    if (/^o\d/.test(id)) return 'Reasoning'
    if (id.startsWith('gpt') || id.startsWith('chatgpt')) return 'Flagship'
    return null
  }
  return null
}

/**
 * Build a human-readable display name from a raw model ID.
 * 'gpt-4o' → 'GPT 4o', 'llama3.2:3b' → 'Llama3.2 3b'
 *
 * @param {string} modelId
 * @returns {string}
 */
export function prettyModelName(modelId) {
  if (!modelId) return ''
  const cleaned = modelId.replace(/^models\//, '')
  return cleaned
    .split(/[-_:/]/)
    .filter(Boolean)
    .map((part) => {
      if (/^gpt/i.test(part)) return part.toUpperCase()
      if (/^\d/.test(part)) return part
      return part.charAt(0).toUpperCase() + part.slice(1)
    })
    .join(' ')
}
