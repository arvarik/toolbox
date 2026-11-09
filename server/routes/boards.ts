import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { asyncHandler, NotFoundError } from "../platform/net/errors.ts";
import { resolveActiveKit, resolveKitById } from "../kits/kitContext.ts";
import { runStructured } from "../ai/engine.ts";
import {
  ANTI_SYCOPHANCY_SYSTEM_PROMPT,
  EvaluationResultLlmSchema,
  enforceAntiSycophancy,
  type EvaluationResultLlm,
} from "../srs/antiSycophancy.ts";

const router = Router();

interface BoardRow {
  id: string;
  ownerId: string;
  kit_id: string;
  name: string;
  data: string;
  position: number;
  created_at: string;
  updated_at: string;
}

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const boards = db
    .prepare(
      "SELECT id, name, position, created_at, updated_at FROM boards WHERE ownerId = ? AND kit_id = ? ORDER BY position ASC, updated_at DESC",
    )
    .all(scope.ownerId, kit.id);
  res.json(boards);
});

router.get("/:id", (req, res) => {
  const scope = scopeOf(req);
  const board = db
    .prepare("SELECT * FROM boards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, req.params.id) as BoardRow | undefined;
  if (!board) {
    res.status(404).json({ message: "Board not found" });
    return;
  }
  res.json({
    ...board,
    data: JSON.parse(board.data || "{}"),
  });
});

router.post("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { name, data } = req.body as { name?: string; data?: unknown };
  const id = uuid();

  const maxPos = db
    .prepare(
      "SELECT COALESCE(MAX(position), -1) as maxPos FROM boards WHERE ownerId = ? AND kit_id = ?",
    )
    .get(scope.ownerId, kit.id) as { maxPos: number } | undefined;
  const position = (maxPos?.maxPos ?? -1) + 1;

  db.prepare(
    "INSERT INTO boards (id, ownerId, kit_id, name, data, position) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(
    id,
    scope.ownerId,
    kit.id,
    name || "Untitled Board",
    JSON.stringify(data || {}),
    position,
  );

  const board = db
    .prepare("SELECT * FROM boards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, id) as BoardRow;
  res.status(201).json({
    ...board,
    data: JSON.parse(board.data || "{}"),
  });
});

router.put("/:id", (req, res) => {
  const scope = scopeOf(req);
  const { name, data } = req.body as { name?: string; data?: unknown };
  const existing = db
    .prepare("SELECT id FROM boards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, req.params.id);
  if (!existing) {
    res.status(404).json({ message: "Board not found" });
    return;
  }

  db.prepare(
    `UPDATE boards SET
       name = COALESCE(?, name),
       data = COALESCE(?, data),
       updated_at = datetime('now')
     WHERE ownerId = ? AND id = ?`,
  ).run(
    name ?? null,
    data !== undefined ? JSON.stringify(data) : null,
    scope.ownerId,
    req.params.id,
  );

  const board = db
    .prepare("SELECT * FROM boards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, req.params.id) as BoardRow;
  res.json({
    ...board,
    data: JSON.parse(board.data || "{}"),
  });
});

router.patch("/reorder", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { ids } = req.body as { ids?: unknown };
  if (!Array.isArray(ids)) {
    res.status(400).json({ message: "ids must be an array" });
    return;
  }

  const updateStmt = db.prepare(
    "UPDATE boards SET position = ? WHERE ownerId = ? AND id = ?",
  );
  const updateAll = db.transaction((orderedIds: string[]) => {
    orderedIds.forEach((id, index) => {
      updateStmt.run(index, scope.ownerId, id);
    });
  });

  updateAll(ids.map(String));

  const boards = db
    .prepare(
      "SELECT id, name, position, created_at, updated_at FROM boards WHERE ownerId = ? AND kit_id = ? ORDER BY position ASC",
    )
    .all(scope.ownerId, kit.id);
  res.json(boards);
});

router.patch("/:id/rename", (req, res) => {
  const scope = scopeOf(req);
  const { name } = req.body as { name?: string };
  if (!name || !name.trim()) {
    res.status(400).json({ message: "Name is required" });
    return;
  }
  const existing = db
    .prepare("SELECT id FROM boards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, req.params.id);
  if (!existing) {
    res.status(404).json({ message: "Board not found" });
    return;
  }

  db.prepare(
    "UPDATE boards SET name = ?, updated_at = datetime('now') WHERE ownerId = ? AND id = ?",
  ).run(name.trim(), scope.ownerId, req.params.id);

  const board = db
    .prepare(
      "SELECT id, name, position, created_at, updated_at FROM boards WHERE ownerId = ? AND id = ?",
    )
    .get(scope.ownerId, req.params.id);
  res.json(board);
});

function sanitizeUntrustedFence(text: string): string {
  return text.replace(/<\/untrusted_/gi, "<\\/untrusted_");
}

const DEFAULT_CONCEPT_RUBRIC = [
  "Propositional accuracy: Every directed edge and linking phrase between concepts forms a factually valid domain proposition.",
  "Structural hierarchy & connectivity: Core concepts connect coherently without isolated orphans or overloaded single-hub star topology.",
  "Domain completeness: Essential causal mechanisms, boundary conditions, or concrete examples for the topic are represented.",
  "Terminological precision: Node labels and edge linking verbs avoid vague or circular phrasing.",
];

const DEFAULT_ARCHITECTURE_RUBRIC = [
  "High availability & single points of failure: Ingress, compute, and stateful tiers avoid unshielded single-instance bottlenecks.",
  "Read/write path scalability: Appropriate caching, partitioning, or asynchronous buffering protects stateful storage under load.",
  "Resiliency & fault isolation: Rate limiting, timeouts, retries, or circuit breakers bound blast radius during downstream degradation.",
  "Protocol & observability clarity: Component boundaries, protocols, and telemetry align with the stated design goal.",
];

router.post(
  "/:id/critique",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const board = db
      .prepare("SELECT * FROM boards WHERE ownerId = ? AND id = ?")
      .get(scope.ownerId, req.params.id) as BoardRow | undefined;
    if (!board) {
      throw new NotFoundError("Board", String(req.params.id));
    }

    const kit =
      (board.kit_id ? resolveKitById(db, scope, board.kit_id) : null) ??
      resolveActiveKit(req, db, scope);

    const {
      model,
      goal,
      data: overrideData,
    } = (req.body ?? {}) as {
      model?: string;
      goal?: string;
      data?: unknown;
    };

    let parsedData: Record<string, unknown> = {};
    if (overrideData && typeof overrideData === "object") {
      parsedData = overrideData as Record<string, unknown>;
    } else {
      try {
        const raw = JSON.parse(board.data || "{}");
        if (raw && typeof raw === "object") {
          parsedData = raw as Record<string, unknown>;
        }
      } catch {
        parsedData = {};
      }
    }

    const rawNodes = Array.isArray(parsedData.nodes) ? parsedData.nodes : [];
    const rawEdges = Array.isArray(parsedData.edges) ? parsedData.edges : [];

    const normalizedNodes = rawNodes.slice(0, 120).map((n) => {
      const item = (n && typeof n === "object" ? n : {}) as Record<
        string,
        unknown
      >;
      const dataObj = (
        item.data && typeof item.data === "object" ? item.data : {}
      ) as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? dataObj.name ?? "Unnamed"),
        category: String(item.category ?? dataObj.category ?? "General"),
        icon: String(item.icon ?? dataObj.icon ?? ""),
      };
    });

    const normalizedEdges = rawEdges.slice(0, 200).map((e) => {
      const item = (e && typeof e === "object" ? e : {}) as Record<
        string,
        unknown
      >;
      const dataObj = (
        item.data && typeof item.data === "object" ? item.data : {}
      ) as Record<string, unknown>;
      return {
        id: String(item.id ?? ""),
        from: String(item.from ?? item.source ?? ""),
        to: String(item.to ?? item.target ?? ""),
        label: String(
          item.label ?? item.protocol ?? dataObj.protocol ?? "",
        ).trim(),
      };
    });

    const mode: "concept" | "architecture" =
      kit.skeleton.capabilities.canvas === "concept"
        ? "concept"
        : "architecture";

    const customRubric = (kit.skeleton.canvasConfig?.auditRubric ?? []).filter(
      (r) => typeof r === "string" && r.trim().length > 0,
    );
    const baseRubric =
      customRubric.length > 0
        ? customRubric
        : mode === "concept"
          ? DEFAULT_CONCEPT_RUBRIC
          : DEFAULT_ARCHITECTURE_RUBRIC;
    const rubricLines = baseRubric.map((r, idx) => `${idx + 1}. ${r}`);

    const kitConceptSummary = kit.skeleton.graph.nodes
      .slice(0, 24)
      .map((n) => `- ${n.name} (${n.id}): ${n.summary}`)
      .join("\n");

    const fencedPayload = sanitizeUntrustedFence(
      JSON.stringify(
        {
          boardName: board.name,
          nodeCount: normalizedNodes.length,
          edgeCount: normalizedEdges.length,
          nodes: normalizedNodes,
          edges: normalizedEdges,
        },
        null,
        2,
      ),
    );

    const rawEval = await runStructured<EvaluationResultLlm>({
      scope,
      capability: "quick",
      model: typeof model === "string" && model.trim() ? model.trim() : undefined,
      schema: EvaluationResultLlmSchema,
      feature: "board-critique",
      system: [
        ANTI_SYCOPHANCY_SYSTEM_PROMPT,
        mode === "concept"
          ? "You are auditing a learner's Novakian concept map for propositional accuracy, missing causal links, and structural misconceptions."
          : "You are auditing a learner's system architecture diagram for single points of failure, scaling bottlenecks, and resiliency gaps.",
      ].join("\n\n"),
      prompt: [
        `Kit: ${kit.skeleton.identity.name} (Canvas Mode: ${mode})`,
        typeof goal === "string" && goal.trim()
          ? `Design / Mapping Goal: ${sanitizeUntrustedFence(goal.trim().slice(0, 600))}`
          : "",
        kitConceptSummary
          ? `Reference Kit Curriculum Concepts:\n${kitConceptSummary}`
          : "",
        `Canvas Critique Rubric:\n${rubricLines.join("\n")}`,
        `<untrusted_submission>\n<untrusted_board>\n${fencedPayload}\n</untrusted_board>\n</untrusted_submission>`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });

    const evaluation = enforceAntiSycophancy(rawEval, {
      passThreshold: 0.75,
      hintsUsed: 0,
      viewedWorkedSolution: false,
    });

    res.json({
      boardId: board.id,
      kitId: kit.id,
      mode,
      ...evaluation,
    });
  }),
);

router.delete("/:id", (req, res) => {
  const scope = scopeOf(req);
  db.prepare("DELETE FROM boards WHERE ownerId = ? AND id = ?").run(
    scope.ownerId,
    req.params.id,
  );
  res.status(204).send();
});

export default router;
