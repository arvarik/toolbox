import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Router } from "express";
import db from "../db.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { ForbiddenError } from "../platform/net/errors.ts";
import logger from "../utils/logger.ts";

const router = Router();

router.get("/stats", (req, res) => {
  const scope = scopeOf(req);
  try {
    const o = scope.ownerId;
    const stats = db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM flashcards WHERE ownerId = ?) as flashcardsCount,
           (SELECT COUNT(*) FROM decks WHERE ownerId = ?) as decksCount,
           (SELECT COUNT(*) FROM boards WHERE ownerId = ?) as boardsCount,
           (SELECT COUNT(*) FROM guide_content WHERE ownerId = ? AND content IS NOT NULL AND trim(content, ' ' || char(9) || char(10) || char(13)) != '') as guideCount,
           (SELECT COUNT(*) FROM chat_starters WHERE ownerId = ?) as cachedStartersCount,
           COALESCE((SELECT length(profile_text) FROM user_learning_profile WHERE ownerId = ?), 0) as profileSize`,
      )
      .get(o, o, o, o, o, o) as {
      flashcardsCount: number;
      decksCount: number;
      boardsCount: number;
      guideCount: number;
      cachedStartersCount: number;
      profileSize: number;
    };

    res.json(stats);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[system] Error fetching stats:", msg);
    res.status(500).json({ message: "Failed to fetch system stats" });
  }
});

router.post("/clear-cache", (req, res) => {
  const scope = scopeOf(req);
  try {
    db.prepare("DELETE FROM chat_starters WHERE ownerId = ?").run(scope.ownerId);
    res.json({ success: true, message: "AI Starter Cache cleared." });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[system] Error clearing cache:", msg);
    res.status(500).json({ message: "Failed to clear cache" });
  }
});

router.get("/export-db", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can export the instance database"));
    return;
  }
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toolbox-backup-"));
  const cleanup = () => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore temp cleanup failure
    }
  };
  try {
    if (process.platform !== "win32") {
      fs.chmodSync(tmpDir, 0o700);
    }
    const tmpFile = path.join(tmpDir, "toolbox_backup.db");
    await db.backup(tmpFile);
    if (process.platform !== "win32") {
      fs.chmodSync(tmpFile, 0o600);
    }
    res.download(tmpFile, "toolbox_backup.db", () => {
      cleanup();
    });
  } catch (err) {
    cleanup();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[system] Error exporting db:", msg);
    res.status(500).json({ message: "Failed to export database" });
  }
});

export default router;
