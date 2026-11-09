import { z } from "zod";
import {
  validateGraph,
  verifyKitSkeleton,
  type GraphEdge,
  type GraphNode,
  type KitSkeletonV1,
  type LearningTrack,
  type Pillar,
} from "../../shared/kits/kitSkeleton.ts";
import { runStructured } from "../ai/engine.ts";
import { getErrorMessage, log, ValidationError } from "../platform/net/errors.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import type { CompilerDepth } from "./calibration.ts";
import {
  formatVerifiedPoolForPrompt,
  hydrateBibliography,
  type VerifiedSourcePool,
} from "./verifiedPool.ts";

const DEFAULT_PILLAR_COLORS = [
  "#006a91",
  "#2563eb",
  "#7c3aed",
  "#059669",
  "#d97706",
  "#db2777",
  "#0891b2",
  "#4f46e5",
];

const DEFAULT_SECTION_LENSES = [
  {
    id: "mental-model",
    name: "Core Mental Model",
    icon: "compass",
    promptHint: "Explain first principles, intuition, and why this exists.",
    ownershipRule: "Intuition, core definitions, invariants, and problem motivation.",
  },
  {
    id: "mechanics-tradeoffs",
    name: "Mechanics & Tradeoffs",
    icon: "sliders",
    promptHint: "Break down how it works under the hood, failure modes, and tradeoffs.",
    ownershipRule: "Internal algorithms, failure modes, complexity, and design tradeoffs.",
  },
  {
    id: "applied-practice",
    name: "Applied Patterns",
    icon: "layers",
    promptHint: "Connect to concrete scenarios, examples, and diagnostic checks.",
    ownershipRule: "Worked scenarios, production patterns, and practical heuristics.",
  },
];

/* ════════════════════════════════════════════════════════════════
   Strict Flat Zod v4 LLM Sub-Schemas
   (ZERO .optional(), ZERO .default(), ZERO z.tuple(), ZERO .regex(), ZERO z.unknown())
   ════════════════════════════════════════════════════════════════ */

const PersonaLlmSchema = z.object({ label: z.string(), prompt: z.string() });

export const IdentityLlmSchema = z.object({
  slug: z.string(),
  name: z.string(),
  description: z.string(),
  icon: z.string(),
  color: z.string(),
  tags: z.array(z.string()),
});

export const CapabilitiesLlmSchema = z.object({
  canvas: z.enum(["none", "concept", "architecture"]),
  calculator: z.boolean(),
  webResearchDefault: z.boolean(),
  enableSvgDiagrams: z.boolean(),
});

export const TopicLlmSchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
});

export const PillarLlmSchema = z.object({
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
  topics: z.array(TopicLlmSchema),
});

export const GraphNodeLlmSchema = z.object({
  id: z.string(),
  name: z.string(),
  pillarId: z.string(),
  topicId: z.string().nullable(),
  summary: z.string(),
  keywords: z.array(z.string()),
  components: z.array(z.string()),
  prereqIds: z.array(z.string()),
});

export const TrackLlmSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  description: z.string(),
  targets: z.array(z.string()),
});

export const MacroBlueprintLlmSchema = z.object({
  identity: IdentityLlmSchema,
  capabilities: CapabilitiesLlmSchema,
  tutor: z.object({
    rolePrompt: z.string(),
    personas: z.object({
      socratic: PersonaLlmSchema,
      eli5: PersonaLlmSchema,
      strict: PersonaLlmSchema,
      devil: PersonaLlmSchema,
    }),
    starterPrompts: z.array(z.string()),
    cardExamples: z.array(z.object({ front: z.string(), back: z.string() })),
  }),
  canvasConfig: z
    .object({
      components: z.array(
        z.object({
          type: z.string(),
          name: z.string(),
          category: z.string(),
          icon: z.string(),
          color: z.string().nullable(),
        }),
      ),
      protocols: z.array(z.string()),
      templates: z.array(
        z.object({ id: z.string(), name: z.string(), description: z.string() }),
      ),
      auditRubric: z.array(z.string()),
    })
    .nullable(),
  pillars: z.array(PillarLlmSchema),
});

export const ConceptGraphPassLlmSchema = z.object({
  nodes: z.array(GraphNodeLlmSchema),
  tracks: z.array(TrackLlmSchema),
  citedSourceIds: z.array(z.string()),
});

export const SccCycleRepairLlmSchema = z.object({
  repairedEdges: z.array(z.object({ from: z.string(), to: z.string() })),
});

export const RefineBlueprintLlmSchema = z.object({
  identity: IdentityLlmSchema,
  capabilities: CapabilitiesLlmSchema,
  pillars: z.array(PillarLlmSchema),
  nodes: z.array(GraphNodeLlmSchema),
  tracks: z.array(TrackLlmSchema),
  citedSourceIds: z.array(z.string()),
});

/* ════════════════════════════════════════════════════════════════
   Slug Normalization & Canonicalization Helpers
   ════════════════════════════════════════════════════════════════ */

export function toSlugId(raw: string, fallback: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return cleaned || fallback;
}

export function uniqueSlug(raw: string, fallback: string, used: Set<string>): string {
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

function normalizePillars(rawPillars: z.infer<typeof MacroBlueprintLlmSchema>["pillars"]): {
  pillars: Pillar[];
  pillarRawToId: Map<string, string>;
  topicRawToLocation: Map<string, { pillarId: string; topicId: string }>;
} {
  const usedPillarIds = new Set<string>();
  const pillarRawToId = new Map<string, string>();
  const topicRawToLocation = new Map<string, { pillarId: string; topicId: string }>();

  const sourceList =
    rawPillars.length > 0
      ? rawPillars.slice(0, 10)
      : [
          {
            id: "foundations",
            name: "Foundations & Core Principles",
            shortName: "Foundations",
            color: DEFAULT_PILLAR_COLORS[0],
            sections: DEFAULT_SECTION_LENSES,
            topics: [
              {
                id: "core-concepts",
                name: "Core Concepts",
                summary: "Foundational concepts and mental models.",
              },
            ],
          },
        ];

  const pillars: Pillar[] = sourceList.map((rp, idx) => {
    const pillarId = uniqueSlug(
      rp.id || rp.shortName || rp.name,
      `pillar-${idx + 1}`,
      usedPillarIds,
    );
    if (rp.id) pillarRawToId.set(rp.id.trim().toLowerCase(), pillarId);
    pillarRawToId.set(pillarId, pillarId);

    const usedSectionIds = new Set<string>();
    const sections = rp.sections.slice(0, 5).map((s, sIdx) => ({
      id: uniqueSlug(s.id || s.name, `lens-${sIdx + 1}`, usedSectionIds),
      name: s.name.trim().slice(0, 80) || `Lens ${sIdx + 1}`,
      icon: s.icon.trim().slice(0, 40) || "book-open",
      promptHint: s.promptHint.trim().slice(0, 300),
      ownershipRule: s.ownershipRule.trim().slice(0, 300),
    }));
    while (sections.length < 2) {
      const fb = DEFAULT_SECTION_LENSES[sections.length] ?? DEFAULT_SECTION_LENSES[0];
      sections.push({
        ...fb,
        id: uniqueSlug(fb.id, `lens-${sections.length + 1}`, usedSectionIds),
      });
    }

    const usedTopicIds = new Set<string>();
    const rawTopics =
      rp.topics.length > 0
        ? rp.topics.slice(0, 8)
        : [
            {
              id: `${pillarId}-fundamentals`,
              name: `${rp.shortName || rp.name || "Core"} Fundamentals`,
              summary: "Essential concepts and foundational building blocks.",
            },
          ];

    const topics = rawTopics.map((t, tIdx) => {
      const topicId = uniqueSlug(
        t.id || t.name,
        `${pillarId}-topic-${tIdx + 1}`,
        usedTopicIds,
      );
      if (t.id) topicRawToLocation.set(t.id.trim().toLowerCase(), { pillarId, topicId });
      topicRawToLocation.set(topicId, { pillarId, topicId });
      return {
        id: topicId,
        name: t.name.trim().slice(0, 120) || `Topic ${tIdx + 1}`,
        ...(t.summary.trim() ? { summary: t.summary.trim().slice(0, 400) } : {}),
      };
    });

    const name = rp.name.trim().slice(0, 100) || `Pillar ${idx + 1}`;
    return {
      id: pillarId,
      number: idx + 1,
      name,
      shortName: rp.shortName.trim().slice(0, 40) || name.slice(0, 40),
      color: rp.color.trim() || DEFAULT_PILLAR_COLORS[idx % DEFAULT_PILLAR_COLORS.length],
      sections,
      topics,
    };
  });

  return { pillars, pillarRawToId, topicRawToLocation };
}

/* ════════════════════════════════════════════════════════════════
   Tarjan's Strongly Connected Components + Cycle Repair + Tie-Breaker
   ════════════════════════════════════════════════════════════════ */

/**
 * Tarjan's O(V + E) strongly connected components algorithm.
 * Returns all SCCs; cyclic components are those with `scc.length > 1`
 * (once self-loops are stripped).
 */
export function findTarjanSccs(
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
): string[][] {
  const validIds = new Set(nodes.map((n) => n.id));
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    if (validIds.has(e.from) && validIds.has(e.to) && e.from !== e.to) {
      adj.get(e.from)!.push(e.to);
    }
  }

  let index = 0;
  const indices = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const sccs: string[][] = [];

  function strongConnect(v: string): void {
    indices.set(v, index);
    lowlink.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);

    for (const w of adj.get(v) ?? []) {
      if (!indices.has(w)) {
        strongConnect(w);
        lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, indices.get(w)!));
      }
    }

    if (lowlink.get(v) === indices.get(v)) {
      const scc: string[] = [];
      while (stack.length > 0) {
        const w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
        if (w === v) break;
      }
      sccs.push(scc);
    }
  }

  for (const n of nodes) {
    if (!indices.has(n.id)) strongConnect(n.id);
  }
  return sccs;
}

export function sanitizeRawEdges(
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
): GraphEdge[] {
  const validIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const clean: GraphEdge[] = [];
  for (const e of edges) {
    if (!validIds.has(e.from) || !validIds.has(e.to) || e.from === e.to) continue;
    const key = `${e.from}\0${e.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ from: e.from, to: e.to });
  }
  return clean;
}

/**
 * Deterministic topological tie-breaker:
 * Ranks every node by strict total order `(pillarNumber, nodeArrayIndex)`.
 * Within any cyclic SCC (`scc.length > 1`), drops back-edges where `rank(from) >= rank(to)`,
 * preserving all valid acyclic cross-SCC edges and guaranteeing 100% DAG validity.
 */
export function applyTopologicalTieBreaker(
  pillars: readonly Pick<Pillar, "id" | "number">[],
  nodes: readonly Pick<GraphNode, "id" | "pillarId">[],
  edges: readonly GraphEdge[],
  protectedEdgeKeys?: ReadonlySet<string>,
): { edges: GraphEdge[]; droppedEdges: GraphEdge[] } {
  const cleanEdges = sanitizeRawEdges(nodes, edges);
  const cyclicSccs = findTarjanSccs(nodes, cleanEdges).filter((scc) => scc.length > 1);
  if (cyclicSccs.length === 0) return { edges: cleanEdges, droppedEdges: [] };

  const pillarNumById = new Map<string, number>();
  pillars.forEach((p, idx) => pillarNumById.set(p.id, p.number || idx + 1));

  const rankById = new Map<string, number>();
  nodes
    .map((n, arrayIdx) => ({
      id: n.id,
      pillarNumber: pillarNumById.get(n.pillarId) ?? Number.MAX_SAFE_INTEGER,
      arrayIdx,
    }))
    .sort((a, b) =>
      a.pillarNumber !== b.pillarNumber
        ? a.pillarNumber - b.pillarNumber
        : a.arrayIdx - b.arrayIdx,
    )
    .forEach((item, rank) => rankById.set(item.id, rank));

  const dropped: GraphEdge[] = [];
  const dropBackEdges = (
    inputEdges: readonly GraphEdge[],
    sccs: string[][],
    honorProtected: boolean,
  ): GraphEdge[] => {
    const sccMap = new Map<string, number>();
    sccs.forEach((scc, idx) => {
      for (const id of scc) sccMap.set(id, idx);
    });
    const out: GraphEdge[] = [];
    for (const e of inputEdges) {
      const sf = sccMap.get(e.from);
      if (sf !== undefined && sf === sccMap.get(e.to)) {
        if (honorProtected && protectedEdgeKeys?.has(`${e.from}\0${e.to}`)) {
          out.push(e);
          continue;
        }
        if ((rankById.get(e.from) ?? 0) >= (rankById.get(e.to) ?? 0)) {
          dropped.push(e);
          continue;
        }
      }
      out.push(e);
    }
    return out;
  };

  let kept = dropBackEdges(cleanEdges, cyclicSccs, true);
  // Belt-and-suspenders: if protectedEdgeKeys participated in a residual cycle, drop unprotectedly.
  const residualCyclic = findTarjanSccs(nodes, kept).filter((s) => s.length > 1);
  if (residualCyclic.length > 0) {
    kept = dropBackEdges(kept, residualCyclic, false);
  }

  validateGraph(nodes, kept);
  return { edges: kept, droppedEdges: dropped };
}

export interface DagRepairReport {
  edges: GraphEdge[];
  initialCyclicSccCount: number;
  llmRepairAttempted: boolean;
  tieBreakerDroppedCount: number;
}

/**
 * Pass 3 symbolic verifier + bounded 1-shot `quick`-model SCC cycle repair +
 * deterministic topological tie-breaker. Guarantees `validateGraph(nodes, edges)` passes.
 */
export async function repairAndVerifyDag({
  pillars,
  nodes,
  edges,
  scope,
  model,
  protectedEdgeKeys,
}: {
  pillars: readonly Pillar[];
  nodes: readonly GraphNode[];
  edges: readonly GraphEdge[];
  scope?: Scope;
  model?: string;
  protectedEdgeKeys?: ReadonlySet<string>;
}): Promise<DagRepairReport> {
  let workingEdges = sanitizeRawEdges(nodes, edges);
  const initialCyclicSccs = findTarjanSccs(nodes, workingEdges).filter((scc) => scc.length > 1);

  if (initialCyclicSccs.length === 0) {
    validateGraph(nodes, workingEdges);
    return {
      edges: workingEdges,
      initialCyclicSccCount: 0,
      llmRepairAttempted: false,
      tieBreakerDroppedCount: 0,
    };
  }

  const cyclicNodeSet = new Set<string>(initialCyclicSccs.flat());
  const externalEdges = workingEdges.filter(
    (e) => !(cyclicNodeSet.has(e.from) && cyclicNodeSet.has(e.to)),
  );
  const internalCyclicEdges = workingEdges.filter(
    (e) => cyclicNodeSet.has(e.from) && cyclicNodeSet.has(e.to),
  );

  let llmRepairAttempted = false;
  try {
    llmRepairAttempted = true;
    const nodeById = new Map(nodes.map((n) => [n.id, n]));
    const pillarById = new Map(pillars.map((p) => [p.id, p]));
    const subgraphNodesDesc = Array.from(cyclicNodeSet)
      .map((id) => {
        const n = nodeById.get(id)!;
        const p = pillarById.get(n.pillarId);
        return `- ${n.id} (Pillar ${p?.number ?? "?"}: ${p?.shortName ?? n.pillarId}): "${n.name}" — ${n.summary}`;
      })
      .join("\n");
    const subgraphEdgesDesc = internalCyclicEdges.map((e) => `${e.from} -> ${e.to}`).join("\n");

    const repaired = await runStructured<z.infer<typeof SccCycleRepairLlmSchema>>({
      model,
      scope,
      capability: "quick",
      system:
        "You are repairing a prerequisite cycle in a curriculum Directed Acyclic Graph (DAG). " +
        "An edge `from -> to` means `from` is a prerequisite that MUST be learned BEFORE `to`. " +
        "Break all cycles among the listed nodes by removing or reversing mistaken back-edges so the subgraph is strictly acyclic. " +
        "Emit ONLY edges whose `from` and `to` both belong to the provided cyclic node list.",
      prompt:
        `Cyclic Nodes:\n${subgraphNodesDesc}\n\n` +
        `Current Cyclic Subgraph Edges (from -> to):\n${subgraphEdgesDesc}`,
      schema: SccCycleRepairLlmSchema,
      maxOutputTokens: 1536,
      feature: "compiler.sccRepair",
    });

    const allowedRepaired = repaired.repairedEdges.filter(
      (e) => cyclicNodeSet.has(e.from) && cyclicNodeSet.has(e.to) && e.from !== e.to,
    );
    const protectedInternal = protectedEdgeKeys
      ? internalCyclicEdges.filter((e) => protectedEdgeKeys.has(`${e.from}\0${e.to}`))
      : [];

    workingEdges = sanitizeRawEdges(nodes, [
      ...externalEdges,
      ...protectedInternal,
      ...allowedRepaired,
    ]);
  } catch (err) {
    log.warn(
      "compiler.sccRepair",
      `LLM cycle repair fell back to deterministic tie-breaker: ${getErrorMessage(err)}`,
    );
  }

  const tied = applyTopologicalTieBreaker(pillars, nodes, workingEdges, protectedEdgeKeys);
  return {
    edges: tied.edges,
    initialCyclicSccCount: initialCyclicSccs.length,
    llmRepairAttempted,
    tieBreakerDroppedCount: tied.droppedEdges.length,
  };
}

/* ════════════════════════════════════════════════════════════════
   Graph Node & Track Normalization
   ════════════════════════════════════════════════════════════════ */

function normalizeNodesAndTracks({
  pillars,
  pillarRawToId,
  topicRawToLocation,
  rawNodes,
  rawTracks,
}: {
  pillars: readonly Pillar[];
  pillarRawToId: ReadonlyMap<string, string>;
  topicRawToLocation: ReadonlyMap<string, { pillarId: string; topicId: string }>;
  rawNodes: z.infer<typeof ConceptGraphPassLlmSchema>["nodes"];
  rawTracks: z.infer<typeof ConceptGraphPassLlmSchema>["tracks"];
}): {
  nodes: GraphNode[];
  rawEdges: GraphEdge[];
  tracks: LearningTrack[];
} {
  const pillarsById = new Map(pillars.map((p) => [p.id, p]));
  const fallbackPillar = pillars[0];
  const usedNodeIds = new Set<string>();
  const nodeRawToId = new Map<string, string>();

  const sourceNodes =
    rawNodes.length > 0
      ? rawNodes
      : pillars.flatMap((p) =>
          p.topics.map((t) => ({
            id: `${t.id}-core`,
            name: t.name,
            pillarId: p.id,
            topicId: t.id,
            summary: t.summary ?? `Core principles of ${t.name}.`,
            keywords: [t.name.toLowerCase()],
            components: [],
            prereqIds: [] as string[],
          })),
        );

  const stagedNodes = sourceNodes.map((rn, idx) => {
    const canonicalId = uniqueSlug(rn.id || rn.name, `concept-${idx + 1}`, usedNodeIds);
    if (rn.id) nodeRawToId.set(rn.id.trim().toLowerCase(), canonicalId);
    nodeRawToId.set(canonicalId, canonicalId);

    const rawTopicKey = rn.topicId?.trim().toLowerCase() ?? "";
    const topicLoc = rawTopicKey ? topicRawToLocation.get(rawTopicKey) : undefined;

    let resolvedPillarId =
      pillarRawToId.get(rn.pillarId.trim().toLowerCase()) ??
      pillarRawToId.get(toSlugId(rn.pillarId, "")) ??
      topicLoc?.pillarId ??
      fallbackPillar.id;
    if (!pillarsById.has(resolvedPillarId)) resolvedPillarId = fallbackPillar.id;

    const pillarObj = pillarsById.get(resolvedPillarId)!;
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
      new Set(rn.keywords.map((k) => k.trim().toLowerCase().slice(0, 60)).filter(Boolean)),
    ).slice(0, 12);
    if (keywords.length === 0) {
      keywords.push(rn.name.trim().toLowerCase().slice(0, 60) || canonicalId);
    }

    const node: GraphNode = {
      id: canonicalId,
      name: rn.name.trim().slice(0, 100) || `Concept ${idx + 1}`,
      pillarId: resolvedPillarId,
      topicId: resolvedTopicId,
      summary: rn.summary.trim().slice(0, 500) || `Core concept in ${pillarObj.name}.`,
      keywords,
      components: Array.from(
        new Set(rn.components.map((c) => c.trim().slice(0, 60)).filter(Boolean)),
      ).slice(0, 8),
    };
    return { node, rawPrereqs: rn.prereqIds };
  });

  const nodes = stagedNodes.map((s) => s.node);
  const rawEdges: GraphEdge[] = [];
  for (const item of stagedNodes) {
    for (const rawPre of item.rawPrereqs) {
      const preId =
        nodeRawToId.get(rawPre.trim().toLowerCase()) ?? nodeRawToId.get(toSlugId(rawPre, ""));
      if (preId && preId !== item.node.id) rawEdges.push({ from: preId, to: item.node.id });
    }
  }

  const validNodeSet = new Set(nodes.map((n) => n.id));
  const usedTrackIds = new Set<string>();
  const tracks: LearningTrack[] = [];

  for (let i = 0; i < rawTracks.length && tracks.length < 6; i++) {
    const rt = rawTracks[i];
    const targets = Array.from(
      new Set(
        rt.targets
          .map((t) => nodeRawToId.get(t.trim().toLowerCase()) ?? nodeRawToId.get(toSlugId(t, "")))
          .filter((id): id is string => Boolean(id && validNodeSet.has(id))),
      ),
    );
    if (targets.length === 0) continue;

    tracks.push({
      id: uniqueSlug(rt.id || rt.name, `track-${i + 1}`, usedTrackIds),
      name: rt.name.trim().slice(0, 100) || `Learning Track ${i + 1}`,
      emoji: rt.emoji.trim().slice(0, 16) || "🧭",
      description: rt.description.trim().slice(0, 400),
      targets,
    });
  }

  if (tracks.length === 0 && nodes.length > 0) {
    const outgoing = new Set(rawEdges.map((e) => e.from));
    const leaves = nodes.filter((n) => !outgoing.has(n.id)).map((n) => n.id);
    tracks.push({
      id: uniqueSlug("complete-mastery", "track-1", usedTrackIds),
      name: "Complete Mastery Path",
      emoji: "🧭",
      description: "End-to-end prerequisite progression across every pillar.",
      targets: leaves.length > 0 ? leaves.slice(0, 6) : [nodes[nodes.length - 1].id],
    });
  }

  return { nodes, rawEdges, tracks };
}

/* ════════════════════════════════════════════════════════════════
   2-Pass Narrow-Schema DAG Compiler & Interactive Blueprint Refiner
   ════════════════════════════════════════════════════════════════ */

function depthTargets(depth: CompilerDepth): { pillarsRange: string; nodesRange: string } {
  if (depth === "quick") return { pillarsRange: "3 to 4", nodesRange: "12 to 18" };
  if (depth === "deep") return { pillarsRange: "5 to 7", nodesRange: "36 to 55" };
  return { pillarsRange: "4 to 6", nodesRange: "24 to 36" };
}

export interface CompileKitDagInput {
  topicPrompt: string;
  depth?: CompilerDepth;
  suggestedTitle?: string;
  suggestedIcon?: string;
  suggestedDescription?: string;
  suggestedCapabilities?: Partial<KitSkeletonV1["capabilities"]>;
  calibrationAnswers?: Record<string, string>;
  customInstructions?: string;
  pool: VerifiedSourcePool;
  scope?: Scope;
  model?: string;
  signal?: AbortSignal;
}

export interface CompileKitDagResult {
  skeleton: KitSkeletonV1;
  citedSourceIds: string[];
  dagRepair: DagRepairReport;
}

export async function compileKitDag(input: CompileKitDagInput): Promise<CompileKitDagResult> {
  const cleanTopic = input.topicPrompt.trim();
  if (!cleanTopic) {
    throw new ValidationError("Topic prompt is required to compile a Study Kit.");
  }

  const depth: CompilerDepth = input.depth ?? "standard";
  const targets = depthTargets(depth);
  const poolPrompt = formatVerifiedPoolForPrompt(input.pool, 1_800);

  const calibrationLines = input.calibrationAnswers
    ? Object.entries(input.calibrationAnswers)
        .filter(([, v]) => Boolean(v?.trim()))
        .map(([k, v]) => `- ${k}: ${v.trim()}`)
        .join("\n")
    : "";

  const contextHeader =
    `Target Topic: ${cleanTopic}\n` +
    `Depth Mode: ${depth} (target ${targets.pillarsRange} pillars and ${targets.nodesRange} total concept nodes)\n` +
    (input.suggestedTitle ? `Suggested Title: ${input.suggestedTitle}\n` : "") +
    (input.suggestedIcon ? `Suggested Icon: ${input.suggestedIcon}\n` : "") +
    (input.suggestedDescription ? `Suggested Description: ${input.suggestedDescription}\n` : "") +
    (input.suggestedCapabilities
      ? `Suggested Capabilities: ${JSON.stringify(input.suggestedCapabilities)}\n`
      : "") +
    (calibrationLines ? `Learner Scope Calibration:\n${calibrationLines}\n` : "") +
    (input.customInstructions?.trim()
      ? `Custom Learner Instructions: ${input.customInstructions.trim()}\n`
      : "");

  // ── PASS 1: Macro Blueprint (Identity, Tutor, Capabilities, Pillars/Lenses/Topics)
  input.signal?.throwIfAborted();
  const pass1 = await runStructured<z.infer<typeof MacroBlueprintLlmSchema>>({
    model: input.model,
    scope: input.scope,
    capability: "deep",
    system:
      "You are compiling Pass 1 (Macro Curriculum Blueprint) of a personalized self-study Study Kit. " +
      `Design ${targets.pillarsRange} ordered Pillars progressing from foundational prerequisites to advanced synthesis. ` +
      "Each Pillar MUST include 2 to 4 domain-appropriate Section Lenses (e.g. Core Intuition, Mechanics & Proofs, Failure Modes, Applied Case Studies) " +
      "and 2 to 5 concrete Topics. " +
      "Configure domain-tailored Tutor personas (socratic, eli5, strict, devil), 4-6 starter prompts, and 2-3 flashcard examples. " +
      "If capabilities.canvas is 'none', return canvasConfig: null; otherwise populate domain components, protocols, starter templates, and auditRubric. " +
      "Use lowercase kebab-case slug IDs (e.g. 'distributed-consensus').",
    prompt: `${contextHeader}\n${poolPrompt}`,
    schema: MacroBlueprintLlmSchema,
    maxOutputTokens: 6144,
    feature: "compiler.pass1Macro",
  });

  const { pillars, pillarRawToId, topicRawToLocation } = normalizePillars(pass1.pillars);

  const canonicalOutline = pillars
    .map(
      (p) =>
        `Pillar ${p.number} [pillarId="${p.id}"]: ${p.name}\n` +
        p.topics
          .map((t) => `  - topicId="${t.id}": ${t.name}${t.summary ? ` (${t.summary})` : ""}`)
          .join("\n"),
    )
    .join("\n");

  const validSourceIds = input.pool.entries.map((e) => e.id);

  // ── PASS 2: Concept Graph Nodes, Prerequisite Edges, Tracks & Citations
  input.signal?.throwIfAborted();
  const pass2 = await runStructured<z.infer<typeof ConceptGraphPassLlmSchema>>({
    model: input.model,
    scope: input.scope,
    capability: "deep",
    system:
      "You are compiling Pass 2 (Prerequisite Concept DAG & Learning Tracks) of a Study Kit. " +
      `Generate ${targets.nodesRange} atomic Concept Nodes covering every Pillar and Topic from Pass 1. ` +
      "CRITICAL RULES:\n" +
      "1. Every node MUST use an exact `pillarId` and `topicId` from the Canonical Pass 1 Outline.\n" +
      "2. `prereqIds` lists prerequisite concept node IDs that MUST be understood BEFORE this node (forming a strictly acyclic DAG — NEVER create cycles or self-loops).\n" +
      "3. Foundational Pillar 1 concepts should have `prereqIds: []`; later concepts should link back to earlier prerequisites.\n" +
      "4. Design 2 to 4 goal-oriented `tracks` whose `targets` reference capstone node IDs.\n" +
      "5. For `citedSourceIds`, emit ONLY source IDs from the Verified Source Pool (e.g. 'S1', 'S2') that grounded your curriculum — NEVER invent IDs or URLs.",
    prompt:
      `${contextHeader}\n` +
      `Canonical Pass 1 Outline (USE EXACT pillarId and topicId VALUES):\n${canonicalOutline}\n\n` +
      `Available Verified Source IDs: ${validSourceIds.length > 0 ? validSourceIds.join(", ") : "(none)"}\n\n` +
      poolPrompt,
    schema: ConceptGraphPassLlmSchema,
    maxOutputTokens: 8192,
    feature: "compiler.pass2Graph",
  });

  const { nodes, rawEdges, tracks } = normalizeNodesAndTracks({
    pillars,
    pillarRawToId,
    topicRawToLocation,
    rawNodes: pass2.nodes,
    rawTracks: pass2.tracks,
  });

  // ── PASS 3: Symbolic Verifier + Tarjan SCC Repair + Topological Tie-Breaker
  const dagRepair = await repairAndVerifyDag({
    pillars,
    nodes,
    edges: rawEdges,
    scope: input.scope,
    model: input.model,
  });

  const bibliography = hydrateBibliography(input.pool, pass2.citedSourceIds);

  const kitName =
    pass1.identity.name.trim().slice(0, 100) ||
    input.suggestedTitle?.trim().slice(0, 100) ||
    cleanTopic.slice(0, 80);
  const kitSlug = toSlugId(pass1.identity.slug || kitName, "custom-study-kit");
  const kitColor = pass1.identity.color.trim() || "#006a91";
  const kitIcon =
    pass1.identity.icon.trim().slice(0, 16) ||
    input.suggestedIcon?.trim().slice(0, 16) ||
    "📚";

  const usedTemplateIds = new Set<string>();
  const canvasConfig: KitSkeletonV1["canvasConfig"] =
    pass1.capabilities.canvas !== "none" && pass1.canvasConfig
      ? {
          components: pass1.canvasConfig.components.slice(0, 24).map((c, idx) => ({
            type: toSlugId(c.type || c.name, `comp-${idx + 1}`),
            name: c.name.trim().slice(0, 80) || `Component ${idx + 1}`,
            category: c.category.trim().slice(0, 60) || "General",
            icon: c.icon.trim().slice(0, 40) || "box",
            ...(c.color?.trim() ? { color: c.color.trim() } : {}),
          })),
          protocols: pass1.canvasConfig.protocols
            .map((p) => p.trim().slice(0, 60))
            .filter(Boolean)
            .slice(0, 16),
          templates: pass1.canvasConfig.templates.slice(0, 6).map((t, idx) => ({
            id: uniqueSlug(t.id || t.name, `template-${idx + 1}`, usedTemplateIds),
            name: t.name.trim().slice(0, 100) || `Template ${idx + 1}`,
            description: t.description.trim().slice(0, 400),
            nodesJson: "[]",
            edgesJson: "[]",
          })),
          auditRubric: pass1.canvasConfig.auditRubric
            .map((r) => r.trim().slice(0, 240))
            .filter(Boolean)
            .slice(0, 10),
        }
      : undefined;

  const normPersona = (
    raw: { label: string; prompt: string },
    defLabel: string,
    defPrompt: string,
  ) => ({
    label: raw.label.trim().slice(0, 60) || defLabel,
    prompt: raw.prompt.trim() || defPrompt,
  });

  const skeleton = verifyKitSkeleton({
    format: "toolbox-kit",
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    identity: {
      slug: kitSlug,
      name: kitName,
      description:
        pass1.identity.description.trim().slice(0, 600) ||
        input.suggestedDescription?.trim().slice(0, 600) ||
        `Structured Study Kit for ${kitName}.`,
      icon: kitIcon,
      color: kitColor,
      version: 1,
      tags: Array.from(
        new Set(pass1.identity.tags.map((t) => t.trim().toLowerCase().slice(0, 40)).filter(Boolean)),
      ).slice(0, 10),
    },
    capabilities: {
      canvas: pass1.capabilities.canvas,
      calculator: Boolean(pass1.capabilities.calculator),
      webResearchDefault: Boolean(pass1.capabilities.webResearchDefault),
      enableSvgDiagrams: Boolean(pass1.capabilities.enableSvgDiagrams),
    },
    tutor: {
      rolePrompt:
        pass1.tutor.rolePrompt.trim() ||
        `You are an expert tutor guiding a learner through ${kitName}.`,
      personas: {
        socratic: normPersona(
          pass1.tutor.personas.socratic,
          "Socratic",
          "Guide with probing questions before revealing answers.",
        ),
        eli5: normPersona(
          pass1.tutor.personas.eli5,
          "Intuitive",
          "Explain from concrete analogies and everyday mental models first.",
        ),
        strict: normPersona(
          pass1.tutor.personas.strict,
          "Rigorous",
          "Insist on precise terminology, invariants, and edge-case reasoning.",
        ),
        devil: normPersona(
          pass1.tutor.personas.devil,
          "Devil's Advocate",
          "Challenge hidden assumptions, failure modes, and naive designs.",
        ),
      },
      starterPrompts: pass1.tutor.starterPrompts
        .map((p) => p.trim().slice(0, 240))
        .filter(Boolean)
        .slice(0, 12),
      cardExamples: pass1.tutor.cardExamples
        .map((c) => ({ front: c.front.trim().slice(0, 300), back: c.back.trim().slice(0, 500) }))
        .filter((c) => c.front && c.back)
        .slice(0, 5),
    },
    pillars,
    graph: { nodes, edges: dagRepair.edges, tracks },
    ...(canvasConfig ? { canvasConfig } : {}),
    seeds: {
      starterDeck: {
        name: `${kitName} Core`.slice(0, 90),
        description: `Core spaced-repetition cards for ${kitName}.`,
        cards: [],
      },
      drills: [],
      baselineGuideNotes: [],
    },
    bibliography,
  } satisfies KitSkeletonV1);

  return { skeleton, citedSourceIds: pass2.citedSourceIds, dagRepair };
}

/**
 * Re-normalizes a client-edited draft skeleton (e.g. after user reorders, renames,
 * adds, or deletes pillars/topics in Stage 3 preview) so node references, tracks,
 * pillar numbers, and DAG acyclicity remain 100% valid before refine or commit.
 */
export function normalizeEditedDraftSkeleton(draft: KitSkeletonV1): KitSkeletonV1 {
  const { pillars, pillarRawToId, topicRawToLocation } = normalizePillars(
    draft.pillars.map((p) => ({
      id: p.id,
      name: p.name,
      shortName: p.shortName,
      color: p.color,
      sections: p.sections.map((s) => ({
        id: s.id,
        name: s.name,
        icon: s.icon ?? "book-open",
        promptHint: s.promptHint ?? "",
        ownershipRule: s.ownershipRule ?? "",
      })),
      topics: p.topics.map((t) => ({ id: t.id, name: t.name, summary: t.summary ?? "" })),
    })),
  );

  const survivingPillarIds = new Set(pillars.map((p) => p.id));
  const filteredDraftNodes = draft.graph.nodes.filter((n) =>
    survivingPillarIds.has(pillarRawToId.get(n.pillarId.toLowerCase()) ?? n.pillarId),
  );

  const coveredTopics = new Set(
    filteredDraftNodes.map((n) => `${n.pillarId}\0${n.topicId ?? ""}`),
  );
  const augmentedNodes = filteredDraftNodes.map((n) => ({
    ...n,
    prereqIds: draft.graph.edges.filter((e) => e.to === n.id).map((e) => e.from),
  }));

  for (const p of pillars) {
    for (const t of p.topics) {
      if (!coveredTopics.has(`${p.id}\0${t.id}`)) {
        augmentedNodes.push({
          id: `${t.id}-concept`,
          name: t.name,
          pillarId: p.id,
          topicId: t.id,
          summary: t.summary ?? `Core concepts and principles of ${t.name}.`,
          keywords: [t.name.toLowerCase()],
          components: [],
          prereqIds: [],
        });
      }
    }
  }

  const { nodes, rawEdges, tracks } = normalizeNodesAndTracks({
    pillars,
    pillarRawToId,
    topicRawToLocation,
    rawNodes: augmentedNodes,
    rawTracks: draft.graph.tracks,
  });

  const tied = applyTopologicalTieBreaker(pillars, nodes, rawEdges);

  return verifyKitSkeleton({
    ...draft,
    exportedAt: new Date().toISOString(),
    identity: {
      ...draft.identity,
      slug: toSlugId(draft.identity.slug || draft.identity.name, "study-kit"),
      name: draft.identity.name.trim().slice(0, 100) || "Study Kit",
    },
    pillars,
    graph: { nodes, edges: tied.edges, tracks },
  });
}

export async function refineBlueprint({
  draftSkeleton,
  instruction,
  pool,
  scope,
  model,
  signal,
}: {
  draftSkeleton: KitSkeletonV1;
  instruction: string;
  pool: VerifiedSourcePool;
  scope?: Scope;
  model?: string;
  signal?: AbortSignal;
}): Promise<CompileKitDagResult> {
  const cleanInstruction = instruction.trim();
  if (!cleanInstruction) {
    throw new ValidationError("Refinement instruction cannot be empty.");
  }

  const normalizedDraft = normalizeEditedDraftSkeleton(draftSkeleton);
  const prereqsByNode = new Map<string, string[]>();
  for (const e of normalizedDraft.graph.edges) {
    const list = prereqsByNode.get(e.to) ?? [];
    list.push(e.from);
    prereqsByNode.set(e.to, list);
  }

  const compactDraft = {
    identity: {
      slug: normalizedDraft.identity.slug,
      name: normalizedDraft.identity.name,
      description: normalizedDraft.identity.description,
      icon: normalizedDraft.identity.icon,
      color: normalizedDraft.identity.color,
      tags: normalizedDraft.identity.tags,
    },
    capabilities: normalizedDraft.capabilities,
    pillars: normalizedDraft.pillars,
    nodes: normalizedDraft.graph.nodes.map((n) => ({
      ...n,
      prereqIds: prereqsByNode.get(n.id) ?? [],
    })),
    tracks: normalizedDraft.graph.tracks,
  };

  const poolPrompt = formatVerifiedPoolForPrompt(pool, 1_200);
  signal?.throwIfAborted();
  const refined = await runStructured<z.infer<typeof RefineBlueprintLlmSchema>>({
    model,
    scope,
    capability: "deep",
    system:
      "You are refining an interactive Study Kit Blueprint according to the learner's chat instruction. " +
      "Preserve existing slug IDs for unchanged pillars, topics, and concept nodes whenever possible; " +
      "apply the requested additions, removals, re-orderings, or depth changes cleanly; " +
      "ensure every node uses a valid `pillarId` and `topicId` from `pillars`, and keep `prereqIds` strictly acyclic. " +
      "Emit ONLY verified source IDs ('S1'..'Sn') in `citedSourceIds`.",
    prompt:
      `Learner Refinement Instruction: ${cleanInstruction}\n\n` +
      `Current Blueprint JSON:\n${JSON.stringify(compactDraft)}\n\n` +
      poolPrompt,
    schema: RefineBlueprintLlmSchema,
    maxOutputTokens: 8192,
    feature: "compiler.refine",
  });

  const { pillars, pillarRawToId, topicRawToLocation } = normalizePillars(refined.pillars);
  const { nodes, rawEdges, tracks } = normalizeNodesAndTracks({
    pillars,
    pillarRawToId,
    topicRawToLocation,
    rawNodes: refined.nodes,
    rawTracks: refined.tracks,
  });

  const dagRepair = await repairAndVerifyDag({
    pillars,
    nodes,
    edges: rawEdges,
    scope,
    model,
  });

  const newBib = hydrateBibliography(pool, refined.citedSourceIds);
  const nextName = refined.identity.name.trim().slice(0, 100) || normalizedDraft.identity.name;

  const skeleton = verifyKitSkeleton({
    ...normalizedDraft,
    exportedAt: new Date().toISOString(),
    identity: {
      ...normalizedDraft.identity,
      slug: toSlugId(refined.identity.slug || nextName, normalizedDraft.identity.slug),
      name: nextName,
      description:
        refined.identity.description.trim().slice(0, 600) ||
        normalizedDraft.identity.description,
      icon: refined.identity.icon.trim().slice(0, 16) || normalizedDraft.identity.icon,
      color: refined.identity.color.trim() || normalizedDraft.identity.color,
      tags: refined.identity.tags
        .map((t) => t.trim().toLowerCase().slice(0, 40))
        .filter(Boolean)
        .slice(0, 10),
    },
    capabilities: {
      canvas: refined.capabilities.canvas,
      calculator: Boolean(refined.capabilities.calculator),
      webResearchDefault: Boolean(refined.capabilities.webResearchDefault),
      enableSvgDiagrams: Boolean(refined.capabilities.enableSvgDiagrams),
    },
    pillars,
    graph: { nodes, edges: dagRepair.edges, tracks },
    bibliography: newBib.length > 0 ? newBib : normalizedDraft.bibliography,
  });

  return { skeleton, citedSourceIds: refined.citedSourceIds, dagRepair };
}
