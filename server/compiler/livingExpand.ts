import type Database from "better-sqlite3";
import { z } from "zod";
import {
  verifyKitSkeleton,
  type GraphEdge,
  type GraphNode,
  type KitSkeletonV1,
  type LearningTrack,
  type Pillar,
} from "../../shared/kits/kitSkeleton.ts";
import { runStructured } from "../ai/engine.ts";
import { getOwnedKit, type OwnedKitDetail } from "../kits/kitService.ts";
import { syncKitStructure, type KitSyncResult } from "../kits/kitSync.ts";
import { ValidationError } from "../platform/net/errors.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import {
  GraphNodeLlmSchema,
  normalizeNode,
  normalizeSections,
  normalizeTopics,
  PillarLlmSchema,
  repairAndVerifyDag,
  resolveRawId,
  TopicLlmSchema,
  toSlugId,
  TrackLlmSchema,
  uniqueSlug,
  type DagRepairReport,
} from "./dagCompiler.ts";
import {
  enqueueKitSeedJob,
  kickSeedJobRunner,
  recoverOrphanedRunningJobs,
  shouldAutoKickSeeder,
} from "./seedHydrator.ts";
import { commitStagedSourcesToKit, type LoadedStagedSource } from "./sourceIngest.ts";
import {
  buildVerifiedSourcePool,
  formatVerifiedPoolForPrompt,
  hydrateBibliography,
} from "./verifiedPool.ts";

export { recoverOrphanedRunningJobs };

const EXPAND_PILLAR_COLORS = [
  "#0891b2",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#2563eb",
  "#db2777",
];

/**
 * Strict flat Zod v4 schema for Living Kits additive expansion:
 * ZERO `.optional()`, ZERO `.default()`, ZERO `z.tuple()`, ZERO `.regex()`, ZERO `z.unknown()`.
 */
export const LivingExpandLlmSchema = z.object({
  newPillars: z.array(PillarLlmSchema),
  topicAdditionsToExistingPillars: z.array(
    z.object({ existingPillarId: z.string(), topics: z.array(TopicLlmSchema) }),
  ),
  newNodes: z.array(GraphNodeLlmSchema),
  newTracks: z.array(TrackLlmSchema),
  citedSourceIds: z.array(z.string()),
});

export interface ExpandLivingKitInput {
  slugOrId: string;
  prompt: string;
  stagedSources?: readonly LoadedStagedSource[];
  enableWebResearch?: boolean;
  runSeederInBackground?: boolean;
  model?: string;
  signal?: AbortSignal;
}

export interface ExpandLivingKitResult {
  kit: OwnedKitDetail;
  jobId: string | null;
  addedPillarIds: string[];
  addedTopicIds: string[];
  addedNodeIds: string[];
  committedSourceIds: string[];
  dagRepair: DagRepairReport;
  syncStats: Omit<KitSyncResult, "kit">;
}

/**
 * Living Kits — `"Expand Kit"`:
 * Synthesizes additive Pillar(s), Topics, Concept Nodes, and DAG edges into an existing
 * personal Kit, repairs cycles across the merged graph via Tarjan SCC + tie-breaker,
 * syncs zero-data-loss via `syncKitStructure`, commits new sources, and enqueues
 * per-Pillar background seeding strictly for newly added pillars/nodes.
 */
export async function expandLivingKit(
  db: Database.Database,
  scope: Scope,
  input: ExpandLivingKitInput,
): Promise<ExpandLivingKitResult> {
  const cleanPrompt = input.prompt.trim();
  if (!cleanPrompt) {
    throw new ValidationError(
      "Provide an expansion prompt describing what to add to this Study Kit.",
    );
  }

  const existingKit = getOwnedKit(db, scope, input.slugOrId);
  const existingSkeleton = existingKit.skeleton;

  const pool = await buildVerifiedSourcePool({
    topicPrompt: `${existingKit.name}: ${cleanPrompt}`,
    depth: "standard",
    stagedSources: input.stagedSources ?? [],
    enableWebResearch: Boolean(input.enableWebResearch),
    scope,
    model: input.model,
    signal: input.signal,
  });

  const existingOutline = existingSkeleton.pillars
    .map(
      (p) =>
        `Pillar ${p.number} [pillarId="${p.id}"]: ${p.name}\n` +
        `  Lenses: ${p.sections.map((s) => s.id).join(", ")}\n` +
        p.topics.map((t) => `  - topicId="${t.id}": ${t.name}`).join("\n"),
    )
    .join("\n");

  const existingNodesSummary = existingSkeleton.graph.nodes
    .map(
      (n) =>
        `- nodeId="${n.id}" (pillarId="${n.pillarId}", topicId="${n.topicId ?? ""}"): ${n.name}`,
    )
    .join("\n");

  const poolPrompt = formatVerifiedPoolForPrompt(pool, 1_800);
  const validSourceIds = pool.entries.map((e) => e.id);

  input.signal?.throwIfAborted();
  const rawExpand = await runStructured<z.infer<typeof LivingExpandLlmSchema>>({
    model: input.model,
    scope,
    capability: "deep",
    system:
      "You are expanding an existing personal Study Kit ('Living Kit') with new curriculum material requested by the learner. " +
      "CRITICAL ADDITIVE RULES:\n" +
      "1. Emit ONLY newly added Pillars (`newPillars`), optional new Topics inside existing Pillars (`topicAdditionsToExistingPillars`), and newly added Concept Nodes (`newNodes`).\n" +
      "2. Link `newNodes` into the existing prerequisite DAG by referencing existing `nodeId`s (and/or earlier new `nodeId`s) in `prereqIds` so prerequisites flow naturally without cycles.\n" +
      "3. Generate at least 1 new Pillar (or topic addition) and 4 to 12 new Concept Nodes thoroughly covering the expansion request.\n" +
      "4. Emit ONLY verified source IDs ('S1'..'Sn') in `citedSourceIds` — NEVER invent URLs.",
    prompt:
      `Existing Study Kit: ${existingSkeleton.identity.name} (${existingSkeleton.identity.slug})\n` +
      `Expansion Request: ${cleanPrompt}\n\n` +
      `Existing Pillars & Topics:\n${existingOutline}\n\n` +
      `Existing Concept Nodes:\n${existingNodesSummary}\n\n` +
      `Available Verified Source IDs: ${validSourceIds.length > 0 ? validSourceIds.join(", ") : "(none)"}\n\n` +
      poolPrompt,
    schema: LivingExpandLlmSchema,
    maxOutputTokens: 6144,
    feature: "compiler.livingExpand",
  });

  // ── 1. Additive Pillar & Topic Merge (100% of existing IDs untouched)
  const usedPillarIds = new Set(existingSkeleton.pillars.map((p) => p.id));
  const pillarRawToId = new Map(existingSkeleton.pillars.map((p) => [p.id, p.id]));
  const topicRawToLocation = new Map<string, { pillarId: string; topicId: string }>();
  for (const p of existingSkeleton.pillars) {
    for (const t of p.topics) topicRawToLocation.set(t.id, { pillarId: p.id, topicId: t.id });
  }

  const addedPillarIds: string[] = [];
  const addedTopicIds: string[] = [];

  const mergedPillars: Pillar[] = existingSkeleton.pillars.map((p) => ({
    ...p,
    sections: [...p.sections],
    topics: [...p.topics],
  }));
  const mergedPillarById = new Map(mergedPillars.map((p) => [p.id, p]));

  for (const addition of rawExpand.topicAdditionsToExistingPillars) {
    const targetPillar = resolveRawId(mergedPillarById, addition.existingPillarId);
    if (!targetPillar) continue;

    const usedTopicsInPillar = new Set(targetPillar.topics.map((t) => t.id));
    addition.topics.forEach((rt, i) => {
      if (!rt.name.trim()) return;
      const topicId = uniqueSlug(
        rt.id || rt.name,
        `${targetPillar.id}-exp-topic-${i + 1}`,
        usedTopicsInPillar,
      );
      if (rt.id) {
        topicRawToLocation.set(rt.id.trim().toLowerCase(), { pillarId: targetPillar.id, topicId });
      }
      topicRawToLocation.set(topicId, { pillarId: targetPillar.id, topicId });
      targetPillar.topics.push({
        id: topicId,
        name: rt.name.trim().slice(0, 120),
        ...(rt.summary.trim() ? { summary: rt.summary.trim().slice(0, 400) } : {}),
      });
      addedTopicIds.push(topicId);
    });
  }

  const defaultSectionsTemplate = existingSkeleton.pillars[0].sections;
  const rawNewPillars =
    rawExpand.newPillars.length > 0 || addedTopicIds.length > 0
      ? rawExpand.newPillars
      : [
          {
            id: toSlugId(cleanPrompt.slice(0, 40), "expanded-module"),
            name: cleanPrompt.slice(0, 80),
            shortName: cleanPrompt.slice(0, 32),
            color: EXPAND_PILLAR_COLORS[0],
            sections: defaultSectionsTemplate.map((s) => ({ ...s })),
            topics: [
              {
                id: `${toSlugId(cleanPrompt.slice(0, 30), "expansion")}-core`,
                name: cleanPrompt.slice(0, 90),
                summary: `Expanded curriculum module on ${cleanPrompt.slice(0, 120)}.`,
              },
            ],
          },
        ];

  rawNewPillars.slice(0, 4).forEach((rp, idx) => {
    const pillarId = uniqueSlug(
      rp.id || rp.shortName || rp.name,
      `expanded-pillar-${idx + 1}`,
      usedPillarIds,
    );
    if (rp.id) pillarRawToId.set(rp.id.trim().toLowerCase(), pillarId);
    pillarRawToId.set(pillarId, pillarId);

    const sections = normalizeSections(rp.sections, defaultSectionsTemplate);
    const sourceTopics =
      rp.topics.length > 0
        ? rp.topics.slice(0, 6)
        : [
            {
              id: `${pillarId}-core`,
              name: `${rp.shortName || rp.name || "Expanded"} Core`,
              summary: `Core concepts for ${rp.name || cleanPrompt}.`,
            },
          ];

    const topics = normalizeTopics(sourceTopics, pillarId, topicRawToLocation);
    addedTopicIds.push(...topics.map((t) => t.id));

    const newPillar: Pillar = {
      id: pillarId,
      number: mergedPillars.length + 1,
      name: rp.name.trim().slice(0, 100) || `Expanded Pillar ${idx + 1}`,
      shortName:
        rp.shortName.trim().slice(0, 40) ||
        rp.name.trim().slice(0, 40) ||
        `Module ${mergedPillars.length + 1}`,
      color: rp.color.trim() || EXPAND_PILLAR_COLORS[idx % EXPAND_PILLAR_COLORS.length],
      sections,
      topics,
    };

    mergedPillars.push(newPillar);
    mergedPillarById.set(pillarId, newPillar);
    addedPillarIds.push(pillarId);
  });

  // ── 2. Additive Concept Nodes & Prerequisite Edges
  const usedNodeIds = new Set(existingSkeleton.graph.nodes.map((n) => n.id));
  const nodeRawToId = new Map(existingSkeleton.graph.nodes.map((n) => [n.id, n.id]));

  const fallbackNewPillar =
    (addedPillarIds[0] ? mergedPillarById.get(addedPillarIds[0]) : undefined) ??
    mergedPillars[mergedPillars.length - 1];

  const sourceNewNodes =
    rawExpand.newNodes.length > 0
      ? rawExpand.newNodes
      : fallbackNewPillar.topics.map((t) => ({
          id: `${t.id}-concept`,
          name: t.name,
          pillarId: fallbackNewPillar.id,
          topicId: t.id,
          summary: t.summary ?? `Core concepts of ${t.name}.`,
          keywords: [t.name.toLowerCase()],
          components: [],
          prereqIds:
            existingSkeleton.graph.nodes.length > 0 ? [existingSkeleton.graph.nodes[0].id] : [],
        }));

  const addedNodes: GraphNode[] = [];
  const addedNodeIds: string[] = [];
  const stagedNewEdges: Array<{ nodeId: string; rawPrereqs: string[] }> = [];

  const place = {
    pillarRawToId,
    topicRawToLocation,
    pillarsById: mergedPillarById,
    fallbackPillarId: fallbackNewPillar.id,
  };
  sourceNewNodes.forEach((rn, idx) => {
    const nodeId = uniqueSlug(rn.id || rn.name, `exp-concept-${idx + 1}`, usedNodeIds);
    if (rn.id) nodeRawToId.set(rn.id.trim().toLowerCase(), nodeId);
    nodeRawToId.set(nodeId, nodeId);

    const labels = { name: "Expanded Concept", summary: "Expanded concept in" };
    addedNodes.push(normalizeNode(rn, idx, nodeId, place, labels));
    addedNodeIds.push(nodeId);
    stagedNewEdges.push({ nodeId, rawPrereqs: rn.prereqIds });
  });

  const mergedNodes: GraphNode[] = [...existingSkeleton.graph.nodes, ...addedNodes];
  const addedEdges: GraphEdge[] = [];
  for (const item of stagedNewEdges) {
    for (const rawPre of item.rawPrereqs) {
      const preId = resolveRawId(nodeRawToId, rawPre);
      if (preId && preId !== item.nodeId) addedEdges.push({ from: preId, to: item.nodeId });
    }
  }

  const protectedEdgeKeys = new Set(existingSkeleton.graph.edges.map((e) => `${e.from}\0${e.to}`));
  const dagRepair = await repairAndVerifyDag({
    pillars: mergedPillars,
    nodes: mergedNodes,
    edges: [...existingSkeleton.graph.edges, ...addedEdges],
    scope,
    model: input.model,
    protectedEdgeKeys,
  });

  // ── 3. Additive Tracks & Bibliography
  const validNodeSet = new Set(mergedNodes.map((n) => n.id));
  const usedTrackIds = new Set(existingSkeleton.graph.tracks.map((t) => t.id));
  const addedTracks: LearningTrack[] = [];

  rawExpand.newTracks.slice(0, 3).forEach((rt, idx) => {
    const targets = Array.from(
      new Set(
        rt.targets
          .map((t) => resolveRawId(nodeRawToId, t))
          .filter((id): id is string => Boolean(id && validNodeSet.has(id))),
      ),
    );
    if (targets.length === 0) return;

    addedTracks.push({
      id: uniqueSlug(rt.id || rt.name, `exp-track-${idx + 1}`, usedTrackIds),
      name: rt.name.trim().slice(0, 100) || `Expansion Track ${idx + 1}`,
      emoji: rt.emoji.trim().slice(0, 16) || "🚀",
      description: rt.description.trim().slice(0, 400),
      targets,
    });
  });

  const hydratedNewBib = hydrateBibliography(pool, rawExpand.citedSourceIds);
  const existingBibKeys = new Set(
    existingSkeleton.bibliography.map((b) => b.url ?? `title:${b.title.toLowerCase()}`),
  );
  const mergedBib = [...existingSkeleton.bibliography];
  for (const item of hydratedNewBib) {
    const key = item.url ?? `title:${item.title.toLowerCase()}`;
    if (!existingBibKeys.has(key)) {
      existingBibKeys.add(key);
      mergedBib.push(item);
    }
  }

  const verifiedMergedSkeleton = verifyKitSkeleton({
    ...existingSkeleton,
    exportedAt: new Date().toISOString(),
    identity: {
      ...existingSkeleton.identity,
      version: (existingSkeleton.identity.version || 1) + 1,
    },
    pillars: mergedPillars,
    graph: {
      nodes: mergedNodes,
      edges: dagRepair.edges,
      tracks: [...existingSkeleton.graph.tracks, ...addedTracks],
    },
    bibliography: mergedBib,
  } satisfies KitSkeletonV1);

  // ── 4. Zero-Data-Loss Sync + Source Commit + Targeted Per-Pillar Seeder
  const { kit: _preSeedKit, ...syncStats } = syncKitStructure(
    db,
    scope,
    existingKit.id,
    verifiedMergedSkeleton,
  );

  const sourceRes = await commitStagedSourcesToKit(
    db,
    scope,
    existingKit.id,
    input.stagedSources ?? [],
  );

  const affectedPillarIds = Array.from(new Set(addedNodes.map((n) => n.pillarId)));
  let jobId: string | null = null;
  if (affectedPillarIds.length > 0 && addedNodeIds.length > 0) {
    const firstAffectedPillar = mergedPillarById.get(affectedPillarIds[0]);
    db.prepare(
      "UPDATE kits SET status = 'seeding', status_detail = ?, updated_at = datetime('now') WHERE ownerId = ? AND id = ?",
    ).run(
      `Seeding Pillar 1/${affectedPillarIds.length}: ${firstAffectedPillar?.shortName ?? "Expansion"}…`,
      scope.ownerId,
      existingKit.id,
    );

    recoverOrphanedRunningJobs(db, { ownerId: scope.ownerId, kitId: existingKit.id });

    jobId = enqueueKitSeedJob(db, scope, {
      kitId: existingKit.id,
      targetPillarIds: affectedPillarIds,
      targetNodeIds: addedNodeIds,
      model: input.model ?? null,
    }).jobId;

    if (shouldAutoKickSeeder(input.runSeederInBackground)) {
      kickSeedJobRunner(db, jobId);
    }
  }

  return {
    kit: getOwnedKit(db, scope, existingKit.id),
    jobId,
    addedPillarIds,
    addedTopicIds,
    addedNodeIds,
    committedSourceIds: sourceRes.sourceIds,
    dagRepair,
    syncStats,
  };
}
