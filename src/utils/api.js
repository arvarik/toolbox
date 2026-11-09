import { getCache, setCache, enqueueSync } from './db'

const API_BASE = '/api'

function activeKitHeader() {
  if (typeof window !== 'undefined' && window.location?.pathname) {
    const match = window.location.pathname.match(/^\/k\/([^/]+)/)
    if (match) return { 'X-Toolbox-Kit': decodeURIComponent(match[1]) }
  }
  const slug = globalThis.__toolboxActiveKitSlug
  return slug ? { 'X-Toolbox-Kit': slug } : {}
}

/**
 * Generic fetch wrapper with offline and sync support.
 */
async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData

  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...activeKitHeader(),
    ...(options.headers || {}),
  }

  const config = {
    ...options,
    headers,
  }

  if (!isFormData && config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body)
  }

  const isGet = !config.method || config.method === 'GET'

  // If offline, try cache (for GET) or queue sync (for mutations)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (isGet) {
      const cached = await getCache(url)
      if (cached) return cached
      throw new Error('Offline and no cache available')
    } else if (!isFormData) {
      await enqueueSync(url, config)
      return { _offline: true, message: 'Queued for sync' } // Mock success for optimistic UI
    }
  }

  let res
  try {
    res = await fetch(url, config)
  } catch (err) {
    // Network error (e.g. server down while browser still thinks it is online)
    if (isGet) {
      const cached = await getCache(url)
      if (cached) return cached
    } else if (!isFormData) {
      await enqueueSync(url, config)
      return { _offline: true, message: 'Queued for sync' }
    }
    throw err
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ message: res.statusText }))
    const message =
      body?.error?.message || body?.message || `Request failed: ${res.status}`
    const err = new Error(message)
    err.status = res.status
    err.code = body?.error?.code
    err.details = body?.error?.details
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('toolbox:unauthorized', { detail: { code: err.code } }),
      )
    }
    throw err
  }

  // Handle 204 No Content
  if (res.status === 204) return null

  const data = await res.json()

  // Cache successful GET requests for offline use
  if (isGet) {
    await setCache(url, data).catch(console.error)
  }

  return data
}

/* ---- Config ---- */
export const configApi = {
  get: () => request('/config'),
  update: (data) => request('/config', { method: 'PUT', body: data }),
  /** Test an API key for a specific provider. provider: 'gemini' | 'claude' | 'openai' */
  testApiKey: (key, provider = 'gemini') => request('/config/test-key', { method: 'POST', body: { key, provider } }),
  /** Get all available models based on configured API keys, grouped by provider */
  getAvailableModels: () => request('/config/available-models'),
  /** Re-sync model catalogs with every configured provider and custom endpoint */
  refreshModels: () => request('/config/refresh-models', { method: 'POST' }),
}

/* ---- Custom Endpoints (BYOM) ---- */
export const endpointsApi = {
  /** List registered custom endpoints (keys masked, cached models attached) */
  list: () => request('/endpoints'),
  /** Register a custom endpoint. data: { name, baseUrl, apiKey? } */
  create: (data) => request('/endpoints', { method: 'POST', body: data }),
  /** Edit a custom endpoint. Masked/omitted apiKey keeps the stored key. */
  update: (id, data) => request(`/endpoints/${id}`, { method: 'PUT', body: data }),
  /** Remove a custom endpoint and its discovered models */
  delete: (id) => request(`/endpoints/${id}`, { method: 'DELETE' }),
  /** Ping an endpoint without saving. data: { baseUrl, apiKey?, endpointId? } */
  test: (data) => request('/endpoints/test', { method: 'POST', body: data }),
  /** Re-discover the model list for one endpoint */
  refreshModels: (id) => request(`/endpoints/${id}/refresh-models`, { method: 'POST' }),
}

/* ---- Decks ---- */
export const decksApi = {
  list: () => request('/decks'),
  get: (id) => request(`/decks/${id}`),
  create: (data) => request('/decks', { method: 'POST', body: data }),
  update: (id, data) => request(`/decks/${id}`, { method: 'PUT', body: data }),
  delete: (id) => request(`/decks/${id}`, { method: 'DELETE' }),
  updateSettings: (id, settings) => request(`/decks/${id}/settings`, { method: 'PUT', body: settings }),
}

/* ---- Flashcards ---- */
export const flashcardsApi = {
  list: (deckId) => request(`/decks/${deckId}/cards`),
  due: (deckId) => request(`/decks/${deckId}/cards/due`),
  dueAll: () => request('/decks/all/cards/due'),
  create: (deckId, data) => request(`/decks/${deckId}/cards`, { method: 'POST', body: data }),
  update: (deckId, cardId, data) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'PUT', body: data }),
  delete: (deckId, cardId) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),
  review: (deckId, cardId, quality, confidence) =>
    request(`/decks/${deckId}/cards/${cardId}/review`, { method: 'PUT', body: { quality, confidence } }),
  checkDuplicates: (deckId, cards) =>
    request(`/decks/${deckId}/cards/check-duplicates`, { method: 'POST', body: { cards } }),
}

/* ---- Study Sessions ---- */
export const studySessionsApi = {
  list: () => request('/study_sessions'),
}

/* ---- Boards ---- */
export const boardsApi = {
  list: () => request('/boards'),
  get: (id) => request(`/boards/${id}`),
  create: (data) => request('/boards', { method: 'POST', body: data }),
  update: (id, data) => request(`/boards/${id}`, { method: 'PUT', body: data }),
  delete: (id) => request(`/boards/${id}`, { method: 'DELETE' }),
  rename: (id, name) => request(`/boards/${id}/rename`, { method: 'PATCH', body: { name } }),
  reorder: (ids) => request('/boards/reorder', { method: 'PATCH', body: { ids } }),
}

/* ---- Chat ---- */
export const chatApi = {
  send: (data) => request('/chat', { method: 'POST', body: data }),

  /**
   * Stream a chat response via SSE.
   * @param {Object} data - { message, context, history }
   * @param {Function} onChunk - Called with each text chunk as it arrives
   * @param {Function} onTool - Called with tool execution strings
   * @param {AbortSignal} [signal] - Optional signal to abort the fetch
   * @returns {Promise<string>} - The full accumulated response text
   */
  stream: async (data, onChunk, onTool, signal) => {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...activeKitHeader(),
      },
      body: JSON.stringify(data),
      signal,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }))
      const message =
        body?.error?.message || body?.message || `Stream failed: ${res.status}`
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('toolbox:unauthorized', {
            detail: { code: body?.error?.code },
          }),
        )
      }
      throw new Error(message)
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()

        if (payload === '[DONE]') {
          return fullText
        }

        try {
          const parsed = JSON.parse(payload)
          if (parsed.error) {
            throw new Error(parsed.error)
          }
          if (parsed.tool) {
            if (onTool) onTool(parsed.tool)
            fullText += `\n\n*⚙️ ${parsed.tool}*\n\n`
            onChunk(fullText)
          }
          if (parsed.text !== undefined) {
            fullText += parsed.text
            onChunk(fullText)
          }
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) {
            throw e
          }
          // Skip malformed JSON lines
        }
      }
    }

    return fullText
  },

  /**
   * Summarize selected chat excerpts into clean guide section notes.
   * @param {Object} data - { excerpts, sectionId, sectionName, topicName, model }
   * @returns {Promise<{ content: string }>}
   */
  summarize: (data) => request('/chat/summarize', { method: 'POST', body: data }),

  /**
   * Evaluate the "Why?" interceptor explanation.
   * @param {Object} data - { explanation, front, back, model }
   * @returns {Promise<{ pass: boolean, feedback: string }>}
   */
  evaluateInterceptor: (data) => request('/chat/evaluate-interceptor', { method: 'POST', body: data }),

  /**
   * Generates a Mermaid concept map from a session history.
   * @param {Object} data - { history, model }
   * @returns {Promise<{ response: string }>}
   */
  generateConceptMap: (data) => request('/chat/concept-map', { method: 'POST', body: data }),

  /**
   * Analyze a chat session and generate reconciled guide section updates.
   * @param {Object} data - { messages, pillarId, topicId, topicName, model }
   * @returns {Promise<{ updates: Array<{ sectionId, sectionName, reason, existingContent, newContent, isNew }> }>}
   */
  commitAnalyze: (data) => request('/chat/commit', { method: 'POST', body: data }),

  /**
   * Batch-save approved section updates from the commit preview.
   * @param {Object} data - { pillarId, topicId, updates: [{ sectionId, content }] }
   * @returns {Promise<{ ok: boolean, savedCount: number }>}
   */
  commitSave: (data) => request('/chat/commit/save', { method: 'POST', body: data }),

  /**
   * Generate flashcards from a given text.
   * @param {Object} data - { text, topicName, model, sessionContext, sections?, pillarId?, topicId? }
   * @returns {Promise<{ cards: Array<{ front, back, sourceSectionId?, sourceSectionName? }> }>}
   */
  generateFlashcards: (data) => request('/chat/generate-flashcards', { method: 'POST', body: data }),

  /**
   * Generate reverse (bidirectional) flashcards from existing Q&A pairs.
   * @param {Object} data - { cards: [{ front, back }], model }
   * @returns {Promise<{ reverseCards: Array<{ front, back, originalIndex }> }>}
   */
  generateReverseCards: (data) => request('/chat/generate-reverse-cards', { method: 'POST', body: data }),

  // Session Management
  getSessions: () => request('/chat/sessions'),
  saveSession: (session) => request('/chat/sessions', { method: 'POST', body: { session } }),
  deleteSession: (id) => request(`/chat/sessions/${id}`, { method: 'DELETE' }),
  migrateBulk: (sessions) => request('/chat/sessions/bulk', { method: 'POST', body: { sessions } }),
}

/* ---- Guide Content ---- */
export const guideContentApi = {
  /** Get all filled sections for a topic. Returns { sectionId: { content, committedAt } } */
  getForTopic: (pillarId, topicId) => request(`/guide-content/${pillarId}/${topicId}`),

  /** Get content for a single section. */
  getSection: (pillarId, topicId, sectionId) =>
    request(`/guide-content/${pillarId}/${topicId}/${sectionId}`),

  /** Upsert content for a section. */
  upsert: (pillarId, topicId, sectionId, content) =>
    request(`/guide-content/${pillarId}/${topicId}/${sectionId}`, {
      method: 'PUT',
      body: { content },
    }),

  /** Delete (clear) a section's content. */
  clear: (pillarId, topicId, sectionId) =>
    request(`/guide-content/${pillarId}/${topicId}/${sectionId}`, { method: 'DELETE' }),

  /** Get a map of all filled section keys. Returns { 'pillarId__topicId__sectionId': true } */
  progress: () => request('/guide-content/progress'),

  /** Get a download URL for the exported markdown file (Note: usually triggered via window.open, but here for completeness) */
  exportUrl: () => `${API_BASE}/guide-content/export`,
}

/* ---- Profile ---- */
export const profileApi = {
  get: () => request('/profile'),
  update: (profileText) => request('/profile', { method: 'PUT', body: { profileText } }),
  clear: () => request('/profile', { method: 'DELETE' }),
}

/* ---- System ---- */
export const systemApi = {
  stats: () => request('/system/stats'),
  clearCache: () => request('/system/clear-cache', { method: 'POST' }),
  exportDbUrl: () => `${API_BASE}/system/export-db`,
}

/* ---- Search ---- */
export const searchApi = {
  query: (q) => request(`/search?q=${encodeURIComponent(q)}`),
}

/* ---- Knowledge Graph ---- */
export const graphApi = {
  /** Full graph: nodes with live SRS health, edges, tracks, stats */
  get: () => request('/graph'),
  /** Node detail for the slide-over panel */
  getNode: (id) => request(`/graph/nodes/${id}`),
  /** Study session built from one node's studyable cards */
  nodeSession: (id) => request(`/graph/nodes/${id}/session`, { method: 'POST' }),
  /** Study session for a curated learning track, in prerequisite order */
  trackSession: (id) => request(`/graph/tracks/${id}/session`, { method: 'POST' }),
}

/* ---- BotE Calculator ---- */
export const calculatorApi = {
  /** AI sanity check. data: { scenario, inputs, results, model } */
  audit: (data) => request('/calculator/audit', { method: 'POST', body: data }),
}

/* ---- Personal Kits & Archive ---- */
export const kitsApi = {
  list: () => request('/kits'),
  get: (idOrSlug) => request(`/kits/${encodeURIComponent(idOrSlug)}`),
  update: (idOrSlug, patch) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}`, { method: 'PATCH', body: patch }),
  delete: (idOrSlug) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}`, { method: 'DELETE' }),
  touch: (idOrSlug) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/touch`, { method: 'POST' }),
  getArchivedNotes: (idOrSlug) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/archived-notes`),
  refileArchivedNote: (idOrSlug, data) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/archived-notes/refile`, {
      method: 'POST',
      body: data,
    }),
  deleteArchivedNote: (idOrSlug, data) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/archived-notes`, {
      method: 'DELETE',
      body: data,
    }),
  syncUpstream: (idOrSlug) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/sync-upstream`, { method: 'POST' }),
  syncSkeleton: (idOrSlug, skeleton) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/sync`, {
      method: 'POST',
      body: { skeleton },
    }),
  publish: (idOrSlug, data) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/publish`, {
      method: 'POST',
      body: data,
    }),
  importKitJson: (skeleton, onCollision = 'error') =>
    request('/kits/import-kit', {
      method: 'POST',
      body: { skeleton, onCollision },
    }),
  importBackupZip: (file, onCollision = 'error') => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('onCollision', onCollision)
    return request('/kits/import-backup', {
      method: 'POST',
      body: fd,
    })
  },
  exportUrl: (idOrSlug, { mode = 'kit', includeGuideNotes = false } = {}) => {
    const params = new URLSearchParams({ mode })
    if (mode === 'kit' && includeGuideNotes) {
      params.set('includeGuideNotes', 'true')
    }
    return `${API_BASE}/kits/${encodeURIComponent(idOrSlug)}/export?${params.toString()}`
  },
  downloadExport: async (idOrSlug, { mode = 'kit', includeGuideNotes = false } = {}) => {
    const url = kitsApi.exportUrl(idOrSlug, { mode, includeGuideNotes })
    const res = await fetch(url, { headers: activeKitHeader() })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ message: res.statusText }))
      const msg = body?.error?.message || body?.message || `Export failed (${res.status})`
      throw new Error(msg)
    }
    const disposition = res.headers.get('Content-Disposition') || ''
    const match = disposition.match(/filename="([^"]+)"/)
    const fallbackName =
      mode === 'backup'
        ? `${idOrSlug}.toolbox-backup.zip`
        : `${idOrSlug}.toolbox-kit.json`
    const filename = match ? match[1] : fallbackName
    const blob = await res.blob()
    const blobUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = blobUrl
    link.download = filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(blobUrl), 5000)
    return { filename }
  },
  sourceFileUrl: (idOrSlug, sourceId) =>
    `${API_BASE}/kits/${encodeURIComponent(idOrSlug)}/sources/${encodeURIComponent(sourceId)}/file`,
}

/* ---- Shared Community Library ---- */
export const sharedKitsApi = {
  list: ({ q, tag } = {}) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (tag) params.set('tag', tag)
    const qs = params.toString()
    return request(`/shared-kits${qs ? `?${qs}` : ''}`)
  },
  get: (slug) => request(`/shared-kits/${encodeURIComponent(slug)}`),
  fork: (slug, data = {}) =>
    request(`/shared-kits/${encodeURIComponent(slug)}/fork`, {
      method: 'POST',
      body: data,
    }),
}
