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
  /banana/i, // Google's "Nano Banana" image-generation line
  // Moderation & safety classifiers
  /moderation/i,
  /guard/i,
  // Specialized non-chat systems (music, robotics, agentic research,
  // computer-use automation, IDE-specific endpoints)
  /lyria/i,
  /robotics/i,
  /computer-use/i,
  /deep-research/i,
  /antigravity/i,
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
 * Used for display grouping/labels and for the latest-per-family
 * reduction below.
 *
 * @param {string} providerId - 'gemini' | 'claude' | 'openai' | other
 * @param {string} modelId
 * @returns {string|null} Family label (e.g. 'Flash', 'Sonnet', 'Flagship') or null
 */
export function inferModelFamily(providerId, modelId) {
  const id = (modelId || '').toLowerCase()
  if (providerId === 'gemini') {
    // Family names only apply to the core Gemini/Gemma lines — a stray
    // 'pro' or 'flash' in a specialized model ID must not hijack a family.
    if (id.startsWith('gemma')) return 'Gemma'
    if (!id.startsWith('gemini')) return null
    if (id.includes('flash-lite')) return 'Flash-Lite'
    if (id.includes('flash')) return 'Flash'
    if (id.includes('pro')) return 'Pro'
    return null
  }
  if (providerId === 'claude') {
    if (id.includes('fable')) return 'Fable'
    if (id.includes('opus')) return 'Opus'
    if (id.includes('sonnet')) return 'Sonnet'
    if (id.includes('haiku')) return 'Haiku'
    return null
  }
  if (providerId === 'openai') {
    // GPT-5.6 tier names: sol (flagship), terra (balanced), luna (fast)
    if (id.includes('-sol')) return 'Flagship'
    if (id.includes('-terra')) return 'Balanced'
    if (id.includes('-luna')) return 'Fast'
    if (id.includes('nano')) return 'Nano'
    if (id.includes('mini')) return 'Mini'
    if (/^o\d/.test(id)) return 'Reasoning'
    if (id.includes('codex')) return 'Codex'
    if (id.startsWith('chatgpt')) return 'Chat'
    if (id.startsWith('gpt')) return 'Flagship'
    return null
  }
  return null
}

/** Display/sort order of families per provider (unknown families sort last). */
const FAMILY_ORDER = {
  gemini: ['Pro', 'Flash', 'Flash-Lite', 'Gemma'],
  claude: ['Fable', 'Opus', 'Sonnet', 'Haiku'],
  openai: ['Flagship', 'Balanced', 'Fast', 'Mini', 'Nano', 'Reasoning', 'Codex', 'Chat'],
}

/**
 * Extract a comparable generation number from a model ID.
 * 'gemini-3.6-flash' → 3.6, 'claude-opus-4-8' → 4.8, 'gpt-5.6-sol' → 5.6,
 * 'o4-mini' → 4, 'gemini-flash-latest' → null.
 *
 * Snapshot suffixes are stripped first so date digits never win, and
 * Claude's dash-separated versions normalize to dots before matching.
 *
 * @param {string} modelId
 * @returns {number|null}
 */
export function extractGeneration(modelId) {
  if (!modelId) return null
  const base = baseAliasOf(modelId).replace(/(\d)-(\d)/g, '$1.$2')
  const match = base.match(/\d+(?:\.\d+)?/)
  if (!match) return null
  const value = parseFloat(match[0])
  return Number.isNaN(value) ? null : value
}

/** Matches preview/experimental/floating-alias variants. */
const PREVIEW_VARIANT_RE = /preview|exp\b|experimental|-latest\b|latest$/i

/**
 * Check if a model ID looks like a preview/experimental/alias variant
 * rather than a stable release.
 * @param {string} modelId
 * @returns {boolean}
 */
export function isPreviewVariant(modelId) {
  return PREVIEW_VARIANT_RE.test(modelId || '')
}

/**
 * Reduce a model list to the latest generation of each family.
 *
 * The heuristic behind the picker: users want "the newest Flash, the
 * newest Opus, the newest flagship GPT" — not every generation that
 * happens to be under a year old. For each family:
 *   1. Find the highest generation number among its models.
 *   2. Keep only models of that generation.
 *   3. When both stable and preview/alias variants remain, keep stable.
 * Models without any version number (e.g. 'gemini-flash-latest') are
 * kept only when their family has no versioned model at all.
 * Unclassifiable models (family null) pass through unchanged.
 *
 * The result is sorted by family display order, then generation.
 *
 * @param {string} providerId
 * @param {Array<{id: string}>} models
 * @returns {Array} The reduced, ordered model list
 */
export function keepLatestPerFamily(providerId, models) {
  const groups = new Map()
  for (const model of models) {
    const family = inferModelFamily(providerId, model.id)
    const key = family ?? '__other__'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(model)
  }

  const order = FAMILY_ORDER[providerId] || []
  const sortedKeys = [...groups.keys()].sort((a, b) => {
    const ia = a === '__other__' ? Infinity : order.indexOf(a) === -1 ? order.length : order.indexOf(a)
    const ib = b === '__other__' ? Infinity : order.indexOf(b) === -1 ? order.length : order.indexOf(b)
    return ia - ib
  })

  const result = []
  for (const key of sortedKeys) {
    const group = groups.get(key)
    if (key === '__other__') {
      result.push(...group)
      continue
    }
    const versioned = group.filter((m) => extractGeneration(m.id) !== null)
    let kept
    if (versioned.length > 0) {
      const maxGen = Math.max(...versioned.map((m) => extractGeneration(m.id)))
      kept = versioned.filter((m) => extractGeneration(m.id) === maxGen)
      const stable = kept.filter((m) => !isPreviewVariant(m.id))
      if (stable.length > 0) kept = stable
    } else {
      kept = group
    }
    // Collapse suffix variants: when one kept ID is a prefix of another
    // ('gemini-3.1-pro-preview' vs 'gemini-3.1-pro-preview-customtools'),
    // keep the base variant only.
    kept = kept.filter(
      (m) => !kept.some((other) => other !== m && m.id.startsWith(`${other.id}-`))
    )
    result.push(...kept)
  }
  return result
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
