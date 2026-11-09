import {
  generateText,
  streamText,
  Output,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import {
  getApiKeyForProvider,
  getProviderIdForModel,
  getProviderDef,
} from "../providers/index.ts";
import { parseCustomModelId, DEFAULT_MODEL_ID } from "../providers/defs.ts";
import { getCustomEndpoint } from "../providers/catalog.ts";
import logger from "../utils/logger.ts";

const CALL_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 600_000;
const MAX_TOOL_STEPS = 8;

const MODEL_FACTORIES: Record<
  string,
  (apiKey: string, modelId: string) => LanguageModel
> = {
  gemini: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
  claude: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  openai: (apiKey, modelId) => createOpenAI({ apiKey }).chat(modelId),
};

export function resolveModel(
  modelId?: string,
): { model: LanguageModel; modelId: string } {
  const id = modelId || DEFAULT_MODEL_ID;

  const custom = parseCustomModelId(id);
  if (custom) {
    const endpoint = getCustomEndpoint(custom.endpointId);
    if (!endpoint) {
      throw new Error(
        "Custom endpoint not found. It may have been removed — pick another model in Settings.",
      );
    }
    const provider = createOpenAICompatible({
      name: endpoint.name,
      baseURL: endpoint.base_url,
      apiKey: endpoint.api_key || undefined,
    });
    return { model: provider.chatModel(custom.upstreamModelId), modelId: id };
  }

  const providerId = getProviderIdForModel(id);
  if (!providerId) {
    throw new Error(`Unknown model "${id}". Pick a model in Settings.`);
  }
  const apiKey = getApiKeyForProvider(providerId);
  if (!apiKey) {
    const def = getProviderDef(providerId);
    throw new Error(
      `${def?.name || providerId} API key not configured. Please add your key in Settings.`,
    );
  }
  return { model: MODEL_FACTORIES[providerId](apiKey, id), modelId: id };
}

function logCall(
  feature: string,
  modelId: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
  finishReason: string | undefined,
  startedAt: number,
): void {
  logger.info(
    `[ai] ${feature} model=${modelId} finish=${finishReason || "unknown"} ` +
      `in=${usage?.inputTokens ?? "?"} out=${usage?.outputTokens ?? "?"} ms=${Date.now() - startedAt}`,
  );
}

export async function runText({
  model,
  system,
  prompt,
  messages,
  maxOutputTokens = 8192,
  feature = "text",
}: {
  model?: string;
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  maxOutputTokens?: number;
  feature?: string;
}): Promise<string> {
  const { model: languageModel, modelId } = resolveModel(model);
  const startedAt = Date.now();

  const result = await generateText({
    model: languageModel,
    system,
    ...(messages ? { messages } : { prompt: prompt ?? "" }),
    maxOutputTokens,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  logCall(feature, modelId, result.usage, result.finishReason, startedAt);
  if (result.finishReason === "length") {
    logger.warn(
      `[ai] ${feature} output was truncated at ${maxOutputTokens} tokens (model=${modelId})`,
    );
  }
  return result.text;
}

export async function runStructured<T = unknown>({
  model,
  system,
  prompt,
  schema,
  element,
  maxOutputTokens = 8192,
  feature = "structured",
}: {
  model?: string;
  system?: string;
  prompt: string;
  schema?: z.ZodType;
  element?: z.ZodType;
  maxOutputTokens?: number;
  feature?: string;
}): Promise<T> {
  const { model: languageModel, modelId } = resolveModel(model);
  const startedAt = Date.now();
  const output = element
    ? Output.array({ element })
    : Output.object({ schema: schema! });

  let result;
  try {
    result = await generateText({
      model: languageModel,
      system,
      prompt,
      output,
      maxOutputTokens,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(
      `[ai] ${feature} structured generation failed (model=${modelId}): ${msg}`,
    );
    throw err;
  }

  logCall(feature, modelId, result.usage, result.finishReason, startedAt);
  if (result.finishReason === "length") {
    throw new Error(
      `The model response was cut off at ${maxOutputTokens} output tokens. ` +
        "Retry with a shorter input or a higher output limit.",
    );
  }
  return result.output as T;
}

export function chatStream({
  model,
  system,
  messages,
  tools,
  abortSignal,
  maxOutputTokens = 8192,
}: {
  model?: string;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
}) {
  const { model: languageModel, modelId } = resolveModel(model);

  const signals: AbortSignal[] = [AbortSignal.timeout(STREAM_TIMEOUT_MS)];
  if (abortSignal) signals.push(abortSignal);

  const result = streamText({
    model: languageModel,
    system,
    messages,
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    maxOutputTokens,
    abortSignal: AbortSignal.any(signals),
    onError: ({ error }) => {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[ai] chat stream error (model=${modelId}): ${msg}`);
    },
    onAbort: () => {
      logger.info(`[ai] chat stream aborted (model=${modelId})`);
    },
  });

  return { result, modelId };
}
