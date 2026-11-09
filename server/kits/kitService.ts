import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { DATA_DIR } from "../appConfig.ts";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../platform/net/errors.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import {
  verifyKitSkeleton,
  type KitSkeletonV1,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import {
  deleteRagChunksBySource,
  deleteRagChunksForKit,
  upsertRagChunk,
} from "../search/hybridSearch.ts";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_PATH_SEGMENT_RE = /^[A-Za-z0-9._-]+$/;

const DECK_STATS_COLS = `
  COUNT(DISTINCT d.id) as deckCount,
  COUNT(f.id) as cardCount,
  COALESCE(SUM(CASE
    WHEN f.id IS NOT NULL AND f.state IN (1, 2, 3)
      AND (f.next_review IS NULL OR datetime(f.next_review) <= datetime('now'))
    THEN 1 ELSE 0 END), 0) as dueCount,
  COALESCE(SUM(CASE
    WHEN f.id IS NOT NULL AND (f.state = 0 OR f.state IS NULL)
    THEN 1 ELSE 0 END), 0) as newCount,
  COALESCE(SUM(CASE
    WHEN f.id IS NOT NULL AND f.repetitions > 0
    THEN 1 ELSE 0 END), 0) as reviewedCount`;

export interface OwnedKitSummary {
  id: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  statusDetail: string | null;
  forkedFromSharedId: string | null;
  forkedVersion: number | null;
  upstreamSlug: string | null;
  upstreamLatestVersion: number | null;
  hasUpstreamUpdate: boolean;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
  pillarCount: number;
  topicCount: number;
  nodeCount: number;
  capabilities: KitSkeletonV1["capabilities"];
  deckCount: number;
  cardCount: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
  masteryPercent: number;
  guideFilledCount: number;
  guideTotalCount: number;
  archivedNotesCount: number;
  drillCount: number;
}

export interface OwnedKitDetail extends OwnedKitSummary {
  skeleton: KitSkeletonV1;
}

export interface ArchivedGuideNote {
  pillarId: string;
  topicId: string;
  sectionId: string;
  content: string;
  committedAt: string | null;
}

export interface SharedKitSummary {
  id: string;
  slug: string;
  publisherUserId: string | null;
  latestVersion: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  tags: string[];
  isOfficial: boolean;
  downloadsCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SharedKitDetail extends SharedKitSummary {
  versions: Array<{ version: number; changelog: string; createdAt: string }>;
  skeleton: KitSkeletonV1;
}

export interface RawKitRow {
  id: string;
  ownerId: string;
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  status: string;
  status_detail: string | null;
  skeleton_json: string;
  forked_from_shared_id: string | null;
  forked_version: number | null;
  created_at: string;
  updated_at: string;
  last_opened_at: string | null;
  upstream_slug?: string | null;
  upstream_latest_version?: number | null;
}

export function kitsUploadsBaseDir(ownerId: string): string {
  if (!SAFE_PATH_SEGMENT_RE.test(ownerId)) {
    throw new ValidationError("Invalid owner identifier for file storage");
  }
  const dataRoot = process.env.DATA_DIR || DATA_DIR;
  return path.resolve(dataRoot, "uploads", "u", ownerId, "kits");
}

export function kitUploadsDir(ownerId: string, kitId: string): string {
  if (!SAFE_PATH_SEGMENT_RE.test(kitId)) {
    throw new ValidationError("Invalid kit identifier for file storage");
  }
  const base = kitsUploadsBaseDir(ownerId);
  const full = path.resolve(base, kitId);
  if (!full.startsWith(base + path.sep)) {
    throw new ValidationError("Invalid kit storage path");
  }
  return full;
}

export function validateAndVerifySkeleton(input: unknown): KitSkeletonV1 {
  try {
    return verifyKitSkeleton(input);
  } catch (err) {
    throw new ValidationError(err instanceof Error ? err.message : "Invalid Kit skeleton");
  }
}

export function parseStoredSkeleton(raw: string): KitSkeletonV1 {
  try {
    return JSON.parse(raw) as KitSkeletonV1;
  } catch {
    return SYSTEM_DESIGN_KIT_SKELETON;
  }
}

export function safeSkeletonSlotSet(skeleton: KitSkeletonV1): Set<string> {
  const slots = new Set<string>();
  for (const p of skeleton.pillars) {
    for (const t of p.topics) {
      for (const s of p.sections) slots.add(`${p.id}\0${t.id}\0${s.id}`);
    }
  }
  return slots;
}

export function mintUniqueKitSlug(
  db: Database.Database,
  scope: Scope,
  baseSlug: string,
): string {
  const cleanBase =
    baseSlug
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "kit";

  const existsStmt = db.prepare("SELECT 1 FROM kits WHERE ownerId = ? AND slug = ?");
  if (!existsStmt.get(scope.ownerId, cleanBase)) return cleanBase;
  for (let n = 2; n < 10_000; n++) {
    const candidate = `${cleanBase}-${n}`;
    if (!existsStmt.get(scope.ownerId, candidate)) return candidate;
  }
  return `${cleanBase}-${crypto.randomBytes(3).toString("hex")}`;
}

export interface SeedHydrationResult {
  addedCards: number;
  addedDrills: number;
  addedGuideNotes: number;
}

export function seedKitStarterContent(
  db: Database.Database,
  scope: Scope,
  kitId: string,
  skeleton: KitSkeletonV1,
  opts: { skipBaselineNotes?: boolean } = {},
): SeedHydrationResult {
  return db.transaction((): SeedHydrationResult => {
    let addedCards = 0;
    let addedDrills = 0;
    let addedGuideNotes = 0;

    // 1. Starter Deck + Cards (with seed_key idempotency + prerequisiteKey -> prerequisite_id)
    const starterDeck = skeleton.seeds.starterDeck;
    if (starterDeck && starterDeck.cards.length > 0) {
      const existingSeedRows = db
        .prepare(
          `SELECT f.seed_key, f.id
           FROM flashcards f
           JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
           WHERE f.ownerId = ? AND d.kit_id = ? AND f.seed_key IS NOT NULL`,
        )
        .all(scope.ownerId, kitId) as Array<{ seed_key: string; id: string }>;

      const keyToCardId = new Map(existingSeedRows.map((r) => [r.seed_key, r.id]));
      const unseenCards = starterDeck.cards.filter((c) => !keyToCardId.has(c.key));

      if (unseenCards.length > 0) {
        const deckRow =
          (db
            .prepare("SELECT id FROM decks WHERE ownerId = ? AND kit_id = ? AND name = ? LIMIT 1")
            .get(scope.ownerId, kitId, starterDeck.name) as { id: string } | undefined) ??
          (db
            .prepare(
              "SELECT id FROM decks WHERE ownerId = ? AND kit_id = ? ORDER BY created_at ASC LIMIT 1",
            )
            .get(scope.ownerId, kitId) as { id: string } | undefined);

        const deckId = deckRow?.id ?? crypto.randomUUID();
        if (!deckRow) {
          db.prepare(
            `INSERT INTO decks (
               id, ownerId, kit_id, name, description, color_index, tags, settings, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 0, '', '{}', datetime('now'), datetime('now'))`,
          ).run(deckId, scope.ownerId, kitId, starterDeck.name, starterDeck.description ?? "");
        }

        const maxPosRow = db
          .prepare(
            "SELECT COALESCE(MAX(position), -1) as maxPos FROM flashcards WHERE ownerId = ? AND deck_id = ?",
          )
          .get(scope.ownerId, deckId) as { maxPos: number };
        let position = (maxPosRow?.maxPos ?? -1) + 1;

        const insertCard = db.prepare(
          `INSERT INTO flashcards (
             id, ownerId, deck_id, node_id, front, back, position,
             source_pillar_id, source_topic_id, source_section_id,
             seed_key, prerequisite_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, datetime('now'), datetime('now'))`,
        );

        const pendingPrereqs: Array<{ cardId: string; prereqKey: string }> = [];
        for (const card of unseenCards) {
          const cardId = crypto.randomUUID();
          insertCard.run(
            cardId,
            scope.ownerId,
            deckId,
            card.nodeId ?? null,
            card.front,
            card.back,
            position++,
            card.pillarId ?? null,
            card.topicId ?? null,
            card.sectionId ?? null,
            card.key,
          );
          keyToCardId.set(card.key, cardId);
          addedCards++;
          if (card.prerequisiteKey) {
            pendingPrereqs.push({ cardId, prereqKey: card.prerequisiteKey });
          }
        }

        if (pendingPrereqs.length > 0) {
          const updatePrereq = db.prepare(
            "UPDATE flashcards SET prerequisite_id = ? WHERE ownerId = ? AND id = ?",
          );
          for (const { cardId, prereqKey } of pendingPrereqs) {
            const prereqId = keyToCardId.get(prereqKey);
            if (prereqId && prereqId !== cardId) {
              updatePrereq.run(prereqId, scope.ownerId, cardId);
            }
          }
        }
      }
    }

    // 2. Guided Drills (NEVER delete existing drills; insert unseen seed_keys only)
    if (skeleton.seeds.drills.length > 0) {
      const existingDrillRows = db
        .prepare(
          "SELECT seed_key FROM drills WHERE ownerId = ? AND kit_id = ? AND seed_key IS NOT NULL",
        )
        .all(scope.ownerId, kitId) as Array<{ seed_key: string }>;
      const existingDrillKeys = new Set(existingDrillRows.map((r) => r.seed_key));

      const insertDrill = db.prepare(
        `INSERT INTO drills (
           id, ownerId, kit_id, node_id, difficulty, prompt,
           hints_json, worked_solution, rubric_json, seed_key, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
      );

      for (const drill of skeleton.seeds.drills) {
        if (existingDrillKeys.has(drill.key)) continue;
        insertDrill.run(
          crypto.randomUUID(),
          scope.ownerId,
          kitId,
          drill.nodeId,
          drill.difficulty,
          drill.prompt,
          JSON.stringify(drill.hints),
          drill.workedSolution,
          JSON.stringify(drill.rubricPoints),
          drill.key,
        );
        existingDrillKeys.add(drill.key);
        addedDrills++;
      }
    }

    // 3. Baseline Guide Notes (fill empty slots only; never overwrite user notes)
    if (!opts.skipBaselineNotes && skeleton.seeds.baselineGuideNotes.length > 0) {
      const upsertBaseline = db.prepare(
        `INSERT INTO guide_content (
           ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at
         ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id) DO UPDATE SET
           content = excluded.content,
           committed_at = excluded.committed_at
         WHERE guide_content.content IS NULL OR guide_content.content = ''`,
      );
      for (const note of skeleton.seeds.baselineGuideNotes) {
        if (!note.content.trim()) continue;
        const info = upsertBaseline.run(
          scope.ownerId,
          kitId,
          note.pillarId,
          note.topicId,
          note.sectionId,
          note.content,
        );
        if (info.changes > 0) addedGuideNotes++;
      }
    }

    return { addedCards, addedDrills, addedGuideNotes };
  })();
}

interface DeckStatsRow {
  deckCount: number;
  cardCount: number;
  dueCount: number;
  newCount: number;
  reviewedCount: number;
}

interface PreloadedKitAggregates {
  deckStats: Map<string, DeckStatsRow>;
  guideRows: Map<string, Array<{ pillar_id: string; topic_id: string; section_id: string }>>;
  drillCounts: Map<string, number>;
}

function hydrateKitSummary(
  db: Database.Database,
  scope: Scope,
  row: RawKitRow,
  preloaded?: PreloadedKitAggregates,
): OwnedKitDetail {
  const skeleton = parseStoredSkeleton(row.skeleton_json);
  const validSlots = safeSkeletonSlotSet(skeleton);
  const guideTotalCount = validSlots.size;

  const deckStat = preloaded
    ? preloaded.deckStats.get(row.id)
    : (db
        .prepare(
          `SELECT ${DECK_STATS_COLS}
           FROM decks d
           LEFT JOIN flashcards f ON f.ownerId = d.ownerId AND f.deck_id = d.id
           WHERE d.ownerId = ? AND d.kit_id = ?`,
        )
        .get(scope.ownerId, row.id) as DeckStatsRow);

  const guideRows = preloaded
    ? (preloaded.guideRows.get(row.id) ?? [])
    : (db
        .prepare(
          `SELECT pillar_id, topic_id, section_id
           FROM guide_content
           WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND content != ''`,
        )
        .all(scope.ownerId, row.id) as Array<{
        pillar_id: string;
        topic_id: string;
        section_id: string;
      }>);

  let guideFilledCount = 0;
  let archivedNotesCount = 0;
  for (const g of guideRows) {
    if (validSlots.has(`${g.pillar_id}\0${g.topic_id}\0${g.section_id}`)) guideFilledCount++;
    else archivedNotesCount++;
  }

  const drillCount = preloaded
    ? (preloaded.drillCounts.get(row.id) ?? 0)
    : (
        db
          .prepare("SELECT COUNT(*) as c FROM drills WHERE ownerId = ? AND kit_id = ?")
          .get(scope.ownerId, row.id) as { c: number }
      ).c;

  const cardCount = deckStat?.cardCount ?? 0;
  const reviewedCount = deckStat?.reviewedCount ?? 0;
  const masteryPercent = cardCount > 0 ? Math.round((reviewedCount / cardCount) * 100) : 0;

  const upstreamLatestVersion = row.upstream_latest_version ?? null;
  const hasUpstreamUpdate =
    row.forked_from_shared_id !== null &&
    upstreamLatestVersion !== null &&
    upstreamLatestVersion > (row.forked_version ?? 0);

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    status: row.status,
    statusDetail: row.status_detail,
    forkedFromSharedId: row.forked_from_shared_id,
    forkedVersion: row.forked_version,
    upstreamSlug: row.upstream_slug ?? null,
    upstreamLatestVersion,
    hasUpstreamUpdate,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
    pillarCount: skeleton.pillars.length,
    topicCount: skeleton.pillars.reduce((acc, p) => acc + p.topics.length, 0),
    nodeCount: skeleton.graph.nodes.length,
    capabilities: skeleton.capabilities,
    deckCount: deckStat?.deckCount ?? 0,
    cardCount,
    dueCount: deckStat?.dueCount ?? 0,
    newCount: deckStat?.newCount ?? 0,
    reviewedCount,
    masteryPercent,
    guideFilledCount,
    guideTotalCount,
    archivedNotesCount,
    drillCount,
    skeleton,
  };
}

function findRawOwnedKit(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): RawKitRow | undefined {
  return db
    .prepare(
      `SELECT k.*, sk.slug as upstream_slug, sk.latest_version as upstream_latest_version
       FROM kits k
       LEFT JOIN shared_kits sk ON sk.id = k.forked_from_shared_id
       WHERE k.ownerId = ? AND (k.id = ? OR k.slug = ?)
       LIMIT 1`,
    )
    .get(scope.ownerId, slugOrId, slugOrId) as RawKitRow | undefined;
}

export function requireRawOwnedKit(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): RawKitRow {
  const row = findRawOwnedKit(db, scope, slugOrId);
  if (!row) throw new NotFoundError("Kit", slugOrId);
  return row;
}

export function listOwnedKits(db: Database.Database, scope: Scope): OwnedKitSummary[] {
  const rows = db
    .prepare(
      `SELECT k.*, sk.slug as upstream_slug, sk.latest_version as upstream_latest_version
       FROM kits k
       LEFT JOIN shared_kits sk ON sk.id = k.forked_from_shared_id
       WHERE k.ownerId = ?
       ORDER BY COALESCE(k.last_opened_at, k.updated_at) DESC, k.created_at DESC`,
    )
    .all(scope.ownerId) as RawKitRow[];

  if (rows.length === 0) return [];

  const deckStatRows = db
    .prepare(
      `SELECT d.kit_id, ${DECK_STATS_COLS}
       FROM decks d
       LEFT JOIN flashcards f ON f.ownerId = d.ownerId AND f.deck_id = d.id
       WHERE d.ownerId = ?
       GROUP BY d.kit_id`,
    )
    .all(scope.ownerId) as Array<DeckStatsRow & { kit_id: string }>;

  const guideAllRows = db
    .prepare(
      `SELECT kit_id, pillar_id, topic_id, section_id
       FROM guide_content
       WHERE ownerId = ? AND content IS NOT NULL AND content != ''`,
    )
    .all(scope.ownerId) as Array<{
    kit_id: string;
    pillar_id: string;
    topic_id: string;
    section_id: string;
  }>;

  const drillCountRows = db
    .prepare("SELECT kit_id, COUNT(*) as c FROM drills WHERE ownerId = ? GROUP BY kit_id")
    .all(scope.ownerId) as Array<{ kit_id: string; c: number }>;

  const preloaded: PreloadedKitAggregates = {
    deckStats: new Map(deckStatRows.map((r) => [r.kit_id, r])),
    guideRows: new Map(),
    drillCounts: new Map(drillCountRows.map((r) => [r.kit_id, r.c])),
  };
  for (const g of guideAllRows) {
    const arr = preloaded.guideRows.get(g.kit_id);
    if (arr) arr.push(g);
    else preloaded.guideRows.set(g.kit_id, [g]);
  }

  return rows.map((row) => {
    const { skeleton: _skeleton, ...summary } = hydrateKitSummary(db, scope, row, preloaded);
    return summary;
  });
}

export function getOwnedKit(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): OwnedKitDetail {
  return hydrateKitSummary(db, scope, requireRawOwnedKit(db, scope, slugOrId));
}

export function updateOwnedKit(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
  patch: {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
    slug?: string;
  },
): OwnedKitDetail {
  const current = requireRawOwnedKit(db, scope, slugOrId);

  const nextSlug =
    patch.slug !== undefined ? patch.slug.trim().toLowerCase() : current.slug;
  if (!SLUG_RE.test(nextSlug)) {
    throw new ValidationError(
      "Kit slug must contain only lowercase letters, numbers, and hyphens",
    );
  }
  if (nextSlug !== current.slug) {
    const conflict = db
      .prepare("SELECT id FROM kits WHERE ownerId = ? AND slug = ? AND id != ?")
      .get(scope.ownerId, nextSlug, current.id) as { id: string } | undefined;
    if (conflict) {
      throw new AppError(`A kit with slug "${nextSlug}" already exists`, 409, {
        code: "KIT_SLUG_CONFLICT",
        details: { existingKitId: conflict.id, slug: nextSlug },
      });
    }
  }

  const nextName = patch.name !== undefined ? patch.name.trim() : current.name;
  if (!nextName) throw new ValidationError("Kit name cannot be empty");
  const nextDesc = patch.description ?? current.description;
  const nextIcon = patch.icon ?? current.icon;
  const nextColor = patch.color ?? current.color;

  const skeleton = parseStoredSkeleton(current.skeleton_json);
  const updatedSkeleton: KitSkeletonV1 = {
    ...skeleton,
    identity: {
      ...skeleton.identity,
      slug: nextSlug,
      name: nextName,
      description: nextDesc,
      icon: nextIcon,
      color: nextColor,
    },
  };

  db.prepare(
    `UPDATE kits
     SET slug = ?, name = ?, description = ?, icon = ?, color = ?,
         skeleton_json = ?, updated_at = datetime('now')
     WHERE ownerId = ? AND id = ?`,
  ).run(
    nextSlug,
    nextName,
    nextDesc,
    nextIcon,
    nextColor,
    JSON.stringify(updatedSkeleton),
    scope.ownerId,
    current.id,
  );

  return getOwnedKit(db, scope, current.id);
}

export function touchOwnedKit(db: Database.Database, scope: Scope, slugOrId: string): void {
  const current = requireRawOwnedKit(db, scope, slugOrId);
  db.prepare("UPDATE kits SET last_opened_at = datetime('now') WHERE ownerId = ? AND id = ?").run(
    scope.ownerId,
    current.id,
  );
}

export function deleteOwnedKit(db: Database.Database, scope: Scope, slugOrId: string): void {
  const current = requireRawOwnedKit(db, scope, slugOrId);
  db.transaction(() => {
    deleteRagChunksForKit(db, scope, current.id);
    db.prepare("DELETE FROM kits WHERE ownerId = ? AND id = ?").run(scope.ownerId, current.id);
  })();
  fs.rmSync(kitUploadsDir(scope.ownerId, current.id), { recursive: true, force: true });
}

export function deleteGuideSlotAndRag(
  db: Database.Database,
  scope: Scope,
  kitId: string,
  pillarId: string,
  topicId: string,
  sectionId: string,
): void {
  db.prepare(
    `DELETE FROM guide_content
     WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
  ).run(scope.ownerId, kitId, pillarId, topicId, sectionId);
  deleteRagChunksBySource(db, scope, kitId, "guide", `${pillarId}:${topicId}:${sectionId}`);
}

export function getArchivedGuideNotes(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): ArchivedGuideNote[] {
  const current = requireRawOwnedKit(db, scope, slugOrId);
  const validSlots = safeSkeletonSlotSet(parseStoredSkeleton(current.skeleton_json));

  const rows = db
    .prepare(
      `SELECT pillar_id, topic_id, section_id, content, committed_at
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND content != ''
       ORDER BY committed_at DESC`,
    )
    .all(scope.ownerId, current.id) as Array<{
    pillar_id: string;
    topic_id: string;
    section_id: string;
    content: string;
    committed_at: string | null;
  }>;

  return rows
    .filter((r) => !validSlots.has(`${r.pillar_id}\0${r.topic_id}\0${r.section_id}`))
    .map((r) => ({
      pillarId: r.pillar_id,
      topicId: r.topic_id,
      sectionId: r.section_id,
      content: r.content,
      committedAt: r.committed_at,
    }));
}

export async function refileArchivedGuideNote(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
  params: {
    fromPillarId: string;
    fromTopicId: string;
    fromSectionId: string;
    toPillarId: string;
    toTopicId: string;
    toSectionId: string;
  },
): Promise<void> {
  const current = requireRawOwnedKit(db, scope, slugOrId);
  const validSlots = safeSkeletonSlotSet(parseStoredSkeleton(current.skeleton_json));
  if (!validSlots.has(`${params.toPillarId}\0${params.toTopicId}\0${params.toSectionId}`)) {
    throw new ValidationError("Target pillar/topic/section does not exist in this Kit");
  }

  const selectSlot = db.prepare(
    `SELECT content FROM guide_content
     WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?`,
  );

  const mergedContent = db.transaction((): string => {
    const src = selectSlot.get(
      scope.ownerId,
      current.id,
      params.fromPillarId,
      params.fromTopicId,
      params.fromSectionId,
    ) as { content: string } | undefined;
    if (!src?.content) throw new NotFoundError("Archived guide note");

    const existingDest = selectSlot.get(
      scope.ownerId,
      current.id,
      params.toPillarId,
      params.toTopicId,
      params.toSectionId,
    ) as { content: string } | undefined;

    const merged = existingDest?.content?.trim()
      ? `${existingDest.content.trim()}\n\n---\n\n${src.content.trim()}`
      : src.content;

    db.prepare(
      `INSERT INTO guide_content (
         ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at
       ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id) DO UPDATE SET
         content = excluded.content,
         committed_at = excluded.committed_at`,
    ).run(
      scope.ownerId,
      current.id,
      params.toPillarId,
      params.toTopicId,
      params.toSectionId,
      merged,
    );

    if (
      params.fromPillarId !== params.toPillarId ||
      params.fromTopicId !== params.toTopicId ||
      params.fromSectionId !== params.toSectionId
    ) {
      deleteGuideSlotAndRag(
        db,
        scope,
        current.id,
        params.fromPillarId,
        params.fromTopicId,
        params.fromSectionId,
      );
    }
    return merged;
  })();

  await upsertRagChunk(db, scope, {
    kitId: current.id,
    kind: "guide",
    sourceRefId: `${params.toPillarId}:${params.toTopicId}:${params.toSectionId}`,
    title: `${params.toTopicId} — ${params.toSectionId}`,
    content: mergedContent,
  });
}

export function deleteArchivedGuideNote(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
  params: { pillarId: string; topicId: string; sectionId: string },
): void {
  const current = requireRawOwnedKit(db, scope, slugOrId);
  deleteGuideSlotAndRag(
    db,
    scope,
    current.id,
    params.pillarId,
    params.topicId,
    params.sectionId,
  );
}

/* ════════════════════════════════════════════════════════════════
   Shared Library (shared_kits + shared_kit_versions)
   ════════════════════════════════════════════════════════════════ */

interface RawSharedKitRow {
  id: string;
  slug: string;
  publisher_user_id: string | null;
  latest_version: number;
  name: string;
  description: string;
  icon: string;
  color: string;
  tags: string;
  is_official: number;
  downloads_count: number;
  created_at: string;
  updated_at: string;
}

function parseTags(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === "string") : [];
  } catch {
    return [];
  }
}

function mapSharedKitRow(row: RawSharedKitRow): SharedKitSummary {
  return {
    id: row.id,
    slug: row.slug,
    publisherUserId: row.publisher_user_id,
    latestVersion: row.latest_version,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    tags: parseTags(row.tags),
    isOfficial: row.is_official === 1,
    downloadsCount: row.downloads_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listSharedKits(
  db: Database.Database,
  query: { q?: string; tag?: string } = {},
): SharedKitSummary[] {
  const rows = db
    .prepare(
      `SELECT * FROM shared_kits
       ORDER BY is_official DESC, downloads_count DESC, updated_at DESC`,
    )
    .all() as RawSharedKitRow[];

  const term = query.q?.trim().toLowerCase() ?? "";
  const tagFilter = query.tag?.trim().toLowerCase() ?? "";

  return rows.map(mapSharedKitRow).filter((item) => {
    if (tagFilter && !item.tags.some((t) => t.toLowerCase() === tagFilter)) return false;
    if (!term) return true;
    return (
      item.name.toLowerCase().includes(term) ||
      item.description.toLowerCase().includes(term) ||
      item.slug.toLowerCase().includes(term) ||
      item.tags.some((t) => t.toLowerCase().includes(term))
    );
  });
}

export function getSharedKitBySlug(db: Database.Database, slug: string): SharedKitDetail {
  const row = db.prepare("SELECT * FROM shared_kits WHERE slug = ?").get(slug) as
    | RawSharedKitRow
    | undefined;
  if (!row) throw new NotFoundError("Shared Kit", slug);

  const versions = db
    .prepare(
      `SELECT version, changelog, skeleton_json, created_at
       FROM shared_kit_versions
       WHERE shared_kit_id = ?
       ORDER BY version DESC`,
    )
    .all(row.id) as Array<{
    version: number;
    changelog: string;
    skeleton_json: string;
    created_at: string;
  }>;

  if (versions.length === 0) throw new NotFoundError("Shared Kit version", slug);

  return {
    ...mapSharedKitRow(row),
    versions: versions.map((v) => ({
      version: v.version,
      changelog: v.changelog,
      createdAt: v.created_at,
    })),
    skeleton: parseStoredSkeleton(versions[0].skeleton_json),
  };
}

export function snapshotSkeletonFromOwnedKit(
  db: Database.Database,
  scope: Scope,
  kit: RawKitRow,
  opts: { includeGuideNotes?: boolean; slugOverride?: string } = {},
): KitSkeletonV1 {
  const base = parseStoredSkeleton(kit.skeleton_json);
  const validSlots = safeSkeletonSlotSet(base);

  let baselineGuideNotes: KitSkeletonV1["seeds"]["baselineGuideNotes"] = [];
  if (opts.includeGuideNotes) {
    const rows = db
      .prepare(
        `SELECT pillar_id, topic_id, section_id, content
         FROM guide_content
         WHERE ownerId = ? AND kit_id = ? AND content IS NOT NULL AND content != ''
         ORDER BY pillar_id, topic_id, section_id`,
      )
      .all(scope.ownerId, kit.id) as Array<{
      pillar_id: string;
      topic_id: string;
      section_id: string;
      content: string;
    }>;
    baselineGuideNotes = rows
      .filter((r) => validSlots.has(`${r.pillar_id}\0${r.topic_id}\0${r.section_id}`))
      .map((r) => ({
        pillarId: r.pillar_id,
        topicId: r.topic_id,
        sectionId: r.section_id,
        content: r.content,
      }));
  }

  return validateAndVerifySkeleton({
    ...base,
    exportedAt: new Date().toISOString(),
    identity: {
      ...base.identity,
      slug: opts.slugOverride ?? kit.slug,
      name: kit.name,
      description: kit.description,
      icon: kit.icon,
      color: kit.color,
    },
    seeds: { ...base.seeds, baselineGuideNotes },
  });
}

export function publishKitToSharedLibrary(
  db: Database.Database,
  publisher: {
    id: string;
    role: string;
    username?: string | null;
    displayName?: string | null;
  },
  scope: Scope,
  slugOrId: string,
  opts: { changelog?: string; includeBaselineNotes?: boolean; slug?: string } = {},
): SharedKitDetail {
  const kit = requireRawOwnedKit(db, scope, slugOrId);

  const targetSlug = (opts.slug ?? kit.slug).trim().toLowerCase();
  if (!SLUG_RE.test(targetSlug)) throw new ValidationError("Invalid shared kit slug");

  const snapshot = snapshotSkeletonFromOwnedKit(db, scope, kit, {
    includeGuideNotes: Boolean(opts.includeBaselineNotes),
    slugOverride: targetSlug,
  });

  const existing = db.prepare("SELECT * FROM shared_kits WHERE slug = ?").get(targetSlug) as
    | RawSharedKitRow
    | undefined;

  if (existing && existing.publisher_user_id !== publisher.id && publisher.role !== "admin") {
    const suffix = (publisher.username || "community")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const suggestedSlug = `${targetSlug}-${suffix || "fork"}`;
    throw new AppError(
      `Shared Kit slug "${targetSlug}" is owned by another publisher. Publish under a distinct slug such as "${suggestedSlug}".`,
      403,
      { code: "SHARED_KIT_NOT_OWNER", details: { suggestedSlug, slug: targetSlug } },
    );
  }

  db.transaction(() => {
    const nextVersion = existing ? existing.latest_version + 1 : 1;
    const authorName =
      snapshot.identity.author ||
      publisher.displayName ||
      publisher.username ||
      "Community";

    const publishedSkeleton: KitSkeletonV1 = validateAndVerifySkeleton({
      ...snapshot,
      identity: {
        ...snapshot.identity,
        slug: targetSlug,
        version: nextVersion,
        author: authorName,
      },
    });
    const skelJson = JSON.stringify(publishedSkeleton);
    const changelog =
      opts.changelog?.trim() ||
      (nextVersion === 1 ? "Initial release" : `Release v${nextVersion}`);
    const { name, description, icon, color, tags } = publishedSkeleton.identity;

    let sharedId: string;
    if (!existing) {
      sharedId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO shared_kits (
           id, slug, publisher_user_id, latest_version, name, description,
           icon, color, tags, is_official, downloads_count, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'), datetime('now'))`,
      ).run(sharedId, targetSlug, publisher.id, nextVersion, name, description, icon, color, JSON.stringify(tags));
    } else {
      sharedId = existing.id;
      db.prepare(
        `UPDATE shared_kits
         SET latest_version = ?, name = ?, description = ?, icon = ?, color = ?,
             tags = ?, updated_at = datetime('now')
         WHERE id = ?`,
      ).run(nextVersion, name, description, icon, color, JSON.stringify(tags), sharedId);
    }

    db.prepare(
      `INSERT INTO shared_kit_versions (shared_kit_id, version, changelog, skeleton_json, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    ).run(sharedId, nextVersion, changelog, skelJson);

    db.prepare(
      `UPDATE kits
       SET forked_from_shared_id = ?, forked_version = ?, skeleton_json = ?, updated_at = datetime('now')
       WHERE ownerId = ? AND id = ?`,
    ).run(
      sharedId,
      nextVersion,
      JSON.stringify({
        ...publishedSkeleton,
        identity: { ...publishedSkeleton.identity, slug: kit.slug },
      }),
      scope.ownerId,
      kit.id,
    );
  })();

  return getSharedKitBySlug(db, targetSlug);
}

export function forkSharedKit(
  db: Database.Database,
  scope: Scope,
  sharedSlug: string,
  opts: { customSlug?: string } = {},
): OwnedKitDetail {
  const shared = getSharedKitBySlug(db, sharedSlug);
  const targetSlug = (opts.customSlug ?? shared.slug).trim().toLowerCase();
  if (!SLUG_RE.test(targetSlug)) throw new ValidationError("Invalid custom slug");

  const kitId = db.transaction((): string => {
    const existing = db
      .prepare("SELECT id, forked_from_shared_id FROM kits WHERE ownerId = ? AND slug = ?")
      .get(scope.ownerId, targetSlug) as
      | { id: string; forked_from_shared_id: string | null }
      | undefined;

    const forkedSkeleton: KitSkeletonV1 = {
      ...shared.skeleton,
      identity: { ...shared.skeleton.identity, slug: targetSlug },
    };

    if (existing) {
      // If `ensureDefaultSystemDesignKit` lazily created a bare shell with 0 decks & 0 drills,
      // hydrate it seamlessly in-place instead of failing with a slug conflict!
      const deckCount = (
        db.prepare("SELECT COUNT(*) as c FROM decks WHERE ownerId = ? AND kit_id = ?").get(scope.ownerId, existing.id) as { c: number }
      ).c;
      const drillCount = (
        db.prepare("SELECT COUNT(*) as c FROM drills WHERE ownerId = ? AND kit_id = ?").get(scope.ownerId, existing.id) as { c: number }
      ).c;
      if (
        !opts.customSlug &&
        existing.forked_from_shared_id === shared.id &&
        deckCount === 0 &&
        drillCount === 0
      ) {
        db.prepare(
          `UPDATE kits
           SET name = ?, description = ?, icon = ?, color = ?,
               skeleton_json = ?, forked_version = ?, updated_at = datetime('now')
           WHERE ownerId = ? AND id = ?`,
        ).run(
          shared.name,
          shared.description,
          shared.icon,
          shared.color,
          JSON.stringify(forkedSkeleton),
          shared.latestVersion,
          scope.ownerId,
          existing.id,
        );
        seedKitStarterContent(db, scope, existing.id, forkedSkeleton);
        db.prepare("UPDATE shared_kits SET downloads_count = downloads_count + 1 WHERE id = ?").run(
          shared.id,
        );
        return existing.id;
      }

      throw new AppError(`You already have a Kit with slug "${targetSlug}"`, 409, {
        code: "KIT_SLUG_CONFLICT",
        details: { existingKitId: existing.id, slug: targetSlug },
      });
    }

    const newKitId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO kits (
         id, ownerId, slug, name, description, icon, color, status,
         skeleton_json, forked_from_shared_id, forked_version,
         created_at, updated_at, last_opened_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))`,
    ).run(
      newKitId,
      scope.ownerId,
      targetSlug,
      shared.name,
      shared.description,
      shared.icon,
      shared.color,
      JSON.stringify(forkedSkeleton),
      shared.id,
      shared.latestVersion,
    );

    seedKitStarterContent(db, scope, newKitId, forkedSkeleton);
    db.prepare("UPDATE shared_kits SET downloads_count = downloads_count + 1 WHERE id = ?").run(
      shared.id,
    );

    return newKitId;
  })();

  return getOwnedKit(db, scope, kitId);
}

export function getKitSourceFile(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
  sourceId: string,
): { filePath: string; downloadName: string; mimeType: string } {
  const kit = requireRawOwnedKit(db, scope, slugOrId);

  const source = db
    .prepare(
      "SELECT id, title, file_path, mime_type FROM kit_sources WHERE ownerId = ? AND kit_id = ? AND id = ?",
    )
    .get(scope.ownerId, kit.id, sourceId) as
    | { id: string; title: string; file_path: string | null; mime_type: string | null }
    | undefined;

  if (!source?.file_path) throw new NotFoundError("Kit source file", sourceId);

  const kitRoot = kitUploadsDir(scope.ownerId, kit.id);
  const resolved = path.resolve(kitRoot, source.file_path);
  if (!resolved.startsWith(kitRoot + path.sep)) {
    throw new ForbiddenError("Source file path is outside kit boundary");
  }
  if (!fs.existsSync(resolved)) {
    throw new NotFoundError("Kit source file on disk", sourceId);
  }
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new ForbiddenError("Source file is not a regular file");
  }

  const baseName = path.basename(resolved).replace(/[^A-Za-z0-9._-]/g, "_");
  return {
    filePath: resolved,
    downloadName: baseName || "source.bin",
    mimeType: source.mime_type || "application/octet-stream",
  };
}
