import crypto from "node:crypto";
import type Database from "better-sqlite3";
import {
  ensureVecExtensionLoaded,
  kitTokFor,
  ownerTokFor,
} from "../kits/kitsSchema.ts";
import {
  bumpEmbeddingGen,
  getEmbeddingGen,
  getEmbeddingsConfig,
} from "../platform/ai/aiSettingsService.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import { embedTexts } from "../utils/embeddings.ts";
import logger from "../utils/logger.ts";

export type RagChunkKind = "guide" | "flashcard" | "source_chunk" | "episodic";

export interface UpsertRagChunkInput {
  chunkId?: string;
  kitId: string;
  kind: RagChunkKind;
  sourceRefId: string;
  nodeId?: string | null;
  title?: string;
  content: string;
  embedding?: Float32Array | null;
}

export interface HybridSearchHit {
  chunkId: string;
  kitId: string;
  kind: RagChunkKind;
  sourceRefId: string;
  nodeId: string | null;
  title: string;
  content: string;
  snippet: string;
  score: number;
  channels: Array<"fts" | "vec">;
}

export interface HybridSearchOptions {
  kitId?: string;
  kinds?: RagChunkKind[];
  limit?: number;
  skipVec?: boolean;
}

const RRF_K = 15;
const BM25_WEIGHT = 1.0;
const VEC_WEIGHT = 1.2;
const MAX_VEC_COSINE_DISTANCE = 0.78;
const BATCH_SIZE = 32;

export { ensureVecExtensionLoaded };

export function kindTokFor(kind: string): string {
  return `d_${kind.replace(/[^a-zA-Z0-9]/g, "_")}`;
}

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function readVecTableDimension(db: Database.Database): number | null {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rag_chunks_vec'",
    )
    .get() as { sql?: string } | undefined;
  if (!row?.sql) return null;
  const match = row.sql.match(/embedding\s+FLOAT\[(\d+)\]/i);
  return match ? Number(match[1]) : null;
}

/**
 * Ensures `rag_chunks_vec` exists with `FLOAT[${dim}]` and `ownerId TEXT PARTITION KEY`.
 * If the configured dimension changed (e.g. 384 -> 768), drops and recreates
 * `rag_chunks_vec`, bumps `embedding_gen`, and resets `rag_chunks.embedding_gen = NULL`
 * while `rag_chunks_fts` continues serving BM25 uninterrupted.
 */
export function ensureEmbeddingStore(
  db: Database.Database,
  dim: number = getEmbeddingsConfig().dimension,
): { recreated: boolean; dimension: number; embeddingGen: string } {
  if (!Number.isInteger(dim) || dim < 1 || dim > 8192) {
    throw new Error(`Invalid embedding dimension: ${dim}`);
  }
  ensureVecExtensionLoaded(db);

  const existingDim = readVecTableDimension(db);
  if (existingDim === dim) {
    return {
      recreated: false,
      dimension: dim,
      embeddingGen: getEmbeddingGen(),
    };
  }

  const isDimensionSwitch = existingDim !== null && existingDim !== dim;
  const tx = db.transaction(() => {
    if (isDimensionSwitch) {
      db.exec("DROP TABLE IF EXISTS rag_chunks_vec");
    }
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS rag_chunks_vec USING vec0(
        chunk_id TEXT PRIMARY KEY,
        ownerId TEXT PARTITION KEY,
        kit_id TEXT,
        kind TEXT,
        embedding FLOAT[${dim}] distance_metric=cosine
      )
    `);
    if (isDimensionSwitch) {
      // tenant-lint: allow instance sweep
      db.prepare("UPDATE rag_chunks SET embedding_gen = NULL").run();
    }
  });
  tx();

  const embeddingGen = isDimensionSwitch ? bumpEmbeddingGen() : getEmbeddingGen();
  return {
    recreated: isDimensionSwitch,
    dimension: dim,
    embeddingGen,
  };
}

export async function upsertRagChunksBatch(
  db: Database.Database,
  scope: Scope,
  inputs: readonly UpsertRagChunkInput[],
): Promise<number> {
  if (inputs.length === 0) return 0;
  const cfg = getEmbeddingsConfig();
  const { dimension, embeddingGen } = ensureEmbeddingStore(db, cfg.dimension);

  const selectExisting = db.prepare(
    "SELECT content_hash, embedding_gen FROM rag_chunks WHERE ownerId = ? AND chunk_id = ?",
  );

  const toProcess: Array<{
    chunkId: string;
    kitId: string;
    kind: RagChunkKind;
    sourceRefId: string;
    nodeId: string | null;
    title: string;
    content: string;
    contentHash: string;
    embedding: Float32Array | null;
  }> = [];

  for (const item of inputs) {
    const trimmedContent = item.content.trim();
    if (!trimmedContent) continue;
    const title = (item.title ?? "").trim();
    const chunkId =
      item.chunkId ??
      `${scope.ownerId}:${item.kitId}:${item.kind}:${item.sourceRefId}`;
    const contentHash = sha256Hex(`${title}\n${trimmedContent}`);

    if (!item.embedding) {
      const prev = selectExisting.get(scope.ownerId, chunkId) as
        | { content_hash: string; embedding_gen: string | null }
        | undefined;
      if (
        prev &&
        prev.content_hash === contentHash &&
        prev.embedding_gen === embeddingGen
      ) {
        continue;
      }
    }

    toProcess.push({
      chunkId,
      kitId: item.kitId,
      kind: item.kind,
      sourceRefId: item.sourceRefId,
      nodeId: item.nodeId ?? null,
      title,
      content: trimmedContent,
      contentHash,
      embedding: item.embedding ?? null,
    });
  }

  if (toProcess.length === 0) return 0;

  // Compute missing embeddings in batches
  const missingIndices: number[] = [];
  for (let i = 0; i < toProcess.length; i++) {
    if (!toProcess[i].embedding) missingIndices.push(i);
  }

  for (let start = 0; start < missingIndices.length; start += BATCH_SIZE) {
    const slice = missingIndices.slice(start, start + BATCH_SIZE);
    const texts = slice.map((idx) => {
      const c = toProcess[idx];
      return c.title ? `${c.title}\n${c.content}` : c.content;
    });
    try {
      const vecs = await embedTexts(texts);
      for (let j = 0; j < slice.length; j++) {
        const v = vecs[j];
        if (v && v.length === dimension) {
          toProcess[slice[j]].embedding = v;
        }
      }
    } catch (err) {
      logger.warn(
        `[hybridSearch] Batch embedding skipped (BM25 still indexed): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const upsertChunkStmt = db.prepare(`
    INSERT INTO rag_chunks (
      chunk_id, ownerId, kit_id, kind, source_ref_id, node_id,
      title, content, content_hash, embedding_gen, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(chunk_id) DO UPDATE SET
      kit_id = excluded.kit_id,
      kind = excluded.kind,
      source_ref_id = excluded.source_ref_id,
      node_id = excluded.node_id,
      title = excluded.title,
      content = excluded.content,
      content_hash = excluded.content_hash,
      embedding_gen = excluded.embedding_gen,
      updated_at = datetime('now')
    WHERE rag_chunks.ownerId = excluded.ownerId
  `);
  const delFtsStmt = db.prepare(
    "DELETE FROM rag_chunks_fts WHERE ownerTok = ? AND chunk_id = ?",
  );
  const insFtsStmt = db.prepare(
    "INSERT INTO rag_chunks_fts (chunk_id, ownerTok, kitTok, kindTok, title, content) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const delVecStmt = db.prepare(
    "DELETE FROM rag_chunks_vec WHERE ownerId = ? AND chunk_id = ?",
  );
  const insVecStmt = db.prepare(
    "INSERT INTO rag_chunks_vec (chunk_id, ownerId, kit_id, kind, embedding) VALUES (?, ?, ?, ?, ?)",
  );

  const ownerTok = ownerTokFor(scope.ownerId);

  const writeBatch = db.transaction(() => {
    for (const row of toProcess) {
      const hasValidVec =
        row.embedding !== null && row.embedding.length === dimension;
      upsertChunkStmt.run(
        row.chunkId,
        scope.ownerId,
        row.kitId,
        row.kind,
        row.sourceRefId,
        row.nodeId,
        row.title,
        row.content,
        row.contentHash,
        hasValidVec ? embeddingGen : null,
      );

      delFtsStmt.run(ownerTok, row.chunkId);
      insFtsStmt.run(
        row.chunkId,
        ownerTok,
        kitTokFor(row.kitId),
        kindTokFor(row.kind),
        row.title,
        row.content,
      );

      delVecStmt.run(scope.ownerId, row.chunkId);
      if (hasValidVec && row.embedding) {
        insVecStmt.run(
          row.chunkId,
          scope.ownerId,
          row.kitId,
          row.kind,
          row.embedding,
        );
      }
    }
  });
  writeBatch();

  if (toProcess.length >= 16) {
    try {
      db.pragma("optimize = 0x10002");
    } catch {
      // Non-critical FTS5 optimize hint
    }
  }

  return toProcess.length;
}

export async function upsertRagChunk(
  db: Database.Database,
  scope: Scope,
  input: UpsertRagChunkInput,
): Promise<string> {
  const chunkId =
    input.chunkId ??
    `${scope.ownerId}:${input.kitId}:${input.kind}:${input.sourceRefId}`;
  await upsertRagChunksBatch(db, scope, [{ ...input, chunkId }]);
  return chunkId;
}

export function deleteRagChunksByIds(
  db: Database.Database,
  scope: Scope,
  chunkIds: readonly string[],
): number {
  if (chunkIds.length === 0) return 0;
  const hasVec = readVecTableDimension(db) !== null;
  if (hasVec) ensureVecExtensionLoaded(db);

  const ownerTok = ownerTokFor(scope.ownerId);
  const delFts = db.prepare(
    "DELETE FROM rag_chunks_fts WHERE ownerTok = ? AND chunk_id = ?",
  );
  const delVec = hasVec
    ? db.prepare("DELETE FROM rag_chunks_vec WHERE ownerId = ? AND chunk_id = ?")
    : null;
  const delChunk = db.prepare(
    "DELETE FROM rag_chunks WHERE ownerId = ? AND chunk_id = ?",
  );

  const tx = db.transaction(() => {
    for (const chunkId of chunkIds) {
      delFts.run(ownerTok, chunkId);
      delVec?.run(scope.ownerId, chunkId);
      delChunk.run(scope.ownerId, chunkId);
    }
  });
  tx();
  return chunkIds.length;
}

export function deleteRagChunksBySource(
  db: Database.Database,
  scope: Scope,
  kitId: string,
  kind: RagChunkKind,
  sourceRefId: string,
): number {
  const existing = db
    .prepare(
      "SELECT chunk_id FROM rag_chunks WHERE ownerId = ? AND kit_id = ? AND kind = ? AND source_ref_id = ?",
    )
    .all(scope.ownerId, kitId, kind, sourceRefId) as Array<{ chunk_id: string }>;
  return deleteRagChunksByIds(
    db,
    scope,
    existing.map((r) => r.chunk_id),
  );
}

export function deleteRagChunksForKit(
  db: Database.Database,
  scope: Scope,
  kitId: string,
): number {
  const existing = db
    .prepare("SELECT chunk_id FROM rag_chunks WHERE ownerId = ? AND kit_id = ?")
    .all(scope.ownerId, kitId) as Array<{ chunk_id: string }>;
  const removed = deleteRagChunksByIds(
    db,
    scope,
    existing.map((r) => r.chunk_id),
  );
  db.prepare(
    "DELETE FROM rag_chunks_fts WHERE ownerTok = ? AND kitTok = ?",
  ).run(ownerTokFor(scope.ownerId), kitTokFor(kitId));
  if (readVecTableDimension(db) !== null) {
    ensureVecExtensionLoaded(db);
    db.prepare(
      "DELETE FROM rag_chunks_vec WHERE ownerId = ? AND kit_id = ?",
    ).run(scope.ownerId, kitId);
  }
  return removed;
}

export function deleteRagChunksForDeck(
  db: Database.Database,
  scope: Scope,
  kitId: string,
  deckId: string,
): number {
  const cards = db
    .prepare("SELECT id FROM flashcards WHERE ownerId = ? AND deck_id = ?")
    .all(scope.ownerId, deckId) as Array<{ id: string }>;
  if (cards.length === 0) return 0;
  const chunkIds = cards.map(
    (c) => `${scope.ownerId}:${kitId}:flashcard:${c.id}`,
  );
  return deleteRagChunksByIds(db, scope, chunkIds);
}

/**
 * Re-embeds rows in `rag_chunks` whose `embedding_gen` is NULL or stale
 * (e.g. after `ensureEmbeddingStore` recreated `rag_chunks_vec` at a new dimension).
 */
export async function reindexMissingEmbeddings(
  db: Database.Database,
  opts: { scope?: Scope; limit?: number } = {},
): Promise<number> {
  const cfg = getEmbeddingsConfig();
  const { dimension, embeddingGen } = ensureEmbeddingStore(db, cfg.dimension);
  const limit = opts.limit ?? 128;

  const pending = opts.scope
    ? (db
        .prepare(
          `SELECT chunk_id, ownerId, kit_id, kind, title, content
           FROM rag_chunks
           WHERE ownerId = ? AND (embedding_gen IS NULL OR embedding_gen != ?)
           LIMIT ?`,
        )
        .all(opts.scope.ownerId, embeddingGen, limit) as Array<{
        chunk_id: string;
        ownerId: string;
        kit_id: string;
        kind: string;
        title: string;
        content: string;
      }>)
    : (db
        .prepare(
          // tenant-lint: allow instance sweep
          `SELECT chunk_id, ownerId, kit_id, kind, title, content
           FROM rag_chunks
           WHERE embedding_gen IS NULL OR embedding_gen != ?
           LIMIT ?`,
        )
        .all(embeddingGen, limit) as Array<{
        chunk_id: string;
        ownerId: string;
        kit_id: string;
        kind: string;
        title: string;
        content: string;
      }>);

  if (pending.length === 0) return 0;

  let updated = 0;
  const delVec = db.prepare(
    "DELETE FROM rag_chunks_vec WHERE ownerId = ? AND chunk_id = ?",
  );
  const insVec = db.prepare(
    "INSERT INTO rag_chunks_vec (chunk_id, ownerId, kit_id, kind, embedding) VALUES (?, ?, ?, ?, ?)",
  );
  const updChunk = db.prepare(
    "UPDATE rag_chunks SET embedding_gen = ?, updated_at = datetime('now') WHERE ownerId = ? AND chunk_id = ?",
  );

  for (let start = 0; start < pending.length; start += BATCH_SIZE) {
    const batch = pending.slice(start, start + BATCH_SIZE);
    const vecs = await embedTexts(
      batch.map((r) => (r.title ? `${r.title}\n${r.content}` : r.content)),
    );
    const tx = db.transaction(() => {
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const vec = vecs[i];
        if (!vec || vec.length !== dimension) continue;
        delVec.run(row.ownerId, row.chunk_id);
        insVec.run(row.chunk_id, row.ownerId, row.kit_id, row.kind, vec);
        updChunk.run(embeddingGen, row.ownerId, row.chunk_id);
        updated++;
      }
    });
    tx();
  }
  return updated;
}

/**
 * Syncs owned rows from `guide_content`, `flashcards`, `kit_source_chunks`,
 * and `episodic_memory` into `rag_chunks` + `rag_chunks_fts` + `rag_chunks_vec`.
 */
export async function syncDomainSourcesToRag(
  db: Database.Database,
  scope: Scope,
  kitId?: string,
  opts: { pruneStale?: boolean } = {},
): Promise<number> {
  const inputs: UpsertRagChunkInput[] = [];

  const guideRows = kitId
    ? (db
        .prepare(
          `SELECT kit_id, pillar_id, topic_id, section_id, content
           FROM guide_content
           WHERE ownerId = ? AND kit_id = ? AND content != ''`,
        )
        .all(scope.ownerId, kitId) as Array<{
        kit_id: string;
        pillar_id: string;
        topic_id: string;
        section_id: string;
        content: string;
      }>)
    : (db
        .prepare(
          `SELECT kit_id, pillar_id, topic_id, section_id, content
           FROM guide_content
           WHERE ownerId = ? AND content != ''`,
        )
        .all(scope.ownerId) as Array<{
        kit_id: string;
        pillar_id: string;
        topic_id: string;
        section_id: string;
        content: string;
      }>);

  for (const g of guideRows) {
    const ref = `${g.pillar_id}:${g.topic_id}:${g.section_id}`;
    inputs.push({
      kitId: g.kit_id,
      kind: "guide",
      sourceRefId: ref,
      title: `${g.topic_id} — ${g.section_id}`,
      content: g.content,
    });
  }

  const cardRows = kitId
    ? (db
        .prepare(
          `SELECT f.id, d.kit_id, f.node_id, f.front, f.back
           FROM flashcards f
           JOIN decks d ON d.id = f.deck_id AND d.ownerId = f.ownerId
           WHERE f.ownerId = ? AND d.kit_id = ?`,
        )
        .all(scope.ownerId, kitId) as Array<{
        id: string;
        kit_id: string;
        node_id: string | null;
        front: string;
        back: string;
      }>)
    : (db
        .prepare(
          `SELECT f.id, d.kit_id, f.node_id, f.front, f.back
           FROM flashcards f
           JOIN decks d ON d.id = f.deck_id AND d.ownerId = f.ownerId
           WHERE f.ownerId = ?`,
        )
        .all(scope.ownerId) as Array<{
        id: string;
        kit_id: string;
        node_id: string | null;
        front: string;
        back: string;
      }>);

  for (const c of cardRows) {
    inputs.push({
      kitId: c.kit_id,
      kind: "flashcard",
      sourceRefId: c.id,
      nodeId: c.node_id,
      title: c.front,
      content: `${c.front}\n${c.back}`,
    });
  }

  const sourceRows = kitId
    ? (db
        .prepare(
          `SELECT sc.id, sc.kit_id, sc.text, s.title
           FROM kit_source_chunks sc
           JOIN kit_sources s ON s.id = sc.source_id AND s.ownerId = sc.ownerId
           WHERE sc.ownerId = ? AND sc.kit_id = ?`,
        )
        .all(scope.ownerId, kitId) as Array<{
        id: string;
        kit_id: string;
        text: string;
        title: string;
      }>)
    : (db
        .prepare(
          `SELECT sc.id, sc.kit_id, sc.text, s.title
           FROM kit_source_chunks sc
           JOIN kit_sources s ON s.id = sc.source_id AND s.ownerId = sc.ownerId
           WHERE sc.ownerId = ?`,
        )
        .all(scope.ownerId) as Array<{
        id: string;
        kit_id: string;
        text: string;
        title: string;
      }>);

  for (const sr of sourceRows) {
    inputs.push({
      kitId: sr.kit_id,
      kind: "source_chunk",
      sourceRefId: sr.id,
      title: sr.title,
      content: sr.text,
    });
  }

  const episodicRows = kitId
    ? (db
        .prepare(
          `SELECT id, kit_id, memory_text
           FROM episodic_memory
           WHERE ownerId = ? AND kit_id = ?`,
        )
        .all(scope.ownerId, kitId) as Array<{
        id: number;
        kit_id: string;
        memory_text: string;
      }>)
    : (db
        .prepare(
          `SELECT id, kit_id, memory_text
           FROM episodic_memory
           WHERE ownerId = ?`,
        )
        .all(scope.ownerId) as Array<{
        id: number;
        kit_id: string;
        memory_text: string;
      }>);

  for (const ep of episodicRows) {
    inputs.push({
      kitId: ep.kit_id,
      kind: "episodic",
      sourceRefId: String(ep.id),
      title: "Episodic Memory",
      content: ep.memory_text,
    });
  }

  if (opts.pruneStale) {
    const liveIds = new Set<string>();
    for (const item of inputs) {
      if (!item.content.trim()) continue;
      liveIds.add(
        item.chunkId ??
          `${scope.ownerId}:${item.kitId}:${item.kind}:${item.sourceRefId}`,
      );
    }
    const storedRows = kitId
      ? (db
          .prepare(
            "SELECT chunk_id FROM rag_chunks WHERE ownerId = ? AND kit_id = ?",
          )
          .all(scope.ownerId, kitId) as Array<{ chunk_id: string }>)
      : (db
          .prepare("SELECT chunk_id FROM rag_chunks WHERE ownerId = ?")
          .all(scope.ownerId) as Array<{ chunk_id: string }>);
    const staleIds = storedRows
      .map((r) => r.chunk_id)
      .filter((id) => !liveIds.has(id));
    if (staleIds.length > 0) {
      deleteRagChunksByIds(db, scope, staleIds);
    }
  }

  return upsertRagChunksBatch(db, scope, inputs);
}

export function safeFtsTokens(rawQuery: string): string[] {
  const words = rawQuery.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length >= 16) break;
  }
  return out;
}

function buildFtsMatchExpression(
  ownerId: string,
  tokens: readonly string[],
  kitId?: string,
  kinds?: readonly RagChunkKind[],
): string {
  const clauses: string[] = [`{ownerTok} : "${ownerTokFor(ownerId)}"`];
  if (kitId) {
    clauses.push(`{kitTok} : "${kitTokFor(kitId)}"`);
  }
  if (kinds && kinds.length > 0) {
    const kindExpr = kinds
      .map((k) => `{kindTok} : "${kindTokFor(k)}"`)
      .join(" OR ");
    clauses.push(`(${kindExpr})`);
  }
  const termExpr = tokens.map((t) => `"${t}"`).join(" OR ");
  clauses.push(`{title content} : (${termExpr})`);
  return clauses.join(" AND ");
}

function makeSnippet(content: string, tokens: readonly string[]): string {
  const clean = content.replace(/\s+/g, " ").trim();
  if (clean.length <= 220) return clean;
  const lower = clean.toLowerCase();
  for (const tok of tokens) {
    const idx = lower.indexOf(tok);
    if (idx !== -1) {
      const start = Math.max(0, idx - 60);
      const end = Math.min(clean.length, start + 220);
      return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
    }
  }
  return `${clean.slice(0, 220)}…`;
}

/**
 * Hybrid lexical (FTS5 BM25, weight 1.0) + semantic (`sqlite-vec` `vec0` cosine KNN, weight 1.2)
 * retrieval fused via Reciprocal Rank Fusion (`RRF_K = 15`), strictly partitioned by `scope.ownerId`.
 */
export async function hybridSearch(
  db: Database.Database,
  scope: Scope,
  query: string,
  options: HybridSearchOptions = {},
): Promise<HybridSearchHit[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
  const candidatePool = Math.max(limit * 3, 30);
  const tokens = safeFtsTokens(trimmed);

  ensureVecExtensionLoaded(db);
  const vecDim = readVecTableDimension(db);

  // 1. Lexical BM25 over `rag_chunks_fts` (weight 1.0)
  let ftsHits: Array<{ chunk_id: string }> = [];
  if (tokens.length > 0) {
    const matchExpr = buildFtsMatchExpression(
      scope.ownerId,
      tokens,
      options.kitId,
      options.kinds,
    );
    try {
      ftsHits = db
        .prepare(
          `SELECT f.chunk_id
           FROM rag_chunks_fts f
           JOIN rag_chunks c ON c.chunk_id = f.chunk_id
           WHERE rag_chunks_fts MATCH ? AND c.ownerId = ?
           ORDER BY bm25(rag_chunks_fts, 0.0, 0.0, 0.0, 0.0, 3.0, 1.0) ASC
           LIMIT ?`,
        )
        .all(matchExpr, scope.ownerId, candidatePool) as Array<{
        chunk_id: string;
      }>;
    } catch (err) {
      logger.warn(
        `[hybridSearch] FTS5 query skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Semantic KNN over `rag_chunks_vec` with ownerId PARTITION KEY (weight 1.2)
  let vecHits: Array<{ chunk_id: string; distance: number }> = [];
  if (!options.skipVec && vecDim !== null) {
    try {
      const [queryVec] = await embedTexts([trimmed]);
      if (queryVec && queryVec.length === vecDim) {
        const whereParts: string[] = ["ownerId = ?"];
        const params: unknown[] = [scope.ownerId];

        if (options.kitId) {
          whereParts.push("kit_id = ?");
          params.push(options.kitId);
        }
        if (options.kinds && options.kinds.length === 1) {
          whereParts.push("kind = ?");
          params.push(options.kinds[0]);
        } else if (options.kinds && options.kinds.length > 1) {
          whereParts.push(
            `kind IN (${options.kinds.map(() => "?").join(", ")})`,
          );
          params.push(...options.kinds);
        }

        whereParts.push("embedding MATCH ?", "k = ?");
        params.push(
          queryVec,
          candidatePool,
          scope.ownerId,
          MAX_VEC_COSINE_DISTANCE,
        );

        vecHits = db
          .prepare(
            `WITH knn AS MATERIALIZED (
               SELECT chunk_id, distance
               FROM rag_chunks_vec
               WHERE ${whereParts.join(" AND ")}
             )
             SELECT knn.chunk_id, knn.distance
             FROM knn
             CROSS JOIN rag_chunks c ON c.chunk_id = knn.chunk_id
             WHERE c.ownerId = ? AND knn.distance <= ?
             ORDER BY knn.distance ASC`,
          )
          .all(...params) as Array<{ chunk_id: string; distance: number }>;
      }
    } catch (err) {
      logger.warn(
        `[hybridSearch] Vector KNN skipped (serving FTS5 uninterrupted): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 3. Reciprocal Rank Fusion (RRF_K = 15, BM25 = 1.0, Vec = 1.2)
  const scores = new Map<
    string,
    { score: number; channels: Set<"fts" | "vec"> }
  >();

  ftsHits.forEach((hit, idx) => {
    const cur = scores.get(hit.chunk_id) ?? {
      score: 0,
      channels: new Set<"fts" | "vec">(),
    };
    cur.score += BM25_WEIGHT / (RRF_K + idx + 1);
    cur.channels.add("fts");
    scores.set(hit.chunk_id, cur);
  });

  vecHits.forEach((hit, idx) => {
    const cur = scores.get(hit.chunk_id) ?? {
      score: 0,
      channels: new Set<"fts" | "vec">(),
    };
    cur.score += VEC_WEIGHT / (RRF_K + idx + 1);
    cur.channels.add("vec");
    scores.set(hit.chunk_id, cur);
  });

  if (scores.size === 0) return [];

  const rankedIds = [...scores.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, limit);

  const placeholders = rankedIds.map(() => "?").join(", ");
  const chunkRows = db
    .prepare(
      `SELECT chunk_id, kit_id, kind, source_ref_id, node_id, title, content
       FROM rag_chunks
       WHERE ownerId = ? AND chunk_id IN (${placeholders})`,
    )
    .all(
      scope.ownerId,
      ...rankedIds.map(([id]) => id),
    ) as Array<{
    chunk_id: string;
    kit_id: string;
    kind: RagChunkKind;
    source_ref_id: string;
    node_id: string | null;
    title: string;
    content: string;
  }>;

  const byId = new Map(chunkRows.map((r) => [r.chunk_id, r]));
  const results: HybridSearchHit[] = [];
  for (const [chunkId, meta] of rankedIds) {
    const row = byId.get(chunkId);
    if (!row) continue;
    results.push({
      chunkId: row.chunk_id,
      kitId: row.kit_id,
      kind: row.kind,
      sourceRefId: row.source_ref_id,
      nodeId: row.node_id,
      title: row.title,
      content: row.content,
      snippet: makeSnippet(row.content, tokens),
      score: Number(meta.score.toFixed(6)),
      channels: [...meta.channels],
    });
  }
  return results;
}
