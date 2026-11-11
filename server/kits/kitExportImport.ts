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
import { AppError, ValidationError } from "../platform/net/errors.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import { deleteRagChunksForKit } from "../search/hybridSearch.ts";
import {
  getOwnedKit,
  kitsUploadsBaseDir,
  kitUploadsDir,
  mintUniqueKitSlug,
  requireRawOwnedKit,
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

export interface Mode1ImportResult {
  kit: OwnedKitDetail;
  mode: "created" | "copied" | "replaced" | "updated";
  syncStats?: Omit<KitSyncResult, "kit">;
}

function resolveImportCollision(
  db: Database.Database,
  scope: Scope,
  verified: KitSkeletonV1,
  onCollision: ImportCollisionPolicy,
):
  | { synced: Mode1ImportResult }
  | {
      synced?: undefined;
      existingId: string | null;
      targetSlug: string;
      mode: Mode1ImportResult["mode"];
      storedSkeleton: KitSkeletonV1;
      newKitId: string;
    } {
  const baseSlug = verified.identity.slug;
  const existing = db
    .prepare("SELECT id, slug FROM kits WHERE ownerId = ? AND slug = ?")
    .get(scope.ownerId, baseSlug) as { id: string; slug: string } | undefined;

  if (existing) {
    if (onCollision === "error") throwSlugConflict(existing.id, baseSlug);
    if (onCollision === "update") {
      const { kit, ...syncStats } = syncKitStructure(db, scope, existing.id, verified);
      return { synced: { kit, mode: "updated", syncStats } };
    }
  }

  const targetSlug =
    existing && onCollision === "copy" ? mintUniqueKitSlug(db, scope, baseSlug) : baseSlug;
  const mode: Mode1ImportResult["mode"] = !existing
    ? "created"
    : onCollision === "copy"
      ? "copied"
      : "replaced";

  return {
    existingId: existing ? existing.id : null,
    targetSlug,
    mode,
    storedSkeleton: { ...verified, identity: { ...verified.identity, slug: targetSlug } },
    newKitId: crypto.randomUUID(),
  };
}

function replaceAndInsertKitRow(
  db: Database.Database,
  scope: Scope,
  newKitId: string,
  targetSlug: string,
  storedSkeleton: KitSkeletonV1,
  replaceKitId: string | null,
): void {
  if (replaceKitId) {
    deleteRagChunksForKit(db, scope, replaceKitId);
    db.prepare("DELETE FROM kits WHERE ownerId = ? AND id = ?").run(scope.ownerId, replaceKitId);
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
  const row = requireRawOwnedKit(db, scope, slugOrId);
  const skeleton = snapshotSkeletonFromOwnedKit(db, scope, row, {
    includeGuideNotes: Boolean(opts.includeGuideNotes),
  });
  return { filename: `${skeleton.identity.slug}.toolbox-kit.json`, skeleton };
}

export function importKitMode1(
  db: Database.Database,
  scope: Scope,
  rawSkeleton: unknown,
  opts: { onCollision?: ImportCollisionPolicy } = {},
): Mode1ImportResult {
  const verified = validateAndVerifySkeleton(rawSkeleton);
  const onCollision = opts.onCollision ?? "error";
  const resolved = resolveImportCollision(db, scope, verified, onCollision);
  if (resolved.synced) return resolved.synced;

  const { existingId, targetSlug, mode, storedSkeleton, newKitId } = resolved;
  const replaceKitId = existingId && onCollision === "replace" ? existingId : null;

  db.transaction(() => {
    replaceAndInsertKitRow(db, scope, newKitId, targetSlug, storedSkeleton, replaceKitId);
    seedKitStarterContent(db, scope, newKitId, storedSkeleton);
  })();

  if (replaceKitId) {
    fs.rmSync(kitUploadsDir(scope.ownerId, replaceKitId), { recursive: true, force: true });
  }
  return { kit: getOwnedKit(db, scope, newKitId), mode };
}

/* ════════════════════════════════════════════════════════════════
   Mode 2: Full Personal Backup (.toolbox-backup.zip)
   ════════════════════════════════════════════════════════════════ */

const idStr = z.string().min(1);
const nullStr = z.string().nullable().default(null);
const tsStr = z.string().nullable();

export const KitBackupUserdataV1Schema = z.object({
  format: z.literal("toolbox-kit-userdata"),
  schemaVersion: z.literal(1),
  exportedAt: z.iso.datetime(),
  originalKitId: idStr,
  guideContent: z
    .array(
      z.object({
        pillarId: idStr,
        topicId: idStr,
        sectionId: idStr,
        content: z.string(),
        committedAt: tsStr,
      }),
    )
    .default([]),
  guideDogears: z
    .array(
      z.object({
        pillarId: idStr,
        topicId: idStr,
        sectionId: z.string().max(200).default(""),
        createdAt: tsStr,
      }),
    )
    .default([]),
  guideHighlights: z
    .array(
      z.object({
        id: idStr,
        pillarId: idStr,
        topicId: idStr,
        sectionId: idStr,
        quote: z.string().min(1).max(2000),
        prefix: z.string().max(160).default(""),
        suffix: z.string().max(160).default(""),
        color: z.enum(["amber", "sage", "coral"]).default("amber"),
        note: z.string().max(500).default(""),
        cardId: nullStr,
        createdAt: tsStr,
        updatedAt: tsStr,
      }),
    )
    .default([]),
  lastGuideRef: z.string().max(2000).nullable().default(null),
  chatStarters: z
    .array(
      z.object({
        pillarId: idStr,
        topicId: idStr,
        suggestions: z.string(),
        contentHash: z.string(),
        updatedAt: tsStr,
      }),
    )
    .default([]),
  decks: z
    .array(
      z.object({
        id: idStr,
        name: idStr,
        description: z.string().default(""),
        colorIndex: z.number().int().default(0),
        tags: z.string().default(""),
        settings: z.string().default("{}"),
        createdAt: tsStr,
        updatedAt: tsStr,
      }),
    )
    .default([]),
  flashcards: z
    .array(
      z.object({
        id: idStr,
        deckId: idStr,
        nodeId: nullStr,
        front: z.string(),
        back: z.string(),
        position: z.number().int().default(0),
        easeFactor: z.number().default(2.5),
        interval: z.number().int().default(0),
        repetitions: z.number().int().default(0),
        nextReview: nullStr,
        lastReviewed: nullStr,
        state: z.number().int().default(0),
        learningStep: z.number().int().default(0),
        prerequisiteId: nullStr,
        sourcePillarId: nullStr,
        sourceTopicId: nullStr,
        sourceSectionId: nullStr,
        isReverse: z.number().int().default(0),
        reverseOfId: nullStr,
        seedKey: nullStr,
        stability: z.number().nullable().default(null),
        difficulty: z.number().nullable().default(null),
        lapses: z.number().int().default(0),
        createdAt: tsStr,
        updatedAt: tsStr,
      }),
    )
    .default([]),
  remediationQueue: z
    .array(
      z.object({
        cardId: idStr,
        sourceCardId: z.string(),
        nodeId: nullStr,
        nodeName: nullStr,
        reason: z.string().default(""),
        createdAt: tsStr,
        resolvedAt: nullStr,
      }),
    )
    .default([]),
  drills: z
    .array(
      z.object({
        id: idStr,
        nodeId: idStr,
        difficulty: z.number().int(),
        prompt: idStr,
        hintsJson: z.string().default("[]"),
        workedSolution: z.string().default(""),
        rubricJson: z.string().default("[]"),
        seedKey: nullStr,
        createdAt: tsStr,
      }),
    )
    .default([]),
  drillAttempts: z
    .array(
      z.object({
        id: idStr,
        drillId: idStr,
        submission: z.string(),
        score: z.number().nullable().default(null),
        feedbackJson: z.string().default("{}"),
        createdAt: tsStr,
      }),
    )
    .default([]),
  boards: z
    .array(
      z.object({
        id: idStr,
        name: idStr,
        data: z.string().default("{}"),
        position: z.number().int().default(0),
        createdAt: tsStr,
        updatedAt: tsStr,
      }),
    )
    .default([]),
  chatSessions: z
    .array(
      z.object({
        id: idStr,
        name: idStr,
        persona: z.string().default("socratic"),
        messages: z.string().default("[]"),
        pillarId: nullStr,
        topicId: nullStr,
        topicName: nullStr,
        createdAt: tsStr,
        updatedAt: tsStr,
      }),
    )
    .default([]),
  episodicMemories: z
    .array(
      z.object({
        memoryText: z.string(),
        importanceScore: z.number().int().default(0),
        createdAt: tsStr,
      }),
    )
    .default([]),
  sources: z
    .array(
      z.object({
        id: idStr,
        kind: idStr,
        title: idStr,
        url: nullStr,
        archiveEntryPath: nullStr,
        safeBasename: nullStr,
        mimeType: nullStr,
        sizeBytes: z.number().int().nonnegative().default(0),
        createdAt: tsStr,
      }),
    )
    .default([]),
  sourceChunks: z
    .array(
      z.object({
        id: idStr,
        sourceId: idStr,
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
  const { skeleton } = exportKitMode1(db, scope, slugOrId, { includeGuideNotes: false });
  const kit = getOwnedKit(db, scope, slugOrId);

  const allKitRows = (sql: string) =>
    db.prepare(sql).all(scope.ownerId, kit.id) as Array<Record<string, unknown>>;

  const guideRows = allKitRows(
    "SELECT pillar_id, topic_id, section_id, content, committed_at FROM guide_content WHERE ownerId = ? AND kit_id = ?",
  );
  const dogearRows = allKitRows(
    "SELECT pillar_id, topic_id, section_id, created_at FROM guide_dogears WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC",
  );
  const highlightRows = allKitRows(
    `SELECT id, pillar_id, topic_id, section_id, quote, prefix, suffix, color, note, card_id, created_at, updated_at
     FROM guide_highlights WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC`,
  );
  const kitMetaRow = db
    .prepare("SELECT last_guide_ref FROM kits WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, kit.id) as { last_guide_ref?: string | null } | undefined;
  const starterRows = allKitRows(
    "SELECT pillar_id, topic_id, suggestions, content_hash, updated_at FROM chat_starters WHERE ownerId = ? AND kit_id = ?",
  );
  const deckRows = allKitRows(
    "SELECT * FROM decks WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC",
  );
  const cardRows = allKitRows(
    `SELECT f.* FROM flashcards f
     JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
     WHERE f.ownerId = ? AND d.kit_id = ?
     ORDER BY f.position ASC, f.created_at ASC`,
  );
  const remediationRows = allKitRows(
    `SELECT card_id, source_card_id, node_id, node_name, reason, created_at, resolved_at
     FROM remediation_queue WHERE ownerId = ? AND kit_id = ? ORDER BY id ASC`,
  );
  const drillRows = allKitRows(
    "SELECT * FROM drills WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC",
  );
  const attemptRows = allKitRows(
    `SELECT da.* FROM drill_attempts da
     JOIN drills dr ON dr.ownerId = da.ownerId AND dr.id = da.drill_id
     WHERE da.ownerId = ? AND dr.kit_id = ? ORDER BY da.created_at ASC`,
  );
  const boardRows = allKitRows(
    "SELECT * FROM boards WHERE ownerId = ? AND kit_id = ? ORDER BY position ASC",
  );
  const sessionRows = allKitRows(
    "SELECT * FROM chat_sessions WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC",
  );
  const memoryRows = allKitRows(
    "SELECT memory_text, importance_score, created_at FROM episodic_memory WHERE ownerId = ? AND kit_id = ? ORDER BY id ASC",
  );
  const sourceRows = allKitRows(
    "SELECT * FROM kit_sources WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC",
  );
  const chunkRows = allKitRows(
    "SELECT id, source_id, chunk_index, text FROM kit_source_chunks WHERE ownerId = ? AND kit_id = ? ORDER BY source_id ASC, chunk_index ASC",
  );

  const s = (v: unknown, fb = "") => String(v ?? fb);
  const n = (v: unknown, fb = 0) => Number(v ?? fb);
  const ns = (v: unknown) => (v as string | null) ?? null;
  const nn = (v: unknown) => (v !== null && v !== undefined ? Number(v) : null);

  const kitRoot = kitUploadsDir(scope.ownerId, kit.id);
  const fileEntries: ZipCreateEntry[] = [];
  const exportedSources: KitBackupUserdataV1["sources"] = [];

  for (const row of sourceRows) {
    const sourceId = s(row.id);
    const rawFilePath =
      typeof row.file_path === "string" && row.file_path.trim() ? row.file_path.trim() : null;
    let archiveEntryPath: string | null = null;
    let safeBase: string | null = null;
    let sizeBytes = n(row.size_bytes);

    if (rawFilePath && SAFE_ID_RE.test(sourceId)) {
      const resolved = path.resolve(kitRoot, rawFilePath);
      if (resolved.startsWith(kitRoot + path.sep) && fs.existsSync(resolved)) {
        const stat = fs.lstatSync(resolved);
        if (stat.isFile() && !stat.isSymbolicLink()) {
          safeBase = sanitizeBasename(path.basename(resolved));
          archiveEntryPath = `files/${sourceId}/${safeBase}`;
          const buf = fs.readFileSync(resolved);
          sizeBytes = buf.byteLength;
          fileEntries.push({ name: archiveEntryPath, data: buf });
        }
      }
    }

    exportedSources.push({
      id: sourceId,
      kind: s(row.kind, "file"),
      title: s(row.title, "Untitled Source"),
      url: ns(row.url),
      archiveEntryPath,
      safeBasename: safeBase,
      mimeType: ns(row.mime_type),
      sizeBytes,
      createdAt: ns(row.created_at),
    });
  }

  const userdata: KitBackupUserdataV1 = KitBackupUserdataV1Schema.parse({
    format: "toolbox-kit-userdata",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    originalKitId: kit.id,
    guideContent: guideRows.map((r) => ({
      pillarId: s(r.pillar_id),
      topicId: s(r.topic_id),
      sectionId: s(r.section_id),
      content: s(r.content),
      committedAt: ns(r.committed_at),
    })),
    guideDogears: dogearRows.map((d) => ({
      pillarId: s(d.pillar_id),
      topicId: s(d.topic_id),
      sectionId: s(d.section_id),
      createdAt: ns(d.created_at),
    })),
    guideHighlights: highlightRows.map((h) => ({
      id: s(h.id),
      pillarId: s(h.pillar_id),
      topicId: s(h.topic_id),
      sectionId: s(h.section_id),
      quote: s(h.quote),
      prefix: s(h.prefix),
      suffix: s(h.suffix),
      color: (h.color === "sage" || h.color === "coral" ? h.color : "amber") as
        | "amber"
        | "sage"
        | "coral",
      note: s(h.note),
      cardId: ns(h.card_id),
      createdAt: ns(h.created_at),
      updatedAt: ns(h.updated_at),
    })),
    lastGuideRef: ns(kitMetaRow?.last_guide_ref ?? null),
    chatStarters: starterRows.map((r) => ({
      pillarId: s(r.pillar_id),
      topicId: s(r.topic_id),
      suggestions: s(r.suggestions, "[]"),
      contentHash: s(r.content_hash),
      updatedAt: ns(r.updated_at),
    })),
    decks: deckRows.map((d) => ({
      id: s(d.id),
      name: s(d.name, "Untitled Deck"),
      description: s(d.description),
      colorIndex: n(d.color_index),
      tags: s(d.tags),
      settings: s(d.settings, "{}"),
      createdAt: ns(d.created_at),
      updatedAt: ns(d.updated_at),
    })),
    flashcards: cardRows.map((c) => ({
      id: s(c.id),
      deckId: s(c.deck_id),
      nodeId: ns(c.node_id),
      front: s(c.front),
      back: s(c.back),
      position: n(c.position),
      easeFactor: nn(c.ease_factor) ?? 2.5,
      interval: n(c.interval),
      repetitions: n(c.repetitions),
      nextReview: ns(c.next_review),
      lastReviewed: ns(c.last_reviewed),
      state: n(c.state),
      learningStep: n(c.learning_step),
      prerequisiteId: ns(c.prerequisite_id),
      sourcePillarId: ns(c.source_pillar_id),
      sourceTopicId: ns(c.source_topic_id),
      sourceSectionId: ns(c.source_section_id),
      isReverse: n(c.is_reverse),
      reverseOfId: ns(c.reverse_of_id),
      seedKey: ns(c.seed_key),
      stability: nn(c.stability),
      difficulty: nn(c.difficulty),
      lapses: n(c.lapses),
      createdAt: ns(c.created_at),
      updatedAt: ns(c.updated_at),
    })),
    remediationQueue: remediationRows.map((r) => ({
      cardId: s(r.card_id),
      sourceCardId: s(r.source_card_id),
      nodeId: ns(r.node_id),
      nodeName: ns(r.node_name),
      reason: s(r.reason),
      createdAt: ns(r.created_at),
      resolvedAt: ns(r.resolved_at),
    })),
    drills: drillRows.map((d) => ({
      id: s(d.id),
      nodeId: s(d.node_id),
      difficulty: n(d.difficulty, 1),
      prompt: s(d.prompt),
      hintsJson: s(d.hints_json, "[]"),
      workedSolution: s(d.worked_solution),
      rubricJson: s(d.rubric_json, "[]"),
      seedKey: ns(d.seed_key),
      createdAt: ns(d.created_at),
    })),
    drillAttempts: attemptRows.map((a) => ({
      id: s(a.id),
      drillId: s(a.drill_id),
      submission: s(a.submission),
      score: nn(a.score),
      feedbackJson: s(a.feedback_json, "{}"),
      createdAt: ns(a.created_at),
    })),
    boards: boardRows.map((b) => ({
      id: s(b.id),
      name: s(b.name, "Untitled Board"),
      data: s(b.data, "{}"),
      position: n(b.position),
      createdAt: ns(b.created_at),
      updatedAt: ns(b.updated_at),
    })),
    chatSessions: sessionRows.map((cs) => ({
      id: s(cs.id),
      name: s(cs.name, "Session"),
      persona: s(cs.persona, "socratic"),
      messages: s(cs.messages, "[]"),
      pillarId: ns(cs.pillar_id),
      topicId: ns(cs.topic_id),
      topicName: ns(cs.topic_name),
      createdAt: ns(cs.created_at),
      updatedAt: ns(cs.updated_at),
    })),
    episodicMemories: memoryRows.map((m) => ({
      memoryText: s(m.memory_text),
      importanceScore: n(m.importance_score),
      createdAt: ns(m.created_at),
    })),
    sources: exportedSources,
    sourceChunks: chunkRows.map((ch) => ({
      id: s(ch.id),
      sourceId: s(ch.source_id),
      chunkIndex: n(ch.chunk_index),
      text: s(ch.text),
    })),
  });

  const buffer = await createZipArchive([
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

  return { filename: `${kit.slug}.toolbox-backup.zip`, buffer };
}

function isAllowedBackupEntryPath(name: string): boolean {
  if (name === "kit.json" || name === "userdata.json") return true;
  const parts = name.split("/");
  return parts.length === 3 && parts[0] === "files" && SAFE_ID_RE.test(parts[1]) && SAFE_BASENAME_RE.test(parts[2]);
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
    throw new BadRequestError("Backup archive must contain both kit.json and userdata.json");
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
  const declaredEntries = new Map<string, { oldSourceId: string; safeBasename: string }>();
  for (const s of userdata.sources) {
    if (!SAFE_ID_RE.test(s.id)) {
      throw new BadRequestError(`Invalid source ID in userdata.json: ${s.id}`);
    }
    if (s.archiveEntryPath !== null) {
      const base = s.safeBasename ?? "";
      if (!SAFE_BASENAME_RE.test(base) || s.archiveEntryPath !== `files/${s.id}/${base}`) {
        throw new BadRequestError(`Invalid archiveEntryPath in userdata.json: ${s.archiveEntryPath}`);
      }
      if (!entries.has(s.archiveEntryPath)) {
        throw new BadRequestError(`Declared source file missing from archive: ${s.archiveEntryPath}`);
      }
      declaredEntries.set(s.archiveEntryPath, { oldSourceId: s.id, safeBasename: base });
    }
  }

  for (const entryName of entries.keys()) {
    if (entryName !== "kit.json" && entryName !== "userdata.json" && !declaredEntries.has(entryName)) {
      throw new BadRequestError(`Undeclared file entry in backup archive: ${entryName}`);
    }
  }

  const onCollision = opts.onCollision ?? "error";
  const resolved = resolveImportCollision(db, scope, verifiedSkeleton, onCollision);
  if (resolved.synced) return resolved.synced;

  const { existingId, targetSlug, mode, storedSkeleton, newKitId } = resolved;
  const replaceKitId = existingId && onCollision === "replace" ? existingId : null;

  // Mint fresh UUIDs for 100% of entities and internal FKs
  const mintIdMap = <T extends { id: string }>(items: T[]) =>
    new Map(items.map((x) => [x.id, crypto.randomUUID()]));

  const deckIdMap = mintIdMap(userdata.decks);
  const cardIdMap = mintIdMap(userdata.flashcards.filter((c) => deckIdMap.has(c.deckId)));
  const drillIdMap = mintIdMap(userdata.drills);
  const boardIdMap = mintIdMap(userdata.boards);
  const sessionIdMap = mintIdMap(userdata.chatSessions);
  const sourceIdMap = mintIdMap(userdata.sources);

  const stagingDir = path.resolve(
    kitsUploadsBaseDir(scope.ownerId),
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

    db.transaction(() => {
      replaceAndInsertKitRow(db, scope, newKitId, targetSlug, storedSkeleton, replaceKitId);

      const insGuide = db.prepare(
        `INSERT INTO guide_content (
           ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
         ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id) DO UPDATE SET
           content = excluded.content, committed_at = excluded.committed_at`,
      );
      for (const g of userdata.guideContent) {
        insGuide.run(scope.ownerId, newKitId, g.pillarId, g.topicId, g.sectionId, g.content, g.committedAt);
      }

      const insStarter = db.prepare(
        `INSERT INTO chat_starters (
           ownerId, kit_id, pillar_id, topic_id, suggestions, content_hash, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
         ON CONFLICT(ownerId, kit_id, pillar_id, topic_id) DO UPDATE SET
           suggestions = excluded.suggestions, content_hash = excluded.content_hash, updated_at = excluded.updated_at`,
      );
      for (const cs of userdata.chatStarters) {
        insStarter.run(scope.ownerId, newKitId, cs.pillarId, cs.topicId, cs.suggestions, cs.contentHash, cs.updatedAt);
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
        const mappedPrereq = c.prerequisiteId ? (cardIdMap.get(c.prerequisiteId) ?? null) : null;
        const mappedReverse = c.reverseOfId ? (cardIdMap.get(c.reverseOfId) ?? null) : null;
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
        insMemory.run(scope.ownerId, newKitId, m.memoryText, m.importanceScore, m.createdAt);
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
          hasStagedFile && s.safeBasename ? `${newSourceId}/${s.safeBasename}` : null;
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
        `INSERT INTO kit_source_chunks (id, ownerId, kit_id, source_id, chunk_index, text)
         VALUES (?, ?, ?, ?, ?, ?)`,
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

      if (userdata.lastGuideRef) {
        try {
          const parsed = JSON.parse(userdata.lastGuideRef) as Record<string, unknown> | null;
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof parsed.pillarId === "string" &&
            parsed.pillarId.trim().length > 0 &&
            parsed.pillarId.trim().length <= 200 &&
            typeof parsed.topicId === "string" &&
            parsed.topicId.trim().length > 0 &&
            parsed.topicId.trim().length <= 200
          ) {
            const sanitizedResume = JSON.stringify({
              pillarId: parsed.pillarId.trim(),
              topicId: parsed.topicId.trim(),
              sectionId:
                typeof parsed.sectionId === "string"
                  ? parsed.sectionId.trim().slice(0, 200)
                  : "",
              ...(typeof parsed.updatedAt === "string"
                ? { updatedAt: parsed.updatedAt.slice(0, 64) }
                : {}),
            });
            db.prepare("UPDATE kits SET last_guide_ref = ? WHERE ownerId = ? AND id = ?").run(
              sanitizedResume,
              scope.ownerId,
              newKitId,
            );
          }
        } catch {
          // Ignore malformed lastGuideRef JSON in archive
        }
      }

      const insDogear = db.prepare(
        `INSERT INTO guide_dogears (
           ownerId, kit_id, pillar_id, topic_id, section_id, created_at
         ) VALUES (?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
         ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id) DO NOTHING`,
      );
      for (const dg of userdata.guideDogears) {
        insDogear.run(scope.ownerId, newKitId, dg.pillarId, dg.topicId, dg.sectionId, dg.createdAt);
      }

      const insHighlight = db.prepare(
        `INSERT INTO guide_highlights (
           id, ownerId, kit_id, pillar_id, topic_id, section_id,
           quote, prefix, suffix, color, note, card_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))`,
      );
      for (const hl of userdata.guideHighlights) {
        const mappedCardId = hl.cardId ? (cardIdMap.get(hl.cardId) ?? null) : null;
        insHighlight.run(
          crypto.randomUUID(),
          scope.ownerId,
          newKitId,
          hl.pillarId,
          hl.topicId,
          hl.sectionId,
          hl.quote,
          hl.prefix,
          hl.suffix,
          hl.color,
          hl.note,
          mappedCardId,
          hl.createdAt,
          hl.updatedAt,
        );
      }
    })();

    if (hasBinaryFiles) {
      fs.mkdirSync(path.dirname(finalKitDir), { recursive: true });
      fs.renameSync(stagingDir, finalKitDir);
    }

    if (replaceKitId) {
      fs.rmSync(kitUploadsDir(scope.ownerId, replaceKitId), { recursive: true, force: true });
    }
  } catch (err) {
    fs.rmSync(stagingDir, { recursive: true, force: true });
    throw err;
  }

  return { kit: getOwnedKit(db, scope, newKitId), mode };
}
