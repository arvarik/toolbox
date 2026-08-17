/**
 * @fileoverview OpenAI provider (api.openai.com).
 *
 * All wire-format logic lives in OpenAICompatibleProvider — this class
 * adds the branding, config metadata, and the static fallback catalog
 * shown before the first live model discovery completes.
 */

import { OpenAICompatibleProvider } from './openai_compatible.js'

export class OpenAIProvider extends OpenAICompatibleProvider {
  // ═══════════════════════════════════════════════════════════
  // Static metadata (self-describing)
  // ═══════════════════════════════════════════════════════════

  static get providerId() { return 'openai' }
  static get displayName() { return 'OpenAI' }
  static get shortName() { return 'OpenAI' }
  static get brandColor() { return '#10A37F' }
  static get configKey() { return 'openai_api_key' }
  static get envKey() { return 'OPENAI_API_KEY' }
  static get keyPlaceholder() { return 'sk-...' }
  static get keyHelpUrl() { return 'https://platform.openai.com/api-keys' }
  static get keyHelpLabel() { return 'OpenAI Platform' }

  /**
   * Static fallback catalog: the GPT-5.6 family (July 2026).
   * Live discovery (GET /v1/models) replaces this list as soon as a
   * key is verified.
   */
  static get models() {
    return [
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', description: 'Flagship — hardest coding, agents, and research', family: 'Flagship' },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', description: 'Balanced quality and cost for most tasks', family: 'Balanced' },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', description: 'Fastest and most cost-effective', family: 'Fast' },
    ]
  }

  static get capabilities() {
    return {
      streaming: true,
      toolCalling: true,
      jsonMode: true,
      embeddings: false,
    }
  }

  static ownsModelId(modelId) {
    return /^(gpt|o\d|chatgpt|codex)/i.test(modelId || '')
  }

  /** Reasoning models on api.openai.com require the modern parameter. */
  get maxTokensParam() {
    return 'max_completion_tokens'
  }
}
