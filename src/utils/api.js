import { getCache, setCache, enqueueSync } from './db'

const API_BASE = '/api'

/**
 * Generic fetch wrapper with offline and sync support.
 */
async function request(path, options = {}) {
  const url = `${API_BASE}${path}`
  const config = {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  }

  if (config.body && typeof config.body === 'object') {
    config.body = JSON.stringify(config.body)
  }

  const isGet = !config.method || config.method === 'GET'

  // If offline, try cache (for GET) or queue sync (for mutations)
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    if (isGet) {
      const cached = await getCache(url)
      if (cached) return cached
      throw new Error('Offline and no cache available')
    } else {
      await enqueueSync(url, config)
      return { _offline: true, message: 'Queued for sync' } // Mock success for optimistic UI
    }
  }

  try {
    const res = await fetch(url, config)

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(error.message || `Request failed: ${res.status}`)
    }

    // Handle 204 No Content
    if (res.status === 204) return null
    
    const data = await res.json()
    
    // Cache successful GET requests for offline use
    if (isGet) {
      await setCache(url, data).catch(console.error)
    }
    
    return data
  } catch (err) {
    // Fallback if fetch fails (e.g. server down but browser thinks it's online)
    if (isGet) {
      const cached = await getCache(url)
      if (cached) return cached
    } else {
      await enqueueSync(url, config)
      return { _offline: true, message: 'Queued for sync' }
    }
    throw err
  }
}

/* ---- Config ---- */
export const configApi = {
  get: () => request('/config'),
  update: (data) => request('/config', { method: 'PUT', body: data }),
  testApiKey: (key) => request('/config/test-key', { method: 'POST', body: { key } }),
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
    request(`/decks/${deckId}/cards/${cardId}/review`, { method: 'POST', body: { quality, confidence } }),
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
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal,
    })

    if (!res.ok) {
      const error = await res.json().catch(() => ({ message: res.statusText }))
      throw new Error(error.message || `Stream failed: ${res.status}`)
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
            fullText += parsed.text + '\n'
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
