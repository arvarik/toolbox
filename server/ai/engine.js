/**
 * @fileoverview AI engine — one thin layer over the Vercel AI SDK.
 *
 * Every model call in the app goes through the three functions here:
 *
 *   runText(...)       → plain text (non-streaming)
 *   runStructured(...) → schema-validated object or array (non-streaming)
 *   chatStream(...)    → streaming chat with tool calling
 *
 * The engine resolves a model ID (e.g. 'gemini-3.5-flash',
 * 'claude-sonnet-4-6', 'custom:<endpointId>:<model>') to an AI SDK
 * model instance using the provider registry, then delegates the call.
 * The AI SDK supplies retries with backoff (default 2), provider-native
 * structured output, schema validation, and the tool-calling loop.
 *
 * Cross-cutting policy enforced here:
 *   - No sampling parameters. Newer Claude/OpenAI models reject
 *     `temperature`; prompts steer behavior instead.
 *   - Every call has an abort signal (client disconnect and/or timeout).
 *   - Every call logs model, token usage, finish reason, and duration.
 *   - Truncated structured output raises a clear error, never a
 *     JSON-parse failure.
 */

import { generateText, streamText, Output, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  getApiKeyForProvider,
  getProviderIdForModel,
  getProviderDef,
} from '../providers/index.js'
import { parseCustomModelId, DEFAULT_MODEL_ID } from '../providers/defs.js'
import { getCustomEndpoint } from '../providers/catalog.js'
import logger from '../utils/logger.js'

/** Timeout for non-streaming calls. */
const CALL_TIMEOUT_MS = 120_000
/** Timeout ceiling for streaming calls. */
const STREAM_TIMEOUT_MS = 600_000
/** Cap on model↔tool round trips in one chat turn. */
const MAX_TOOL_STEPS = 8

/** Map: providerId → AI SDK model factory. */
const MODEL_FACTORIES = {
  gemini: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
  claude: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  // .chat = the Chat Completions surface (the cross-vendor standard)
  openai: (apiKey, modelId) => createOpenAI({ apiKey }).chat(modelId),
}

/**
 * Resolve a model ID to an AI SDK model instance.
 *
 * @param {string} [modelId] - Model ID; defaults to DEFAULT_MODEL_ID
 * @returns {{ model: import('ai').LanguageModel, modelId: string }}
 * @throws {Error} When the model is unknown or its key/endpoint is missing
 */
export function resolveModel(modelId) {
  const id = modelId || DEFAULT_MODEL_ID

  const custom = parseCustomModelId(id)
  if (custom) {
    const endpoint = getCustomEndpoint(custom.endpointId)
    if (!endpoint) {
      throw new Error('Custom endpoint not found. It may have been removed — pick another model in Settings.')
    }
    const provider = createOpenAICompatible({
      name: endpoint.name,
      baseURL: endpoint.base_url,
      apiKey: endpoint.api_key || undefined,
    })
    return { model: provider.chatModel(custom.upstreamModelId), modelId: id }
  }

  const providerId = getProviderIdForModel(id)
  if (!providerId) {
    throw new Error(`Unknown model "${id}". Pick a model in Settings.`)
  }
  const apiKey = getApiKeyForProvider(providerId)
  if (!apiKey) {
    const def = getProviderDef(providerId)
    throw new Error(`${def?.name || providerId} API key not configured. Please add your key in Settings.`)
  }
  return { model: MODEL_FACTORIES[providerId](apiKey, id), modelId: id }
}

/** Log one line per model call: feature, model, tokens, finish reason, duration. */
function logCall(feature, modelId, usage, finishReason, startedAt) {
  logger.info(
    `[ai] ${feature} model=${modelId} finish=${finishReason || 'unknown'} ` +
    `in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'} ms=${Date.now() - startedAt}`
  )
}

/**
 * Generate plain text (non-streaming).
 *
 * @param {Object} options
 * @param {string} [options.model] - Model ID
 * @param {string} [options.system] - System prompt
 * @param {string} [options.prompt] - Single user prompt (use prompt OR messages)
 * @param {Array<{role: string, content: string}>} [options.messages] - Chat messages
 * @param {number} [options.maxOutputTokens]
 * @param {string} [options.feature] - Label for the usage log
 * @returns {Promise<string>} The generated text
 */
export async function runText({ model, system, prompt, messages, maxOutputTokens = 8192, feature = 'text' }) {
  const { model: languageModel, modelId } = resolveModel(model)
  const startedAt = Date.now()

  const result = await generateText({
    model: languageModel,
    system,
    ...(messages ? { messages } : { prompt }),
    maxOutputTokens,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  })

  logCall(feature, modelId, result.usage, result.finishReason, startedAt)
  if (result.finishReason === 'length') {
    logger.warn(`[ai] ${feature} output was truncated at ${maxOutputTokens} tokens (model=${modelId})`)
  }
  return result.text
}

/**
 * Generate a schema-validated object or array (non-streaming).
 * Uses the provider's native structured-output mode; the AI SDK
 * validates the result against the schema before it returns.
 *
 * Pass exactly one of:
 *   - schema:  a zod object schema → returns the object
 *   - element: a zod schema for array items → returns the array
 *
 * @param {Object} options
 * @param {string} [options.model] - Model ID
 * @param {string} [options.system] - System prompt
 * @param {string} options.prompt - The user prompt
 * @param {import('zod').ZodTypeAny} [options.schema] - Object schema
 * @param {import('zod').ZodTypeAny} [options.element] - Array element schema
 * @param {number} [options.maxOutputTokens]
 * @param {string} [options.feature] - Label for the usage log
 * @returns {Promise<Object|Array>} The validated result
 * @throws {Error} With a clear message when the output was truncated
 */
export async function runStructured({ model, system, prompt, schema, element, maxOutputTokens = 8192, feature = 'structured' }) {
  const { model: languageModel, modelId } = resolveModel(model)
  const startedAt = Date.now()
  const output = element ? Output.array({ element }) : Output.object({ schema })

  let result
  try {
    result = await generateText({
      model: languageModel,
      system,
      prompt,
      output,
      maxOutputTokens,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    })
  } catch (err) {
    logger.error(`[ai] ${feature} structured generation failed (model=${modelId}): ${err.message}`)
    throw err
  }

  logCall(feature, modelId, result.usage, result.finishReason, startedAt)
  if (result.finishReason === 'length') {
    throw new Error(
      `The model response was cut off at ${maxOutputTokens} output tokens. ` +
      'Retry with a shorter input or a higher output limit.'
    )
  }
  return result.output
}

/**
 * Stream a chat response with tool calling.
 * The AI SDK runs the model↔tool loop; MAX_TOOL_STEPS caps it.
 *
 * @param {Object} options
 * @param {string} [options.model] - Model ID
 * @param {string} options.system - System prompt
 * @param {Array<{role: string, content: string}>} options.messages - Chat messages
 * @param {Object} [options.tools] - AI SDK tool set (from `tool()`)
 * @param {AbortSignal} [options.abortSignal] - Client-disconnect signal
 * @param {number} [options.maxOutputTokens]
 * @returns {{ result: import('ai').StreamTextResult, modelId: string }}
 */
export function chatStream({ model, system, messages, tools, abortSignal, maxOutputTokens = 8192 }) {
  const { model: languageModel, modelId } = resolveModel(model)

  const signals = [AbortSignal.timeout(STREAM_TIMEOUT_MS)]
  if (abortSignal) signals.push(abortSignal)

  const result = streamText({
    model: languageModel,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    maxOutputTokens,
    abortSignal: AbortSignal.any(signals),
    onError: ({ error }) => {
      logger.error(`[ai] chat stream error (model=${modelId}): ${error?.message || error}`)
    },
    onAbort: () => {
      logger.info(`[ai] chat stream aborted (model=${modelId})`)
    },
  })

  return { result, modelId }
}
