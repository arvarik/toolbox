/**
 * @fileoverview OpenAI-compatible provider core.
 *
 * Speaks the standard OpenAI wire format (`/chat/completions`, `/models`)
 * over plain fetch — no SDK dependency. Two concrete providers build on
 * this class:
 *
 *   - OpenAIProvider        → api.openai.com (branded, static metadata)
 *   - CustomEndpointProvider → user-configured servers (Ollama, LM Studio,
 *                              vLLM, OpenRouter, Groq, ...)
 *
 * Structured output (generateJSON) adapts to the server's capability:
 *
 *   json_schema  →  json_object  →  prompt-enforced JSON
 *
 * The first mode that succeeds is cached per (baseUrl, model), so later
 * calls skip the failing modes.
 */

import { AIProvider } from './base.js'
import logger from '../utils/logger.js'

/** Ordered list of structured-output modes, most strict first. */
const JSON_MODES = ['json_schema', 'json_object', 'prompt']

/** Cache: `${baseUrl}|${model}` → index into JSON_MODES that last worked. */
const jsonModeCache = new Map()

export class OpenAICompatibleProvider extends AIProvider {
  // ═══════════════════════════════════════════════════════════
  // Static metadata — subclasses override the branding
  // ═══════════════════════════════════════════════════════════

  static get apiBaseUrl() { return 'https://api.openai.com/v1' }

  /**
   * @param {string} apiKey - Bearer token (may be empty for local servers)
   * @param {string} [baseUrl] - Override the API base URL
   */
  constructor(apiKey, baseUrl) {
    super(apiKey)
    this.baseUrl = (baseUrl || new.target.apiBaseUrl).replace(/\/+$/, '')
  }

  // ═══════════════════════════════════════════════════════════
  // HTTP plumbing
  // ═══════════════════════════════════════════════════════════

  _headers() {
    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) headers['Authorization'] = `Bearer ${this.apiKey}`
    return headers
  }

  /**
   * Name of the max-tokens request parameter.
   * Local engines expect the classic `max_tokens`; the branded OpenAI
   * provider overrides this with `max_completion_tokens` (required by
   * reasoning models).
   */
  get maxTokensParam() {
    return 'max_tokens'
  }

  /**
   * Resolve the model ID to send upstream.
   * Strips the `custom:<endpointId>:` namespace prefix that the global
   * model picker uses for custom endpoint models.
   */
  _resolveModel(model) {
    const id = model || this.constructor.defaultModel
    if (id && id.startsWith('custom:')) {
      return id.split(':').slice(2).join(':')
    }
    return id
  }

  /**
   * POST /chat/completions (non-streaming).
   * @returns {Promise<Object>} The parsed response body
   * @throws {Error} With the server's error message on failure
   */
  async _chatCompletion(body) {
    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(await extractErrorMessage(res))
    }
    return res.json()
  }

  // ═══════════════════════════════════════════════════════════
  // AIProvider implementation
  // ═══════════════════════════════════════════════════════════

  async generateText(prompt, options = {}) {
    const messages = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    messages.push({ role: 'user', content: prompt })

    const body = {
      model: this._resolveModel(options.model),
      messages,
      [this.maxTokensParam]: options.maxOutputTokens ?? 8192,
    }
    if (options.temperature !== undefined) body.temperature = options.temperature

    const data = await this._chatCompletion(body)
    return data.choices?.[0]?.message?.content ?? ''
  }

  /**
   * Structured JSON generation with adaptive downgrade.
   * Tries `json_schema`, then `json_object`, then prompt-only enforcement.
   * A mode fails on an API error or an unparseable response; the next
   * mode then runs. The first working mode is cached per (baseUrl, model).
   */
  async generateJSON(prompt, schema, options = {}) {
    const model = this._resolveModel(options.model)
    const cacheKey = `${this.baseUrl}|${model}`
    const startIndex = jsonModeCache.get(cacheKey) ?? 0

    let lastError = null
    for (let i = startIndex; i < JSON_MODES.length; i++) {
      const mode = JSON_MODES[i]
      try {
        const result = await this._generateJSONWithMode(mode, prompt, schema, model, options)
        jsonModeCache.set(cacheKey, i)
        return result
      } catch (err) {
        lastError = err
        logger.warn(
          `[OpenAICompatibleProvider] JSON mode "${mode}" failed for ${model} at ${this.baseUrl}: ${err.message}`
        )
      }
    }
    throw lastError || new Error('Structured JSON generation failed')
  }

  async _generateJSONWithMode(mode, prompt, schema, model, options) {
    let systemPrompt = options.systemPrompt || ''
    systemPrompt +=
      '\n\nIMPORTANT: Respond with valid JSON only. No markdown, no code fences, no explanation — just raw JSON.'

    const body = {
      model,
      [this.maxTokensParam]: options.maxOutputTokens ?? 8192,
    }
    if (options.temperature !== undefined) body.temperature = options.temperature

    // OpenAI json_schema mode requires an object at the schema root.
    // Wrap array/scalar roots into { items: ... } and unwrap after.
    const needsWrap = schema && schema.type !== 'object'

    if (mode === 'json_schema') {
      const effectiveSchema = needsWrap
        ? { type: 'object', properties: { items: schema }, required: ['items'] }
        : (schema || { type: 'object' })
      body.response_format = {
        type: 'json_schema',
        json_schema: { name: 'structured_response', schema: effectiveSchema },
      }
      if (needsWrap) {
        systemPrompt += '\n\nReturn a JSON object with a single "items" key holding the requested data.'
      }
    } else {
      if (mode === 'json_object') {
        body.response_format = { type: 'json_object' }
      }
      if (schema) {
        systemPrompt += `\n\nThe response must conform to this JSON schema:\n${JSON.stringify(schema, null, 2)}`
        if (schema.type === 'array') {
          systemPrompt += '\n\nReturn the JSON array directly (or an object with an "items" array).'
        }
      }
    }

    body.messages = [
      { role: 'system', content: systemPrompt.trim() },
      { role: 'user', content: prompt },
    ]

    const data = await this._chatCompletion(body)
    const text = data.choices?.[0]?.message?.content ?? ''
    const parsed = parseJSONResponse(text)

    // Unwrap { items: [...] } when the root schema was not an object
    if (needsWrap && parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'items' in parsed) {
      return parsed.items
    }
    return parsed
  }

  async *streamChat(systemPrompt, history, message, options = {}) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...mapHistory(history),
      { role: 'user', content: message },
    ]

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({
        model: this._resolveModel(options.model),
        messages,
        [this.maxTokensParam]: options.maxOutputTokens ?? 8192,
        temperature: options.temperature ?? 0.5,
        stream: true,
      }),
    })
    if (!res.ok) {
      throw new Error(await extractErrorMessage(res))
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
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
        if (payload === '[DONE]') return
        try {
          const parsed = JSON.parse(payload)
          const text = parsed.choices?.[0]?.delta?.content
          if (text) yield { type: 'text', text }
        } catch {
          // Skip malformed SSE lines
        }
      }
    }
  }

  async *streamChatWithTools(systemPrompt, history, message, tools, toolExecutor, options = {}) {
    const model = this._resolveModel(options.model)
    const openaiTools = tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }))

    const messages = [
      { role: 'system', content: systemPrompt },
      ...mapHistory(history),
      { role: 'user', content: message },
    ]

    let firstTurn = true
    let continueLoop = true

    while (continueLoop) {
      continueLoop = false

      let data
      try {
        data = await this._chatCompletion({
          model,
          messages,
          tools: openaiTools,
          [this.maxTokensParam]: options.maxOutputTokens ?? 8192,
          temperature: options.temperature ?? 0.5,
        })
      } catch (err) {
        // Some local engines reject the `tools` parameter entirely.
        // Degrade gracefully to a plain streaming chat on the first turn.
        if (firstTurn && /tool|function/i.test(err.message || '')) {
          logger.warn(
            `[OpenAICompatibleProvider] ${this.baseUrl} rejected tools (${err.message}). Falling back to plain chat.`
          )
          yield* this.streamChat(systemPrompt, history, message, options)
          return
        }
        throw err
      }
      firstTurn = false

      const choice = data.choices?.[0]
      const msg = choice?.message || {}

      if (msg.content) {
        yield { type: 'text', text: msg.content }
      }

      const toolCalls = msg.tool_calls || []
      if (toolCalls.length > 0) {
        messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: toolCalls })

        for (const call of toolCalls) {
          const name = call.function?.name
          yield { type: 'tool', name }
          let args = {}
          try {
            args = JSON.parse(call.function?.arguments || '{}')
          } catch {
            // Malformed arguments from the model — execute with empty args
          }
          const result = await toolExecutor(name, args)
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(result),
          })
        }
        continueLoop = true
      }
    }
  }

  /**
   * Verify the credential/endpoint by listing models.
   * Cheap (no token spend) and works on every OpenAI-compatible server.
   */
  async testApiKey(apiKey) {
    await this.constructor.fetchModels(apiKey, this.baseUrl)
    return true
  }

  /**
   * Ping this instance's endpoint and return its live model list.
   * @returns {Promise<Array<{id: string, releasedAt: number|null}>>}
   */
  async listModels() {
    return this.constructor.fetchModels(this.apiKey, this.baseUrl)
  }

  /**
   * GET /models from an OpenAI-compatible server.
   *
   * @param {string} apiKey - Bearer token (may be empty)
   * @param {string} [baseUrl] - The server base URL
   * @returns {Promise<Array<{id: string, releasedAt: number|null}>>} Raw models
   * @throws {Error} With a connectivity-friendly message on failure
   */
  static async fetchModels(apiKey, baseUrl) {
    const base = (baseUrl || this.apiBaseUrl).replace(/\/+$/, '')
    const headers = {}
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`

    let res
    try {
      res = await fetch(`${base}/models`, { headers })
    } catch (err) {
      throw new Error(`Could not reach ${base} — ${err.message}`, { cause: err })
    }
    if (!res.ok) {
      throw new Error(await extractErrorMessage(res))
    }

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
}

// ═══════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════

/** Map internal chat roles ('ai'/'model') to OpenAI roles. */
function mapHistory(history) {
  return (history || []).map((msg) => ({
    role: msg.role === 'ai' || msg.role === 'model' ? 'assistant' : 'user',
    content: msg.content,
  }))
}

/** Parse a JSON response, stripping markdown code fences if present. */
function parseJSONResponse(text) {
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim()
  return JSON.parse(cleaned)
}

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

/** Test-only: reset the structured-output mode cache. */
export function _resetJsonModeCache() {
  jsonModeCache.clear()
}
