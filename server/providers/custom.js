/**
 * @fileoverview Custom endpoint provider ("Bring Your Own Model").
 *
 * One instance per user-registered OpenAI-compatible endpoint
 * (Ollama, LM Studio, vLLM, OpenRouter, Groq, ...). The endpoint row
 * from the `custom_endpoints` table supplies the base URL, optional
 * API key, and display name.
 *
 * Models from custom endpoints are namespaced in the global picker as
 *   custom:<endpointId>:<upstreamModelId>
 * The inherited _resolveModel() strips that prefix before requests.
 */

import { OpenAICompatibleProvider } from './openai_compatible.js'

/** Brand color used for all custom endpoint groups in the UI. */
export const CUSTOM_ENDPOINT_COLOR = '#8B5CF6'

/**
 * Build the namespaced picker ID for a model on a custom endpoint.
 * @param {string} endpointId
 * @param {string} upstreamModelId
 * @returns {string}
 */
export function customModelId(endpointId, upstreamModelId) {
  return `custom:${endpointId}:${upstreamModelId}`
}

/**
 * Parse a namespaced custom model ID.
 * @param {string} modelId
 * @returns {{ endpointId: string, upstreamModelId: string }|null}
 */
export function parseCustomModelId(modelId) {
  if (typeof modelId !== 'string' || !modelId.startsWith('custom:')) return null
  const parts = modelId.split(':')
  if (parts.length < 3) return null
  return { endpointId: parts[1], upstreamModelId: parts.slice(2).join(':') }
}

export class CustomEndpointProvider extends OpenAICompatibleProvider {
  static get providerId() { return 'custom' }
  static get displayName() { return 'Custom Endpoint' }
  static get shortName() { return 'Custom' }
  static get brandColor() { return CUSTOM_ENDPOINT_COLOR }

  static get capabilities() {
    return {
      streaming: true,
      toolCalling: true, // degrades to plain chat when the engine rejects tools
      jsonMode: true,    // adaptive: json_schema → json_object → prompt
      embeddings: false,
    }
  }

  /**
   * @param {{ id: string, name: string, base_url: string, api_key?: string }} endpoint
   *   A row from the custom_endpoints table
   */
  constructor(endpoint) {
    super(endpoint.api_key || '', endpoint.base_url)
    this.endpointId = endpoint.id
    this.endpointName = endpoint.name
  }
}
