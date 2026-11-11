import { randomUUID } from "node:crypto";
import { Router } from "express";
import db from "../db.ts";
import { scopeOf, type Scope } from "../platform/tenancy/scope.ts";
import { asyncHandler, NotFoundError, ValidationError } from "../platform/net/errors.ts";
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

const MAX_BOARD_NAME_LEN = 200;
const MAX_BOARD_DATA_CHARS = 2_000_000;
const MAX_REORDER_IDS = 500;

function getOwnedBoard(scope: Scope, id: string): BoardRow | undefined {
  return db
    .prepare("SELECT * FROM boards WHERE ownerId = ? AND id = ?")
    .get(scope.ownerId, id) as BoardRow | undefined;
}

function serializeBoard(board: BoardRow) {
  let parsedData: unknown = {};
  try {
    parsedData = JSON.parse(board.data || "{}");
    if (!parsedData || typeof parsedData !== "object" || Array.isArray(parsedData)) {
      parsedData = {};
    }
  } catch {
    parsedData = {};
  }
  return {
    ...board,
    data: parsedData,
  };
}

function serializeValidatedBoardData(raw: unknown): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("Board data must be a JSON object");
  }
  const serialized = JSON.stringify(raw);
  if (serialized.length > MAX_BOARD_DATA_CHARS) {
    throw new ValidationError(
      `Board data exceeds maximum size of ${MAX_BOARD_DATA_CHARS} characters`,
    );
  }
  return serialized;
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
  const board = getOwnedBoard(scopeOf(req), req.params.id);
  if (!board) {
    res.status(404).json({ message: "Board not found" });
    return;
  }
  res.json(serializeBoard(board));
});

router.post("/", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { name, data } = (req.body ?? {}) as { name?: unknown; data?: unknown };
  if (name !== undefined && typeof name !== "string") {
    throw new ValidationError("Board name must be a string");
  }
  const cleanName = typeof name === "string" && name.trim() ? name.trim() : "Untitled Board";
  if (cleanName.length > MAX_BOARD_NAME_LEN) {
    throw new ValidationError(`Board name cannot exceed ${MAX_BOARD_NAME_LEN} characters`);
  }
  const serializedData =
    data !== undefined ? serializeValidatedBoardData(data) : "{}";

  const id = randomUUID();
  db.transaction(() => {
    const maxPos = db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) as maxPos FROM boards WHERE ownerId = ? AND kit_id = ?",
      )
      .get(scope.ownerId, kit.id) as { maxPos: number } | undefined;

    db.prepare(
      "INSERT INTO boards (id, ownerId, kit_id, name, data, position) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      id,
      scope.ownerId,
      kit.id,
      cleanName,
      serializedData,
      (maxPos?.maxPos ?? -1) + 1,
    );
  })();

  res.status(201).json(serializeBoard(getOwnedBoard(scope, id)!));
});

router.put("/:id", (req, res) => {
  const scope = scopeOf(req);
  const { name, data } = (req.body ?? {}) as { name?: unknown; data?: unknown };
  let nextName: string | null = null;
  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      throw new ValidationError("Board name cannot be empty");
    }
    if (name.trim().length > MAX_BOARD_NAME_LEN) {
      throw new ValidationError(`Board name cannot exceed ${MAX_BOARD_NAME_LEN} characters`);
    }
    nextName = name.trim();
  }
  const nextData = data !== undefined ? serializeValidatedBoardData(data) : null;

  if (!getOwnedBoard(scope, req.params.id)) {
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
    nextName,
    nextData,
    scope.ownerId,
    req.params.id,
  );

  res.json(serializeBoard(getOwnedBoard(scope, req.params.id)!));
});

router.patch("/reorder", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { ids } = (req.body ?? {}) as { ids?: unknown };
  if (!Array.isArray(ids)) {
    throw new ValidationError("ids must be an array");
  }
  if (ids.length > MAX_REORDER_IDS) {
    throw new ValidationError(`Cannot reorder more than ${MAX_REORDER_IDS} boards at once`);
  }
  const orderedIds = ids.map((item) => {
    if (typeof item !== "string" || !item.trim() || item.length > 120) {
      throw new ValidationError("Each board id must be a non-empty string");
    }
    return item.trim();
  });

  const updateStmt = db.prepare(
    "UPDATE boards SET position = ? WHERE ownerId = ? AND kit_id = ? AND id = ?",
  );
  db.transaction((cleanIds: string[]) => {
    cleanIds.forEach((id, index) => {
      updateStmt.run(index, scope.ownerId, kit.id, id);
    });
  })(orderedIds);

  const boards = db
    .prepare(
      "SELECT id, name, position, created_at, updated_at FROM boards WHERE ownerId = ? AND kit_id = ? ORDER BY position ASC",
    )
    .all(scope.ownerId, kit.id);
  res.json(boards);
});

router.patch("/:id/rename", (req, res) => {
  const scope = scopeOf(req);
  const { name } = (req.body ?? {}) as { name?: unknown };
  if (typeof name !== "string" || !name.trim()) {
    throw new ValidationError("Name is required");
  }
  if (name.trim().length > MAX_BOARD_NAME_LEN) {
    throw new ValidationError(`Board name cannot exceed ${MAX_BOARD_NAME_LEN} characters`);
  }
  if (!getOwnedBoard(scope, req.params.id)) {
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

function asObj(val: unknown): Record<string, unknown> {
  return val && typeof val === "object" ? (val as Record<string, unknown>) : {};
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
    const board = getOwnedBoard(scope, String(req.params.id));
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

    let parsedData = asObj(overrideData);
    if (!overrideData || typeof overrideData !== "object") {
      try {
        parsedData = asObj(JSON.parse(board.data || "{}"));
      } catch {
        parsedData = {};
      }
    }

    const rawNodes = Array.isArray(parsedData.nodes) ? parsedData.nodes : [];
    const rawEdges = Array.isArray(parsedData.edges) ? parsedData.edges : [];

    const normalizedNodes = rawNodes.slice(0, 120).map((n) => {
      const item = asObj(n);
      const dataObj = asObj(item.data);
      return {
        id: String(item.id ?? ""),
        name: String(item.name ?? dataObj.name ?? "Unnamed"),
        category: String(item.category ?? dataObj.category ?? "General"),
        icon: String(item.icon ?? dataObj.icon ?? ""),
      };
    });

    const normalizedEdges = rawEdges.slice(0, 200).map((e) => {
      const item = asObj(e);
      const dataObj = asObj(item.data);
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
        `Canvas Critique Rubric:\n${baseRubric.map((r, idx) => `${idx + 1}. ${r}`).join("\n")}`,
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
