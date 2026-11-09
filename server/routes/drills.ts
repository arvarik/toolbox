import { randomUUID } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import db from "../db.ts";
import { scopeOf, type Scope } from "../platform/tenancy/scope.ts";
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
} from "../platform/net/errors.ts";
import {
  resolveActiveKit,
  resolveKitById,
  type ActiveKitContext,
} from "../kits/kitContext.ts";
import {
  nodeMap,
  nodesForCard,
  prerequisitesOf,
  type GraphNode,
} from "../../shared/kits/kitSkeleton.ts";
import { runStructured } from "../ai/engine.ts";
import {
  ANTI_SYCOPHANCY_SYSTEM_PROMPT,
  EvaluationResultLlmSchema,
  enforceAntiSycophancy,
  type EvaluationResultLlm,
} from "../srs/antiSycophancy.ts";
import { easeFromDifficulty } from "../srs/scheduler.ts";
import { applyImplicitPrerequisiteCredit } from "../graph/encompassing.ts";
import { planNodeFailureRemediation } from "../graph/remediation.ts";
import { upsertRagChunk } from "../search/hybridSearch.ts";

const router = Router();

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Strict all-required Zod v4 LLM schema for generating a grounded `GuidedDrill`
 * (zero `.optional()`, zero `.default()`, zero `z.tuple()`).
 */
const GeneratedDrillLlmSchema = z.object({
  prompt: z.string(),
  hints: z.array(z.string()),
  rubricPoints: z.array(z.string()),
  workedSolution: z.string(),
});

type GeneratedDrillLlm = z.infer<typeof GeneratedDrillLlmSchema>;

interface DrillRow {
  id: string;
  ownerId: string;
  kit_id: string;
  node_id: string;
  difficulty: number;
  prompt: string;
  hints_json: string;
  worked_solution: string;
  rubric_json: string;
  seed_key: string | null;
  created_at: string;
}

interface DrillAttemptRow {
  id: string;
  ownerId: string;
  drill_id: string;
  submission: string;
  score: number | null;
  feedback_json: string;
  created_at: string;
}

const DEFAULT_FALLBACK_HINTS: readonly [string, string, string] = [
  "Nudge: Identify the core invariant or constraint this concept must maintain.",
  "Setup: Structure your answer around inputs, state transitions, and failure modes.",
  "Key Step: Walk through a concrete edge case and verify each trade-off.",
];

function normalizeThreeHints(rawHints: readonly string[]): [string, string, string] {
  const cleaned = rawHints.map((h) => h.trim()).filter((h) => h.length > 0);
  return [
    cleaned[0] ?? DEFAULT_FALLBACK_HINTS[0],
    cleaned[1] ?? DEFAULT_FALLBACK_HINTS[1],
    cleaned[2] ?? DEFAULT_FALLBACK_HINTS[2],
  ];
}

function parseStringArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter(Boolean);
    }
  } catch {
    // Ignore malformed JSON
  }
  return [];
}

function ensureSeedDrillsHydrated(scope: Scope, kit: ActiveKitContext): void {
  const seeds = kit.skeleton.seeds?.drills;
  if (!seeds || seeds.length === 0) return;

  const insertSeed = db.prepare(
    `INSERT OR IGNORE INTO drills (
       id, ownerId, kit_id, node_id, difficulty, prompt, hints_json, worked_solution, rubric_json, seed_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    for (const seed of seeds) {
      insertSeed.run(
        randomUUID(),
        scope.ownerId,
        kit.id,
        seed.nodeId,
        seed.difficulty,
        seed.prompt,
        JSON.stringify(normalizeThreeHints(seed.hints)),
        seed.workedSolution,
        JSON.stringify(seed.rubricPoints),
        seed.key,
      );
    }
  })();
}

function computeAttemptSummary(attempts: readonly DrillAttemptRow[]): {
  attemptCount: number;
  bestScore: number | null;
  mastered: boolean;
  lastAttemptAt: string | null;
} {
  if (attempts.length === 0) {
    return {
      attemptCount: 0,
      bestScore: null,
      mastered: false,
      lastAttemptAt: null,
    };
  }

  let bestScore: number | null = null;
  let mastered = false;
  let lastAttemptAt: string | null = null;

  for (const att of attempts) {
    if (typeof att.score === "number" && Number.isFinite(att.score)) {
      bestScore = bestScore === null ? att.score : Math.max(bestScore, att.score);
    }
    if (!lastAttemptAt || att.created_at > lastAttemptAt) {
      lastAttemptAt = att.created_at;
    }
    try {
      const fb = JSON.parse(att.feedback_json || "{}") as {
        masteryEligible?: boolean;
        pass?: boolean;
      };
      if (fb.masteryEligible === true && fb.pass !== false) {
        mastered = true;
      } else if (
        fb.masteryEligible === undefined &&
        typeof att.score === "number" &&
        att.score >= 0.8
      ) {
        mastered = true;
      }
    } catch {
      if (typeof att.score === "number" && att.score >= 0.8) {
        mastered = true;
      }
    }
  }

  return {
    attemptCount: attempts.length,
    bestScore,
    mastered,
    lastAttemptAt,
  };
}

function formatDrill(
  row: DrillRow,
  nodesById: Map<string, GraphNode>,
  attempts: readonly DrillAttemptRow[],
) {
  const summary = computeAttemptSummary(attempts);
  return {
    id: row.id,
    kitId: row.kit_id,
    nodeId: row.node_id,
    nodeName: nodesById.get(row.node_id)?.name ?? row.node_id,
    difficulty: row.difficulty as 1 | 2 | 3,
    prompt: row.prompt,
    hints: normalizeThreeHints(parseStringArray(row.hints_json)),
    rubricPoints: parseStringArray(row.rubric_json),
    workedSolution: row.worked_solution,
    seedKey: row.seed_key,
    createdAt: row.created_at,
    ...summary,
  };
}

function loadGuideContextForNode(
  scope: Scope,
  kitId: string,
  node: GraphNode,
): string {
  if (!node.topicId) return "";
  const rows = db
    .prepare(
      `SELECT section_id, content
       FROM guide_content
       WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND content != ''`,
    )
    .all(scope.ownerId, kitId, node.pillarId, node.topicId) as Array<{
    section_id: string;
    content: string;
  }>;
  if (rows.length === 0) return "";
  return rows
    .map((r) => `[${r.section_id}]\n${r.content}`)
    .join("\n\n")
    .slice(0, 2400);
}

async function generateAndPersistDrill(
  scope: Scope,
  kit: ActiveKitContext,
  node: GraphNode,
  difficulty: 1 | 2 | 3,
  model?: string,
): Promise<DrillRow> {
  const pillar = kit.skeleton.pillars.find((p) => p.id === node.pillarId);
  const topic = pillar?.topics.find((t) => t.id === node.topicId);
  const prereqIds = prerequisitesOf(kit.skeleton.graph.edges).get(node.id) ?? [];
  const nodesById = nodeMap(kit.skeleton.graph.nodes);
  const prereqNames = prereqIds.map((id) => nodesById.get(id)?.name ?? id);
  const guideExcerpt = loadGuideContextForNode(scope, kit.id, node);

  const existingPrompts = (
    db
      .prepare(
        "SELECT prompt FROM drills WHERE ownerId = ? AND kit_id = ? AND node_id = ? ORDER BY created_at DESC LIMIT 5",
      )
      .all(scope.ownerId, kit.id, node.id) as Array<{ prompt: string }>
  ).map((r) => r.prompt);

  const difficultyLabel =
    difficulty === 1
      ? "1 (Foundational application)"
      : difficulty === 2
        ? "2 (Multi-constraint design / debugging)"
        : "3 (Adversarial edge-case / diagnostic mastery challenge)";

  const generated = await runStructured<GeneratedDrillLlm>({
    scope,
    capability: "quick",
    model,
    schema: GeneratedDrillLlmSchema,
    feature: "drill-generate",
    system: [
      `You design grounded active-recall engineering & domain drills for "${kit.skeleton.identity.name}".`,
      "Produce ONE concrete scenario-based problem (not a trivia definition) with:",
      "- `prompt`: Clear scenario, constraints, and exact question to solve.",
      "- `hints`: Exactly 3 progressive hints ordered [1: subtle Nudge, 2: structural Setup, 3: decisive Key Step without giving the full prose away].",
      "- `rubricPoints`: 3 to 5 specific, falsifiable grading criteria.",
      "- `workedSolution`: Complete, rigorous reference solution.",
    ].join("\n"),
    prompt: [
      `Concept Node: ${node.name} (id: ${node.id})`,
      `Pillar: ${pillar?.name ?? node.pillarId}${topic ? ` / Topic: ${topic.name}` : ""}`,
      `Difficulty: ${difficultyLabel}`,
      `Node Summary: ${node.summary}`,
      prereqNames.length > 0
        ? `Prerequisites: ${prereqNames.join(", ")}`
        : "Prerequisites: None (foundational node)",
      guideExcerpt ? `Committed Study Notes:\n${guideExcerpt}` : "",
      existingPrompts.length > 0
        ? `Avoid repeating these existing drill prompts:\n- ${existingPrompts.join("\n- ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  });

  const promptText =
    generated.prompt.trim() ||
    `Apply ${node.name} to a concrete scenario and justify the trade-offs.`;
  const hints = normalizeThreeHints(generated.hints);
  const rubricPoints = generated.rubricPoints
    .map((r) => r.trim())
    .filter((r) => r.length > 0);
  if (rubricPoints.length === 0) {
    rubricPoints.push(
      `Correctly applies core mechanism of ${node.name}`,
      "Identifies key constraints, failure modes, or trade-offs",
    );
  }
  const workedSolution = generated.workedSolution.trim();

  const id = randomUUID();
  db.prepare(
    `INSERT INTO drills (
       id, ownerId, kit_id, node_id, difficulty, prompt, hints_json, worked_solution, rubric_json, seed_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    scope.ownerId,
    kit.id,
    node.id,
    difficulty,
    promptText,
    JSON.stringify(hints),
    workedSolution,
    JSON.stringify(rubricPoints),
  );

  return getOwnedDrill(scope, id);
}

function requireNonEmpty(val: unknown, field: string): string {
  if (typeof val !== "string" || !val.trim()) {
    throw new ValidationError(`${field} is required`);
  }
  return val.trim();
}

function optModel(model: unknown): string | undefined {
  return typeof model === "string" && model.trim() ? model.trim() : undefined;
}

function requireKitNode(
  kit: ActiveKitContext,
  rawNodeId: string,
): { nodesById: Map<string, GraphNode>; node: GraphNode } {
  const id = rawNodeId.trim();
  const nodesById = nodeMap(kit.skeleton.graph.nodes);
  const node = nodesById.get(id);
  if (!node) throw new NotFoundError("Node", id);
  return { nodesById, node };
}

function getOwnedDrill(scope: Scope, id: string): DrillRow {
  const row = db
    .prepare("SELECT * FROM drills WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, id) as DrillRow | undefined;
  if (!row) throw new NotFoundError("Drill", id);
  return row;
}

function recordDrillAttempt(
  scope: Scope,
  drillId: string,
  submission: string,
  evaluation: { score: number },
): string {
  const attemptId = randomUUID();
  db.prepare(
    `INSERT INTO drill_attempts (id, ownerId, drill_id, submission, score, feedback_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    attemptId,
    scope.ownerId,
    drillId,
    submission,
    evaluation.score,
    JSON.stringify(evaluation),
  );
  db.prepare(
    `INSERT INTO study_sessions (ownerId, date, count)
     VALUES (?, date('now', 'localtime'), 1)
     ON CONFLICT(ownerId, date) DO UPDATE SET count = count + 1`,
  ).run(scope.ownerId);
  return attemptId;
}

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  ensureSeedDrillsHydrated(scope, kit);

  const nodeFilter =
    typeof req.query.nodeId === "string" ? req.query.nodeId.trim() : "";

  const drillRows = db
    .prepare(
      `SELECT * FROM drills
       WHERE ownerId = ? AND kit_id = ? ${nodeFilter ? "AND node_id = ?" : ""}
       ORDER BY difficulty ASC, created_at ASC`,
    )
    .all(
      ...(nodeFilter
        ? [scope.ownerId, kit.id, nodeFilter]
        : [scope.ownerId, kit.id]),
    ) as DrillRow[];

  const attemptRows = db
    .prepare(
      `SELECT a.*
       FROM drill_attempts a
       JOIN drills d ON d.ownerId = a.ownerId AND d.id = a.drill_id
       WHERE a.ownerId = ? AND d.kit_id = ?
       ORDER BY a.created_at DESC`,
    )
    .all(scope.ownerId, kit.id) as DrillAttemptRow[];

  const attemptsByDrill = Map.groupBy(attemptRows, (att) => att.drill_id);

  const nodesById = nodeMap(kit.skeleton.graph.nodes);
  res.json(
    drillRows.map((row) =>
      formatDrill(row, nodesById, attemptsByDrill.get(row.id) ?? []),
    ),
  );
});

router.post(
  "/generate",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const kit = resolveActiveKit(req, db, scope);
    const { nodeId, difficulty: rawDiff, model } = (req.body ?? {}) as {
      nodeId?: string;
      difficulty?: number;
      model?: string;
    };

    const { nodesById, node } = requireKitNode(
      kit,
      requireNonEmpty(nodeId, "nodeId"),
    );
    const parsedDiff =
      rawDiff === 1 || rawDiff === 2 || rawDiff === 3 ? rawDiff : 2;

    const row = await generateAndPersistDrill(
      scope,
      kit,
      node,
      parsedDiff,
      optModel(model),
    );

    res.status(201).json(formatDrill(row, nodesById, []));
  }),
);

router.get(
  "/challenge/:nodeId",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const kit = resolveActiveKit(req, db, scope);
    ensureSeedDrillsHydrated(scope, kit);

    const { nodesById, node } = requireKitNode(kit, String(req.params.nodeId));

    const drillRow =
      (db
        .prepare(
          `SELECT * FROM drills
           WHERE ownerId = ? AND kit_id = ? AND node_id = ? AND difficulty = 3
           ORDER BY created_at DESC
           LIMIT 1`,
        )
        .get(scope.ownerId, kit.id, node.id) as DrillRow | undefined) ??
      (await generateAndPersistDrill(
        scope,
        kit,
        node,
        3,
        optModel(req.query.model),
      ));

    const attempts = db
      .prepare(
        "SELECT * FROM drill_attempts WHERE ownerId = ? AND drill_id = ? ORDER BY created_at DESC",
      )
      .all(scope.ownerId, drillRow.id) as DrillAttemptRow[];

    res.json({
      nodeId: node.id,
      nodeName: node.name,
      nodeSummary: node.summary,
      drill: formatDrill(drillRow, nodesById, attempts),
      feynmanPrompt: `Synthesize ${node.name} in your own words without hand-waving jargon: explain the core mechanism, when to use it, and what breaks when its assumptions fail.`,
      passThreshold: 0.85,
    });
  }),
);

router.post(
  "/challenge/:nodeId",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const kit = resolveActiveKit(req, db, scope);
    const { node } = requireKitNode(kit, String(req.params.nodeId));

    const { drillId, drillSubmission, feynmanExplanation, model } = (req.body ??
      {}) as {
      drillId?: string;
      drillSubmission?: string;
      feynmanExplanation?: string;
      model?: string;
    };

    const cleanDrillId = requireNonEmpty(drillId, "drillId");
    const cleanSubmission = requireNonEmpty(drillSubmission, "drillSubmission");
    const cleanFeynman = requireNonEmpty(
      feynmanExplanation,
      "feynmanExplanation",
    );

    const drillRow = db
      .prepare(
        "SELECT * FROM drills WHERE ownerId = ? AND kit_id = ? AND id = ?",
      )
      .get(scope.ownerId, kit.id, cleanDrillId) as DrillRow | undefined;

    if (!drillRow || drillRow.node_id !== node.id) {
      throw new NotFoundError("Drill", cleanDrillId);
    }

    const rubricPoints = parseStringArray(drillRow.rubric_json);

    const rawEval = await runStructured<EvaluationResultLlm>({
      scope,
      capability: "quick",
      model: optModel(model),
      schema: EvaluationResultLlmSchema,
      feature: "challenge-node",
      system: ANTI_SYCOPHANCY_SYSTEM_PROMPT,
      prompt: [
        `Diagnostic Fast-Track Challenge for Node: ${node.name} (${node.id})`,
        `Canonical Concept Summary:\n${node.summary}`,
        `Hard Drill Prompt:\n${drillRow.prompt}`,
        `Reference Worked Solution:\n${drillRow.worked_solution}`,
        `Required Rubric Points (plus clear, jargon-free Feynman synthesis):\n${rubricPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}\n${rubricPoints.length + 1}. Clear, accurate first-principles Feynman synthesis of ${node.name}`,
        `<untrusted_submission>\n[Drill Solution]\n${cleanSubmission}\n\n[Feynman Explanation]\n${cleanFeynman}\n</untrusted_submission>`,
      ].join("\n\n"),
    });

    const evaluation = enforceAntiSycophancy(rawEval, {
      passThreshold: 0.85,
      hintsUsed: 0,
      viewedWorkedSolution: false,
    });

    const attemptId = recordDrillAttempt(
      scope,
      drillRow.id,
      cleanSubmission,
      evaluation,
    );

    let committedSectionId: string | null = null;
    const graduatedCardIds: string[] = [];
    let implicitCredit = {
      updatedCardIds: [] as string[],
      nodesCredited: [] as string[],
    };

    if (
      evaluation.pass === true &&
      evaluation.factualOrLogicalErrors.length === 0
    ) {
      const now = new Date();
      const nowIso = now.toISOString();
      const nextReviewIso = new Date(
        now.getTime() + 21 * DAY_MS,
      ).toISOString();

      const fastTrackTx = db.transaction(() => {
        // 1. Upsert feynmanExplanation into the node's first empty guide_content slot if pillarId & topicId exist.
        if (node.pillarId && node.topicId) {
          const pillar = kit.skeleton.pillars.find(
            (p) => p.id === node.pillarId,
          );
          if (pillar && pillar.sections.length > 0) {
            const existingRows = db
              .prepare(
                `SELECT section_id, content
                 FROM guide_content
                 WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ?`,
              )
              .all(
                scope.ownerId,
                kit.id,
                node.pillarId,
                node.topicId,
              ) as Array<{ section_id: string; content: string | null }>;

            const filledSections = new Set(
              existingRows
                .filter((r) => (r.content ?? "").trim().length > 0)
                .map((r) => r.section_id),
            );

            const emptySlot = pillar.sections.find(
              (s) => !filledSections.has(s.id),
            );
            if (emptySlot) {
              db.prepare(
                `INSERT INTO guide_content (ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at)
                 VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
                 ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id)
                 DO UPDATE SET content = excluded.content, committed_at = excluded.committed_at`,
              ).run(
                scope.ownerId,
                kit.id,
                node.pillarId,
                node.topicId,
                emptySlot.id,
                cleanFeynman,
              );
              committedSectionId = emptySlot.id;
            }
          }
        }

        // 2. Graduate any state !== 2 cards linked to nodeId straight to state=2, S=21, D=4.5, interval=21.
        const kitCards = db
          .prepare(
            `SELECT f.id, f.node_id, f.front, f.back, f.source_topic_id, f.state, f.repetitions
             FROM flashcards f
             JOIN decks d ON d.ownerId = f.ownerId AND d.id = f.deck_id
             WHERE f.ownerId = ? AND d.kit_id = ?`,
          )
          .all(scope.ownerId, kit.id) as Array<{
          id: string;
          node_id: string | null;
          front: string;
          back: string;
          source_topic_id: string | null;
          state: number | null;
          repetitions: number | null;
        }>;

        const graduateStmt = db.prepare(
          `UPDATE flashcards
           SET state = 2,
               learning_step = 0,
               stability = 21,
               difficulty = 4.5,
               ease_factor = ?,
               interval = 21,
               repetitions = ?,
               last_reviewed = ?,
               next_review = ?,
               updated_at = datetime('now')
           WHERE ownerId = ? AND id = ?`,
        );
        const resolveRemStmt = db.prepare(
          `UPDATE remediation_queue SET resolved_at = datetime('now')
           WHERE ownerId = ? AND card_id = ? AND resolved_at IS NULL`,
        );

        const targetEase = easeFromDifficulty(4.5);
        for (const c of kitCards) {
          if ((c.state ?? 0) === 2) continue;
          if (!nodesForCard(c, kit.skeleton.graph.nodes).includes(node.id)) {
            continue;
          }
          graduateStmt.run(
            targetEase,
            Math.max(c.repetitions ?? 0, 1),
            nowIso,
            nextReviewIso,
            scope.ownerId,
            c.id,
          );
          resolveRemStmt.run(scope.ownerId, c.id);
          graduatedCardIds.push(c.id);
        }
      });

      fastTrackTx();

      if (committedSectionId && node.topicId) {
        await upsertRagChunk(db, scope, {
          kitId: kit.id,
          kind: "guide",
          sourceRefId: `${node.pillarId}:${node.topicId}:${committedSectionId}`,
          nodeId: node.id,
          title: `${node.topicId} — ${committedSectionId}`,
          content: cleanFeynman,
        });
      }

      // 3. Propagate upward FIRe prerequisite credit with weight 1.0.
      implicitCredit = applyImplicitPrerequisiteCredit(db, scope, kit, {
        nodeId: node.id,
        weight: 1.0,
        now,
      });
    }

    res.json({
      attemptId,
      nodeId: node.id,
      drillId: drillRow.id,
      ...evaluation,
      committedSectionId,
      graduatedCardIds,
      implicitCredit,
      implicit_credit_count: implicitCredit.updatedCardIds.length,
    });
  }),
);

router.get("/:id", (req, res) => {
  const scope = scopeOf(req);
  const row = getOwnedDrill(scope, req.params.id);
  const kit =
    resolveKitById(db, scope, row.kit_id) ?? resolveActiveKit(req, db, scope);
  const attempts = db
    .prepare(
      "SELECT * FROM drill_attempts WHERE ownerId = ? AND drill_id = ? ORDER BY created_at DESC",
    )
    .all(scope.ownerId, row.id) as DrillAttemptRow[];
  const nodesById = nodeMap(kit.skeleton.graph.nodes);

  res.json({
    ...formatDrill(row, nodesById, attempts),
    attempts: attempts.map((a) => {
      let feedback: Record<string, unknown> = {};
      try {
        feedback = JSON.parse(a.feedback_json || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        // Ignore malformed feedback JSON
      }
      return {
        id: a.id,
        submission: a.submission,
        score: a.score,
        feedback,
        createdAt: a.created_at,
      };
    }),
  });
});

router.post(
  "/:id/submit",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const drillRow = getOwnedDrill(scope, String(req.params.id).trim());

    const { submission, hintsUsed, viewedWorkedSolution, model } = (req.body ??
      {}) as {
      submission?: string;
      hintsUsed?: number;
      viewedWorkedSolution?: boolean;
      model?: string;
    };

    const cleanSubmission = requireNonEmpty(submission, "submission");

    const kit =
      resolveKitById(db, scope, drillRow.kit_id) ??
      resolveActiveKit(req, db, scope);
    const node = nodeMap(kit.skeleton.graph.nodes).get(drillRow.node_id);
    const rubricPoints = parseStringArray(drillRow.rubric_json);

    const rawEval = await runStructured<EvaluationResultLlm>({
      scope,
      capability: "quick",
      model: optModel(model),
      schema: EvaluationResultLlmSchema,
      feature: "drill-grade",
      system: ANTI_SYCOPHANCY_SYSTEM_PROMPT,
      prompt: [
        `Concept: ${node?.name ?? drillRow.node_id}`,
        node?.summary ? `Concept Summary: ${node.summary}` : "",
        `Drill Prompt:\n${drillRow.prompt}`,
        drillRow.worked_solution
          ? `Reference Worked Solution:\n${drillRow.worked_solution}`
          : "",
        rubricPoints.length > 0
          ? `Rubric Criteria:\n${rubricPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}`
          : "",
        `<untrusted_submission>\n${cleanSubmission}\n</untrusted_submission>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const evaluation = enforceAntiSycophancy(rawEval, {
      passThreshold: 0.75,
      hintsUsed: typeof hintsUsed === "number" ? hintsUsed : Number(hintsUsed) || 0,
      viewedWorkedSolution: Boolean(viewedWorkedSolution),
    });

    const attemptId = recordDrillAttempt(
      scope,
      drillRow.id,
      cleanSubmission,
      evaluation,
    );

    let implicitCredit = {
      updatedCardIds: [] as string[],
      nodesCredited: [] as string[],
    };
    let remediation: ReturnType<typeof planNodeFailureRemediation> = [];

    if (evaluation.masteryEligible && evaluation.score >= 0.8) {
      implicitCredit = applyImplicitPrerequisiteCredit(db, scope, kit, {
        nodeId: drillRow.node_id,
        weight: 1.0,
      });
    } else if (evaluation.score < 0.6) {
      remediation = planNodeFailureRemediation(db, scope, kit, {
        failedNodeId: drillRow.node_id,
        sourceRefId: drillRow.id,
      });
    }

    res.json({
      attemptId,
      drillId: drillRow.id,
      nodeId: drillRow.node_id,
      ...evaluation,
      workedSolution: drillRow.worked_solution,
      implicitCredit,
      implicit_credit_count: implicitCredit.updatedCardIds.length,
      remediation,
    });
  }),
);

export default router;
