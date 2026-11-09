import { Router } from "express";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import logger from "../utils/logger.ts";

const router = Router();

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  try {
    const row = db
      .prepare(
        "SELECT profile_text FROM user_learning_profile WHERE ownerId = ?",
      )
      .get(scope.ownerId) as { profile_text: string } | undefined;
    res.json({ profileText: row?.profile_text || "" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[profile] Error fetching profile:", msg);
    res.status(500).json({ message: "Failed to fetch profile" });
  }
});

router.put("/", (req, res) => {
  const scope = scopeOf(req);
  const { profileText } = req.body as { profileText?: unknown };

  if (typeof profileText !== "string") {
    res.status(400).json({ message: "profileText must be a string" });
    return;
  }

  try {
    db.prepare(
      `INSERT INTO user_learning_profile (ownerId, profile_text, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(ownerId) DO UPDATE SET
         profile_text = excluded.profile_text,
         updated_at = excluded.updated_at`,
    ).run(scope.ownerId, profileText);

    res.json({ success: true, profileText });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[profile] Error updating profile:", msg);
    res.status(500).json({ message: "Failed to update profile" });
  }
});

router.delete("/", (req, res) => {
  const scope = scopeOf(req);
  try {
    db.prepare("DELETE FROM user_learning_profile WHERE ownerId = ?").run(
      scope.ownerId,
    );
    res.json({ success: true, message: "Profile cleared" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[profile] Error clearing profile:", msg);
    res.status(500).json({ message: "Failed to clear profile" });
  }
});

export default router;
