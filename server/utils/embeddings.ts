import { embed, cosineSimilarity as aiCosineSimilarity } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import db from "../db.ts";
import { openCredential } from "../kits/kitsSchema.ts";
import logger from "./logger.ts";

const EMBEDDING_MODEL_ID = "gemini-embedding-2";
const EMBED_TIMEOUT_MS = 20_000;

export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim() === "") return [];

  const row = db
    .prepare("SELECT value FROM config WHERE key = 'gemini_api_key'")
    .get() as { value: string } | undefined;
  const apiKey = openCredential(row?.value);
  if (!apiKey) {
    logger.warn(
      "[embeddings] No Gemini API key — semantic search and episodic memory are disabled.",
    );
    return [];
  }

  try {
    const google = createGoogleGenerativeAI({ apiKey });
    const { embedding } = await embed({
      model: google.textEmbedding(EMBEDDING_MODEL_ID),
      value: text,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });
    return embedding;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[embeddings] Embedding call failed: ${msg}`);
    return [];
  }
}

export function cosineSimilarity(
  vecA: number[] | null | undefined,
  vecB: number[] | null | undefined,
): number {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) return 0;
  return aiCosineSimilarity(vecA, vecB);
}
