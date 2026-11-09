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
  repairAndVerifyDag,
  toSlugId,
  type DagRepairReport,
} from "./dagCompiler.ts";
import { enqueueKitSeedJob, kickSeedJobRunner } from "./seedHydrator.ts";
import {
  commitStagedSourcesToKit,
  type LoadedStagedSource,
} from "./sourceIngest.ts";
import {
  buildVerifiedSourcePool,
  formatVerifiedPoolForPrompt,
  hydrateBibliography,
} from "./verifiedPool.ts";

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
  newPillars: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      shortName: z.string(),
      color: z.string(),
      sections: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          icon: z.string(),
          promptHint: z.string(),
          ownershipRule: z.string(),
        }),
      ),
      topics: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          summary: z.string(),
        }),
      ),
    }),
  ),
  topicAdditionsToExistingPillars: z.array(
    z.object({
      existingPillarId: z.string(),
      topics: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          summary: z.string(),
        }),
      ),
    }),
  ),
  newNodes: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      pillarId: z.string(),
      topicId: z.string().nullable(),
      summary: z.string(),
      keywords: z.array(z.string()),
      components: z.array(z.string()),
      prereqIds: z.array(z.string()),
    }),
  ),
  newTracks: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      emoji: z.string(),
      description: z.string(),
      targets: z.array(z.string()),
    }),
  ),
  citedSourceIds: z.array(z.string()),
});

function mintUniqueSlug(raw: string, fallback: string, used: Set<string>): string {
  const base = toSlugId(raw, fallback);
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  for (let i = 2; i < 10_000; i++) {
    const candidate = `${base}-${i}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const emergency = `${base}-${used.size + 1}`;
  used.add(emergency);
  return emergency;
}

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
  const pillarRawToId = new Map<string, string>(
    existingSkeleton.pillars.map((p) => [p.id, p.id]),
  );
  const topicRawToLocation = new Map<
    string,
    { pillarId: string; topicId: string }
  >();
  for (const p of existingSkeleton.pillars) {
    for (const t of p.topics) {
      topicRawToLocation.set(t.id, { pillarId: p.id, topicId: t.id });
    }
  }

  const addedPillarIds: string[] = [];
  const addedTopicIds: string[] = [];

  // Clone existing pillars & apply topicAdditionsToExistingPillars
  const mergedPillars: Pillar[] = existingSkeleton.pillars.map((p) => ({
    ...p,
    sections: [...p.sections],
    topics: [...p.topics],
  }));
  const mergedPillarById = new Map(mergedPillars.map((p) => [p.id, p]));

  for (const addition of rawExpand.topicAdditionsToExistingPillars) {
    const targetPillar =
      mergedPillarById.get(addition.existingPillarId.trim().toLowerCase()) ??
      mergedPillarById.get(toSlugId(addition.existingPillarId, ""));
    if (!targetPillar) continue;

    const usedTopicsInPillar = new Set(targetPillar.topics.map((t) => t.id));
    for (let i = 0; i < addition.topics.length; i++) {
      const rt = addition.topics[i];
      if (!rt.name.trim()) continue;
      const topicId = mintUniqueSlug(
        rt.id || rt.name,
        `${targetPillar.id}-exp-topic-${i + 1}`,
        usedTopicsInPillar,
      );
      if (rt.id) {
        topicRawToLocation.set(rt.id.trim().toLowerCase(), {
          pillarId: targetPillar.id,
          topicId,
        });
      }
      topicRawToLocation.set(topicId, { pillarId: targetPillar.id, topicId });
      targetPillar.topics.push({
        id: topicId,
        name: rt.name.trim().slice(0, 120),
        ...(rt.summary.trim() ? { summary: rt.summary.trim().slice(0, 400) } : {}),
      });
      addedTopicIds.push(topicId);
    }
  }

  // Fallback: if LLM emitted neither newPillars nor topicAdditions, create 1 additive Pillar from the prompt
  const rawNewPillars =
    rawExpand.newPillars.length > 0 || addedTopicIds.length > 0
      ? rawExpand.newPillars
      : [
          {
            id: toSlugId(cleanPrompt.slice(0, 40), "expanded-module"),
            name: cleanPrompt.slice(0, 80),
            shortName: cleanPrompt.slice(0, 32),
            color: EXPAND_PILLAR_COLORS[0],
            sections: existingSkeleton.pillars[0].sections.map((s) => ({
              id: s.id,
              name: s.name,
              icon: s.icon,
              promptHint: s.promptHint,
              ownershipRule: s.ownershipRule,
            })),
            topics: [
              {
                id: `${toSlugId(cleanPrompt.slice(0, 30), "expansion")}-core`,
                name: cleanPrompt.slice(0, 90),
                summary: `Expanded curriculum module on ${cleanPrompt.slice(0, 120)}.`,
              },
            ],
          },
        ];

  const defaultSectionsTemplate = existingSkeleton.pillars[0].sections;

  rawNewPillars.slice(0, 4).forEach((rp, idx) => {
    const pillarId = mintUniqueSlug(
      rp.id || rp.shortName || rp.name,
      `expanded-pillar-${idx + 1}`,
      usedPillarIds,
    );
    if (rp.id) pillarRawToId.set(rp.id.trim().toLowerCase(), pillarId);
    pillarRawToId.set(pillarId, pillarId);

    const usedSecIds = new Set<string>();
    const sections = rp.sections.slice(0, 5).map((s, sIdx) => ({
      id: mintUniqueSlug(s.id || s.name, `lens-${sIdx + 1}`, usedSecIds),
      name: s.name.trim().slice(0, 80) || `Lens ${sIdx + 1}`,
      icon: s.icon.trim().slice(0, 40) || "book-open",
      promptHint: s.promptHint.trim().slice(0, 300),
      ownershipRule: s.ownershipRule.trim().slice(0, 300),
    }));
    while (sections.length < 2) {
      const tmpl =
        defaultSectionsTemplate[sections.length] ?? defaultSectionsTemplate[0];
      sections.push({
        id: mintUniqueSlug(tmpl.id, `lens-${sections.length + 1}`, usedSecIds),
        name: tmpl.name,
        icon: tmpl.icon,
        promptHint: tmpl.promptHint,
        ownershipRule: tmpl.ownershipRule,
      });
    }

    const usedTopicIds = new Set<string>();
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

    const topics = sourceTopics.map((t, tIdx) => {
      const topicId = mintUniqueSlug(
        t.id || t.name,
        `${pillarId}-topic-${tIdx + 1}`,
        usedTopicIds,
      );
      if (t.id) {
        topicRawToLocation.set(t.id.trim().toLowerCase(), { pillarId, topicId });
      }
      topicRawToLocation.set(topicId, { pillarId, topicId });
      addedTopicIds.push(topicId);
      return {
        id: topicId,
        name: t.name.trim().slice(0, 120) || `Topic ${tIdx + 1}`,
        ...(t.summary.trim() ? { summary: t.summary.trim().slice(0, 400) } : {}),
      };
    });

    const newPillar: Pillar = {
      id: pillarId,
      number: mergedPillars.length + 1,
      name: rp.name.trim().slice(0, 100) || `Expanded Pillar ${idx + 1}`,
      shortName:
        rp.shortName.trim().slice(0, 40) ||
        rp.name.trim().slice(0, 40) ||
        `Module ${mergedPillars.length + 1}`,
      color:
        rp.color.trim() ||
        EXPAND_PILLAR_COLORS[idx % EXPAND_PILLAR_COLORS.length],
      sections,
      topics,
    };

    mergedPillars.push(newPillar);
    mergedPillarById.set(pillarId, newPillar);
    addedPillarIds.push(pillarId);
  });

  // ── 2. Additive Concept Nodes & Prerequisite Edges
  const usedNodeIds = new Set(existingSkeleton.graph.nodes.map((n) => n.id));
  const nodeRawToId = new Map<string, string>(
    existingSkeleton.graph.nodes.map((n) => [n.id, n.id]),
  );

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
            existingSkeleton.graph.nodes.length > 0
              ? [existingSkeleton.graph.nodes[0].id]
              : [],
        }));

  const addedNodes: GraphNode[] = [];
  const addedNodeIds: string[] = [];
  const stagedNewEdges: Array<{ nodeId: string; rawPrereqs: string[] }> = [];

  sourceNewNodes.forEach((rn, idx) => {
    const nodeId = mintUniqueSlug(
      rn.id || rn.name,
      `exp-concept-${idx + 1}`,
      usedNodeIds,
    );
    if (rn.id) nodeRawToId.set(rn.id.trim().toLowerCase(), nodeId);
    nodeRawToId.set(nodeId, nodeId);

    const rawTopicKey = rn.topicId?.trim().toLowerCase() ?? "";
    const topicLoc = rawTopicKey ? topicRawToLocation.get(rawTopicKey) : undefined;
    let resolvedPillarId =
      pillarRawToId.get(rn.pillarId.trim().toLowerCase()) ??
      pillarRawToId.get(toSlugId(rn.pillarId, "")) ??
      topicLoc?.pillarId ??
      fallbackNewPillar.id;
    if (!mergedPillarById.has(resolvedPillarId)) {
      resolvedPillarId = fallbackNewPillar.id;
    }

    const pillarObj = mergedPillarById.get(resolvedPillarId)!;
    const pillarTopicSet = new Set(pillarObj.topics.map((t) => t.id));
    let resolvedTopicId: string | null = null;
    if (topicLoc && topicLoc.pillarId === resolvedPillarId) {
      resolvedTopicId = topicLoc.topicId;
    } else if (rn.topicId && pillarTopicSet.has(toSlugId(rn.topicId, ""))) {
      resolvedTopicId = toSlugId(rn.topicId, "");
    } else if (pillarObj.topics.length > 0) {
      resolvedTopicId = pillarObj.topics[idx % pillarObj.topics.length].id;
    }

    const keywords = Array.from(
      new Set(
        rn.keywords
          .map((k) => k.trim().toLowerCase().slice(0, 60))
          .filter(Boolean),
      ),
    ).slice(0, 12);
    if (keywords.length === 0) {
      keywords.push(rn.name.trim().toLowerCase().slice(0, 60) || nodeId);
    }

    const node: GraphNode = {
      id: nodeId,
      name: rn.name.trim().slice(0, 100) || `Expanded Concept ${idx + 1}`,
      pillarId: resolvedPillarId,
      topicId: resolvedTopicId,
      summary:
        rn.summary.trim().slice(0, 500) ||
        `Expanded concept in ${pillarObj.name}.`,
      keywords,
      components: Array.from(
        new Set(rn.components.map((c) => c.trim().slice(0, 60)).filter(Boolean)),
      ).slice(0, 8),
    };

    addedNodes.push(node);
    addedNodeIds.push(nodeId);
    stagedNewEdges.push({ nodeId, rawPrereqs: rn.prereqIds });
  });

  const mergedNodes: GraphNode[] = [
    ...existingSkeleton.graph.nodes,
    ...addedNodes,
  ];
  const addedEdges: GraphEdge[] = [];
  for (const item of stagedNewEdges) {
    for (const rawPre of item.rawPrereqs) {
      const preId =
        nodeRawToId.get(rawPre.trim().toLowerCase()) ??
        nodeRawToId.get(toSlugId(rawPre, ""));
      if (preId && preId !== item.nodeId) {
        addedEdges.push({ from: preId, to: item.nodeId });
      }
    }
  }

  // Protect existing DAG edges so tie-breaking preferentially drops newly introduced back-edges
  const protectedEdgeKeys = new Set(
    existingSkeleton.graph.edges.map((e) => `${e.from}\0${e.to}`),
  );

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
          .map(
            (t) =>
              nodeRawToId.get(t.trim().toLowerCase()) ??
              nodeRawToId.get(toSlugId(t, "")),
          )
          .filter((id): id is string => Boolean(id && validNodeSet.has(id))),
      ),
    );
    if (targets.length === 0) return;

    addedTracks.push({
      id: mintUniqueSlug(rt.id || rt.name, `exp-track-${idx + 1}`, usedTrackIds),
      name: rt.name.trim().slice(0, 100) || `Expansion Track ${idx + 1}`,
      emoji: rt.emoji.trim().slice(0, 16) || "🚀",
      description: rt.description.trim().slice(0, 400),
      targets,
    });
  });

  const hydratedNewBib = hydrateBibliography(pool, rawExpand.citedSourceIds);
  const existingBibKeys = new Set(
    existingSkeleton.bibliography.map(
      (b) => b.url ?? `title:${b.title.toLowerCase()}`,
    ),
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
  const synced = syncKitStructure(
    db,
    scope,
    existingKit.id,
    verifiedMergedSkeleton,
  );
  const { kit: _preSeedKit, ...syncStats } = synced;

  const sourceRes = await commitStagedSourcesToKit(
    db,
    scope,
    existingKit.id,
    input.stagedSources ?? [],
  );

  const affectedPillarIds = Array.from(
    new Set(addedNodes.map((n) => n.pillarId)),
  );

  let jobId: string | null = null;
  if (affectedPillarIds.length > 0 && addedNodeIds.length > 0) {
    const firstAffectedPillar = mergedPillarById.get(affectedPillarIds[0]);
    const banner = `Seeding Pillar 1/${affectedPillarIds.length}: ${firstAffectedPillar?.shortName ?? "Expansion"}…`;

    db.prepare(
      `UPDATE kits
       SET status = 'seeding', status_detail = ?, updated_at = datetime('now')
       WHERE ownerId = ? AND id = ?`,
    ).run(banner, scope.ownerId, existingKit.id);

    const enqueued = enqueueKitSeedJob(db, scope, {
      kitId: existingKit.id,
      targetPillarIds: affectedPillarIds,
      targetNodeIds: addedNodeIds,
      model: input.model ?? null,
    });
    jobId = enqueued.jobId;

    const shouldKick =
      input.runSeederInBackground ??
      !(process.env.VITEST || process.env.NODE_ENV === "test");
    if (shouldKick) {
      kickSeedJobRunner(db, jobId);
    }
  }

  const updatedKit = getOwnedKit(db, scope, existingKit.id);
  return {
    kit: updatedKit,
    jobId,
    addedPillarIds,
    addedTopicIds,
    addedNodeIds,
    committedSourceIds: sourceRes.sourceIds,
    dagRepair,
    syncStats,
  };
}
