import { embedMany } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  getEmbeddingsConfig,
  resolveEmbeddingsEndpointCredentials,
  resolveInstanceProviderKeyForEmbeddings,
} from "../platform/ai/aiSettingsService.ts";
import { embedTextsLocal } from "../platform/workers/cpuHost.ts";
import logger from "./logger.ts";

const EMBED_TIMEOUT_MS = 30_000;

export async function embedTexts(
  texts: string[],
  opts: { signal?: AbortSignal } = {},
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  const cfg = getEmbeddingsConfig();

  if (cfg.provider === "local") {
    return embedTextsLocal(texts, {
      signal: opts.signal,
      dim: cfg.dimension,
    });
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
    return embeddings.map((v) => Float32Array.from(v));
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
    return embeddings.map((v) => Float32Array.from(v));
  }

  const ep = resolveEmbeddingsEndpointCredentials(cfg.endpointId);
  const compat = createOpenAICompatible({
    name: ep.name,
    baseURL: ep.baseUrl,
    apiKey: ep.apiKey || undefined,
  });
  const { embeddings } = await embedMany({
    model: compat.textEmbeddingModel(cfg.modelId),
    values: texts,
    abortSignal,
  });
  return embeddings.map((v) => Float32Array.from(v));
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
