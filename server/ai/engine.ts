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
import { z } from "zod";
import type { GenerationCapability } from "../../shared/platform/aiSettings.ts";
import {
  resolveModelDescriptor,
  type ResolvedModelDescriptor,
} from "../platform/ai/aiSettingsService.ts";
import { AppError } from "../platform/net/errors.ts";
import { guardedFetch } from "../platform/net/originAndFetch.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import logger from "../utils/logger.ts";

export type { GenerationCapability };

const CALL_TIMEOUT_MS = 120_000;
const STREAM_TIMEOUT_MS = 600_000;
const MAX_TOOL_STEPS = 8;
const MAX_RETRY_TOKENS = 32_768;

// Suppress AI SDK console warning when Rung 2 intentionally pairs json_object mode with Output.object
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const MODEL_FACTORIES: Record<
  "gemini" | "claude" | "openai",
  (apiKey: string, modelId: string) => LanguageModel
> = {
  gemini: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
  claude: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  openai: (apiKey, modelId) => createOpenAI({ apiKey }).chat(modelId),
};

export type StructuredRung = "json_schema" | "json_object" | "prompt";

const structuredModeCache = new Map<string, StructuredRung>();

export function __resetStructuredModeCache(): void {
  structuredModeCache.clear();
}

export function __getStructuredModeFor(
  endpointKey: string,
  upstreamModelId: string,
): StructuredRung | undefined {
  return structuredModeCache.get(`${endpointKey}::${upstreamModelId}`);
}

function buildLanguageModelFromDescriptor(
  desc: ResolvedModelDescriptor,
  supportsStructuredOutputs: boolean = true,
): LanguageModel {
  if (desc.kind === "openai-compatible") {
    const provider = createOpenAICompatible({
      name: desc.name,
      baseURL: desc.baseUrl,
      apiKey: desc.apiKey || undefined,
      supportsStructuredOutputs,
      // A user's endpoint was checked when saved; DNS and redirects can change, so check every call.
      ...(desc.keySource === "byok"
        ? {
            fetch: guardedFetch({
              allowPrivate: desc.allowPrivate,
              timeoutMs: STREAM_TIMEOUT_MS,
            }),
          }
        : {}),
    });
    return provider.chatModel(desc.upstreamModelId);
  }
  return MODEL_FACTORIES[desc.providerId](desc.apiKey, desc.modelId);
}

export function resolveModel(
  modelId?: string,
  opts?: { scope?: Scope; capability?: GenerationCapability },
): { model: LanguageModel; modelId: string } {
  const desc = resolveModelDescriptor(modelId, opts);
  return {
    model: buildLanguageModelFromDescriptor(desc, true),
    modelId: desc.modelId,
  };
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

function isReasoningExhausted(result: {
  text: string;
  finishReason?: string;
  reasoningText?: string;
  usage?: unknown;
}): boolean {
  if (result.text.trim() !== "") return false;
  if (result.finishReason === "length") return true;
  if (result.reasoningText && result.reasoningText.trim() !== "") return true;
  const usage = result.usage as
    | {
        reasoningTokens?: number;
        outputTokenDetails?: { reasoningTokens?: number };
      }
    | undefined;
  const reasoningTokens =
    usage?.reasoningTokens ?? usage?.outputTokenDetails?.reasoningTokens ?? 0;
  return reasoningTokens > 0;
}

function throwReasoningExhausted(modelId: string, maxTokens: number): never {
  throw new AppError(
    `Model "${modelId}" exhausted its ${maxTokens}-token output budget on reasoning without producing an answer.`,
    422,
    { code: "AI_REASONING_EXHAUSTED", details: { modelId, maxTokens } },
  );
}

export async function runText({
  model,
  scope,
  capability,
  system,
  prompt,
  messages,
  maxOutputTokens = 8192,
  feature = "text",
}: {
  model?: string;
  scope?: Scope;
  capability?: GenerationCapability;
  system?: string;
  prompt?: string;
  messages?: ModelMessage[];
  maxOutputTokens?: number;
  feature?: string;
}): Promise<string> {
  const { model: languageModel, modelId } = resolveModel(model, {
    scope,
    capability,
  });
  const startedAt = Date.now();

  let result = await generateText({
    model: languageModel,
    system,
    ...(messages ? { messages } : { prompt: prompt ?? "" }),
    maxOutputTokens,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (isReasoningExhausted(result)) {
    const retryTokens = Math.min(maxOutputTokens * 2, MAX_RETRY_TOKENS);
    logger.warn(
      `[ai] ${feature} reasoning budget exhausted at ${maxOutputTokens} tokens (model=${modelId}); retrying with ${retryTokens}`,
    );
    result = await generateText({
      model: languageModel,
      system,
      ...(messages ? { messages } : { prompt: prompt ?? "" }),
      maxOutputTokens: retryTokens,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (isReasoningExhausted(result)) {
      throwReasoningExhausted(modelId, retryTokens);
    }
  }

  logCall(feature, modelId, result.usage, result.finishReason, startedAt);
  if (result.finishReason === "length") {
    logger.warn(
      `[ai] ${feature} output was truncated at ${maxOutputTokens} tokens (model=${modelId})`,
    );
  }
  return result.text;
}

function shouldDowngradeStructuredRung(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    statusCode?: number;
    name?: string;
    message?: string;
    cause?: unknown;
  };
  if (e.name === "AbortError" || e.name === "TimeoutError") return false;
  if (
    e.statusCode === 401 ||
    e.statusCode === 403 ||
    e.statusCode === 429 ||
    (typeof e.statusCode === "number" && e.statusCode >= 500)
  ) {
    return false;
  }
  if (e.statusCode === 400 || e.statusCode === 422) return true;
  if (
    typeof e.name === "string" &&
    /NoObjectGenerated|JSONParse|TypeValidation/i.test(e.name)
  ) {
    return true;
  }
  const msg = e.message ?? "";
  if (
    /response_format|json_schema|json_object|structured|no object generated|could not parse/i.test(
      msg,
    )
  ) {
    return true;
  }
  return e.cause ? shouldDowngradeStructuredRung(e.cause) : false;
}

function buildJsonSchemaInstruction(
  schema: z.ZodType | undefined,
  element: z.ZodType | undefined,
  wrapArrayAsElements: boolean,
): string {
  const targetSchema = element
    ? wrapArrayAsElements
      ? z.object({ elements: z.array(element) })
      : z.array(element)
    : schema!;
  let jsonSchemaText = "";
  try {
    jsonSchemaText = JSON.stringify(z.toJSONSchema(targetSchema));
  } catch {
    jsonSchemaText = element ? '{"type":"array"}' : '{"type":"object"}';
  }
  return (
    "Respond ONLY with valid JSON matching this exact JSON Schema (no markdown prose, no commentary):\n" +
    jsonSchemaText
  );
}

function extractJsonPayload(raw: string): unknown {
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    const anyFence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (anyFence) cleaned = anyFence[1].trim();
  }
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.search(/[{[]/);
    const lastBrace = Math.max(
      cleaned.lastIndexOf("}"),
      cleaned.lastIndexOf("]"),
    );
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error("Model did not return valid JSON.");
  }
}

async function runOpenAiCompatibleStructured<T>({
  desc,
  system,
  prompt,
  schema,
  element,
  maxOutputTokens,
  feature,
  startedAt,
}: {
  desc: Extract<ResolvedModelDescriptor, { kind: "openai-compatible" }>;
  system?: string;
  prompt: string;
  schema?: z.ZodType;
  element?: z.ZodType;
  maxOutputTokens: number;
  feature: string;
  startedAt: number;
}): Promise<T> {
  const cacheKey = `${desc.endpointKey}::${desc.upstreamModelId}`;
  let rung: StructuredRung = structuredModeCache.get(cacheKey) ?? "json_schema";
  const output = element
    ? Output.array({ element })
    : Output.object({ schema: schema! });

  if (rung === "json_schema") {
    try {
      const model = buildLanguageModelFromDescriptor(desc, true);
      const result = await generateText({
        model,
        system,
        prompt,
        output,
        maxOutputTokens,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      logCall(feature, desc.modelId, result.usage, result.finishReason, startedAt);
      if (result.finishReason === "length") {
        throw new Error(
          `The model response was cut off at ${maxOutputTokens} output tokens. ` +
            "Retry with a shorter input or a higher output limit.",
        );
      }
      structuredModeCache.set(cacheKey, "json_schema");
      return result.output as T;
    } catch (err) {
      if (!shouldDowngradeStructuredRung(err)) throw err;
      logger.warn(
        `[ai] ${feature} downgrading ${desc.modelId} from json_schema -> json_object`,
      );
      rung = "json_object";
      structuredModeCache.set(cacheKey, rung);
    }
  }

  if (rung === "json_object") {
    try {
      const model = buildLanguageModelFromDescriptor(desc, false);
      const schemaInstruction = buildJsonSchemaInstruction(
        schema,
        element,
        true,
      );
      const augmentedSystem = system
        ? `${system}\n\n${schemaInstruction}`
        : schemaInstruction;
      const result = await generateText({
        model,
        system: augmentedSystem,
        prompt,
        output,
        maxOutputTokens,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      logCall(feature, desc.modelId, result.usage, result.finishReason, startedAt);
      if (result.finishReason === "length") {
        throw new Error(
          `The model response was cut off at ${maxOutputTokens} output tokens. ` +
            "Retry with a shorter input or a higher output limit.",
        );
      }
      structuredModeCache.set(cacheKey, "json_object");
      return result.output as T;
    } catch (err) {
      if (!shouldDowngradeStructuredRung(err)) throw err;
      logger.warn(
        `[ai] ${feature} downgrading ${desc.modelId} from json_object -> prompt JSON`,
      );
      rung = "prompt";
      structuredModeCache.set(cacheKey, rung);
    }
  }

  // Rung 3: Plain prompt JSON (zero response_format on the wire, e.g. LM Studio)
  const model = buildLanguageModelFromDescriptor(desc, false);
  const schemaInstruction = buildJsonSchemaInstruction(schema, element, false);
  const augmentedSystem = system
    ? `${system}\n\n${schemaInstruction}`
    : schemaInstruction;

  let result = await generateText({
    model,
    system: augmentedSystem,
    prompt,
    maxOutputTokens,
    abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
  });

  if (isReasoningExhausted(result)) {
    const retryTokens = Math.min(maxOutputTokens * 2, MAX_RETRY_TOKENS);
    result = await generateText({
      model,
      system: augmentedSystem,
      prompt,
      maxOutputTokens: retryTokens,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    if (isReasoningExhausted(result)) {
      throwReasoningExhausted(desc.modelId, retryTokens);
    }
  }

  logCall(feature, desc.modelId, result.usage, result.finishReason, startedAt);
  if (result.finishReason === "length") {
    throw new Error(
      `The model response was cut off at ${maxOutputTokens} output tokens. ` +
        "Retry with a shorter input or a higher output limit.",
    );
  }

  const parsedJson = extractJsonPayload(result.text);
  if (element) {
    const candidate = Array.isArray(parsedJson)
      ? parsedJson
      : parsedJson &&
          typeof parsedJson === "object" &&
          Array.isArray((parsedJson as { elements?: unknown }).elements)
        ? (parsedJson as { elements: unknown[] }).elements
        : parsedJson &&
            typeof parsedJson === "object" &&
            Array.isArray((parsedJson as { items?: unknown }).items)
          ? (parsedJson as { items: unknown[] }).items
          : parsedJson;
    return z.array(element).parse(candidate) as T;
  }
  return schema!.parse(parsedJson) as T;
}

export async function runStructured<T = unknown>({
  model,
  scope,
  capability,
  system,
  prompt,
  schema,
  element,
  maxOutputTokens = 8192,
  feature = "structured",
}: {
  model?: string;
  scope?: Scope;
  capability?: GenerationCapability;
  system?: string;
  prompt: string;
  schema?: z.ZodType;
  element?: z.ZodType;
  maxOutputTokens?: number;
  feature?: string;
}): Promise<T> {
  const desc = resolveModelDescriptor(model, { scope, capability });
  const startedAt = Date.now();

  if (desc.kind === "openai-compatible") {
    try {
      return await runOpenAiCompatibleStructured<T>({
        desc,
        system,
        prompt,
        schema,
        element,
        maxOutputTokens,
        feature,
        startedAt,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(
        `[ai] ${feature} structured generation failed (model=${desc.modelId}): ${msg}`,
      );
      throw err;
    }
  }

  const languageModel = buildLanguageModelFromDescriptor(desc, true);
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
      `[ai] ${feature} structured generation failed (model=${desc.modelId}): ${msg}`,
    );
    throw err;
  }

  logCall(feature, desc.modelId, result.usage, result.finishReason, startedAt);
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
  scope,
  capability,
  system,
  messages,
  tools,
  abortSignal,
  maxOutputTokens = 8192,
}: {
  model?: string;
  scope?: Scope;
  capability?: GenerationCapability;
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
  abortSignal?: AbortSignal;
  maxOutputTokens?: number;
}) {
  const { model: languageModel, modelId } = resolveModel(model, {
    scope,
    capability,
  });

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
