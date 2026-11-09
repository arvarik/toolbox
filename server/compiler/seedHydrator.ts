import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { z } from "zod";
import {
  verifyKitSkeleton,
  type GuidedDrillSeed,
  type KitSkeletonV1,
  type Pillar,
  type StarterCardSeed,
} from "../../shared/kits/kitSkeleton.ts";
import { runStructured } from "../ai/engine.ts";
import { isBackgroundJobsDisabled } from "../appConfig.ts";
import {
  getOwnedKit,
  mintUniqueKitSlug,
  parseStoredSkeleton,
  seedKitStarterContent,
  type OwnedKitDetail,
} from "../kits/kitService.ts";
import {
  AppError,
  getErrorMessage,
  log,
  NotFoundError,
} from "../platform/net/errors.ts";
import { scopeForOwnerId, type Scope } from "../platform/tenancy/scope.ts";
import {
  upsertRagChunksBatch,
  type UpsertRagChunkInput,
} from "../search/hybridSearch.ts";
import { normalizeEditedDraftSkeleton } from "./dagCompiler.ts";
import {
  commitStagedSourcesToKit,
  type LoadedStagedSource,
} from "./sourceIngest.ts";
import {
  sanitizeUntrustedExcerpt,
  UNTRUSTED_POOL_INSTRUCTION,
} from "./verifiedPool.ts";

export const SEED_KIT_JOB_KIND = "seed_kit_pillars";

export interface SeedJobPayload {
  kitId: string;
  targetPillarIds: string[];
  targetNodeIds: string[] | null;
  model: string | null;
}

export interface SeedJobProgress {
  totalPillars: number;
  completedPillarIds: string[];
  currentPillarId: string | null;
  addedCards: number;
  addedDrills: number;
  addedGuideNotes: number;
}

export interface KitSeedStatusView {
  kitId: string;
  slug: string;
  status: string;
  statusDetail: string | null;
  cardCount: number;
  drillCount: number;
  guideFilledCount: number;
  job: {
    id: string;
    status: string;
    attempts: number;
    lastError: string | null;
    progress: SeedJobProgress;
  } | null;
}

/**
 * Strict flat Zod v4 schema for per-Pillar background seeding:
 * ZERO `.optional()`, ZERO `.default()`, ZERO `z.tuple()`, ZERO `.regex()`, ZERO `z.unknown()`.
 */
export const PillarSeedLlmSchema = z.object({
  cards: z.array(
    z.object({
      nodeId: z.string(),
      topicId: z.string().nullable(),
      sectionId: z.string().nullable(),
      front: z.string(),
      back: z.string(),
      prerequisiteCardIndex: z.number().nullable(),
    }),
  ),
  drills: z.array(
    z.object({
      nodeId: z.string(),
      difficulty: z.number(),
      prompt: z.string(),
      hints: z.array(z.string()),
      workedSolution: z.string(),
      rubricPoints: z.array(z.string()),
    }),
  ),
  baselineGuideNotes: z.array(
    z.object({
      topicId: z.string(),
      sectionId: z.string(),
      content: z.string(),
    }),
  ),
});

const activeJobRunners = new Map<string, Promise<void>>();

function parseJsonOr<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeThreeHints(
  rawHints: readonly string[],
  nodeName: string,
): [string, string, string] {
  const cleaned = rawHints.map((h) => h.trim()).filter(Boolean);
  const h1 =
    cleaned[0] ??
    `Start by recalling the core invariant and purpose of ${nodeName}.`;
  const h2 =
    cleaned[1] ??
    `Consider the primary bottleneck, failure mode, or boundary condition in ${nodeName}.`;
  const h3 =
    cleaned[2] ??
    `Walk through a concrete step-by-step trace applying ${nodeName} to verify your answer.`;
  return [h1, h2, h3];
}

function clampDifficulty(raw: number): 1 | 2 | 3 {
  if (raw <= 1) return 1;
  if (raw >= 3) return 3;
  return 2;
}

function selectRelevantSourceChunks(
  db: Database.Database,
  scope: Scope,
  kitId: string,
  pillar: Pillar,
  nodes: ReadonlyArray<{ name: string; keywords: string[] }>,
  limit: number = 6,
): Array<{ id: string; title: string; text: string }> {
  const rows = db
    .prepare(
      `SELECT c.id, s.title, c.text
       FROM kit_source_chunks c
       JOIN kit_sources s ON s.ownerId = c.ownerId AND s.id = c.source_id
       WHERE c.ownerId = ? AND c.kit_id = ?
       ORDER BY c.chunk_index ASC
       LIMIT 80`,
    )
    .all(scope.ownerId, kitId) as Array<{
    id: string;
    title: string;
    text: string;
  }>;

  if (rows.length === 0) return [];

  const terms = new Set<string>();
  for (const w of pillar.name.toLowerCase().split(/\W+/)) {
    if (w.length >= 4) terms.add(w);
  }
  for (const t of pillar.topics) {
    for (const w of t.name.toLowerCase().split(/\W+/)) {
      if (w.length >= 4) terms.add(w);
    }
  }
  for (const n of nodes) {
    for (const kw of n.keywords) {
      if (kw.trim().length >= 3) terms.add(kw.trim().toLowerCase());
    }
  }

  const scored = rows.map((row, idx) => {
    const lower = row.text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (lower.includes(term)) score += 2;
    }
    return { row, score, idx };
  });

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.idx - b.idx));
  return scored.slice(0, limit).map((s) => s.row);
}

function mintUniqueSeedKey(base: string, existingKeys: Set<string>): string {
  if (!existingKeys.has(base)) {
    existingKeys.add(base);
    return base;
  }
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!existingKeys.has(candidate)) {
      existingKeys.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}-${crypto.randomUUID().slice(0, 8)}`;
  existingKeys.add(fallback);
  return fallback;
}

/**
 * Enqueues (or merges into an active) `seed_kit_pillars` job for `kitId`.
 */
export function enqueueKitSeedJob(
  db: Database.Database,
  scope: Scope,
  opts: {
    kitId: string;
    targetPillarIds: string[];
    targetNodeIds?: string[] | null;
    model?: string | null;
  },
): { jobId: string; progress: SeedJobProgress } {
  const dedupeKey = `seed_kit:${opts.kitId}`;
  const existingActive = db
    .prepare(
      `SELECT id, payload, progress
       FROM jobs
       WHERE ownerId = ? AND dedupeKey = ? AND status IN ('queued', 'running')
       LIMIT 1`,
    )
    .get(scope.ownerId, dedupeKey) as
    | { id: string; payload: string; progress: string | null }
    | undefined;

  if (existingActive) {
    const prevPayload = parseJsonOr<SeedJobPayload>(existingActive.payload, {
      kitId: opts.kitId,
      targetPillarIds: [],
      targetNodeIds: null,
      model: opts.model ?? null,
    });
    const prevProgress = parseJsonOr<SeedJobProgress>(existingActive.progress, {
      totalPillars: prevPayload.targetPillarIds.length,
      completedPillarIds: [],
      currentPillarId: null,
      addedCards: 0,
      addedDrills: 0,
      addedGuideNotes: 0,
    });

    const mergedPillars = Array.from(
      new Set([...prevPayload.targetPillarIds, ...opts.targetPillarIds]),
    );
    const mergedNodes =
      prevPayload.targetNodeIds === null || opts.targetNodeIds === undefined || opts.targetNodeIds === null
        ? null
        : Array.from(new Set([...prevPayload.targetNodeIds, ...opts.targetNodeIds]));

    const nextPayload: SeedJobPayload = {
      kitId: opts.kitId,
      targetPillarIds: mergedPillars,
      targetNodeIds: mergedNodes,
      model: opts.model ?? prevPayload.model,
    };
    const completedFiltered = prevProgress.completedPillarIds.filter(
      (id) => !opts.targetPillarIds.includes(id),
    );
    const nextProgress: SeedJobProgress = {
      ...prevProgress,
      totalPillars: mergedPillars.length,
      completedPillarIds: completedFiltered,
    };

    db.prepare(
      `UPDATE jobs
       SET payload = ?, progress = ?, attempts = 0, lastError = NULL
       WHERE ownerId = ? AND id = ?`,
    ).run(
      JSON.stringify(nextPayload),
      JSON.stringify(nextProgress),
      scope.ownerId,
      existingActive.id,
    );

    return { jobId: existingActive.id, progress: nextProgress };
  }

  const jobId = crypto.randomUUID();
  const payload: SeedJobPayload = {
    kitId: opts.kitId,
    targetPillarIds: opts.targetPillarIds,
    targetNodeIds: opts.targetNodeIds ?? null,
    model: opts.model ?? null,
  };
  const progress: SeedJobProgress = {
    totalPillars: opts.targetPillarIds.length,
    completedPillarIds: [],
    currentPillarId: null,
    addedCards: 0,
    addedDrills: 0,
    addedGuideNotes: 0,
  };

  db.prepare(
    `INSERT INTO jobs (
       id, kind, ownerId, payload, status, attempts, maxAttempts, progress, dedupeKey
     ) VALUES (?, ?, ?, ?, 'queued', 0, 3, ?, ?)`,
  ).run(
    jobId,
    SEED_KIT_JOB_KIND,
    scope.ownerId,
    JSON.stringify(payload),
    JSON.stringify(progress),
    dedupeKey,
  );

  return { jobId, progress };
}

/**
 * Fires the per-Pillar job runner asynchronously in the background (non-blocking).
 */
export function kickSeedJobRunner(db: Database.Database, jobId: string): void {
  if (isBackgroundJobsDisabled() || activeJobRunners.has(jobId)) return;
  const p = Promise.resolve()
    .then(() => runSeedKitJob(db, jobId))
    .then(() => undefined)
    .catch((err) => {
      log.warn(
        "compiler.seedHydrator",
        `Background seed job ${jobId} error: ${getErrorMessage(err)}`,
      );
    })
    .finally(() => {
      activeJobRunners.delete(jobId);
    });
  activeJobRunners.set(jobId, p);
}

/**
 * Executes a `seed_kit_pillars` job one Pillar at a time, committing cards, drills,
 * guide notes, `skeleton_json`, `jobs.progress` (`completedPillarIds`), and `rag_chunks`
 * after each Pillar so progress is live and crash-resumable.
 */
export async function runSeedKitJob(
  db: Database.Database,
  jobId: string,
  opts: { maxPillarsToProcess?: number } = {},
): Promise<SeedJobProgress | null> {
  const jobRow = db
    .prepare(
      `SELECT id, ownerId, payload, status, attempts, maxAttempts, progress
       FROM jobs
       WHERE id = ? AND kind = ?
       LIMIT 1`,
    )
    .get(jobId, SEED_KIT_JOB_KIND) as
    | {
        id: string;
        ownerId: string | null;
        payload: string;
        status: string;
        attempts: number;
        maxAttempts: number;
        progress: string | null;
      }
    | undefined;

  if (!jobRow || !jobRow.ownerId || jobRow.status === "done") {
    return jobRow?.progress
      ? parseJsonOr<SeedJobProgress | null>(jobRow.progress, null)
      : null;
  }

  const scope = scopeForOwnerId(jobRow.ownerId);
  const payload = parseJsonOr<SeedJobPayload>(jobRow.payload, {
    kitId: "",
    targetPillarIds: [],
    targetNodeIds: null,
    model: null,
  });

  const kitExists = db
    .prepare("SELECT id FROM kits WHERE ownerId = ? AND id = ? LIMIT 1")
    .get(scope.ownerId, payload.kitId) as { id: string } | undefined;

  if (!kitExists) {
    db.prepare(
      `UPDATE jobs
       SET status = 'done', finishedAt = CURRENT_TIMESTAMP
       WHERE ownerId = ? AND id = ?`,
    ).run(scope.ownerId, jobId);
    return null;
  }

  let progress = parseJsonOr<SeedJobProgress>(jobRow.progress, {
    totalPillars: payload.targetPillarIds.length,
    completedPillarIds: [],
    currentPillarId: null,
    addedCards: 0,
    addedDrills: 0,
    addedGuideNotes: 0,
  });

  db.prepare(
    `UPDATE jobs
     SET status = 'running', startedAt = COALESCE(startedAt, CURRENT_TIMESTAMP)
     WHERE ownerId = ? AND id = ?`,
  ).run(scope.ownerId, jobId);

  let processedInThisCall = 0;
  const maxBatch = opts.maxPillarsToProcess ?? Number.POSITIVE_INFINITY;

  try {
    while (processedInThisCall < maxBatch) {
      // Re-read fresh payload/progress in case Living Kit Expand merged new pillars mid-run
      const freshJob = db
        .prepare("SELECT payload, progress FROM jobs WHERE ownerId = ? AND id = ?")
        .get(scope.ownerId, jobId) as
        | { payload: string; progress: string | null }
        | undefined;
      if (!freshJob) break;

      const currentPayload = parseJsonOr<SeedJobPayload>(
        freshJob.payload,
        payload,
      );
      progress = parseJsonOr<SeedJobProgress>(freshJob.progress, progress);

      const kitRow = db
        .prepare(
          "SELECT id, slug, name, skeleton_json FROM kits WHERE ownerId = ? AND id = ? LIMIT 1",
        )
        .get(scope.ownerId, currentPayload.kitId) as
        | { id: string; slug: string; name: string; skeleton_json: string }
        | undefined;
      if (!kitRow) break;

      const currentSkeleton = parseStoredSkeleton(kitRow.skeleton_json);
      const completedSet = new Set(progress.completedPillarIds);
      const targetPillars = currentSkeleton.pillars.filter((p) =>
        currentPayload.targetPillarIds.includes(p.id),
      );
      const pendingPillars = targetPillars.filter((p) => !completedSet.has(p.id));

      if (pendingPillars.length === 0) {
        // All target pillars seeded -> mark Kit ready and Job done!
        const finishTx = db.transaction(() => {
          db.prepare(
            `UPDATE kits
             SET status = 'ready', status_detail = NULL, updated_at = datetime('now')
             WHERE ownerId = ? AND id = ?`,
          ).run(scope.ownerId, kitRow.id);

          progress = {
            ...progress,
            totalPillars: targetPillars.length,
            currentPillarId: null,
          };
          db.prepare(
            `UPDATE jobs
             SET status = 'done', progress = ?, finishedAt = CURRENT_TIMESTAMP, lastError = NULL
             WHERE ownerId = ? AND id = ?`,
          ).run(JSON.stringify(progress), scope.ownerId, jobId);
        });
        finishTx();
        return progress;
      }

      const pillar = pendingPillars[0];
      const doneIdx = targetPillars.length - pendingPillars.length + 1;
      const statusBanner = `Seeding Pillar ${doneIdx}/${targetPillars.length}: ${pillar.shortName}…`;

      progress = {
        ...progress,
        totalPillars: targetPillars.length,
        currentPillarId: pillar.id,
      };
      db.prepare(
        "UPDATE kits SET status = 'seeding', status_detail = ? WHERE ownerId = ? AND id = ?",
      ).run(statusBanner, scope.ownerId, kitRow.id);
      db.prepare(
        "UPDATE jobs SET progress = ? WHERE ownerId = ? AND id = ?",
      ).run(JSON.stringify(progress), scope.ownerId, jobId);

      // Filter nodes belonging to this pillar (and optional targetNodeIds for Living Kit expand)
      const targetNodeSet = currentPayload.targetNodeIds
        ? new Set(currentPayload.targetNodeIds)
        : null;
      const pillarNodes = currentSkeleton.graph.nodes.filter(
        (n) =>
          n.pillarId === pillar.id &&
          (targetNodeSet === null || targetNodeSet.has(n.id)),
      );

      if (pillarNodes.length === 0) {
        progress.completedPillarIds = Array.from(
          new Set([...progress.completedPillarIds, pillar.id]),
        );
        db.prepare(
          "UPDATE jobs SET progress = ? WHERE ownerId = ? AND id = ?",
        ).run(JSON.stringify(progress), scope.ownerId, jobId);
        processedInThisCall++;
        continue;
      }

      const groundingChunks = selectRelevantSourceChunks(
        db,
        scope,
        kitRow.id,
        pillar,
        pillarNodes,
        6,
      );
      const groundingBlock =
        groundingChunks.length > 0
          ? `${UNTRUSTED_POOL_INSTRUCTION}\n\n` +
            groundingChunks
              .map(
                (ch, i) =>
                  `<untrusted_data source="C${i + 1}" title="${sanitizeUntrustedExcerpt(ch.title, 140).replace(/"/g, "'")}">\n${sanitizeUntrustedExcerpt(ch.text, 1_500)}\n</untrusted_data>`,
              )
              .join("\n\n")
          : "Reference Source Chunks: (none uploaded — ground content in rigorous domain fundamentals).";

      const nodesDesc = pillarNodes
        .map(
          (n) =>
            `- nodeId="${n.id}" (topicId="${n.topicId ?? ""}"): ${n.name} — ${n.summary}`,
        )
        .join("\n");
      const sectionsDesc = pillar.sections
        .map((s) => `- sectionId="${s.id}": ${s.name} (${s.promptHint})`)
        .join("\n");
      const topicsDesc = pillar.topics
        .map((t) => `- topicId="${t.id}": ${t.name}`)
        .join("\n");

      const targetCardCount = Math.min(20, Math.max(4, pillarNodes.length * 2));
      const targetDrillCount = Math.min(8, Math.max(2, Math.ceil(pillarNodes.length / 2)));

      const generated = await runStructured<z.infer<typeof PillarSeedLlmSchema>>({
        model: currentPayload.model ?? undefined,
        scope,
        capability: "quick",
        system:
          "You are hydrating high-signal starter study materials for one Pillar of a personalized Study Kit. " +
          `Generate ${targetCardCount} atomic spaced-repetition flashcards (1-3 per concept node, testing active recall & why/tradeoffs rather thanrote trivia), ` +
          `${targetDrillCount} scenario-based Guided Drills (each with difficulty 1..3, a realistic open-ended problem prompt, 3 progressive hints from gentle nudge to structural clue, a complete workedSolution, and 3-5 rubricPoints), ` +
          "and concise Markdown `baselineGuideNotes` for key topic/section slots. " +
          "Use ONLY exact `nodeId`, `topicId`, and `sectionId` values listed for this Pillar. " +
          "If a card builds directly on an earlier card in this `cards` array, set `prerequisiteCardIndex` to that 0-based index, otherwise `null`.",
        prompt:
          `Study Kit: ${currentSkeleton.identity.name}\n` +
          `Pillar ${pillar.number} [pillarId="${pillar.id}"]: ${pillar.name}\n\n` +
          `Topics:\n${topicsDesc}\n\n` +
          `Section Lenses:\n${sectionsDesc}\n\n` +
          `Concept Nodes to Seed:\n${nodesDesc}\n\n` +
          groundingBlock,
        schema: PillarSeedLlmSchema,
        maxOutputTokens: 6144,
        feature: "compiler.seedPillar",
      });

      // Re-load latest skeleton right before commit so concurrent metadata edits aren't overwritten
      const latestKitRow = db
        .prepare(
          "SELECT skeleton_json FROM kits WHERE ownerId = ? AND id = ? LIMIT 1",
        )
        .get(scope.ownerId, kitRow.id) as { skeleton_json: string } | undefined;
      if (!latestKitRow) break;

      const latestSkeleton = parseStoredSkeleton(latestKitRow.skeleton_json);
      const latestPillar = latestSkeleton.pillars.find((p) => p.id === pillar.id);
      if (!latestPillar) {
        progress.completedPillarIds = Array.from(
          new Set([...progress.completedPillarIds, pillar.id]),
        );
        db.prepare(
          "UPDATE jobs SET progress = ? WHERE ownerId = ? AND id = ?",
        ).run(JSON.stringify(progress), scope.ownerId, jobId);
        processedInThisCall++;
        continue;
      }

      const validPillarNodeIds = new Set(
        latestSkeleton.graph.nodes
          .filter((n) => n.pillarId === latestPillar.id)
          .map((n) => n.id),
      );
      const validTopicIds = new Set(latestPillar.topics.map((t) => t.id));
      const validSectionIds = new Set(latestPillar.sections.map((s) => s.id));
      const nodeById = new Map(
        latestSkeleton.graph.nodes.map((n) => [n.id, n]),
      );
      const fallbackNodeId =
        pillarNodes.find((n) => validPillarNodeIds.has(n.id))?.id ??
        Array.from(validPillarNodeIds)[0];

      const existingCardKeys = new Set(
        (latestSkeleton.seeds.starterDeck?.cards ?? []).map((c) => c.key),
      );
      const existingDrillKeys = new Set(
        latestSkeleton.seeds.drills.map((d) => d.key),
      );

      const newCardSeeds: StarterCardSeed[] = [];
      const cardIndexToKey = new Map<number, string>();

      generated.cards.forEach((rawCard, idx) => {
        const front = rawCard.front.trim();
        const back = rawCard.back.trim();
        if (!front || !back || !fallbackNodeId) return;

        const nodeId = validPillarNodeIds.has(rawCard.nodeId)
          ? rawCard.nodeId
          : fallbackNodeId;
        const nodeObj = nodeById.get(nodeId);
        const topicId =
          rawCard.topicId && validTopicIds.has(rawCard.topicId)
            ? rawCard.topicId
            : nodeObj?.topicId && validTopicIds.has(nodeObj.topicId)
              ? nodeObj.topicId
              : latestPillar.topics[0]?.id;
        const sectionId =
          rawCard.sectionId && validSectionIds.has(rawCard.sectionId)
            ? rawCard.sectionId
            : latestPillar.sections[0]?.id;

        const key = mintUniqueSeedKey(
          `${latestSkeleton.identity.slug}:${latestPillar.id}:card:${idx + 1}`,
          existingCardKeys,
        );
        cardIndexToKey.set(idx, key);

        let prerequisiteKey: string | undefined;
        if (
          rawCard.prerequisiteCardIndex !== null &&
          Number.isInteger(rawCard.prerequisiteCardIndex) &&
          rawCard.prerequisiteCardIndex >= 0 &&
          rawCard.prerequisiteCardIndex < idx
        ) {
          prerequisiteKey = cardIndexToKey.get(rawCard.prerequisiteCardIndex);
        }

        newCardSeeds.push({
          key,
          front,
          back,
          nodeId,
          pillarId: latestPillar.id,
          ...(topicId ? { topicId } : {}),
          ...(sectionId ? { sectionId } : {}),
          ...(prerequisiteKey ? { prerequisiteKey } : {}),
        });
      });

      const newDrillSeeds: GuidedDrillSeed[] = [];
      generated.drills.forEach((rawDrill, idx) => {
        const prompt = rawDrill.prompt.trim();
        const workedSolution = rawDrill.workedSolution.trim();
        if (!prompt || !workedSolution || !fallbackNodeId) return;

        const nodeId = validPillarNodeIds.has(rawDrill.nodeId)
          ? rawDrill.nodeId
          : fallbackNodeId;
        const nodeName = nodeById.get(nodeId)?.name ?? latestPillar.name;
        const rubricPoints = rawDrill.rubricPoints
          .map((r) => r.trim())
          .filter(Boolean)
          .slice(0, 6);
        if (rubricPoints.length === 0) {
          rubricPoints.push(
            `Accurately applies core principles and tradeoffs of ${nodeName}.`,
          );
        }

        const key = mintUniqueSeedKey(
          `${latestSkeleton.identity.slug}:${latestPillar.id}:drill:${idx + 1}`,
          existingDrillKeys,
        );
        newDrillSeeds.push({
          key,
          nodeId,
          difficulty: clampDifficulty(rawDrill.difficulty),
          prompt,
          hints: normalizeThreeHints(rawDrill.hints, nodeName),
          workedSolution,
          rubricPoints,
        });
      });

      const existingGuideSlots = new Set(
        latestSkeleton.seeds.baselineGuideNotes.map(
          (g) => `${g.pillarId}\0${g.topicId}\0${g.sectionId}`,
        ),
      );
      const newBaselineNotes = generated.baselineGuideNotes
        .filter((n) => {
          if (!n.content.trim()) return false;
          if (!validTopicIds.has(n.topicId) || !validSectionIds.has(n.sectionId)) {
            return false;
          }
          const slot = `${latestPillar.id}\0${n.topicId}\0${n.sectionId}`;
          if (existingGuideSlots.has(slot)) return false;
          existingGuideSlots.add(slot);
          return true;
        })
        .map((n) => ({
          pillarId: latestPillar.id,
          topicId: n.topicId,
          sectionId: n.sectionId,
          content: n.content.trim(),
        }));

      const prevStarterDeck = latestSkeleton.seeds.starterDeck ?? {
        name: `${latestSkeleton.identity.name} Core`.slice(0, 90),
        description: `Core spaced-repetition cards for ${latestSkeleton.identity.name}.`,
        cards: [],
      };

      const updatedSkeleton = verifyKitSkeleton({
        ...latestSkeleton,
        seeds: {
          starterDeck: {
            ...prevStarterDeck,
            cards: [...prevStarterDeck.cards, ...newCardSeeds],
          },
          drills: [...latestSkeleton.seeds.drills, ...newDrillSeeds],
          baselineGuideNotes: [
            ...latestSkeleton.seeds.baselineGuideNotes,
            ...newBaselineNotes,
          ],
        },
      });

      const remainingAfterThis = pendingPillars.slice(1);
      const isFinalPillar = remainingAfterThis.length === 0;
      const nextStatusDetail = isFinalPillar
        ? null
        : `Seeding Pillar ${doneIdx + 1}/${targetPillars.length}: ${remainingAfterThis[0].shortName}…`;

      const commitPillarTx = db.transaction(() => {
        const hydrated = seedKitStarterContent(
          db,
          scope,
          kitRow.id,
          updatedSkeleton,
        );

        const nextCompleted = Array.from(
          new Set([...progress.completedPillarIds, latestPillar.id]),
        );
        progress = {
          totalPillars: targetPillars.length,
          completedPillarIds: nextCompleted,
          currentPillarId: isFinalPillar ? null : remainingAfterThis[0].id,
          addedCards: progress.addedCards + hydrated.addedCards,
          addedDrills: progress.addedDrills + hydrated.addedDrills,
          addedGuideNotes: progress.addedGuideNotes + hydrated.addedGuideNotes,
        };

        db.prepare(
          `UPDATE kits
           SET skeleton_json = ?,
               status = ?,
               status_detail = ?,
               updated_at = datetime('now')
           WHERE ownerId = ? AND id = ?`,
        ).run(
          JSON.stringify(updatedSkeleton),
          isFinalPillar ? "ready" : "seeding",
          nextStatusDetail,
          scope.ownerId,
          kitRow.id,
        );

        if (isFinalPillar) {
          db.prepare(
            `UPDATE jobs
             SET status = 'done', progress = ?, finishedAt = CURRENT_TIMESTAMP, lastError = NULL
             WHERE ownerId = ? AND id = ?`,
          ).run(JSON.stringify(progress), scope.ownerId, jobId);
        } else {
          db.prepare(
            `UPDATE jobs
             SET progress = ?
             WHERE ownerId = ? AND id = ?`,
          ).run(JSON.stringify(progress), scope.ownerId, jobId);
        }

        return hydrated;
      });
      commitPillarTx();

      // Index newly inserted flashcards and baseline guide notes into hybrid RAG
      const ragInputs: UpsertRagChunkInput[] = [];
      if (newCardSeeds.length > 0) {
        const cardRows = db
          .prepare(
            `SELECT f.id, f.node_id, f.front, f.back, f.seed_key
             FROM flashcards f
             JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
             WHERE f.ownerId = ? AND d.kit_id = ? AND f.seed_key IS NOT NULL`,
          )
          .all(scope.ownerId, kitRow.id) as Array<{
          id: string;
          node_id: string | null;
          front: string;
          back: string;
          seed_key: string;
        }>;

        const newKeySet = new Set(newCardSeeds.map((c) => c.key));
        for (const r of cardRows) {
          if (!newKeySet.has(r.seed_key)) continue;
          ragInputs.push({
            kitId: kitRow.id,
            kind: "flashcard",
            sourceRefId: r.id,
            nodeId: r.node_id,
            title: r.front.slice(0, 140),
            content: `Q: ${r.front}\nA: ${r.back}`,
          });
        }
      }

      if (newBaselineNotes.length > 0) {
        for (const note of newBaselineNotes) {
          if (!note.content.trim()) continue;
          ragInputs.push({
            kitId: kitRow.id,
            kind: "guide",
            sourceRefId: `${note.pillarId}:${note.topicId}:${note.sectionId}`,
            title: `${note.topicId} — ${note.sectionId}`,
            content: note.content,
          });
        }
      }

      if (ragInputs.length > 0) {
        await upsertRagChunksBatch(db, scope, ragInputs);
      }

      processedInThisCall++;
      if (isFinalPillar) {
        return progress;
      }
    }

    return progress;
  } catch (err) {
    const errMsg = getErrorMessage(err);
    const nextAttempts = (jobRow.attempts ?? 0) + 1;
    const exhausted = nextAttempts >= (jobRow.maxAttempts ?? 3);

    db.prepare(
      `UPDATE jobs
       SET status = ?,
           attempts = ?,
           lastError = ?,
           finishedAt = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END
       WHERE ownerId = ? AND id = ?`,
    ).run(
      exhausted ? "failed" : "queued",
      nextAttempts,
      errMsg,
      exhausted ? 1 : 0,
      scope.ownerId,
      jobId,
    );

    if (exhausted) {
      db.prepare(
        `UPDATE kits
         SET status = 'ready',
             status_detail = 'Starter seeding paused (retry via Expand Kit)',
             updated_at = datetime('now')
         WHERE ownerId = ? AND id = ?`,
      ).run(scope.ownerId, payload.kitId);
    }

    throw err;
  }
}

export const ORPHANED_JOB_RESTART_ERROR = "Interrupted by server restart";

export interface RecoverOrphanedJobsResult {
  recoveredCount: number;
  recoveredJobIds: string[];
}

/**
 * Idempotent startup recovery: marks any orphaned `status = 'running'` rows
 * left behind in `jobs` by a crashed or restarted server process as `'failed'`
 * (`lastError = 'Interrupted by server restart'`), leaving `'queued'` and
 * completed (`'done'` / `'completed'`) rows untouched.
 */
export function recoverOrphanedRunningJobs(
  db: Database.Database,
  opts: { ownerId?: string; kitId?: string } = {},
): RecoverOrphanedJobsResult {
  const tx = db.transaction((): RecoverOrphanedJobsResult => {
    const runningRows = (
      opts.ownerId
        ? db
            .prepare(
              `SELECT id, kind, ownerId, payload
               FROM jobs
               WHERE ownerId = ? AND status = 'running'`,
            )
            .all(opts.ownerId)
        : db
            .prepare(
              `SELECT id, kind, ownerId, payload
               FROM jobs
               WHERE status = 'running'`,
            )
            .all()
    ) as Array<{
      id: string;
      kind: string;
      ownerId: string | null;
      payload: string;
    }>;

    const orphaned = runningRows.filter((row) => {
      if (activeJobRunners.has(row.id)) return false;
      if (opts.kitId) {
        const parsed = parseJsonOr<{ kitId?: string }>(row.payload, {});
        return parsed.kitId === opts.kitId;
      }
      return true;
    });

    if (orphaned.length === 0) {
      return { recoveredCount: 0, recoveredJobIds: [] };
    }

    const markJobFailed = db.prepare(
      `UPDATE jobs
       SET status = 'failed',
           lastError = ?,
           finishedAt = COALESCE(finishedAt, CURRENT_TIMESTAMP)
       WHERE id = ? AND status = 'running'`,
    );
    const resetKitSeedingBanner = db.prepare(
      `UPDATE kits
       SET status = 'ready',
           status_detail = ?,
           updated_at = datetime('now')
       WHERE ownerId = ? AND id = ? AND status = 'seeding'`,
    );

    const recoveredJobIds: string[] = [];
    for (const row of orphaned) {
      const res = markJobFailed.run(ORPHANED_JOB_RESTART_ERROR, row.id);
      if (res.changes > 0) {
        recoveredJobIds.push(row.id);
        if (row.ownerId && row.kind === SEED_KIT_JOB_KIND) {
          const parsed = parseJsonOr<{ kitId?: string }>(row.payload, {});
          if (parsed.kitId) {
            resetKitSeedingBanner.run(
              ORPHANED_JOB_RESTART_ERROR,
              row.ownerId,
              parsed.kitId,
            );
          }
        }
      }
    }

    return {
      recoveredCount: recoveredJobIds.length,
      recoveredJobIds,
    };
  });

  return tx();
}

/**
 * Resumes any `queued` or `running` `seed_kit_pillars` jobs after server restart.
 */
export async function resumePendingSeedJobs(
  db: Database.Database,
  opts: { awaitCompletion?: boolean } = {},
): Promise<string[]> {
  const rows = db
    .prepare(
      `SELECT id
       FROM jobs
       WHERE kind = ? AND status IN ('queued', 'running')
       ORDER BY createdAt ASC`,
    )
    .all(SEED_KIT_JOB_KIND) as Array<{ id: string }>;

  const ids = rows.map((r) => r.id);
  if (opts.awaitCompletion) {
    for (const id of ids) {
      await runSeedKitJob(db, id);
    }
  } else {
    for (const id of ids) {
      kickSeedJobRunner(db, id);
    }
  }
  return ids;
}

export function getKitSeedStatus(
  db: Database.Database,
  scope: Scope,
  slugOrId: string,
): KitSeedStatusView {
  const kit = getOwnedKit(db, scope, slugOrId);
  const jobRow = db
    .prepare(
      `SELECT id, status, attempts, lastError, progress
       FROM jobs
       WHERE ownerId = ? AND kind = ? AND dedupeKey = ?
       ORDER BY createdAt DESC
       LIMIT 1`,
    )
    .get(scope.ownerId, SEED_KIT_JOB_KIND, `seed_kit:${kit.id}`) as
    | {
        id: string;
        status: string;
        attempts: number;
        lastError: string | null;
        progress: string | null;
      }
    | undefined;

  return {
    kitId: kit.id,
    slug: kit.slug,
    status: kit.status,
    statusDetail: kit.statusDetail,
    cardCount: kit.cardCount,
    drillCount: kit.drillCount,
    guideFilledCount: kit.guideFilledCount,
    job: jobRow
      ? {
          id: jobRow.id,
          status: jobRow.status,
          attempts: jobRow.attempts,
          lastError: jobRow.lastError,
          progress: parseJsonOr<SeedJobProgress>(jobRow.progress, {
            totalPillars: kit.pillarCount,
            completedPillarIds: [],
            currentPillarId: null,
            addedCards: 0,
            addedDrills: 0,
            addedGuideNotes: 0,
          }),
        }
      : null,
  };
}

export interface CommitCompiledKitInput {
  skeleton: KitSkeletonV1;
  stagedSources?: readonly LoadedStagedSource[];
  runSeederInBackground?: boolean;
  model?: string;
}

export interface CommitCompiledKitResult {
  kit: OwnedKitDetail;
  jobId: string;
  committedSourceIds: string[];
}

/**
 * Stage 4 Instant Save:
 * Validates skeleton via `verifyKitSkeleton`, creates `kits` (`status = 'seeding'`),
 * creates the starter deck, commits staged sources (`kit_sources`, `kit_source_chunks`, `rag_chunks`),
 * enqueues `seed_kit_pillars` in SQLite `jobs`, kicks async runner, and returns immediately (`< 300ms`).
 */
export async function commitCompiledKit(
  db: Database.Database,
  scope: Scope,
  input: CommitCompiledKitInput,
): Promise<CommitCompiledKitResult> {
  let verified: KitSkeletonV1;
  try {
    verified = verifyKitSkeleton(normalizeEditedDraftSkeleton(input.skeleton));
  } catch (err) {
    throw new AppError(
      `Invalid Study Kit skeleton: ${getErrorMessage(err)}`,
      400,
      { code: "INVALID_KIT_SKELETON" },
    );
  }

  const kitId = crypto.randomUUID();
  const uniqueSlug = mintUniqueKitSlug(db, scope, verified.identity.slug);
  const deckName =
    verified.seeds.starterDeck?.name?.trim() ||
    `${verified.identity.name} Core`.slice(0, 90);
  const deckDesc =
    verified.seeds.starterDeck?.description ??
    `Core spaced-repetition cards for ${verified.identity.name}.`;

  const storedSkeleton: KitSkeletonV1 = {
    ...verified,
    identity: {
      ...verified.identity,
      slug: uniqueSlug,
    },
    seeds: {
      ...verified.seeds,
      starterDeck: {
        name: deckName,
        description: deckDesc,
        cards: verified.seeds.starterDeck?.cards ?? [],
      },
    },
  };

  const firstPillar = storedSkeleton.pillars[0];
  const initialBanner = `Seeding Pillar 1/${storedSkeleton.pillars.length}: ${firstPillar.shortName}…`;

  let jobId = "";
  const createTx = db.transaction(() => {
    db.prepare(
      `INSERT INTO kits (
         id, ownerId, slug, name, description, icon, color,
         status, status_detail, skeleton_json,
         forked_from_shared_id, forked_version,
         created_at, updated_at, last_opened_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, 'seeding', ?, ?, NULL, NULL, datetime('now'), datetime('now'), datetime('now'))`,
    ).run(
      kitId,
      scope.ownerId,
      uniqueSlug,
      storedSkeleton.identity.name,
      storedSkeleton.identity.description,
      storedSkeleton.identity.icon,
      storedSkeleton.identity.color,
      initialBanner,
      JSON.stringify(storedSkeleton),
    );

    // Create empty starter deck immediately so workspace deck views work on arrival
    db.prepare(
      `INSERT INTO decks (
         id, ownerId, kit_id, name, description, color_index, tags, settings, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 0, '', '{}', datetime('now'), datetime('now'))`,
    ).run(crypto.randomUUID(), scope.ownerId, kitId, deckName, deckDesc);

    // Hydrate any pre-existing seeds if skeleton carried any
    seedKitStarterContent(db, scope, kitId, storedSkeleton);

    const enqueued = enqueueKitSeedJob(db, scope, {
      kitId,
      targetPillarIds: storedSkeleton.pillars.map((p) => p.id),
      targetNodeIds: null,
      model: input.model ?? null,
    });
    jobId = enqueued.jobId;
  });
  createTx();

  const sourceRes = await commitStagedSourcesToKit(
    db,
    scope,
    kitId,
    input.stagedSources ?? [],
  );

  const shouldKick =
    input.runSeederInBackground ??
    !(
      process.env.VITEST ||
      process.env.NODE_ENV === "test" ||
      isBackgroundJobsDisabled()
    );
  if (shouldKick) {
    kickSeedJobRunner(db, jobId);
  }

  const kit = getOwnedKit(db, scope, kitId);
  if (!kit) {
    throw new NotFoundError("Kit", kitId);
  }

  return {
    kit,
    jobId,
    committedSourceIds: sourceRes.sourceIds,
  };
}
