import { Router } from "express";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";

const router = Router();

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const results = db
    .prepare(
      `SELECT date, count
       FROM study_sessions
       WHERE ownerId = ?
       ORDER BY date ASC`,
    )
    .all(scope.ownerId);

  res.json(results);
});

export default router;
