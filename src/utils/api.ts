const API_BASE = '/api'

export class ApiError extends Error {
  status?: number
  code?: string
  details?: unknown

  constructor(message: string, status?: number, code?: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

export interface ModelProviderInfo {
  id: string
  name: string
  color?: string
}

export interface ModelCatalogItem {
  id: string
  name: string
  description?: string
  family?: string | null
}

export interface ModelGroup {
  provider: ModelProviderInfo
  models: ModelCatalogItem[]
}

export interface AvailableModelsResponse {
  groups: ModelGroup[]
  providers?: ModelProviderInfo[]
  errors?: Record<string, string>
}

export interface ConfigResponse {
  api_key_configured?: boolean
  api_keys_configured?: Record<string, boolean>
  gemini_api_key?: string
  claude_api_key?: string
  openai_api_key?: string
  [key: string]: unknown
}

export interface DeckRecord {
  id: string
  name: string
  description?: string
  tags?: string
  color_index?: number
  card_count?: number
  due_count?: number
  new_count?: number
  last_studied?: string | null
  progress?: number
  cards?: FlashcardRecord[]
  [key: string]: unknown
}

export interface FlashcardRecord {
  id: string
  deck_id?: string
  front: string
  back: string
  state?: number
  source_pillar_id?: string | null
  source_topic_id?: string | null
  source_section_id?: string | null
  is_reverse?: number
  [key: string]: unknown
}

export interface DuplicateMatchItem {
  isDuplicate: boolean
  duplicateOf?: { id?: string; front: string; back: string }
  similarity?: number
}

export interface SearchApiResponse {
  guideContent: Array<{
    pillar_id: string
    topic_id: string
    section_id: string
    content?: string
  }>
  flashcards: Array<{
    id: string
    deck_id: string
    front: string
    back?: string
  }>
  boards: Array<{
    id: string
    name: string
  }>
  decks: Array<{
    id: string
    name: string
  }>
}

export interface CommitSectionUpdate {
  sectionId: string
  sectionName?: string
  reason: string
  existingContent?: string
  newContent: string
  isNew: boolean
}

export interface GeneratedFlashcardDraft {
  front: string
  back: string
  sourceSectionId?: string | null
  sourceSectionName?: string | null
  sourcePillarId?: string | null
  sourceTopicId?: string | null
}

export interface ReverseCardDraft extends GeneratedFlashcardDraft {
  originalIndex: number
}

export interface SharedKitApiEntry {
  id: string
  slug: string
  name: string
  description: string
  icon: string
  color: string
  authorId: string | null
  authorName: string
  isOfficial: boolean
  latestVersion: number
  tags: string[]
  downloadsCount: number
  pillarCount: number
  topicCount: number
  nodeCount: number
  starterCardCount: number
  starterDrillCount: number
  createdAt: string
  updatedAt: string
}

export interface SharedKitDetailApiEntry extends SharedKitApiEntry {
  versions: Array<{
    version: number
    changelog: string
    createdAt: string
  }>
}

interface RequestOptions extends Omit<RequestInit, 'body' | 'headers'> {
  body?: unknown
  headers?: Record<string, string>
}

interface ErrorPayload {
  message?: string
  error?: {
    message?: string
    code?: string
    details?: unknown
  }
}

/**
 * Resolves the active Kit header (`X-Toolbox-Kit`) synchronously from the
 * `/k/:slug` URL pathname first, falling back to `useKitStore`'s synced global slug.
 */
export function getActiveKitHeaders(): Record<string, string> {
  if (typeof window !== 'undefined' && window.location?.pathname) {
    const match = window.location.pathname.match(/^\/k\/([^/]+)/)
    if (match) return { 'X-Toolbox-Kit': decodeURIComponent(match[1]) }
  }
  const slug = (globalThis as { __toolboxActiveKitSlug?: unknown }).__toolboxActiveKitSlug
  return typeof slug === 'string' && slug ? { 'X-Toolbox-Kit': slug } : {}
}

/**
 * Generic fetch wrapper with active Kit header propagation and structured errors.
 */
async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const url = `${API_BASE}${path}`
  const isFormData =
    typeof FormData !== 'undefined' && options.body instanceof FormData

  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...getActiveKitHeaders(),
    ...(options.headers ?? {}),
  }

  let serializedBody: BodyInit | undefined
  if (isFormData) {
    serializedBody = options.body as FormData
  } else if (typeof options.body === 'string') {
    serializedBody = options.body
  } else if (options.body !== undefined) {
    serializedBody = JSON.stringify(options.body)
  }

  const { body: _rawBody, headers: _rawHeaders, ...restOptions } = options
  const config: RequestInit = {
    ...restOptions,
    headers,
    ...(serializedBody !== undefined ? { body: serializedBody } : {}),
  }

  const res = await fetch(url, config)

  if (!res.ok) {
    const body = (await res
      .json()
      .catch(() => ({ message: res.statusText }))) as ErrorPayload
    const message =
      body?.error?.message || body?.message || `Request failed: ${res.status}`
    const err = new ApiError(
      message,
      res.status,
      body?.error?.code,
      body?.error?.details,
    )
    if (res.status === 401 && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('toolbox:unauthorized', { detail: { code: err.code } }),
      )
    }
    throw err
  }

  if (res.status === 204) return null as T

  return (await res.json()) as T
}

/* ---- Config ---- */
export const configApi = {
  get: () => request<ConfigResponse>('/config'),
  update: (data: Record<string, unknown>) =>
    request('/config', { method: 'PUT', body: data }),
  testApiKey: (key: string, provider = 'gemini') =>
    request<{ valid?: boolean; ok?: boolean; message?: string }>('/config/test-key', {
      method: 'POST',
      body: { key, provider },
    }),
  getAvailableModels: () => request<AvailableModelsResponse>('/config/available-models'),
  refreshModels: () =>
    request<AvailableModelsResponse>('/config/refresh-models', { method: 'POST' }),
}

/* ---- Custom Endpoints (BYOM) ---- */
export const endpointsApi = {
  list: <T = Record<string, unknown>>() => request<T[]>('/endpoints'),
  create: (data: { name: string; baseUrl: string; apiKey?: string }) =>
    request('/endpoints', { method: 'POST', body: data }),
  update: (id: string, data: object) =>
    request(`/endpoints/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) => request(`/endpoints/${id}`, { method: 'DELETE' }),
  test: (data: { baseUrl: string; apiKey?: string; endpointId?: string }) =>
    request<{ ok: boolean; modelCount?: number; message?: string }>('/endpoints/test', {
      method: 'POST',
      body: data,
    }),
  refreshModels: (id: string) =>
    request(`/endpoints/${id}/refresh-models`, { method: 'POST' }),
}

/* ---- Decks ---- */
export const decksApi = {
  list: () => request<DeckRecord[]>('/decks'),
  get: (id: string) => request<DeckRecord>(`/decks/${id}`),
  create: (data: { name: string; description?: string; tags?: string; color_index?: number }) =>
    request<DeckRecord>('/decks', { method: 'POST', body: data }),
  update: (id: string, data: object) =>
    request<DeckRecord>(`/decks/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) => request(`/decks/${id}`, { method: 'DELETE' }),
  updateSettings: (id: string, settings: object) =>
    request(`/decks/${id}/settings`, { method: 'PUT', body: settings }),
}

/* ---- Flashcards ---- */
export const flashcardsApi = {
  list: (deckId: string) => request<FlashcardRecord[]>(`/decks/${deckId}/cards`),
  due: (deckId: string) => request<FlashcardRecord[]>(`/decks/${deckId}/cards/due`),
  dueAll: () => request<FlashcardRecord[]>('/decks/all/cards/due'),
  create: (deckId: string, data: object) =>
    request<FlashcardRecord>(`/decks/${deckId}/cards`, { method: 'POST', body: data }),
  update: (deckId: string, cardId: string, data: object) =>
    request<FlashcardRecord>(`/decks/${deckId}/cards/${cardId}`, {
      method: 'PUT',
      body: data,
    }),
  delete: (deckId: string, cardId: string) =>
    request(`/decks/${deckId}/cards/${cardId}`, { method: 'DELETE' }),
  review: (
    deckId: string,
    cardId: string,
    quality: number,
    confidence?: string | number | null,
  ) =>
    request(`/decks/${deckId}/cards/${cardId}/review`, {
      method: 'PUT',
      body: { quality, confidence },
    }),
  checkDuplicates: (deckId: string, cards: Array<{ front: string; back: string }>) =>
    request<{ results?: DuplicateMatchItem[] }>(`/decks/${deckId}/cards/check-duplicates`, {
      method: 'POST',
      body: { cards },
    }),
}

/* ---- Study Sessions ---- */
export const studySessionsApi = {
  list: () => request<Array<{ date: string; count: number }>>('/study_sessions'),
}

/* ---- Boards ---- */
export const boardsApi = {
  list: <T = Record<string, unknown>>() => request<T[]>('/boards'),
  get: <T = Record<string, unknown>>(id: string) => request<T>(`/boards/${id}`),
  create: <T = Record<string, unknown>>(data: object) =>
    request<T>('/boards', { method: 'POST', body: data }),
  update: <T = Record<string, unknown>>(id: string, data: object) =>
    request<T>(`/boards/${id}`, { method: 'PUT', body: data }),
  delete: (id: string) => request(`/boards/${id}`, { method: 'DELETE' }),
  rename: (id: string, name: string) =>
    request(`/boards/${id}/rename`, { method: 'PATCH', body: { name } }),
  reorder: (ids: string[]) =>
    request('/boards/reorder', { method: 'PATCH', body: { ids } }),
}

/* ---- Chat ---- */
export const chatApi = {
  send: (data: Record<string, unknown>) =>
    request<{ response: string }>('/chat', { method: 'POST', body: data }),

  /**
   * Stream a chat response via SSE.
   */
  stream: async (
    data: Record<string, unknown>,
    onChunk: (fullText: string) => void,
    onTool?: ((tool: string) => void) | null,
    signal?: AbortSignal,
  ): Promise<string> => {
    const res = await fetch(`${API_BASE}/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...getActiveKitHeaders(),
      },
      body: JSON.stringify(data),
      signal,
    })

    if (!res.ok) {
      const body = (await res
        .json()
        .catch(() => ({ message: res.statusText }))) as ErrorPayload
      const message =
        body?.error?.message || body?.message || `Stream failed: ${res.status}`
      if (res.status === 401 && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('toolbox:unauthorized', {
            detail: { code: body?.error?.code },
          }),
        )
      }
      throw new ApiError(message, res.status, body?.error?.code, body?.error?.details)
    }

    if (!res.body) return ''

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let fullText = ''
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()

        if (payload === '[DONE]') {
          return fullText
        }

        let parsed: { error?: string; tool?: string; text?: string } | null = null
        try {
          parsed = JSON.parse(payload) as {
            error?: string
            tool?: string
            text?: string
          }
        } catch {
          // Skip malformed JSON lines
          continue
        }

        if (parsed?.error) {
          throw new Error(parsed.error)
        }
        if (parsed?.tool) {
          onTool?.(parsed.tool)
          fullText += `\n\n*⚙️ ${parsed.tool}*\n\n`
          onChunk(fullText)
        }
        if (parsed?.text !== undefined) {
          fullText += parsed.text
          onChunk(fullText)
        }
      }
    }

    return fullText
  },

  summarize: (data: Record<string, unknown>) =>
    request<{ content: string }>('/chat/summarize', { method: 'POST', body: data }),

  evaluateInterceptor: (data: Record<string, unknown>) =>
    request<{ pass: boolean; feedback: string }>('/chat/evaluate-interceptor', {
      method: 'POST',
      body: data,
    }),

  generateConceptMap: (data: Record<string, unknown>) =>
    request<{ response: string }>('/chat/concept-map', { method: 'POST', body: data }),

  commitAnalyze: (data: Record<string, unknown>) =>
    request<{ updates: CommitSectionUpdate[] }>('/chat/commit', {
      method: 'POST',
      body: data,
    }),

  commitSave: (data: Record<string, unknown>) =>
    request<{ ok: boolean; savedCount: number }>('/chat/commit/save', {
      method: 'POST',
      body: data,
    }),

  generateFlashcards: (data: Record<string, unknown>) =>
    request<{ cards: GeneratedFlashcardDraft[] }>('/chat/generate-flashcards', {
      method: 'POST',
      body: data,
    }),

  generateReverseCards: (data: {
    cards: Array<{ front: string; back: string }>
    model?: string
  }) =>
    request<{ reverseCards: ReverseCardDraft[] }>('/chat/generate-reverse-cards', {
      method: 'POST',
      body: data,
    }),

  getSessions: <T = Record<string, unknown>>() => request<T>('/chat/sessions'),
  saveSession: (session: object) =>
    request('/chat/sessions', { method: 'POST', body: { session } }),
  deleteSession: (id: string) =>
    request(`/chat/sessions/${id}`, { method: 'DELETE' }),
  migrateBulk: (sessions: object) =>
    request('/chat/sessions/bulk', { method: 'POST', body: { sessions } }),
}

/* ---- Guide Content ---- */
export const guideContentApi = {
  getForTopic: (pillarId: string, topicId: string) =>
    request<Record<string, { content: string; committedAt?: string | null }>>(
      `/guide-content/${pillarId}/${topicId}`,
    ),
  getSection: (pillarId: string, topicId: string, sectionId: string) =>
    request<{ content: string; committedAt?: string | null }>(
      `/guide-content/${pillarId}/${topicId}/${sectionId}`,
    ),
  upsert: (pillarId: string, topicId: string, sectionId: string, content: string) =>
    request(`/guide-content/${pillarId}/${topicId}/${sectionId}`, {
      method: 'PUT',
      body: { content },
    }),
  clear: (pillarId: string, topicId: string, sectionId: string) =>
    request(`/guide-content/${pillarId}/${topicId}/${sectionId}`, {
      method: 'DELETE',
    }),
  progress: () => request<Record<string, boolean>>('/guide-content/progress'),
  exportUrl: () => `${API_BASE}/guide-content/export`,
}

/* ---- Profile ---- */
export const profileApi = {
  get: () => request<{ profileText: string }>('/profile'),
  update: (profileText: string) =>
    request('/profile', { method: 'PUT', body: { profileText } }),
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
  query: (q: string) =>
    request<SearchApiResponse>(`/search?q=${encodeURIComponent(q)}`),
}

/* ---- Knowledge Graph ---- */
export const graphApi = {
  get: <T = unknown>() => request<T>('/graph'),
  getNode: <T = unknown>(id: string) => request<T>(`/graph/nodes/${id}`),
  nodeSession: (id: string) =>
    request(`/graph/nodes/${id}/session`, { method: 'POST' }),
  trackSession: (id: string) =>
    request(`/graph/tracks/${id}/session`, { method: 'POST' }),
}

/* ---- BotE Calculator ---- */
export const calculatorApi = {
  audit: (data: Record<string, unknown>) =>
    request('/calculator/audit', { method: 'POST', body: data }),
}

/* ---- Personal Kits & Archive ---- */
export const kitsApi = {
  list: () => request<{ kits?: Array<Record<string, unknown>> }>('/kits'),
  get: (idOrSlug: string) =>
    request<{ kit?: Record<string, unknown> }>(`/kits/${encodeURIComponent(idOrSlug)}`),
  update: (idOrSlug: string, patch: Record<string, unknown>) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}`, { method: 'PATCH', body: patch }),
  delete: (idOrSlug: string) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}`, { method: 'DELETE' }),
  touch: (idOrSlug: string) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/touch`, { method: 'POST' }),
  getArchivedNotes: (idOrSlug: string) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/archived-notes`),
  refileArchivedNote: (idOrSlug: string, data: Record<string, unknown>) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/archived-notes/refile`, {
      method: 'POST',
      body: data,
    }),
  deleteArchivedNote: (idOrSlug: string, data: Record<string, unknown>) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/archived-notes`, {
      method: 'DELETE',
      body: data,
    }),
  syncUpstream: (idOrSlug: string) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/sync-upstream`, { method: 'POST' }),
  syncSkeleton: (idOrSlug: string, skeleton: unknown) =>
    request(`/kits/${encodeURIComponent(idOrSlug)}/sync`, {
      method: 'POST',
      body: { skeleton },
    }),
  publish: (
    idOrSlug: string,
    data: { changelog?: string; includeBaselineNotes?: boolean; slug?: string },
  ) =>
    request<{ sharedKit?: { name?: string; latestVersion?: number; slug?: string } }>(
      `/kits/${encodeURIComponent(idOrSlug)}/publish`,
      {
        method: 'POST',
        body: data,
      },
    ),
  importKitJson: (skeleton: unknown, onCollision = 'error') =>
    request<{ kit?: unknown; mode?: string }>('/kits/import-kit', {
      method: 'POST',
      body: { skeleton, onCollision },
    }),
  importBackupZip: (file: File | Blob, onCollision = 'error') => {
    const fd = new FormData()
    fd.append('file', file)
    fd.append('onCollision', onCollision)
    return request<{ kit?: unknown; mode?: string }>('/kits/import-backup', {
      method: 'POST',
      body: fd,
    })
  },
  exportUrl: (
    idOrSlug: string,
    {
      mode = 'kit',
      includeGuideNotes = false,
    }: { mode?: 'kit' | 'backup'; includeGuideNotes?: boolean } = {},
  ) => {
    const params = new URLSearchParams({ mode })
    if (mode === 'kit' && includeGuideNotes) {
      params.set('includeGuideNotes', 'true')
    }
    return `${API_BASE}/kits/${encodeURIComponent(idOrSlug)}/export?${params.toString()}`
  },
  downloadExport: async (
    idOrSlug: string,
    {
      mode = 'kit',
      includeGuideNotes = false,
    }: { mode?: 'kit' | 'backup'; includeGuideNotes?: boolean } = {},
  ): Promise<{ filename: string }> => {
    const url = kitsApi.exportUrl(idOrSlug, { mode, includeGuideNotes })
    const res = await fetch(url, { headers: getActiveKitHeaders() })
    if (!res.ok) {
      const body = (await res
        .json()
        .catch(() => ({ message: res.statusText }))) as ErrorPayload
      const msg =
        body?.error?.message || body?.message || `Export failed (${res.status})`
      throw new ApiError(msg, res.status, body?.error?.code, body?.error?.details)
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
  sourceFileUrl: (idOrSlug: string, sourceId: string) =>
    `${API_BASE}/kits/${encodeURIComponent(idOrSlug)}/sources/${encodeURIComponent(sourceId)}/file`,
}

/* ---- Shared Community Library ---- */
export const sharedKitsApi = {
  list: ({ q, tag }: { q?: string; tag?: string } = {}) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (tag) params.set('tag', tag)
    const qs = params.toString()
    return request<{ kits?: SharedKitApiEntry[] }>(
      `/shared-kits${qs ? `?${qs}` : ''}`,
    )
  },
  get: (slug: string) =>
    request<{ sharedKit?: SharedKitDetailApiEntry }>(
      `/shared-kits/${encodeURIComponent(slug)}`,
    ),
  fork: (slug: string, data: Record<string, unknown> = {}) =>
    request<{ kit?: { id?: string; slug?: string; name?: string } }>(
      `/shared-kits/${encodeURIComponent(slug)}/fork`,
      {
        method: 'POST',
        body: data,
      },
    ),
}
