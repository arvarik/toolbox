/**
 * @fileoverview Text embeddings via the AI SDK.
 *
 * Embeddings are always Gemini-based — the other providers in this app
 * offer no embedding model. The model must stay `gemini-embedding-2`:
 * stored vectors come from that model, and vectors from different
 * embedding models are not comparable.
 */

import { embed, cosineSimilarity as aiCosineSimilarity } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import db from '../db.js'
import logger from './logger.js'

const EMBEDDING_MODEL_ID = 'gemini-embedding-2'
const EMBED_TIMEOUT_MS = 20_000

/**
 * Generate an embedding vector for a text.
 * Returns an empty array when no Gemini key is configured or the call
 * fails — callers treat an empty vector as "no embedding".
 *
 * @param {string} text
 * @returns {Promise<number[]>}
 */
export async function generateEmbedding(text) {
  if (!text || text.trim() === '') return []

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    logger.warn('[embeddings] No Gemini API key — semantic search and episodic memory are disabled.')
    return []
  }

  try {
    const google = createGoogleGenerativeAI({ apiKey: config.value })
    const { embedding } = await embed({
      model: google.textEmbedding(EMBEDDING_MODEL_ID),
      value: text,
      abortSignal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    })
    return embedding
  } catch (err) {
    logger.error(`[embeddings] Embedding call failed: ${err.message}`)
    return []
  }
}

/**
 * Cosine similarity between two vectors.
 * Returns 0 for empty or mismatched vectors (e.g. rows embedded while
 * no key was configured).
 *
 * @param {number[]} vecA
 * @param {number[]} vecB
 * @returns {number}
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA?.length || !vecB?.length || vecA.length !== vecB.length) return 0
  return aiCosineSimilarity(vecA, vecB)
}
