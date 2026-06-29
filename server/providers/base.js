/* eslint-disable no-unused-vars, require-yield */
/**
 * @fileoverview Abstract base class for AI providers.
 *
 * Each concrete provider (Gemini, Claude, OpenAI, Ollama, etc.) extends this
 * class and implements both the instance methods (for AI operations) and the
 * static metadata getters (for self-description and auto-registration).
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────┐
 * │  AIProvider (abstract)                                      │
 * │  ├─ Static metadata   → providerId, models, capabilities    │
 * │  └─ Instance methods  → generateText, streamChat, etc.      │
 * ├─────────────────────────────────────────────────────────────┤
 * │  GeminiProvider       │  ClaudeProvider    │  Future...      │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Adding a new provider requires:
 *   1. Create server/providers/<name>.js extending AIProvider
 *   2. Override all static getters (providerId, displayName, models, etc.)
 *   3. Implement all instance methods (generateText, streamChat, etc.)
 *   4. Add the class to PROVIDER_CLASSES in server/providers/index.js
 *
 * The registry, routes, settings UI, and sidebar automatically discover
 * the new provider from its static metadata — no other files need changes.
 */

export class AIProvider {
  // ═══════════════════════════════════════════════════════════
  // Static metadata — providers MUST override these
  // ═══════════════════════════════════════════════════════════

  /**
   * Unique identifier for this provider (e.g. 'gemini', 'claude', 'openai').
   * Used as the key in the provider registry and in API responses.
   * @returns {string}
   */
  static get providerId() {
    throw new Error('AIProvider subclass must define static get providerId()')
  }

  /**
   * Human-readable display name (e.g. 'Google Gemini', 'Anthropic Claude').
   * Shown in the settings page and model selector.
   * @returns {string}
   */
  static get displayName() {
    throw new Error('AIProvider subclass must define static get displayName()')
  }

  /**
   * Short display name for compact UI elements (e.g. 'Gemini', 'Claude').
   * @returns {string}
   */
  static get shortName() {
    throw new Error('AIProvider subclass must define static get shortName()')
  }

  /**
   * Brand color for UI grouping (hex string).
   * @returns {string}
   */
  static get brandColor() {
    return '#888888'
  }

  /**
   * Database config key used to store/retrieve this provider's API key.
   * e.g. 'gemini_api_key', 'claude_api_key'
   * @returns {string}
   */
  static get configKey() {
    throw new Error('AIProvider subclass must define static get configKey()')
  }

  /**
   * Environment variable name to seed the API key from on first run.
   * e.g. 'GEMINI_API_KEY', 'CLAUDE_API_KEY'
   * @returns {string}
   */
  static get envKey() {
    throw new Error('AIProvider subclass must define static get envKey()')
  }

  /**
   * Placeholder text for the API key input field (e.g. 'AIza...', 'sk-ant-...').
   * @returns {string}
   */
  static get keyPlaceholder() {
    return '...'
  }

  /**
   * URL where users can get an API key for this provider.
   * @returns {string|null}
   */
  static get keyHelpUrl() {
    return null
  }

  /**
   * Display text for the key help link (e.g. 'Google AI Studio').
   * @returns {string|null}
   */
  static get keyHelpLabel() {
    return null
  }

  /**
   * Model catalog: array of models this provider supports.
   * Each entry: { id: string, name: string, description: string }
   *
   * The `id` is the model identifier passed to the SDK (e.g. 'gemini-3.5-flash').
   * The `name` is the human-readable label for the UI.
   *
   * @returns {Array<{ id: string, name: string, description: string }>}
   */
  static get models() {
    return []
  }

  /**
   * The default model ID to use when none is specified.
   * Must be one of the IDs from models().
   * @returns {string}
   */
  static get defaultModel() {
    const models = this.models
    return models.length > 0 ? models[0].id : ''
  }

  /**
   * Capability flags for feature-gating.
   * Routes and UI components can check these to gracefully degrade
   * for providers that lack certain features (e.g. local models
   * without tool calling, or providers without embedding support).
   *
   * @returns {{ streaming: boolean, toolCalling: boolean, jsonMode: boolean, embeddings: boolean }}
   */
  static get capabilities() {
    return {
      streaming: true,
      toolCalling: true,
      jsonMode: true,
      embeddings: false,
    }
  }

  // ═══════════════════════════════════════════════════════════
  // Instance methods — providers MUST implement these
  // ═══════════════════════════════════════════════════════════

  /**
   * @param {string} apiKey - The API key for this provider
   */
  constructor(apiKey) {
    if (new.target === AIProvider) {
      throw new Error('AIProvider is abstract and cannot be instantiated directly.')
    }
    this.apiKey = apiKey
  }

  /**
   * Generate a plain text response (non-streaming).
   * @param {string} prompt - The user prompt
   * @param {Object} options
   * @param {string} [options.systemPrompt] - System instruction
   * @param {string} [options.model] - Model ID override
   * @param {number} [options.temperature] - Sampling temperature
   * @param {number} [options.maxOutputTokens] - Max tokens to generate
   * @returns {Promise<string>} The generated text
   */
  async generateText(prompt, options = {}) {
    throw new Error('generateText() must be implemented by subclass')
  }

  /**
   * Generate a structured JSON response (non-streaming).
   * Provider implementations should enforce JSON output as best they can
   * (native schema for Gemini, prompt-based for Claude).
   *
   * @param {string} prompt - The user prompt
   * @param {Object} schema - JSON Schema describing the expected output shape
   * @param {Object} options
   * @param {string} [options.systemPrompt] - System instruction
   * @param {string} [options.model] - Model ID override
   * @param {number} [options.temperature] - Sampling temperature
   * @returns {Promise<Object>} The parsed JSON response
   */
  async generateJSON(prompt, schema, options = {}) {
    throw new Error('generateJSON() must be implemented by subclass')
  }

  /**
   * Stream a chat response with history support.
   * Yields text chunks as they arrive.
   *
   * @param {string} systemPrompt - System instruction
   * @param {Array<{role: string, content: string}>} history - Chat history (role: 'user'|'ai')
   * @param {string} message - The current user message
   * @param {Object} options
   * @param {string} [options.model] - Model ID override
   * @param {number} [options.temperature] - Sampling temperature
   * @param {number} [options.maxOutputTokens] - Max tokens to generate
   * @yields {{ type: 'text', text: string }} Text chunks
   */
  async *streamChat(systemPrompt, history, message, options = {}) {
    throw new Error('streamChat() must be implemented by subclass')
  }

  /**
   * Stream a chat response with tool/function calling support.
   * Handles the multi-turn tool calling loop internally.
   *
   * @param {string} systemPrompt - System instruction
   * @param {Array<{role: string, content: string}>} history - Chat history
   * @param {string} message - The current user message
   * @param {Array<Object>} tools - Tool definitions (provider-agnostic format)
   * @param {Function} toolExecutor - async (toolName, args) => result
   * @param {Object} options
   * @param {string} [options.model] - Model ID override
   * @param {number} [options.temperature] - Sampling temperature
   * @param {number} [options.maxOutputTokens] - Max tokens to generate
   * @yields {{ type: 'text', text: string } | { type: 'tool', name: string }} Chunks
   */
  async *streamChatWithTools(systemPrompt, history, message, tools, toolExecutor, options = {}) {
    throw new Error('streamChatWithTools() must be implemented by subclass')
  }

  /**
   * Test if an API key is valid by making a minimal API call.
   * @param {string} apiKey - The key to test
   * @returns {Promise<boolean>} True if valid
   */
  async testApiKey(apiKey) {
    throw new Error('testApiKey() must be implemented by subclass')
  }
}
