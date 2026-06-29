/**
 * @fileoverview Claude AI Provider implementation.
 * Wraps the Anthropic SDK (@anthropic-ai/sdk) behind the unified AIProvider interface.
 *
 * Self-describing: all metadata (models, capabilities, config keys) is declared
 * via static getters so the registry and UI auto-discover this provider.
 *
 * Key differences from Gemini:
 * - System prompt is a top-level parameter, not part of messages
 * - No native JSON schema enforcement — uses prompt instructions + parsing
 * - No embedding model — embeddings remain Gemini-only
 * - No context caching equivalent
 * - Different tool calling format (tool_use content blocks)
 * - Role mapping: 'ai' → 'assistant' (not 'model')
 */

import { AIProvider } from './base.js'

export class ClaudeProvider extends AIProvider {
  // ═══════════════════════════════════════════════════════════
  // Static metadata (self-describing)
  // ═══════════════════════════════════════════════════════════

  static get providerId() { return 'claude' }
  static get displayName() { return 'Anthropic Claude' }
  static get shortName() { return 'Claude' }
  static get brandColor() { return '#D97757' }
  static get configKey() { return 'claude_api_key' }
  static get envKey() { return 'CLAUDE_API_KEY' }
  static get keyPlaceholder() { return 'sk-ant-...' }
  static get keyHelpUrl() { return 'https://console.anthropic.com/settings/keys' }
  static get keyHelpLabel() { return 'Anthropic Console' }

  static get models() {
    return [
      { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6', description: 'Best balance of speed and intelligence' },
      { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', description: 'Fastest, most cost-effective' },
      { id: 'claude-opus-4-8', name: 'Claude Opus 4.8', description: 'Most capable, complex reasoning' },
    ]
  }

  static get capabilities() {
    return {
      streaming: true,
      toolCalling: true,
      jsonMode: true,   // via prompt-based enforcement
      embeddings: false, // Claude has no embedding model
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Instance implementation
  // ═══════════════════════════════════════════════════════════

  constructor(apiKey) {
    super(apiKey)
    this._client = null
  }

  /**
   * Lazy-init the Anthropic client
   */
  async _getClient() {
    if (this._client) return this._client
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    this._client = new Anthropic({ apiKey: this.apiKey })
    return this._client
  }

  /**
   * Map internal history roles to Claude roles.
   * Ensures message alternation (Claude requires user/assistant alternation).
   */
  _mapHistory(history) {
    const mapped = history.map((msg) => ({
      role: msg.role === 'ai' || msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content,
    }))

    // Claude requires strict user/assistant alternation.
    // Merge consecutive same-role messages.
    const merged = []
    for (const msg of mapped) {
      if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
        merged[merged.length - 1].content += '\n\n' + msg.content
      } else {
        merged.push({ ...msg })
      }
    }
    return merged
  }

  async generateText(prompt, options = {}) {
    const client = await this._getClient()
    const modelId = options.model || ClaudeProvider.defaultModel

    const params = {
      model: modelId,
      max_tokens: options.maxOutputTokens || 8192,
      messages: [{ role: 'user', content: prompt }],
    }
    if (options.systemPrompt) {
      params.system = options.systemPrompt
    }
    if (options.temperature !== undefined) {
      params.temperature = options.temperature
    }

    const response = await client.messages.create(params)

    // Extract text from content blocks
    return response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')
  }

  async generateJSON(prompt, schema, options = {}) {
    const client = await this._getClient()
    const modelId = options.model || ClaudeProvider.defaultModel

    // Build a system prompt that enforces JSON output
    let systemPrompt = options.systemPrompt || ''
    const schemaStr = schema ? JSON.stringify(schema, null, 2) : ''
    
    systemPrompt += `\n\nIMPORTANT: You MUST respond with valid JSON only. No markdown, no code fences, no explanation — just raw JSON.`
    if (schemaStr) {
      systemPrompt += `\n\nThe response must conform to this JSON schema:\n${schemaStr}`
    }

    const params = {
      model: modelId,
      max_tokens: options.maxOutputTokens || 8192,
      system: systemPrompt.trim(),
      messages: [{ role: 'user', content: prompt }],
    }
    if (options.temperature !== undefined) {
      params.temperature = options.temperature
    }

    const response = await client.messages.create(params)

    const text = response.content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('')

    // Strip any markdown code fences that Claude sometimes adds despite instructions
    const cleaned = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

    return JSON.parse(cleaned)
  }

  async *streamChat(systemPrompt, history, message, options = {}) {
    const client = await this._getClient()
    const modelId = options.model || ClaudeProvider.defaultModel

    const messages = [
      ...this._mapHistory(history),
      { role: 'user', content: message },
    ]

    // Ensure messages start with 'user' role (Claude requirement)
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: '(continued conversation)' })
    }

    const stream = client.messages.stream({
      model: modelId,
      max_tokens: options.maxOutputTokens ?? 8192,
      system: systemPrompt,
      messages,
      temperature: options.temperature ?? 0.5,
    })

    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield { type: 'text', text: event.delta.text }
      }
    }
  }

  async *streamChatWithTools(systemPrompt, history, message, tools, toolExecutor, options = {}) {
    const client = await this._getClient()
    const modelId = options.model || ClaudeProvider.defaultModel

    // Convert generic tool definitions to Claude's tool format
    const claudeTools = tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }))

    const messages = [
      ...this._mapHistory(history),
      { role: 'user', content: message },
    ]

    // Ensure messages start with 'user' role
    if (messages.length > 0 && messages[0].role !== 'user') {
      messages.unshift({ role: 'user', content: '(continued conversation)' })
    }

    let continueLoop = true

    while (continueLoop) {
      continueLoop = false

      // Use non-streaming create for tool-calling turns to simplify the loop,
      // then stream the final text-only turn.
      const response = await client.messages.create({
        model: modelId,
        max_tokens: options.maxOutputTokens ?? 8192,
        system: systemPrompt,
        messages,
        tools: claudeTools,
        temperature: options.temperature ?? 0.5,
      })

      // Process response content blocks
      const assistantContent = response.content
      const toolUseBlocks = assistantContent.filter(b => b.type === 'tool_use')
      const textBlocks = assistantContent.filter(b => b.type === 'text')

      // Yield any text that came before/alongside tool calls
      for (const block of textBlocks) {
        if (block.text) {
          yield { type: 'text', text: block.text }
        }
      }

      if (toolUseBlocks.length > 0 && response.stop_reason === 'tool_use') {
        // Process tool calls
        const toolResults = []

        for (const toolBlock of toolUseBlocks) {
          yield { type: 'tool', name: toolBlock.name }
          const result = await toolExecutor(toolBlock.name, toolBlock.input)
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolBlock.id,
            content: JSON.stringify(result),
          })
        }

        // Add assistant message with tool_use and user message with tool_result
        messages.push({ role: 'assistant', content: assistantContent })
        messages.push({ role: 'user', content: toolResults })

        continueLoop = true
      } else if (response.stop_reason === 'end_turn' && textBlocks.length === 0) {
        // Edge case: no text was produced
        break
      }
    }
  }

  async testApiKey(apiKey) {
    const Anthropic = (await import('@anthropic-ai/sdk')).default
    const client = new Anthropic({ apiKey })
    await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 16,
      messages: [{ role: 'user', content: 'Say "ok"' }],
    })
    return true
  }
}
