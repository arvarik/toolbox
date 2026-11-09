import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  BadRequestError,
  createZipArchive,
  extractZipArchive,
  type ZipCreateEntry,
} from "../platform/archive/zip.ts";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../platform/net/errors.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import { kitTokFor, ownerTokFor } from "./kitsSchema.ts";
import {
  getOwnedKit,
  kitsUploadsBaseDir,
  kitUploadsDir,
  mintUniqueKitSlug,
  seedKitStarterContent,
  snapshotSkeletonFromOwnedKit,
  validateAndVerifySkeleton,
  type OwnedKitDetail,
} from "./kitService.ts";
import { syncKitStructure, type KitSyncResult } from "./kitSync.ts";

export type ImportCollisionPolicy = "error" | "copy" | "replace" | "update";

const SAFE_BASENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$/;
const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_JSON_ENTRY_BYTES = 32 * 1024 * 1024;
const MAX_BINARY_ENTRY_BYTES = 50 * 1024 * 1024;

function sanitizeBasename(raw: string): string {
  const cleaned = path
    .basename(raw)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  return cleaned.slice(0, 160) || "source.bin";
}

function throwSlugConflict(existingKitId: string, slug: string): never {
  throw new AppError(`A Kit with slug "${slug}" already exists`, 409, {
    code: "KIT_SLUG_CONFLICT",
    details: { code: "KIT_SLUG_CONFLICT", existingKitId, slug },
  });
}

/* ════════════════════════════════════════════════════════════════
   Mode 1: Portable Skeleton (.toolbox-kit.json)
   ════════════════════════════════════════════════════════════════ */

export function exportKitMode1(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
  opts: { includeGuideNotes?: boolean } = {},
): { filename: string; skeleton: KitSkeletonV1 } {
  const row = db
    .prepare(
      "SELECT * FROM kits WHERE ownerId = ? AND (id = ? OR slug = ?) LIMIT 1",
    )
    .get(scope.ownerId, slugOrId, slugOrId) as
    | Parameters<typeof snapshotSkeletonFromOwnedKit>[2]
    | undefined;

  if (!row) {
    throw new NotFoundError("Kit", slugOrId);
  }

  const skeleton = snapshotSkeletonFromOwnedKit(db, scope, row, {
    includeGuideNotes: Boolean(opts.includeGuideNotes),
  });

  return {
    filename: `${skeleton.identity.slug}.toolbox-kit.json`,
    skeleton,
  };
}

export interface Mode1ImportResult {
  kit: OwnedKitDetail;
  mode: "created" | "copied" | "replaced" | "updated";
  syncStats?: Omit<KitSyncResult, "kit">;
}

export function importKitMode1(
  db: Database.Database,
  scope: Scope,
  rawSkeleton: unknown,
  opts: { onCollision?: ImportCollisionPolicy } = {},
): Mode1ImportResult {
  const verified = validateAndVerifySkeleton(rawSkeleton);
  const onCollision = opts.onCollision ?? "error";
  const baseSlug = verified.identity.slug;

  const existing = db
    .prepare("SELECT id, slug FROM kits WHERE ownerId = ? AND slug = ?")
    .get(scope.ownerId, baseSlug) as { id: string; slug: string } | undefined;

  if (existing) {
    if (onCollision === "error") {
      throwSlugConflict(existing.id, baseSlug);
    }
    if (onCollision === "update") {
      const synced = syncKitStructure(db, scope, existing.id, verified);
      const { kit, ...syncStats } = synced;
      return { kit, mode: "updated", syncStats };
    }
  }

  let targetSlug = baseSlug;
  let mode: Mode1ImportResult["mode"] = "created";
  if (existing && onCollision === "copy") {
    targetSlug = mintUniqueKitSlug(db, scope, baseSlug);
    mode = "copied";
  } else if (existing && onCollision === "replace") {
    mode = "replaced";
  }

  const newKitId = crypto.randomUUID();
  const storedSkeleton: KitSkeletonV1 = {
    ...verified,
    identity: { ...verified.identity, slug: targetSlug },
  };

  const runTx = db.transaction(() => {
    if (existing && onCollision === "replace") {
      db.prepare(
        "DELETE FROM rag_chunks_fts WHERE ownerTok = ? AND kitTok = ?",
      ).run(ownerTokFor(scope.ownerId), kitTokFor(existing.id));
      db.prepare("DELETE FROM rag_chunks WHERE ownerId = ? AND kit_id = ?").run(
        scope.ownerId,
        existing.id,
      );
      db.prepare("DELETE FROM kits WHERE ownerId = ? AND id = ?").run(
        scope.ownerId,
        existing.id,
      );
    }

    db.prepare(
      `INSERT INTO kits (
         id, ownerId, slug, name, description, icon, color, status,
         skeleton_json, forked_from_shared_id, forked_version,
         created_at, updated_at, last_opened_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, NULL, ?, datetime('now'), datetime('now'), datetime('now'))`,
    ).run(
      newKitId,
      scope.ownerId,
      targetSlug,
      storedSkeleton.identity.name,
      storedSkeleton.identity.description,
      storedSkeleton.identity.icon,
      storedSkeleton.identity.color,
      JSON.stringify(storedSkeleton),
      storedSkeleton.identity.version,
    );

    seedKitStarterContent(db, scope, newKitId, storedSkeleton);
  });

  runTx();

  if (existing && onCollision === "replace") {
    fs.rmSync(kitUploadsDir(scope.ownerId, existing.id), {
      recursive: true,
      force: true,
    });
  }

  return { kit: getOwnedKit(db, scope, newKitId), mode };
}

/* ════════════════════════════════════════════════════════════════
   Mode 2: Full Personal Backup (.toolbox-backup.zip)
   ════════════════════════════════════════════════════════════════ */

export const KitBackupUserdataV1Schema = z.object({
  format: z.literal("toolbox-kit-userdata"),
  schemaVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  originalKitId: z.string().min(1),
  guideContent: z
    .array(
      z.object({
        pillarId: z.string().min(1),
        topicId: z.string().min(1),
        sectionId: z.string().min(1),
        content: z.string(),
        committedAt: z.string().nullable(),
      }),
    )
    .default([]),
  chatStarters: z
    .array(
      z.object({
        pillarId: z.string().min(1),
        topicId: z.string().min(1),
        suggestions: z.string(),
        contentHash: z.string(),
        updatedAt: z.string().nullable(),
      }),
    )
    .default([]),
  decks: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        description: z.string().default(""),
        colorIndex: z.number().int().default(0),
        tags: z.string().default(""),
        settings: z.string().default("{}"),
        createdAt: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
    )
    .default([]),
  flashcards: z
    .array(
      z.object({
        id: z.string().min(1),
        deckId: z.string().min(1),
        nodeId: z.string().nullable().default(null),
        front: z.string(),
        back: z.string(),
        position: z.number().int().default(0),
        easeFactor: z.number().default(2.5),
        interval: z.number().int().default(0),
        repetitions: z.number().int().default(0),
        nextReview: z.string().nullable().default(null),
        lastReviewed: z.string().nullable().default(null),
        state: z.number().int().default(0),
        learningStep: z.number().int().default(0),
        prerequisiteId: z.string().nullable().default(null),
        sourcePillarId: z.string().nullable().default(null),
        sourceTopicId: z.string().nullable().default(null),
        sourceSectionId: z.string().nullable().default(null),
        isReverse: z.number().int().default(0),
        reverseOfId: z.string().nullable().default(null),
        seedKey: z.string().nullable().default(null),
        stability: z.number().nullable().default(null),
        difficulty: z.number().nullable().default(null),
        lapses: z.number().int().default(0),
        createdAt: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
    )
    .default([]),
  remediationQueue: z
    .array(
      z.object({
        cardId: z.string().min(1),
        sourceCardId: z.string(),
        nodeId: z.string().nullable().default(null),
        nodeName: z.string().nullable().default(null),
        reason: z.string().default(""),
        createdAt: z.string().nullable(),
        resolvedAt: z.string().nullable().default(null),
      }),
    )
    .default([]),
  drills: z
    .array(
      z.object({
        id: z.string().min(1),
        nodeId: z.string().min(1),
        difficulty: z.number().int(),
        prompt: z.string().min(1),
        hintsJson: z.string().default("[]"),
        workedSolution: z.string().default(""),
        rubricJson: z.string().default("[]"),
        seedKey: z.string().nullable().default(null),
        createdAt: z.string().nullable(),
      }),
    )
    .default([]),
  drillAttempts: z
    .array(
      z.object({
        id: z.string().min(1),
        drillId: z.string().min(1),
        submission: z.string(),
        score: z.number().nullable().default(null),
        feedbackJson: z.string().default("{}"),
        createdAt: z.string().nullable(),
      }),
    )
    .default([]),
  boards: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        data: z.string().default("{}"),
        position: z.number().int().default(0),
        createdAt: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
    )
    .default([]),
  chatSessions: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        persona: z.string().default("socratic"),
        messages: z.string().default("[]"),
        pillarId: z.string().nullable().default(null),
        topicId: z.string().nullable().default(null),
        topicName: z.string().nullable().default(null),
        createdAt: z.string().nullable(),
        updatedAt: z.string().nullable(),
      }),
    )
    .default([]),
  episodicMemories: z
    .array(
      z.object({
        memoryText: z.string(),
        importanceScore: z.number().int().default(0),
        createdAt: z.string().nullable(),
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        kind: z.string().min(1),
        title: z.string().min(1),
        url: z.string().nullable().default(null),
        archiveEntryPath: z.string().nullable().default(null),
        safeBasename: z.string().nullable().default(null),
        mimeType: z.string().nullable().default(null),
        sizeBytes: z.number().int().nonnegative().default(0),
        createdAt: z.string().nullable(),
      }),
    )
    .default([]),
  sourceChunks: z
    .array(
      z.object({
        id: z.string().min(1),
        sourceId: z.string().min(1),
        chunkIndex: z.number().int(),
        text: z.string(),
      }),
    )
    .default([]),
});

export type KitBackupUserdataV1 = z.infer<typeof KitBackupUserdataV1Schema>;

export async function exportKitBackupZip(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): Promise<{ filename: string; buffer: Buffer }> {
  const { skeleton } = exportKitMode1(db, scope, slugOrId, {
    includeGuideNotes: false,
  });
  const kit = getOwnedKit(db, scope, slugOrId);

  const guideRows = db
    .prepare(
      `SELECT pillar_id, topic_id, section_id, content, committed_at
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ?`,
    )
    .all(scope.ownerId, kit.id) as Array<{
    pillar_id: string;
    topic_id: string;
    section_id: string;
    content: string;
    committed_at: string | null;
  }>;

  const starterRows = db
    .prepare(
      `SELECT pillar_id, topic_id, suggestions, content_hash, updated_at
       FROM chat_starters
       WHERE ownerId = ? AND kit_id = ?`,
    )
    .all(scope.ownerId, kit.id) as Array<{
    pillar_id: string;
    topic_id: string;
    suggestions: string;
    content_hash: string;
    updated_at: string | null;
  }>;

  const deckRows = db
    .prepare("SELECT * FROM decks WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC")
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const cardRows = db
    .prepare(
      `SELECT f.*
       FROM flashcards f
       JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
       WHERE f.ownerId = ? AND d.kit_id = ?
       ORDER BY f.position ASC, f.created_at ASC`,
    )
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const remediationRows = db
    .prepare(
      `SELECT card_id, source_card_id, node_id, node_name, reason, created_at, resolved_at
       FROM remediation_queue
       WHERE ownerId = ? AND kit_id = ?
       ORDER BY id ASC`,
    )
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const drillRows = db
    .prepare("SELECT * FROM drills WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC")
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const attemptRows = db
    .prepare(
      `SELECT da.*
       FROM drill_attempts da
       JOIN drills dr ON dr.ownerId = da.ownerId AND dr.id = da.drill_id
       WHERE da.ownerId = ? AND dr.kit_id = ?
       ORDER BY da.created_at ASC`,
    )
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const boardRows = db
    .prepare("SELECT * FROM boards WHERE ownerId = ? AND kit_id = ? ORDER BY position ASC")
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const sessionRows = db
    .prepare("SELECT * FROM chat_sessions WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC")
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const memoryRows = db
    .prepare(
      "SELECT memory_text, importance_score, created_at FROM episodic_memory WHERE ownerId = ? AND kit_id = ? ORDER BY id ASC",
    )
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const sourceRows = db
    .prepare("SELECT * FROM kit_sources WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC")
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const chunkRows = db
    .prepare(
      "SELECT id, source_id, chunk_index, text FROM kit_source_chunks WHERE ownerId = ? AND kit_id = ? ORDER BY source_id ASC, chunk_index ASC",
    )
    .all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const kitRoot = kitUploadsDir(scope.ownerId, kit.id);
  const fileEntries: ZipCreateEntry[] = [];
  const exportedSources: KitBackupUserdataV1["sources"] = [];

  for (const s of sourceRows) {
    const sourceId = String(s.id);
    const rawFilePath =
      typeof s.file_path === "string" && s.file_path.trim()
        ? s.file_path.trim()
        : null;
    let archiveEntryPath: string | null = null;
    let safeBase: string | null = null;
    let sizeBytes = Number(s.size_bytes ?? 0);

    if (rawFilePath && SAFE_ID_RE.test(sourceId)) {
      const resolved = path.resolve(kitRoot, rawFilePath);
      if (resolved.startsWith(kitRoot + path.sep) && fs.existsSync(resolved)) {
        const stat = fs.lstatSync(resolved);
        if (stat.isFile() && !stat.isSymbolicLink()) {
          safeBase = sanitizeBasename(path.basename(resolved));
          archiveEntryPath = `files/${sourceId}/${safeBase}`;
          const buf = fs.readFileSync(resolved);
          sizeBytes = buf.byteLength;
          fileEntries.push({
            name: archiveEntryPath,
            data: buf,
          });
        }
      }
    }

    exportedSources.push({
      id: sourceId,
      kind: String(s.kind ?? "file"),
      title: String(s.title ?? "Untitled Source"),
      url: (s.url as string | null) ?? null,
      archiveEntryPath,
      safeBasename: safeBase,
      mimeType: (s.mime_type as string | null) ?? null,
      sizeBytes,
      createdAt: (s.created_at as string | null) ?? null,
    });
  }

  const userdata: KitBackupUserdataV1 = KitBackupUserdataV1Schema.parse({
    format: "toolbox-kit-userdata",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    originalKitId: kit.id,
    guideContent: guideRows.map((r) => ({
      pillarId: r.pillar_id,
      topicId: r.topic_id,
      sectionId: r.section_id,
      content: r.content ?? "",
      committedAt: r.committed_at ?? null,
    })),
    chatStarters: starterRows.map((r) => ({
      pillarId: r.pillar_id,
      topicId: r.topic_id,
      suggestions: r.suggestions ?? "[]",
      contentHash: r.content_hash ?? "",
      updatedAt: r.updated_at ?? null,
    })),
    decks: deckRows.map((d) => ({
      id: String(d.id),
      name: String(d.name ?? "Untitled Deck"),
      description: String(d.description ?? ""),
      colorIndex: Number(d.color_index ?? 0),
      tags: String(d.tags ?? ""),
      settings: String(d.settings ?? "{}"),
      createdAt: (d.created_at as string | null) ?? null,
      updatedAt: (d.updated_at as string | null) ?? null,
    })),
    flashcards: cardRows.map((c) => ({
      id: String(c.id),
      deckId: String(c.deck_id),
      nodeId: (c.node_id as string | null) ?? null,
      front: String(c.front ?? ""),
      back: String(c.back ?? ""),
      position: Number(c.position ?? 0),
      easeFactor: c.ease_factor !== null && c.ease_factor !== undefined ? Number(c.ease_factor) : 2.5,
      interval: Number(c.interval ?? 0),
      repetitions: Number(c.repetitions ?? 0),
      nextReview: (c.next_review as string | null) ?? null,
      lastReviewed: (c.last_reviewed as string | null) ?? null,
      state: Number(c.state ?? 0),
      learningStep: Number(c.learning_step ?? 0),
      prerequisiteId: (c.prerequisite_id as string | null) ?? null,
      sourcePillarId: (c.source_pillar_id as string | null) ?? null,
      sourceTopicId: (c.source_topic_id as string | null) ?? null,
      sourceSectionId: (c.source_section_id as string | null) ?? null,
      isReverse: Number(c.is_reverse ?? 0),
      reverseOfId: (c.reverse_of_id as string | null) ?? null,
      seedKey: (c.seed_key as string | null) ?? null,
      stability:
        c.stability !== null && c.stability !== undefined
          ? Number(c.stability)
          : null,
      difficulty:
        c.difficulty !== null && c.difficulty !== undefined
          ? Number(c.difficulty)
          : null,
      lapses: Number(c.lapses ?? 0),
      createdAt: (c.created_at as string | null) ?? null,
      updatedAt: (c.updated_at as string | null) ?? null,
    })),
    remediationQueue: remediationRows.map((r) => ({
      cardId: String(r.card_id),
      sourceCardId: String(r.source_card_id ?? ""),
      nodeId: (r.node_id as string | null) ?? null,
      nodeName: (r.node_name as string | null) ?? null,
      reason: String(r.reason ?? ""),
      createdAt: (r.created_at as string | null) ?? null,
      resolvedAt: (r.resolved_at as string | null) ?? null,
    })),
    drills: drillRows.map((d) => ({
      id: String(d.id),
      nodeId: String(d.node_id),
      difficulty: Number(d.difficulty ?? 1),
      prompt: String(d.prompt ?? ""),
      hintsJson: String(d.hints_json ?? "[]"),
      workedSolution: String(d.worked_solution ?? ""),
      rubricJson: String(d.rubric_json ?? "[]"),
      seedKey: (d.seed_key as string | null) ?? null,
      createdAt: (d.created_at as string | null) ?? null,
    })),
    drillAttempts: attemptRows.map((a) => ({
      id: String(a.id),
      drillId: String(a.drill_id),
      submission: String(a.submission ?? ""),
      score: a.score !== null && a.score !== undefined ? Number(a.score) : null,
      feedbackJson: String(a.feedback_json ?? "{}"),
      createdAt: (a.created_at as string | null) ?? null,
    })),
    boards: boardRows.map((b) => ({
      id: String(b.id),
      name: String(b.name ?? "Untitled Board"),
      data: String(b.data ?? "{}"),
      position: Number(b.position ?? 0),
      createdAt: (b.created_at as string | null) ?? null,
      updatedAt: (b.updated_at as string | null) ?? null,
    })),
    chatSessions: sessionRows.map((s) => ({
      id: String(s.id),
      name: String(s.name ?? "Session"),
      persona: String(s.persona ?? "socratic"),
      messages: String(s.messages ?? "[]"),
      pillarId: (s.pillar_id as string | null) ?? null,
      topicId: (s.topic_id as string | null) ?? null,
      topicName: (s.topic_name as string | null) ?? null,
      createdAt: (s.created_at as string | null) ?? null,
      updatedAt: (s.updated_at as string | null) ?? null,
    })),
    episodicMemories: memoryRows.map((m) => ({
      memoryText: String(m.memory_text ?? ""),
      importanceScore: Number(m.importance_score ?? 0),
      createdAt: (m.created_at as string | null) ?? null,
    })),
    sources: exportedSources,
    sourceChunks: chunkRows.map((ch) => ({
      id: String(ch.id),
      sourceId: String(ch.source_id),
      chunkIndex: Number(ch.chunk_index ?? 0),
      text: String(ch.text ?? ""),
    })),
  });

  const zipBuffer = await createZipArchive([
    {
      name: "kit.json",
      data: Buffer.from(JSON.stringify(skeleton, null, 2), "utf8"),
      compress: true,
    },
    {
      name: "userdata.json",
      data: Buffer.from(JSON.stringify(userdata, null, 2), "utf8"),
      compress: true,
    },
    ...fileEntries,
  ]);

  return {
    filename: `${kit.slug}.toolbox-backup.zip`,
    buffer: zipBuffer,
  };
}

function isAllowedBackupEntryPath(name: string): boolean {
  if (name === "kit.json" || name === "userdata.json") return true;
  const parts = name.split("/");
  if (parts.length !== 3 || parts[0] !== "files") return false;
  return SAFE_ID_RE.test(parts[1]) && SAFE_BASENAME_RE.test(parts[2]);
}

export async function importKitBackupZip(
  db: Database.Database,
  scope: Scope,
  zipBuf: Buffer,
  opts: { onCollision?: ImportCollisionPolicy } = {},
): Promise<Mode1ImportResult> {
  const entries = await extractZipArchive(zipBuf, {
    allowedPath: isAllowedBackupEntryPath,
    maxEntryBytes: (name) =>
      name === "kit.json" || name === "userdata.json"
        ? MAX_JSON_ENTRY_BYTES
        : MAX_BINARY_ENTRY_BYTES,
  });

  const kitRawBuf = entries.get("kit.json");
  const userdataRawBuf = entries.get("userdata.json");
  if (!kitRawBuf || !userdataRawBuf) {
    throw new BadRequestError(
      "Backup archive must contain both kit.json and userdata.json",
    );
  }

  let parsedKitJson: unknown;
  let parsedUserdataJson: unknown;
  try {
    parsedKitJson = JSON.parse(kitRawBuf.toString("utf8"));
    parsedUserdataJson = JSON.parse(userdataRawBuf.toString("utf8"));
  } catch {
    throw new BadRequestError("Malformed JSON in backup archive");
  }

  const verifiedSkeleton = validateAndVerifySkeleton(parsedKitJson);
  const userdataParse = KitBackupUserdataV1Schema.safeParse(parsedUserdataJson);
  if (!userdataParse.success) {
    throw new ValidationError(
      userdataParse.error.issues[0]?.message ?? "Invalid userdata.json schema",
      userdataParse.error.issues,
    );
  }
  const userdata = userdataParse.data;

  // Verify closed allowlist: every binary file entry must match a declared source in userdata.sources
  const declaredEntries = new Map<
    string,
    { oldSourceId: string; safeBasename: string }
  >();
  for (const s of userdata.sources) {
    if (!SAFE_ID_RE.test(s.id)) {
      throw new BadRequestError(`Invalid source ID in userdata.json: ${s.id}`);
    }
    if (s.archiveEntryPath !== null) {
      const base = s.safeBasename ?? "";
      if (
        !SAFE_BASENAME_RE.test(base) ||
        s.archiveEntryPath !== `files/${s.id}/${base}`
      ) {
        throw new BadRequestError(
          `Invalid archiveEntryPath in userdata.json: ${s.archiveEntryPath}`,
        );
      }
      if (!entries.has(s.archiveEntryPath)) {
        throw new BadRequestError(
          `Declared source file missing from archive: ${s.archiveEntryPath}`,
        );
      }
      declaredEntries.set(s.archiveEntryPath, {
        oldSourceId: s.id,
        safeBasename: base,
      });
    }
  }

  for (const entryName of entries.keys()) {
    if (entryName === "kit.json" || entryName === "userdata.json") continue;
    if (!declaredEntries.has(entryName)) {
      throw new BadRequestError(
        `Undeclared file entry in backup archive: ${entryName}`,
      );
    }
  }

  const onCollision = opts.onCollision ?? "error";
  const baseSlug = verifiedSkeleton.identity.slug;
  const existing = db
    .prepare("SELECT id, slug FROM kits WHERE ownerId = ? AND slug = ?")
    .get(scope.ownerId, baseSlug) as { id: string; slug: string } | undefined;

  if (existing) {
    if (onCollision === "error") {
      throwSlugConflict(existing.id, baseSlug);
    }
    if (onCollision === "update") {
      const synced = syncKitStructure(db, scope, existing.id, verifiedSkeleton);
      const { kit, ...syncStats } = synced;
      return { kit, mode: "updated", syncStats };
    }
  }

  let targetSlug = baseSlug;
  let mode: Mode1ImportResult["mode"] = "created";
  if (existing && onCollision === "copy") {
    targetSlug = mintUniqueKitSlug(db, scope, baseSlug);
    mode = "copied";
  } else if (existing && onCollision === "replace") {
    mode = "replaced";
  }

  // Mint fresh UUIDs for 100% of entities and internal FKs
  const newKitId = crypto.randomUUID();
  const deckIdMap = new Map<string, string>();
  for (const d of userdata.decks) deckIdMap.set(d.id, crypto.randomUUID());

  const cardIdMap = new Map<string, string>();
  for (const c of userdata.flashcards) {
    if (deckIdMap.has(c.deckId)) {
      cardIdMap.set(c.id, crypto.randomUUID());
    }
  }

  const drillIdMap = new Map<string, string>();
  for (const dr of userdata.drills) drillIdMap.set(dr.id, crypto.randomUUID());

  const boardIdMap = new Map<string, string>();
  for (const b of userdata.boards) boardIdMap.set(b.id, crypto.randomUUID());

  const sessionIdMap = new Map<string, string>();
  for (const s of userdata.chatSessions) {
    sessionIdMap.set(s.id, crypto.randomUUID());
  }

  const sourceIdMap = new Map<string, string>();
  for (const s of userdata.sources) sourceIdMap.set(s.id, crypto.randomUUID());

  const ownerKitsBase = kitsUploadsBaseDir(scope.ownerId);
  const stagingDir = path.resolve(
    ownerKitsBase,
    `.staging-${crypto.randomUUID()}`,
  );
  const finalKitDir = kitUploadsDir(scope.ownerId, newKitId);
  const hasBinaryFiles = declaredEntries.size > 0;

  try {
    if (hasBinaryFiles) {
      fs.mkdirSync(stagingDir, { recursive: true });
      for (const [archivePath, info] of declaredEntries.entries()) {
        const newSourceId = sourceIdMap.get(info.oldSourceId)!;
        const targetSubdir = path.resolve(stagingDir, newSourceId);
        const targetFile = path.resolve(targetSubdir, info.safeBasename);
        if (!targetFile.startsWith(stagingDir + path.sep)) {
          throw new BadRequestError("Unsafe staged file target path");
        }
        fs.mkdirSync(targetSubdir, { recursive: true });
        fs.writeFileSync(targetFile, entries.get(archivePath)!);
      }
    }

    const storedSkeleton: KitSkeletonV1 = {
      ...verifiedSkeleton,
      identity: { ...verifiedSkeleton.identity, slug: targetSlug },
    };

    const runImportTx = db.transaction(() => {
      if (existing && onCollision === "replace") {
        db.prepare(
          "DELETE FROM rag_chunks_fts WHERE ownerTok = ? AND kitTok = ?",
        ).run(ownerTokFor(scope.ownerId), kitTokFor(existing.id));
        db.prepare(
          "DELETE FROM rag_chunks WHERE ownerId = ? AND kit_id = ?",
        ).run(scope.ownerId, existing.id);
        db.prepare("DELETE FROM kits WHERE ownerId = ? AND id = ?").run(
          scope.ownerId,
          existing.id,
        );
      }

      db.prepare(
        `INSERT INTO kits (
           id, ownerId, slug, name, description, icon, color, status,
           skeleton_json, forked_from_shared_id, forked_version,
           created_at, updated_at, last_opened_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, NULL, ?, datetime('now'), datetime('now'), datetime('now'))`,
      ).run(
        newKitId,
        scope.ownerId,
        targetSlug,
        storedSkeleton.identity.name,
        storedSkeleton.identity.description,
        storedSkeleton.identity.icon,
        storedSkeleton.identity.color,
        JSON.stringify(storedSkeleton),
        storedSkeleton.identity.version,
      );

      const insGuide = db.prepare(
        `INSERT INTO guide_content (
           ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
         ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id) DO UPDATE SET
           content = excluded.content,
           committed_at = excluded.committed_at`,
      );
      for (const g of userdata.guideContent) {
        insGuide.run(
          scope.ownerId,
          newKitId,
          g.pillarId,
          g.topicId,
          g.sectionId,
          g.content,
          g.committedAt,
        );
      }

      const insStarter = db.prepare(
        `INSERT INTO chat_starters (
           ownerId, kit_id, pillar_id, topic_id, suggestions, content_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
         ON CONFLICT(ownerId, kit_id, pillar_id, topic_id) DO UPDATE SET
           suggestions = excluded.suggestions,
           content_hash = excluded.content_hash,
           updated_at = excluded.updated_at`,
      );
      for (const cs of userdata.chatStarters) {
        insStarter.run(
          scope.ownerId,
          newKitId,
          cs.pillarId,
          cs.topicId,
          cs.suggestions,
          cs.contentHash,
          cs.updatedAt,
        );
      }

      const insDeck = db.prepare(
        `INSERT INTO decks (
           id, ownerId, kit_id, name, description, color_index, tags, settings, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
      );
      for (const d of userdata.decks) {
        insDeck.run(
          deckIdMap.get(d.id)!,
          scope.ownerId,
          newKitId,
          d.name,
          d.description,
          d.colorIndex,
          d.tags,
          d.settings,
          d.createdAt,
          d.updatedAt,
        );
      }

      const insCard = db.prepare(
        `INSERT INTO flashcards (
           id, ownerId, deck_id, node_id, front, back, position,
           ease_factor, interval, repetitions, next_review, last_reviewed,
           state, learning_step, prerequisite_id,
           source_pillar_id, source_topic_id, source_section_id,
           is_reverse, reverse_of_id, seed_key, stability, difficulty, lapses,
           created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
      );

      for (const c of userdata.flashcards) {
        const newCardId = cardIdMap.get(c.id);
        const newDeckId = deckIdMap.get(c.deckId);
        if (!newCardId || !newDeckId) continue;

        insCard.run(
          newCardId,
          scope.ownerId,
          newDeckId,
          c.nodeId,
          c.front,
          c.back,
          c.position,
          c.easeFactor,
          c.interval,
          c.repetitions,
          c.nextReview,
          c.lastReviewed,
          c.state,
          c.learningStep,
          c.sourcePillarId,
          c.sourceTopicId,
          c.sourceSectionId,
          c.isReverse,
          c.seedKey,
          c.stability,
          c.difficulty,
          c.lapses,
          c.createdAt,
          c.updatedAt,
        );
      }

      // Second pass for card self-references (prerequisite_id + reverse_of_id)
      const updCardRefs = db.prepare(
        "UPDATE flashcards SET prerequisite_id = ?, reverse_of_id = ? WHERE ownerId = ? AND id = ?",
      );
      for (const c of userdata.flashcards) {
        const newCardId = cardIdMap.get(c.id);
        if (!newCardId) continue;
        const mappedPrereq = c.prerequisiteId
          ? (cardIdMap.get(c.prerequisiteId) ?? null)
          : null;
        const mappedReverse = c.reverseOfId
          ? (cardIdMap.get(c.reverseOfId) ?? null)
          : null;
        const safePrereq = mappedPrereq !== newCardId ? mappedPrereq : null;
        const safeReverse = mappedReverse !== newCardId ? mappedReverse : null;
        if (safePrereq || safeReverse) {
          updCardRefs.run(safePrereq, safeReverse, scope.ownerId, newCardId);
        }
      }

      const insRem = db.prepare(
        `INSERT INTO remediation_queue (
           ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason, created_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?)`,
      );
      for (const r of userdata.remediationQueue) {
        const mappedCardId = cardIdMap.get(r.cardId);
        if (!mappedCardId) continue;
        const mappedSourceCardId = r.sourceCardId
          ? (cardIdMap.get(r.sourceCardId) ?? r.sourceCardId)
          : "";
        insRem.run(
          scope.ownerId,
          newKitId,
          mappedCardId,
          mappedSourceCardId,
          r.nodeId,
          r.nodeName,
          r.reason,
          r.createdAt,
          r.resolvedAt,
        );
      }

      const insDrill = db.prepare(
        `INSERT INTO drills (
           id, ownerId, kit_id, node_id, difficulty, prompt,
           hints_json, worked_solution, rubric_json, seed_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      );
      for (const dr of userdata.drills) {
        insDrill.run(
          drillIdMap.get(dr.id)!,
          scope.ownerId,
          newKitId,
          dr.nodeId,
          dr.difficulty,
          dr.prompt,
          dr.hintsJson,
          dr.workedSolution,
          dr.rubricJson,
          dr.seedKey,
          dr.createdAt,
        );
      }

      const insAttempt = db.prepare(
        `INSERT INTO drill_attempts (
           id, ownerId, drill_id, submission, score, feedback_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      );
      for (const a of userdata.drillAttempts) {
        const mappedDrillId = drillIdMap.get(a.drillId);
        if (!mappedDrillId) continue;
        insAttempt.run(
          crypto.randomUUID(),
          scope.ownerId,
          mappedDrillId,
          a.submission,
          a.score,
          a.feedbackJson,
          a.createdAt,
        );
      }

      const insBoard = db.prepare(
        `INSERT INTO boards (
           id, ownerId, kit_id, name, data, position, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
      );
      for (const b of userdata.boards) {
        insBoard.run(
          boardIdMap.get(b.id)!,
          scope.ownerId,
          newKitId,
          b.name,
          b.data,
          b.position,
          b.createdAt,
          b.updatedAt,
        );
      }

      const insSession = db.prepare(
        `INSERT INTO chat_sessions (
           id, ownerId, kit_id, name, persona, messages, pillar_id, topic_id, topic_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
      );
      for (const s of userdata.chatSessions) {
        insSession.run(
          sessionIdMap.get(s.id)!,
          scope.ownerId,
          newKitId,
          s.name,
          s.persona,
          s.messages,
          s.pillarId,
          s.topicId,
          s.topicName,
          s.createdAt,
          s.updatedAt,
        );
      }

      const insMemory = db.prepare(
        `INSERT INTO episodic_memory (
           ownerId, kit_id, memory_text, importance_score, created_at
         ) VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      );
      for (const m of userdata.episodicMemories) {
        insMemory.run(
          scope.ownerId,
          newKitId,
          m.memoryText,
          m.importanceScore,
          m.createdAt,
        );
      }

      const insSource = db.prepare(
        `INSERT INTO kit_sources (
           id, ownerId, kit_id, kind, title, url, file_path, mime_type, size_bytes, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
      );
      for (const s of userdata.sources) {
        const newSourceId = sourceIdMap.get(s.id)!;
        const hasStagedFile =
          s.archiveEntryPath !== null && declaredEntries.has(s.archiveEntryPath);
        const relFilePath =
          hasStagedFile && s.safeBasename
            ? `${newSourceId}/${s.safeBasename}`
            : null;
        const actualSize =
          hasStagedFile && s.archiveEntryPath
            ? (entries.get(s.archiveEntryPath)?.byteLength ?? s.sizeBytes)
            : s.sizeBytes;

        insSource.run(
          newSourceId,
          scope.ownerId,
          newKitId,
          s.kind,
          s.title,
          s.url,
          relFilePath,
          s.mimeType,
          actualSize,
          s.createdAt,
        );
      }

      const insChunk = db.prepare(
        `INSERT INTO kit_source_chunks (
           id, ownerId, kit_id, source_id, chunk_index, text
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const ch of userdata.sourceChunks) {
        const newSourceId = sourceIdMap.get(ch.sourceId);
        if (!newSourceId) continue;
        insChunk.run(
          crypto.randomUUID(),
          scope.ownerId,
          newKitId,
          newSourceId,
          ch.chunkIndex,
          ch.text,
        );
      }
    });

    runImportTx();

    if (hasBinaryFiles) {
      fs.mkdirSync(path.dirname(finalKitDir), { recursive: true });
      fs.renameSync(stagingDir, finalKitDir);
    }

    if (existing && onCollision === "replace") {
      fs.rmSync(kitUploadsDir(scope.ownerId, existing.id), {
        recursive: true,
        force: true,
      });
    }
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }

  return { kit: getOwnedKit(db, scope, newKitId), mode };
}
