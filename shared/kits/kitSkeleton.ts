import { z } from "zod";

const slugId = z.string().regex(/^[a-z0-9-]+$/);

export const SectionLensSchema = z.object({
  id: slugId,
  name: z.string().min(1).max(80),
  icon: z.string().default("book-open"),
  promptHint: z.string().max(300).default(""),
  ownershipRule: z.string().max(300).default(""),
});

export const PillarTopicSchema = z.object({
  id: slugId,
  name: z.string().min(1).max(120),
  summary: z.string().max(400).optional(),
});

export const PillarSchema = z.object({
  id: slugId,
  number: z.number().int().positive(),
  name: z.string().min(1).max(100),
  shortName: z.string().min(1).max(40),
  color: z.string().min(1),
  sections: z.array(SectionLensSchema).min(2).max(8),
  topics: z.array(PillarTopicSchema).min(1),
});

export const GraphNodeSchema = z.object({
  id: slugId,
  name: z.string().min(1).max(100),
  pillarId: slugId,
  topicId: slugId.nullable().default(null),
  summary: z.string().max(500),
  keywords: z.array(z.string()).default([]),
  components: z.array(z.string()).default([]),
});

export const GraphEdgeSchema = z.object({
  from: slugId,
  to: slugId,
});

export const LearningTrackSchema = z.object({
  id: slugId,
  name: z.string().min(1).max(100),
  emoji: z.string().default("🧭"),
  description: z.string().max(400),
  targets: z.array(slugId).min(1),
});

export const StarterCardSeedSchema = z.object({
  key: z.string().min(1),
  front: z.string().min(1),
  back: z.string().min(1),
  nodeId: slugId.optional(),
  pillarId: slugId.optional(),
  topicId: slugId.optional(),
  sectionId: slugId.optional(),
  prerequisiteKey: z.string().optional(),
});

export const GuidedDrillSeedSchema = z.object({
  key: z.string().min(1),
  nodeId: slugId,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  prompt: z.string().min(1),
  hints: z.tuple([z.string(), z.string(), z.string()]),
  workedSolution: z.string().min(1),
  rubricPoints: z.array(z.string()).min(1),
});

export const TutorPersonaSchema = z.object({
  label: z.string().min(1).max(60),
  prompt: z.string().min(1),
});

export const KitSkeletonV1Schema = z.object({
  format: z.literal("toolbox-kit"),
  schemaVersion: z.literal(1),
  exportedAt: z.iso.datetime(),

  identity: z.object({
    slug: slugId,
    name: z.string().min(1).max(100),
    description: z.string().max(600).default(""),
    icon: z.string().max(16).default("📚"),
    color: z.string().default("#006a91"),
    version: z.number().int().positive().default(1),
    author: z.string().max(100).optional(),
    tags: z.array(z.string().max(40)).default([]),
  }),

  capabilities: z.object({
    canvas: z.enum(["none", "concept", "architecture"]).default("none"),
    calculator: z.boolean().default(false),
    webResearchDefault: z.boolean().default(false),
    enableSvgDiagrams: z.boolean().default(true),
  }),

  tutor: z.object({
    rolePrompt: z.string().min(1),
    personas: z.object({
      socratic: TutorPersonaSchema,
      eli5: TutorPersonaSchema,
      strict: TutorPersonaSchema,
      devil: TutorPersonaSchema,
    }),
    starterPrompts: z.array(z.string()).max(12).default([]),
    cardExamples: z
      .array(z.object({ front: z.string(), back: z.string() }))
      .max(5)
      .default([]),
  }),

  pillars: z.array(PillarSchema).min(1),

  graph: z.object({
    nodes: z.array(GraphNodeSchema).min(1),
    edges: z.array(GraphEdgeSchema),
    tracks: z.array(LearningTrackSchema).default([]),
  }),

  canvasConfig: z
    .object({
      components: z
        .array(
          z.object({
            type: z.string(),
            name: z.string(),
            category: z.string(),
            icon: z.string(),
            color: z.string().optional(),
          }),
        )
        .default([]),
      protocols: z.array(z.string()).default([]),
      templates: z.array(z.unknown()).default([]),
      auditRubric: z.array(z.string()).default([]),
    })
    .optional(),

  seeds: z.object({
    starterDeck: z
      .object({
        name: z.string().min(1),
        description: z.string().default(""),
        cards: z.array(StarterCardSeedSchema),
      })
      .optional(),
    drills: z.array(GuidedDrillSeedSchema).default([]),
    baselineGuideNotes: z
      .array(
        z.object({
          pillarId: slugId,
          topicId: slugId,
          sectionId: slugId,
          content: z.string(),
        }),
      )
      .default([]),
  }),

  bibliography: z
    .array(
      z.object({
        title: z.string().min(1),
        url: z.url().optional(),
        note: z.string().optional(),
      }),
    )
    .default([]),
});

export type SectionLens = z.infer<typeof SectionLensSchema>;
export type Pillar = z.infer<typeof PillarSchema>;
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type LearningTrack = z.infer<typeof LearningTrackSchema>;
export type StarterCardSeed = z.infer<typeof StarterCardSeedSchema>;
export type GuidedDrillSeed = z.infer<typeof GuidedDrillSeedSchema>;
export type KitSkeletonV1 = z.infer<typeof KitSkeletonV1Schema>;

/* ════════════════════════════════════════════════════════════════
   Pure DAG & Card-Matching Algorithms (shared by client & server)
   ════════════════════════════════════════════════════════════════ */

export interface GraphNodeLike {
  id: string;
  name?: string;
  pillarId: string;
  topicId: string | null;
  keywords: string[];
  components?: string[];
  summary?: string;
}

export function nodeMap<T extends { id: string }>(nodes: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const n of nodes) map.set(n.id, n);
  return map;
}

export function prerequisitesOf(edges: readonly GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of edges) {
    let list = map.get(e.to);
    if (!list) {
      list = [];
      map.set(e.to, list);
    }
    list.push(e.from);
  }
  return map;
}

export function dependentsOf(edges: readonly GraphEdge[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const e of edges) {
    let list = map.get(e.from);
    if (!list) {
      list = [];
      map.set(e.from, list);
    }
    list.push(e.to);
  }
  return map;
}

/**
 * Kahn's algorithm. Ties break on original node-array order for stability.
 */
export function topologicalSort(
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
): string[] {
  const indegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adj = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!indegree.has(e.from) || !indegree.has(e.to)) continue;
    indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1);
    adj.get(e.from)?.push(e.to);
  }
  const orderIndex = new Map<string, number>(nodes.map((n, i) => [n.id, i]));
  const queue = nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const result: string[] = [];
  while (queue.length > 0) {
    queue.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
    const id = queue.shift()!;
    result.push(id);
    for (const next of adj.get(id) ?? []) {
      const nextDeg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }
  return result;
}

export function validateGraph(
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
): true {
  const ids = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id)) throw new Error(`Duplicate node id: ${n.id}`);
    ids.add(n.id);
  }
  for (const e of edges) {
    if (!ids.has(e.from)) throw new Error(`Edge references missing node: ${e.from}`);
    if (!ids.has(e.to)) throw new Error(`Edge references missing node: ${e.to}`);
    if (e.from === e.to) throw new Error(`Self-loop on node: ${e.from}`);
  }
  const order = topologicalSort(nodes, edges);
  if (order.length !== nodes.length) {
    const sorted = new Set(order);
    const cyclic = nodes.filter((n) => !sorted.has(n.id)).map((n) => n.id);
    throw new Error(
      `Cycle detected in prerequisite graph involving: ${cyclic.join(", ")}`,
    );
  }
  return true;
}

export function nodeDepths(
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
): Map<string, number> {
  const prereqs = prerequisitesOf(edges);
  const depths = new Map<string, number>();
  for (const id of topologicalSort(nodes, edges)) {
    const above = prereqs.get(id) ?? [];
    depths.set(
      id,
      above.length === 0
        ? 0
        : Math.max(...above.map((p) => depths.get(p) ?? 0)) + 1,
    );
  }
  return depths;
}

export function ancestorsOf(nodeId: string, edges: readonly GraphEdge[]): Set<string> {
  const prereqs = prerequisitesOf(edges);
  const seen = new Set<string>();
  const stack = [...(prereqs.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const p of prereqs.get(id) ?? []) stack.push(p);
  }
  return seen;
}

export function descendantsOf(nodeId: string, edges: readonly GraphEdge[]): Set<string> {
  const deps = dependentsOf(edges);
  const seen = new Set<string>();
  const stack = [...(deps.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of deps.get(id) ?? []) stack.push(d);
  }
  return seen;
}

export function expandTrack(
  track: { targets: readonly string[] },
  nodes: readonly { id: string }[],
  edges: readonly GraphEdge[],
): string[] {
  const wanted = new Set<string>(track.targets);
  for (const target of track.targets) {
    for (const anc of ancestorsOf(target, edges)) wanted.add(anc);
  }
  return topologicalSort(nodes, edges).filter((id) => wanted.has(id));
}

export interface CardForNodeMatching {
  front?: string | null;
  back?: string | null;
  node_id?: string | null;
  source_topic_id?: string | null;
}

/**
 * Match a flashcard to graph nodes:
 * 1. Explicit `node_id` wins when set and present in `nodes`.
 * 2. Keyword hits on `front + back` match next.
 * 3. `source_topic_id` is the coarse fallback.
 */
export function nodesForCard(
  card: CardForNodeMatching,
  nodes: readonly GraphNodeLike[],
): string[] {
  if (card.node_id && nodes.some((n) => n.id === card.node_id)) {
    return [card.node_id];
  }
  const text = `${card.front ?? ""} ${card.back ?? ""}`.toLowerCase();
  const keywordHits: string[] = [];
  for (const node of nodes) {
    if (node.keywords.some((kw) => text.includes(kw))) keywordHits.push(node.id);
  }
  if (keywordHits.length > 0) return keywordHits;
  if (card.source_topic_id) {
    return nodes
      .filter((n) => n.topicId === card.source_topic_id)
      .map((n) => n.id);
  }
  return [];
}

/**
 * Structural invariant verifier for `.toolbox-kit.json` (Mode 1).
 * Throws an Error with a clear diagnostic when any cross-reference or DAG rule fails.
 */
export function verifyKitSkeleton(input: unknown): KitSkeletonV1 {
  const kit = KitSkeletonV1Schema.parse(input);

  const pillarsById = new Map<
    string,
    { topics: Set<string>; sections: Set<string> }
  >();
  for (const p of kit.pillars) {
    if (pillarsById.has(p.id)) {
      throw new Error(`Duplicate pillar id: ${p.id}`);
    }
    const topics = new Set<string>();
    for (const t of p.topics) {
      if (topics.has(t.id)) {
        throw new Error(`Duplicate topic id "${t.id}" in pillar "${p.id}"`);
      }
      topics.add(t.id);
    }
    const sections = new Set<string>();
    for (const s of p.sections) {
      if (sections.has(s.id)) {
        throw new Error(`Duplicate section id "${s.id}" in pillar "${p.id}"`);
      }
      sections.add(s.id);
    }
    pillarsById.set(p.id, { topics, sections });
  }

  for (const node of kit.graph.nodes) {
    const pillar = pillarsById.get(node.pillarId);
    if (!pillar) {
      throw new Error(
        `Graph node "${node.id}" references unknown pillar "${node.pillarId}"`,
      );
    }
    if (node.topicId !== null && !pillar.topics.has(node.topicId)) {
      throw new Error(
        `Graph node "${node.id}" references unknown topic "${node.topicId}" in pillar "${node.pillarId}"`,
      );
    }
  }

  validateGraph(kit.graph.nodes, kit.graph.edges);

  const nodeIds = new Set(kit.graph.nodes.map((n) => n.id));
  for (const track of kit.graph.tracks) {
    for (const target of track.targets) {
      if (!nodeIds.has(target)) {
        throw new Error(
          `Learning track "${track.id}" references unknown target node "${target}"`,
        );
      }
    }
  }

  if (kit.seeds.starterDeck) {
    const cardKeys = new Set<string>();
    for (const card of kit.seeds.starterDeck.cards) {
      if (cardKeys.has(card.key)) {
        throw new Error(`Duplicate starter card key: ${card.key}`);
      }
      cardKeys.add(card.key);
      if (card.nodeId && !nodeIds.has(card.nodeId)) {
        throw new Error(
          `Starter card "${card.key}" references unknown node "${card.nodeId}"`,
        );
      }
      if (card.pillarId) {
        const pillar = pillarsById.get(card.pillarId);
        if (!pillar) {
          throw new Error(
            `Starter card "${card.key}" references unknown pillar "${card.pillarId}"`,
          );
        }
        if (card.topicId && !pillar.topics.has(card.topicId)) {
          throw new Error(
            `Starter card "${card.key}" references unknown topic "${card.topicId}" in pillar "${card.pillarId}"`,
          );
        }
        if (card.sectionId && !pillar.sections.has(card.sectionId)) {
          throw new Error(
            `Starter card "${card.key}" references unknown section "${card.sectionId}" in pillar "${card.pillarId}"`,
          );
        }
      }
    }
    for (const card of kit.seeds.starterDeck.cards) {
      if (card.prerequisiteKey) {
        if (card.prerequisiteKey === card.key) {
          throw new Error(
            `Starter card "${card.key}" cannot reference itself as prerequisiteKey`,
          );
        }
        if (!cardKeys.has(card.prerequisiteKey)) {
          throw new Error(
            `Starter card "${card.key}" references unknown prerequisiteKey "${card.prerequisiteKey}"`,
          );
        }
      }
    }
  }

  const drillKeys = new Set<string>();
  for (const drill of kit.seeds.drills) {
    if (drillKeys.has(drill.key)) {
      throw new Error(`Duplicate drill key: ${drill.key}`);
    }
    drillKeys.add(drill.key);
    if (!nodeIds.has(drill.nodeId)) {
      throw new Error(
        `Guided drill "${drill.key}" references unknown node "${drill.nodeId}"`,
      );
    }
  }

  for (const note of kit.seeds.baselineGuideNotes) {
    const pillar = pillarsById.get(note.pillarId);
    if (!pillar) {
      throw new Error(
        `Baseline guide note references unknown pillar "${note.pillarId}"`,
      );
    }
    if (!pillar.topics.has(note.topicId)) {
      throw new Error(
        `Baseline guide note references unknown topic "${note.topicId}" in pillar "${note.pillarId}"`,
      );
    }
    if (!pillar.sections.has(note.sectionId)) {
      throw new Error(
        `Baseline guide note references unknown section "${note.sectionId}" in pillar "${note.pillarId}"`,
      );
    }
  }

  return kit;
}
