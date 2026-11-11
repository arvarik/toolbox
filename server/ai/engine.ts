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
const MAX_STRUCTURED_MODES = 256;
const MAX_MESSAGE_CHARS = 64_000;
const DEFAULT_HISTORY_BUDGET_CHARS = 160_000;

// A stream that starts and then goes silent this long is cut off, instead of
// holding the request until STREAM_TIMEOUT_MS.
let streamIdleTimeoutMs = 120_000;

export function __setStreamIdleTimeoutMs(ms: number): void {
  streamIdleTimeoutMs = ms;
}

// Suppress AI SDK console warning when Rung 2 intentionally pairs json_object mode with Output.object
(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false;

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/([?&](?:key|api_key|apikey|token|secret)=)[^&\s"']+/gi, "$1[redacted]"],
  [/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[redacted]"],
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}\b/g, "sk-[redacted]"],
];

export function redactAiErrorMessage(raw: string): string {
  let out = raw;
  for (const [pattern, replacement] of SECRET_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function sanitizeThrownAiError(err: unknown, seen = new Set<unknown>()): unknown {
  if (!err || typeof err !== "object" || seen.has(err)) return err;
  seen.add(err);
  const e = err as {
    message?: unknown;
    stack?: unknown;
    cause?: unknown;
    lastError?: unknown;
  };
  if (typeof e.message === "string") {
    try {
      e.message = redactAiErrorMessage(e.message);
    } catch {
      // Read-only getter on exotic Error subclass
    }
  }
  if (typeof e.stack === "string") {
    try {
      e.stack = redactAiErrorMessage(e.stack);
    } catch {
      // Ignore read-only stack
    }
  }
  if (e.cause) sanitizeThrownAiError(e.cause, seen);
  if (e.lastError) sanitizeThrownAiError(e.lastError, seen);
  return err;
}

function unwrapUpstreamProviderError(err: unknown): {
  statusCode: number;
  retryAfter?: string;
} | null {
  if (!err || typeof err !== "object") return null;
  const e = err as {
    name?: string;
    statusCode?: number;
    responseHeaders?: Record<string, string | undefined>;
    lastError?: unknown;
    cause?: unknown;
  };
  if (e.name === "AI_RetryError") return unwrapUpstreamProviderError(e.lastError);
  if (e.name === "AI_APICallError" && typeof e.statusCode === "number") {
    if (e.statusCode === 429 || e.statusCode >= 500) {
      return {
        statusCode: e.statusCode,
        retryAfter: e.responseHeaders?.["retry-after"],
      };
    }
  }
  return e.cause ? unwrapUpstreamProviderError(e.cause) : null;
}

export function isForwardableAiError(err: unknown): boolean {
  if (err instanceof AppError) return true;
  if ((err as { name?: string } | null)?.name === "TimeoutError") return true;
  return unwrapUpstreamProviderError(err) !== null;
}

export function formatStreamErrorMessage(err: unknown): string {
  const upstream = unwrapUpstreamProviderError(err);
  if (upstream?.statusCode === 429) {
    return "The AI provider is rate limiting this instance. Try again shortly.";
  }
  if (upstream && upstream.statusCode >= 500) {
    return `The AI provider failed with HTTP ${upstream.statusCode}. Try again shortly.`;
  }
  if ((err as { name?: string } | null)?.name === "TimeoutError") {
    return "An upstream service did not answer in time. Try again shortly.";
  }
  const raw = err instanceof Error ? err.message : String(err);
  return redactAiErrorMessage(raw) || "AI stream failed.";
}

export function clampModelMessages(
  messages: ModelMessage[],
  budgetChars: number = DEFAULT_HISTORY_BUDGET_CHARS,
): ModelMessage[] {
  if (messages.length === 0) return messages;
  const normalized: ModelMessage[] = messages.map((m) => {
    if (typeof m.content === "string" && m.content.length > MAX_MESSAGE_CHARS) {
      return {
        ...m,
        content: `${m.content.slice(0, MAX_MESSAGE_CHARS)}\n…[truncated]`,
      } as ModelMessage;
    }
    return m;
  });

  const measure = (m: ModelMessage): number =>
    typeof m.content === "string"
      ? m.content.length
      : JSON.stringify(m.content).length;

  const kept: ModelMessage[] = [];
  let used = 0;
  for (let i = normalized.length - 1; i >= 0; i--) {
    const item = normalized[i];
    const len = measure(item);
    if (kept.length > 0 && used + len > budgetChars) break;
    kept.push(item);
    used += len;
  }
  kept.reverse();

  // Keep conversation starting on a user turn when older history was trimmed,
  // so strict alternating providers (Gemini/Anthropic) never see a leading assistant turn.
  while (kept.length > 1 && kept[0].role === "assistant") {
    kept.shift();
  }
  return kept;
}

const MODEL_FACTORIES: Record<
  "gemini" | "claude" | "openai",
  (apiKey: string, modelId: string) => LanguageModel
> = {
  gemini: (apiKey, modelId) => createGoogleGenerativeAI({ apiKey })(modelId),
  claude: (apiKey, modelId) => createAnthropic({ apiKey })(modelId),
  openai: (apiKey, modelId) => createOpenAI({ apiKey }).chat(modelId),
};

export type StructuredRung = "json_schema" | "json_object" | "prompt";

// Keys include the caller-supplied upstream model id, so the oldest entry is
// evicted past MAX_STRUCTURED_MODES instead of growing per distinct id.
const structuredModeCache = new Map<string, StructuredRung>();

function rememberStructuredMode(key: string, rung: StructuredRung): void {
  structuredModeCache.delete(key);
  structuredModeCache.set(key, rung);
  if (structuredModeCache.size > MAX_STRUCTURED_MODES) {
    structuredModeCache.delete(structuredModeCache.keys().next().value!);
  }
}

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
      // Always route OpenAI-compatible traffic through guardedFetch: BYOK blocks all private/RFC1918
      // hosts (unless ALLOW_PRIVATE_BYOK_ENDPOINTS=true), and admin/instance endpoints still block
      // cloud metadata IPs (169.254.169.254 / fd00:ec2::254) and strip Authorization on cross-origin redirects.
      fetch: guardedFetch({
        allowPrivate: desc.allowPrivate,
        timeoutMs: STREAM_TIMEOUT_MS,
      }),
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

/** Logs a structured call, and refuses output that the token limit cut off. */
function finishStructuredCall(
  feature: string,
  modelId: string,
  result: { usage?: { inputTokens?: number; outputTokens?: number }; finishReason?: string },
  startedAt: number,
  maxOutputTokens: number,
): void {
  logCall(feature, modelId, result.usage, result.finishReason, startedAt);
  if (result.finishReason === "length") {
    throw new Error(
      `The model response was cut off at ${maxOutputTokens} output tokens. ` +
        "Retry with a shorter input or a higher output limit.",
    );
  }
}

function readReasoningTokens(usage: unknown): number {
  const u = usage as
    | {
        reasoningTokens?: number;
        outputTokenDetails?: { reasoningTokens?: number };
      }
    | undefined;
  return u?.reasoningTokens ?? u?.outputTokenDetails?.reasoningTokens ?? 0;
}

function isReasoningExhausted(result: {
  text?: string;
  finishReason?: string;
  reasoningText?: string;
  usage?: unknown;
}): boolean {
  if ((result.text ?? "").trim() !== "") return false;
  if (result.finishReason === "length") return true;
  if (result.reasoningText && result.reasoningText.trim() !== "") return true;
  return readReasoningTokens(result.usage) > 0;
}

function isLengthTruncatedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { finishReason?: string; cause?: unknown };
  if (e.finishReason === "length") return true;
  return e.cause ? isLengthTruncatedError(e.cause) : false;
}

function isReasoningExhaustedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    text?: string;
    finishReason?: string;
    reasoningText?: string;
    usage?: unknown;
    cause?: unknown;
  };
  if (
    (e.finishReason !== undefined ||
      e.usage !== undefined ||
      e.reasoningText !== undefined) &&
    isReasoningExhausted({
      text: typeof e.text === "string" ? e.text : "",
      finishReason: e.finishReason,
      reasoningText: e.reasoningText,
      usage: e.usage,
    })
  ) {
    return true;
  }
  return e.cause ? isReasoningExhaustedError(e.cause) : false;
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
  const boundedMessages = messages ? clampModelMessages(messages) : undefined;
  const startedAt = Date.now();
  let effectiveMaxTokens = maxOutputTokens;

  let result;
  try {
    result = await generateText({
      model: languageModel,
      system,
      ...(boundedMessages ? { messages: boundedMessages } : { prompt: prompt ?? "" }),
      maxOutputTokens,
      abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });

    if (isReasoningExhausted(result)) {
      const retryTokens = Math.min(maxOutputTokens * 2, MAX_RETRY_TOKENS);
      if (retryTokens > maxOutputTokens) {
        effectiveMaxTokens = retryTokens;
        logger.warn(
          `[ai] ${feature} reasoning budget exhausted at ${maxOutputTokens} tokens (model=${modelId}); retrying with ${retryTokens}`,
        );
        result = await generateText({
          model: languageModel,
          system,
          ...(boundedMessages ? { messages: boundedMessages } : { prompt: prompt ?? "" }),
          maxOutputTokens: retryTokens,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        });
      }
      if (isReasoningExhausted(result)) {
        throwReasoningExhausted(modelId, effectiveMaxTokens);
      }
    }
  } catch (err) {
    throw sanitizeThrownAiError(err);
  }

  logCall(feature, modelId, result.usage, result.finishReason, startedAt);
  if (result.finishReason === "length") {
    logger.warn(
      `[ai] ${feature} output was truncated at ${effectiveMaxTokens} tokens (model=${modelId})`,
    );
  }
  return result.text;
}

function extractUpstreamHttpStatus(
  err: unknown,
  seen = new Set<unknown>(),
): number | undefined {
  if (!err || typeof err !== "object" || seen.has(err)) return undefined;
  seen.add(err);
  const e = err as {
    statusCode?: unknown;
    lastError?: unknown;
    cause?: unknown;
  };
  if (typeof e.statusCode === "number") return e.statusCode;
  return (
    extractUpstreamHttpStatus(e.lastError, seen) ??
    extractUpstreamHttpStatus(e.cause, seen)
  );
}

export function shouldDowngradeStructuredRung(
  err: unknown,
  seen = new Set<unknown>(),
): boolean {
  if (!err || typeof err !== "object" || seen.has(err)) return false;
  seen.add(err);
  if (err instanceof AppError) return false;
  // Never mistake token-limit truncation or upstream rate-limit/5xx/404 errors for schema incompatibility.
  if (isLengthTruncatedError(err)) return false;
  if (unwrapUpstreamProviderError(err) !== null) return false;

  const httpStatus = extractUpstreamHttpStatus(err);
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    httpStatus === 404 ||
    httpStatus === 408 ||
    httpStatus === 429 ||
    (typeof httpStatus === "number" && httpStatus >= 500)
  ) {
    return false;
  }

  const e = err as {
    statusCode?: number;
    name?: string;
    message?: string;
    lastError?: unknown;
    cause?: unknown;
  };
  if (e.name === "AbortError" || e.name === "TimeoutError") return false;
  const msg = e.message ?? "";
  if (
    /context_length|maximum context|too many tokens|prompt is too long/i.test(
      msg,
    )
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
  if (
    /response_format|responseSchema|json_schema|json_object|json mode|structured|no object generated|could not parse/i.test(
      msg,
    )
  ) {
    return true;
  }
  return (
    (e.lastError ? shouldDowngradeStructuredRung(e.lastError, seen) : false) ||
    (e.cause ? shouldDowngradeStructuredRung(e.cause, seen) : false)
  );
}

/** Appends the JSON Schema instruction to `system` (or uses it alone). */
function withJsonSchemaInstruction(
  system: string | undefined,
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
  const instruction =
    "Respond ONLY with valid JSON matching this exact JSON Schema (no markdown prose, no commentary):\n" +
    jsonSchemaText;
  return system ? `${system}\n\n${instruction}` : instruction;
}

const OPEN_REASONING_TAG_RE = /^<(think|thinking|reasoning|thought)\b[^>]*>/i;

function stripReasoningBlocks(raw: string): string {
  // 1. Strip anchored leading closed <think>...</think> blocks (even if thoughts contain unbalanced quotes).
  let current = raw.trim();
  const leadingClosedRe =
    /^\s*<(think|thinking|reasoning|thought)\b[^>]*>[\s\S]*?<\/\1\s*>\s*/i;
  while (true) {
    const match = current.match(leadingClosedRe);
    if (!match) break;
    current = current.slice(match[0].length);
  }

  // 2. Strip any remaining reasoning blocks ONLY outside JSON string literals so literal
  //    `<think>` / `</think>` tokens inside JSON string values are never altered or merged across fields.
  let out = "";
  let inString = false;
  let escaped = false;
  let i = 0;
  while (i < current.length) {
    const ch = current[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      i++;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i++;
      continue;
    }
    if (ch === "<") {
      const openMatch = current.slice(i).match(OPEN_REASONING_TAG_RE);
      if (openMatch) {
        const tag = openMatch[1];
        const afterOpen = i + openMatch[0].length;
        const closeRe = new RegExp(`<\\/${tag}\\s*>`, "i");
        const closeMatch = closeRe.exec(current.slice(afterOpen));
        if (closeMatch) {
          i = afterOpen + closeMatch.index + closeMatch[0].length;
          continue;
        }
        if (out.trim() === "") {
          i = afterOpen;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }
  return out.trim();
}

function stripTrailingCommasOutsideStrings(jsonLike: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < jsonLike.length; i++) {
    const ch = jsonLike[i];
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < jsonLike.length && /\s/.test(jsonLike[j])) j++;
      if (jsonLike[j] === "}" || jsonLike[j] === "]") {
        continue;
      }
    }
    out += ch;
  }
  return out;
}

function tryParseJsonCandidate(candidate: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(candidate) };
  } catch {
    try {
      return { ok: true, value: JSON.parse(stripTrailingCommasOutsideStrings(candidate)) };
    } catch {
      return { ok: false };
    }
  }
}

function scanBalancedJsonAt(text: string, startIdx: number): string | null {
  const open = text[startIdx];
  if (open !== "{" && open !== "[") return null;
  const stack: string[] = [open === "{" ? "}" : "]"];
  let inString = false;
  let escaped = false;

  for (let i = startIdx + 1; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === "{") {
      stack.push("}");
    } else if (ch === "[") {
      stack.push("]");
    } else if (ch === "}" || ch === "]") {
      if (stack[stack.length - 1] !== ch) return null;
      stack.pop();
      if (stack.length === 0) {
        return text.slice(startIdx, i + 1);
      }
    }
  }
  return null;
}

function tryParseDirectOrOuterFence(
  trimmed: string,
): { ok: true; value: unknown } | { ok: false } {
  if (!trimmed) return { ok: false };
  // 1. Fast path: pure JSON object or array
  const direct = tryParseJsonCandidate(trimmed);
  if (direct.ok) return direct;

  // 2. Outer markdown fence only (anchored to end of string so inner ```python blocks never truncate!)
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const firstNewline = trimmed.indexOf("\n");
    if (firstNewline !== -1) {
      const inner = trimmed.slice(firstNewline + 1, -3).trim();
      const fenced = tryParseJsonCandidate(inner);
      if (fenced.ok) return fenced;
    }
  }
  return { ok: false };
}

export function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("Model did not return valid JSON.");
  }

  // Attempt whole-payload / outer-fenced JSON parse BEFORE any reasoning-tag stripping
  // so valid JSON containing literal `<think>`/`</think>` text is returned untouched.
  const untouched = tryParseDirectOrOuterFence(trimmed);
  if (untouched.ok) return untouched.value;

  const cleaned = stripReasoningBlocks(trimmed);
  if (!cleaned) {
    throw new Error("Model did not return valid JSON.");
  }

  const afterStrip = tryParseDirectOrOuterFence(cleaned);
  if (afterStrip.ok) return afterStrip.value;

  // 3. Prefer a ```json fenced block when leading prose contains {placeholders}
  const jsonFenceRegex = /```(?:json)?\s*([{[])/gi;
  let fenceMatch: RegExpExecArray | null;
  while ((fenceMatch = jsonFenceRegex.exec(cleaned)) !== null) {
    const braceIdx = fenceMatch.index + fenceMatch[0].length - 1;
    const slice = scanBalancedJsonAt(cleaned, braceIdx);
    if (slice) {
      const parsed = tryParseJsonCandidate(slice);
      if (parsed.ok) return parsed.value;
    }
  }

  // 4. General string-aware balanced scan across any { or [ in the response
  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === "{" || ch === "[") {
      const slice = scanBalancedJsonAt(cleaned, i);
      if (slice) {
        const parsed = tryParseJsonCandidate(slice);
        if (parsed.ok) return parsed.value;
        i += slice.length - 1;
      }
    }
  }

  throw new Error("Model did not return valid JSON.");
}

export function unwrapArrayCandidate(parsed: unknown): unknown {
  if (Array.isArray(parsed) || !parsed || typeof parsed !== "object") {
    return parsed;
  }
  const obj = parsed as Record<string, unknown>;
  for (const key of ["elements", "items", "data", "results"]) {
    if (Array.isArray(obj[key])) return obj[key];
  }
  const arrayValues = Object.values(obj).filter(Array.isArray);
  if (arrayValues.length === 1) return arrayValues[0];
  return parsed;
}

async function callStructuredWithLengthRetry<
  R extends {
    usage?: { inputTokens?: number; outputTokens?: number };
    finishReason?: string;
    text?: string;
    reasoningText?: string;
  },
>({
  feature,
  modelId,
  maxOutputTokens,
  invoke,
}: {
  feature: string;
  modelId: string;
  maxOutputTokens: number;
  invoke: (tokens: number) => Promise<R>;
}): Promise<{ result: R; effectiveMaxTokens: number }> {
  try {
    let result = await invoke(maxOutputTokens);
    let effectiveMaxTokens = maxOutputTokens;

    if (
      (result.finishReason === "length" || isReasoningExhausted(result)) &&
      maxOutputTokens < MAX_RETRY_TOKENS
    ) {
      const retryTokens = Math.min(maxOutputTokens * 2, MAX_RETRY_TOKENS);
      effectiveMaxTokens = retryTokens;
      logger.warn(
        `[ai] ${feature} structured output hit ${maxOutputTokens}-token budget (model=${modelId}); retrying with ${retryTokens}`,
      );
      result = await invoke(retryTokens);
    }

    if (isReasoningExhausted(result)) {
      throwReasoningExhausted(modelId, effectiveMaxTokens);
    }
    return { result, effectiveMaxTokens };
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (!isLengthTruncatedError(err) && !isReasoningExhaustedError(err)) {
      throw err;
    }

    const retryTokens = Math.min(maxOutputTokens * 2, MAX_RETRY_TOKENS);
    if (retryTokens > maxOutputTokens) {
      logger.warn(
        `[ai] ${feature} structured output truncated at ${maxOutputTokens} tokens (model=${modelId}); retrying with ${retryTokens}`,
      );
      try {
        const retryResult = await invoke(retryTokens);
        if (isReasoningExhausted(retryResult)) {
          throwReasoningExhausted(modelId, retryTokens);
        }
        return { result: retryResult, effectiveMaxTokens: retryTokens };
      } catch (retryErr) {
        if (retryErr instanceof AppError) throw retryErr;
        if (isReasoningExhaustedError(retryErr)) {
          throwReasoningExhausted(modelId, retryTokens);
        }
        if (isLengthTruncatedError(retryErr)) {
          throw new Error(
            `The model response was cut off at ${retryTokens} output tokens. Retry with a shorter input or a higher output limit.`,
            { cause: retryErr },
          );
        }
        throw retryErr;
      }
    }

    if (isReasoningExhaustedError(err)) {
      throwReasoningExhausted(modelId, maxOutputTokens);
    }
    throw new Error(
      `The model response was cut off at ${maxOutputTokens} output tokens. Retry with a shorter input or a higher output limit.`,
      { cause: err },
    );
  }
}

async function runPromptGuidedStructured<T>({
  languageModel,
  modelId,
  system,
  prompt,
  schema,
  element,
  maxOutputTokens,
  feature,
  startedAt,
}: {
  languageModel: LanguageModel;
  modelId: string;
  system?: string;
  prompt: string;
  schema?: z.ZodType;
  element?: z.ZodType;
  maxOutputTokens: number;
  feature: string;
  startedAt: number;
}): Promise<T> {
  const augmentedSystem = withJsonSchemaInstruction(system, schema, element, false);
  const { result, effectiveMaxTokens } = await callStructuredWithLengthRetry({
    feature,
    modelId,
    maxOutputTokens,
    invoke: (tokens) =>
      generateText({
        model: languageModel,
        system: augmentedSystem,
        prompt,
        maxOutputTokens: tokens,
        abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      }),
  });

  finishStructuredCall(feature, modelId, result, startedAt, effectiveMaxTokens);

  const parsedJson = extractJsonPayload(result.text);
  try {
    if (element) {
      return z.array(element).parse(unwrapArrayCandidate(parsedJson)) as T;
    }
    return schema!.parse(parsedJson) as T;
  } catch (parseErr) {
    const detail =
      parseErr instanceof Error ? parseErr.message : String(parseErr);
    throw new Error(`Model output failed schema validation: ${detail}`, {
      cause: parseErr,
    });
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
      const { result, effectiveMaxTokens } = await callStructuredWithLengthRetry({
        feature,
        modelId: desc.modelId,
        maxOutputTokens,
        invoke: (tokens) =>
          generateText({
            model,
            system,
            prompt,
            output,
            maxOutputTokens: tokens,
            abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          }),
      });
      finishStructuredCall(feature, desc.modelId, result, startedAt, effectiveMaxTokens);
      rememberStructuredMode(cacheKey, "json_schema");
      return result.output as T;
    } catch (err) {
      if (!shouldDowngradeStructuredRung(err)) throw err;
      logger.warn(
        `[ai] ${feature} downgrading ${desc.modelId} from json_schema -> json_object`,
      );
      rung = "json_object";
      rememberStructuredMode(cacheKey, rung);
    }
  }

  if (rung === "json_object") {
    try {
      const model = buildLanguageModelFromDescriptor(desc, false);
      const { result, effectiveMaxTokens } = await callStructuredWithLengthRetry({
        feature,
        modelId: desc.modelId,
        maxOutputTokens,
        invoke: (tokens) =>
          generateText({
            model,
            system: withJsonSchemaInstruction(system, schema, element, true),
            prompt,
            output,
            maxOutputTokens: tokens,
            abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
          }),
      });
      finishStructuredCall(feature, desc.modelId, result, startedAt, effectiveMaxTokens);
      rememberStructuredMode(cacheKey, "json_object");
      return result.output as T;
    } catch (err) {
      if (!shouldDowngradeStructuredRung(err)) throw err;
      logger.warn(
        `[ai] ${feature} downgrading ${desc.modelId} from json_object -> prompt JSON`,
      );
      rung = "prompt";
      rememberStructuredMode(cacheKey, rung);
    }
  }

  // Rung 3: Plain prompt JSON (zero response_format on the wire, e.g. LM Studio)
  return runPromptGuidedStructured<T>({
    languageModel: buildLanguageModelFromDescriptor(desc, false),
    modelId: desc.modelId,
    system,
    prompt,
    schema,
    element,
    maxOutputTokens,
    feature,
    startedAt,
  });
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
      sanitizeThrownAiError(err);
      const msg = redactAiErrorMessage(err instanceof Error ? err.message : String(err));
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

  try {
    const { result, effectiveMaxTokens } = await callStructuredWithLengthRetry({
      feature,
      modelId: desc.modelId,
      maxOutputTokens,
      invoke: (tokens) =>
        generateText({
          model: languageModel,
          system,
          prompt,
          output,
          maxOutputTokens: tokens,
          abortSignal: AbortSignal.timeout(CALL_TIMEOUT_MS),
        }),
    });
    finishStructuredCall(feature, desc.modelId, result, startedAt, effectiveMaxTokens);
    return result.output as T;
  } catch (err) {
    // Fallback for built-in models (e.g. Gemma on Gemini API) that reject native responseSchema
    // or emit reasoning/fenced prose around valid JSON.
    if (shouldDowngradeStructuredRung(err)) {
      logger.warn(
        `[ai] ${feature} native structured output rejected on ${desc.modelId}; falling back to prompt JSON`,
      );
      try {
        return await runPromptGuidedStructured<T>({
          languageModel,
          modelId: desc.modelId,
          system,
          prompt,
          schema,
          element,
          maxOutputTokens,
          feature,
          startedAt,
        });
      } catch (fallbackErr) {
        sanitizeThrownAiError(fallbackErr);
        const msg = redactAiErrorMessage(
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
        );
        logger.error(
          `[ai] ${feature} structured generation failed (model=${desc.modelId}): ${msg}`,
        );
        throw fallbackErr;
      }
    }
    sanitizeThrownAiError(err);
    const msg = redactAiErrorMessage(err instanceof Error ? err.message : String(err));
    logger.error(
      `[ai] ${feature} structured generation failed (model=${desc.modelId}): ${msg}`,
    );
    throw err;
  }
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
    messages: clampModelMessages(messages),
    tools,
    stopWhen: stepCountIs(MAX_TOOL_STEPS),
    maxOutputTokens,
    abortSignal: AbortSignal.any(signals),
    timeout: { chunkMs: streamIdleTimeoutMs },
    onError: ({ error }) => {
      const msg = redactAiErrorMessage(
        error instanceof Error ? error.message : String(error),
      );
      logger.error(`[ai] chat stream error (model=${modelId}): ${msg}`);
    },
    onAbort: () => {
      logger.info(`[ai] chat stream aborted (model=${modelId})`);
    },
  });

  return { result, modelId };
}
