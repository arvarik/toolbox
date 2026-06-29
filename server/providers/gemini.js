/**
 * @fileoverview Gemini AI Provider implementation.
 * Wraps the Google Generative AI SDK (@google/generative-ai and @google/genai)
 * behind the unified AIProvider interface.
 *
 * Self-describing: all metadata (models, capabilities, config keys) is declared
 * via static getters so the registry and UI auto-discover this provider.
 */

import { AIProvider } from './base.js'
import logger from '../utils/logger.js'

export class GeminiProvider extends AIProvider {
  // ═══════════════════════════════════════════════════════════
  // Static metadata (self-describing)
  // ═══════════════════════════════════════════════════════════

  static get providerId() { return 'gemini' }
  static get displayName() { return 'Google Gemini' }
  static get shortName() { return 'Gemini' }
  static get brandColor() { return '#4285F4' }
  static get configKey() { return 'gemini_api_key' }
  static get envKey() { return 'GEMINI_API_KEY' }
  static get keyPlaceholder() { return 'AIza...' }
  static get keyHelpUrl() { return 'https://aistudio.google.com/apikey' }
  static get keyHelpLabel() { return 'Google AI Studio' }

  static get models() {
    return [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Fast and efficient — best for most tasks' },
      { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', description: 'Advanced reasoning, stable and reliable' },
      { id: 'gemini-3.1-flash-lite', name: 'Gemini 3.1 Flash Lite', description: 'Budget-friendly, high-speed for simple tasks' },
    ]
  }

  static get capabilities() {
    return {
      streaming: true,
      toolCalling: true,
      jsonMode: true,
      embeddings: true,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Instance implementation
  // ═══════════════════════════════════════════════════════════

  constructor(apiKey) {
    super(apiKey)
    this._genAI = null
    this._genAIClient = null
  }

  /**
   * Lazy-init the @google/generative-ai client (used for streaming, chat, SchemaType)
   */
  async _getGenAI() {
    if (this._genAI) return this._genAI
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    this._genAI = new GoogleGenerativeAI(this.apiKey)
    return this._genAI
  }

  /**
   * Lazy-init the @google/genai client (used for structured JSON output with responseSchema)
   */
  async _getGenAIClient() {
    if (this._genAIClient) return this._genAIClient
    const { GoogleGenAI } = await import('@google/genai')
    this._genAIClient = new GoogleGenAI({ apiKey: this.apiKey })
    return this._genAIClient
  }

  async generateText(prompt, options = {}) {
    const genAI = await this._getGenAI()
    const modelId = options.model || GeminiProvider.defaultModel
    const modelOpts = { model: modelId }
    if (options.systemPrompt) {
      modelOpts.systemInstruction = options.systemPrompt
    }
    const model = genAI.getGenerativeModel(modelOpts)
    const result = await model.generateContent(prompt)
    return result.response.text()
  }

  async generateJSON(prompt, schema, options = {}) {
    const client = await this._getGenAIClient()
    const modelId = options.model || GeminiProvider.defaultModel

    const config = {
      responseMimeType: 'application/json',
    }
    if (schema) {
      config.responseSchema = schema
    }
    if (options.temperature !== undefined) {
      config.temperature = options.temperature
    }

    const result = await client.models.generateContent({
      model: modelId,
      contents: prompt,
      config,
    })

    return JSON.parse(result.text)
  }

  async *streamChat(systemPrompt, history, message, options = {}) {
    const genAI = await this._getGenAI()
    const modelId = options.model || GeminiProvider.defaultModel

    // Attempt context caching for large system prompts
    let model
    try {
      const { GoogleAICacheManager } = await import('@google/generative-ai/server')
      const cacheManager = new GoogleAICacheManager(this.apiKey)
      const cache = await cacheManager.create({
        model: 'models/' + modelId,
        systemInstruction: systemPrompt,
        contents: [
          { role: 'user', parts: [{ text: 'Understood. I am ready to help the student.' }] },
          { role: 'model', parts: [{ text: 'Ready.' }] }
        ],
        ttlSeconds: 600
      })
      model = genAI.getGenerativeModelFromCachedContent(cache)
    } catch (cacheErr) {
      logger.warn(`[GeminiProvider] Context caching skipped (${cacheErr.message}). Using standard init.`)
      model = genAI.getGenerativeModel({
        model: modelId,
        systemInstruction: systemPrompt
      })
    }

    const chatHistory = history.map((msg) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: options.temperature ?? 0.5,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
      },
    })

    const result = await chat.sendMessageStream(message)
    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        yield { type: 'text', text }
      }
    }
  }

  async *streamChatWithTools(systemPrompt, history, message, tools, toolExecutor, options = {}) {
    const genAI = await this._getGenAI()
    const modelId = options.model || GeminiProvider.defaultModel

    // Convert generic tool definitions to Gemini function declarations
    const geminiTools = [{
      functionDeclarations: tools.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
    }]

    // Attempt context caching
    let model
    try {
      const { GoogleAICacheManager } = await import('@google/generative-ai/server')
      const cacheManager = new GoogleAICacheManager(this.apiKey)
      const cache = await cacheManager.create({
        model: 'models/' + modelId,
        systemInstruction: systemPrompt,
        contents: [
          { role: 'user', parts: [{ text: 'Understood. I am ready to help the student.' }] },
          { role: 'model', parts: [{ text: 'Ready.' }] }
        ],
        ttlSeconds: 600
      })
      model = genAI.getGenerativeModelFromCachedContent(cache, { tools: geminiTools })
    } catch (cacheErr) {
      logger.warn(`[GeminiProvider] Context caching skipped (${cacheErr.message}). Using standard init.`)
      model = genAI.getGenerativeModel({
        model: modelId,
        tools: geminiTools,
        systemInstruction: systemPrompt
      })
    }

    const chatHistory = history.map((msg) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: options.temperature ?? 0.5,
        maxOutputTokens: options.maxOutputTokens ?? 8192,
      },
    })

    let currentMessage = message
    let isFunctionCall

    do {
      isFunctionCall = false
      const result = await chat.sendMessageStream(currentMessage)

      for await (const chunk of result.stream) {
        const chunkFunctionCalls = typeof chunk.functionCalls === 'function'
          ? chunk.functionCalls()
          : chunk.functionCalls

        if (chunkFunctionCalls && chunkFunctionCalls.length > 0) {
          isFunctionCall = true
          const functionResponses = []

          for (const call of chunkFunctionCalls) {
            yield { type: 'tool', name: call.name }
            const toolResult = await toolExecutor(call.name, call.args)
            functionResponses.push({
              functionResponse: {
                name: call.name,
                response: { result: toolResult }
              }
            })
          }
          currentMessage = functionResponses
          break
        } else {
          const text = chunk.text()
          if (text) {
            yield { type: 'text', text }
          }
        }
      }
    } while (isFunctionCall)
  }

  async testApiKey(apiKey) {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })
    await model.generateContent('Say "ok"')
    return true
  }
}
