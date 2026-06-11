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
  create: (deckId, data) => request(`/decks/${deckId}/cards`, { method: 'POST', body: data }),
  update: (deckId, cardId, data) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'PUT', body: data }),
  delete: (deckId, cardId) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),
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
}
