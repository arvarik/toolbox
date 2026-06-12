const API_BASE = '/api'

/**
 * Generic fetch wrapper with error handling.
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

  const res = await fetch(url, config)

  if (!res.ok) {
    const error = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(error.message || `Request failed: ${res.status}`)
  }

  // Handle 204 No Content
  if (res.status === 204) return null
  return res.json()
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
}

/* ---- Flashcards ---- */
export const flashcardsApi = {
  list: (deckId) => request(`/decks/${deckId}/cards`),
  due: (deckId) => request(`/decks/${deckId}/cards/due`),
  create: (deckId, data) => request(`/decks/${deckId}/cards`, { method: 'POST', body: data }),
  update: (deckId, cardId, data) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'PUT', body: data }),
  delete: (deckId, cardId) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),
  review: (deckId, cardId, quality) =>
    request(`/decks/${deckId}/cards/${cardId}/review`, { method: 'POST', body: { quality } }),
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
   * @returns {Promise<string>} - The full accumulated response text
   */
  stream: async (data, onChunk) => {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
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
}
