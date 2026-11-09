import { Router } from "express";
import { v4 as uuid } from "uuid";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { resolveActiveKit } from "../kits/kitContext.ts";

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

router.delete("/:id", (req, res) => {
  const scope = scopeOf(req);
  db.prepare("DELETE FROM boards WHERE ownerId = ? AND id = ?").run(
    scope.ownerId,
    req.params.id,
  );
  res.status(204).send();
});

export default router;
