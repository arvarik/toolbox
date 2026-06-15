import { GoogleGenerativeAI } from '@google/generative-ai';
import db from '../db.js';
import logger from './logger.js';

let genAI = null;

function getGenAI() {
  if (genAI) return genAI;
  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get();
  if (config?.value) {
    genAI = new GoogleGenerativeAI(config.value);
    return genAI;
  }
  return null;
}

/**
 * Generates an embedding for a given text using gemini-embedding-2.
 */
export async function generateEmbedding(text) {
  if (!text || text.trim() === '') return [];
  const ai = getGenAI();
  if (!ai) {
    logger.warn('[embeddings] No API key, cannot generate embedding.');
    return [];
  }
  
  try {
    const model = ai.getGenerativeModel({ model: 'gemini-embedding-2' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (err) {
    logger.error('[embeddings] Error generating embedding:', err.message);
    return [];
  }
}

/**
 * Computes cosine similarity between two vectors.
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
