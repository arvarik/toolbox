import { Router } from "express";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import {
  asyncHandler,
  NotFoundError,
  ValidationError,
} from "../platform/net/errors.ts";
import { resolveActiveKit } from "../kits/kitContext.ts";
import { nodeMap, type GraphNode } from "../../shared/kits/kitSkeleton.ts";
import { runStructured } from "../ai/engine.ts";
import {
  ANTI_SYCOPHANCY_SYSTEM_PROMPT,
  EvaluationResultLlmSchema,
  enforceAntiSycophancy,
  type EvaluationResultLlm,
} from "../srs/antiSycophancy.ts";

const router = Router();

router.post(
  "/evaluate",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const kit = resolveActiveKit(req, db, scope);

    const { nodeId, pillarId, topicId, conceptName, explanation, model } =
      (req.body ?? {}) as {
        nodeId?: string;
        pillarId?: string;
        topicId?: string;
        conceptName?: string;
        explanation?: string;
        model?: string;
      };

    if (
      !explanation ||
      typeof explanation !== "string" ||
      !explanation.trim()
    ) {
      throw new ValidationError("explanation is required");
    }

    const nodesById = nodeMap(kit.skeleton.graph.nodes);
    let node: GraphNode | undefined;
    if (typeof nodeId === "string" && nodeId.trim()) {
      node = nodesById.get(nodeId.trim());
      if (!node) {
        throw new NotFoundError("Node", nodeId.trim());
      }
    } else if (
      typeof pillarId === "string" &&
      pillarId.trim() &&
      typeof topicId === "string" &&
      topicId.trim()
    ) {
      node = kit.skeleton.graph.nodes.find(
        (n) => n.pillarId === pillarId.trim() && n.topicId === topicId.trim(),
      );
    }

    const effectivePillarId =
      (typeof pillarId === "string" && pillarId.trim()) ||
      node?.pillarId ||
      null;
    const effectiveTopicId =
      (typeof topicId === "string" && topicId.trim()) ||
      node?.topicId ||
      null;

    const pillar = effectivePillarId
      ? kit.skeleton.pillars.find((p) => p.id === effectivePillarId)
      : undefined;
    const topic =
      pillar && effectiveTopicId
        ? pillar.topics.find((t) => t.id === effectiveTopicId)
        : undefined;

    const targetConcept =
      (typeof conceptName === "string" && conceptName.trim()) ||
      node?.name ||
      topic?.name ||
      "Target Concept";

    let committedNotes = "";
    if (effectivePillarId && effectiveTopicId) {
      const noteRows = db
        .prepare(
          `SELECT section_id, content
           FROM guide_content
           WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND content != ''`,
        )
        .all(
          scope.ownerId,
          kit.id,
          effectivePillarId,
          effectiveTopicId,
        ) as Array<{ section_id: string; content: string }>;

      if (noteRows.length > 0) {
        committedNotes = noteRows
          .map((r) => `[${r.section_id}]\n${r.content}`)
          .join("\n\n")
          .slice(0, 3000);
      }
    }

    const rubricLines: string[] = [
      `1. Explains the core mechanism of ${targetConcept} in plain, first-principles language without circular definitions.`,
      "2. Defines or unpacks any specialized technical terms rather than hiding behind unexplained jargon.",
      "3. Accurately states key trade-offs, boundary conditions, or failure modes.",
    ];
    if (pillar?.sections) {
      for (const sec of pillar.sections.slice(0, 3)) {
        if (sec.promptHint) {
          rubricLines.push(
            `${rubricLines.length + 1}. (${sec.name}) ${sec.promptHint}`,
          );
        }
      }
    }

    const rawEval = await runStructured<EvaluationResultLlm>({
      scope,
      capability: "quick",
      model: typeof model === "string" && model.trim() ? model.trim() : undefined,
      schema: EvaluationResultLlmSchema,
      feature: "feynman-evaluate",
      system: [
        ANTI_SYCOPHANCY_SYSTEM_PROMPT,
        "You are evaluating a Feynman-technique teach-back explanation as a curious but rigorous student who refuses hand-wavy jargon and catches subtle misconceptions.",
      ].join("\n\n"),
      prompt: [
        `Kit: ${kit.skeleton.identity.name}`,
        `Concept to Explain: ${targetConcept}`,
        node ? `Canonical Node Summary (${node.id}):\n${node.summary}` : "",
        node && node.keywords.length > 0
          ? `Expected Domain Concepts / Keywords: ${node.keywords.join(", ")}`
          : "",
        topic?.summary ? `Topic Summary (${topic.name}):\n${topic.summary}` : "",
        committedNotes
          ? `Reference Study Guide Notes:\n${committedNotes}`
          : "",
        `Feynman Evaluation Rubric:\n${rubricLines.join("\n")}`,
        `<untrusted_submission>\n${explanation.trim().slice(0, 32_000).replace(/<\/untrusted_/gi, "<\\/untrusted_")}\n</untrusted_submission>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const evaluation = enforceAntiSycophancy(rawEval, {
      passThreshold: 0.75,
      hintsUsed: 0,
      viewedWorkedSolution: false,
    });

    db.prepare(
      `INSERT INTO study_sessions (ownerId, date, count)
       VALUES (?, date('now', 'localtime'), 1)
       ON CONFLICT(ownerId, date) DO UPDATE SET count = count + 1`,
    ).run(scope.ownerId);

    res.json({
      conceptName: targetConcept,
      nodeId: node?.id ?? null,
      pillarId: effectivePillarId,
      topicId: effectiveTopicId,
      ...evaluation,
    });
  }),
);

export default router;
