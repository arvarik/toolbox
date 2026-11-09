import { Router } from "express";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import logger from "../utils/logger.ts";

const router = Router();

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const { q } = req.query;

  if (!q || typeof q !== "string" || q.trim() === "") {
    res.json({ flashcards: [], guideContent: [], boards: [], decks: [] });
    return;
  }

  const query = `%${q.trim()}%`;

  try {
    const flashcards = db
      .prepare(
        `SELECT id, deck_id, front, back, state
         FROM flashcards
         WHERE ownerId = ? AND (front LIKE ? OR back LIKE ?)
         LIMIT 10`,
      )
      .all(scope.ownerId, query, query);

    const guideContent = db
      .prepare(
        `SELECT pillar_id, topic_id, section_id, content
         FROM guide_content
         WHERE ownerId = ? AND (content LIKE ? OR section_id LIKE ? OR topic_id LIKE ?)
         LIMIT 10`,
      )
      .all(scope.ownerId, query, query, query);

    const boards = db
      .prepare(
        `SELECT id, name
         FROM boards
         WHERE ownerId = ? AND name LIKE ?
         LIMIT 10`,
      )
      .all(scope.ownerId, query);

    const decks = db
      .prepare(
        `SELECT id, name, description, tags
         FROM decks
         WHERE ownerId = ? AND (name LIKE ? OR description LIKE ? OR tags LIKE ?)
         LIMIT 10`,
      )
      .all(scope.ownerId, query, query, query);

    res.json({
      flashcards,
      guideContent,
      boards,
      decks,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[search] Error running global search:", msg);
    res.status(500).json({ message: "Failed to run global search" });
  }
});

export default router;
