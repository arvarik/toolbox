import { embedMany } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  canUsePrivateEndpoint,
  getEmbeddingsConfig,
  resolveEmbeddingsEndpointCredentials,
  resolveInstanceProviderKeyForEmbeddings,
} from "../platform/ai/aiSettingsService.ts";
import { guardedFetch } from "../platform/net/originAndFetch.ts";
import { embedTextsLocal } from "../platform/workers/cpuHost.ts";
import logger from "./logger.ts";

const EMBED_TIMEOUT_MS = 30_000;

function toValidatedFloat32Vectors(
  vectors: ReadonlyArray<ArrayLike<number>>,
  expectedCount: number,
  expectedDimension: number,
  providerLabel: string,
): Float32Array[] {
  if (!Array.isArray(vectors) || vectors.length !== expectedCount) {
    throw new Error(
      `[embeddings] ${providerLabel} returned ${Array.isArray(vectors) ? vectors.length : 0} vector(s); expected ${expectedCount}`,
    );
  }

  return vectors.map((vec, rowIdx) => {
    if (!vec || typeof vec.length !== "number" || vec.length !== expectedDimension) {
      const actualLen = vec && typeof vec.length === "number" ? vec.length : 0;
      throw new Error(
        `[embeddings] ${providerLabel} vector[${rowIdx}] dimension mismatch: got ${actualLen}, expected ${expectedDimension}`,
      );
    }

    const out = new Float32Array(expectedDimension);
    for (let i = 0; i < expectedDimension; i += 1) {
      const rawVal = vec[i];
      if (typeof rawVal !== "number" || !Number.isFinite(rawVal)) {
        throw new Error(
          `[embeddings] ${providerLabel} vector[${rowIdx}][${i}] is non-finite (${String(rawVal)})`,
        );
      }
      const f32 = Math.fround(rawVal);
      if (!Number.isFinite(f32)) {
        throw new Error(
          `[embeddings] ${providerLabel} vector[${rowIdx}][${i}] overflows Float32 (${String(rawVal)})`,
        );
      }
      out[i] = f32;
    }
    return out;
  });
}

export async function embedTexts(
  texts: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const cfg = getEmbeddingsConfig();

  if (cfg.provider === "local") {
    const vectors = await embedTextsLocal(texts, {
      signal: opts.signal,
      dim: cfg.dimension,
    });
    return toValidatedFloat32Vectors(vectors, texts.length, cfg.dimension, "local");
  }

  const signals: AbortSignal[] = [AbortSignal.timeout(EMBED_TIMEOUT_MS)];
  if (opts.signal) signals.push(opts.signal);
  const abortSignal = AbortSignal.any(signals);

  if (cfg.provider === "gemini") {
    const apiKey = resolveInstanceProviderKeyForEmbeddings("gemini");
    const google = createGoogleGenerativeAI({ apiKey });
    const { embeddings } = await embedMany({
      model: google.textEmbeddingModel(cfg.modelId),
      values: texts,
      providerOptions: {
        google: { outputDimensionality: cfg.dimension },
      },
      abortSignal,
    });
    return toValidatedFloat32Vectors(embeddings, texts.length, cfg.dimension, "gemini");
  }

  if (cfg.provider === "openai") {
    const apiKey = resolveInstanceProviderKeyForEmbeddings("openai");
    const openai = createOpenAI({ apiKey });
    const { embeddings } = await embedMany({
      model: openai.textEmbeddingModel(cfg.modelId),
      values: texts,
      providerOptions: {
        openai: { dimensions: cfg.dimension },
      },
      abortSignal,
    });
    return toValidatedFloat32Vectors(embeddings, texts.length, cfg.dimension, "openai");
  }

  const ep = resolveEmbeddingsEndpointCredentials(cfg.endpointId);
  const compat = createOpenAICompatible({
    name: ep.name,
    baseURL: ep.baseUrl,
    apiKey: ep.apiKey || undefined,
    fetch: guardedFetch({
      allowPrivate: canUsePrivateEndpoint({ isAdmin: true }),
      timeoutMs: EMBED_TIMEOUT_MS,
    }),
  });
  const { embeddings } = await embedMany({
    model: compat.textEmbeddingModel(cfg.modelId),
    values: texts,
    abortSignal,
  });
  return toValidatedFloat32Vectors(embeddings, texts.length, cfg.dimension, "custom");
}

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim() === "") return [];
  try {
    const [vec] = await embedTexts([text]);
    return vec ? Array.from(vec) : [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[embeddings] Embedding call failed: ${msg}`);
    return [];
  }
}
