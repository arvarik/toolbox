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
    const count = (sql: string) =>
      (db.prepare(sql).get(scope.ownerId) as { c: number }).c;

    const flashcardsCount = count(
      "SELECT COUNT(*) as c FROM flashcards WHERE ownerId = ?",
    );
    const decksCount = count(
      "SELECT COUNT(*) as c FROM decks WHERE ownerId = ?",
    );
    const boardsCount = count(
      "SELECT COUNT(*) as c FROM boards WHERE ownerId = ?",
    );
    const guideCount = count(
      "SELECT COUNT(*) as c FROM guide_content WHERE ownerId = ? AND content != ''",
    );
    const cachedStartersCount = count(
      "SELECT COUNT(*) as c FROM chat_starters WHERE ownerId = ?",
    );
    const profileRow = db
      .prepare(
        "SELECT profile_text FROM user_learning_profile WHERE ownerId = ?",
      )
      .get(scope.ownerId) as { profile_text: string } | undefined;
    const profileSize = profileRow?.profile_text
      ? profileRow.profile_text.length
      : 0;

    res.json({
      flashcardsCount,
      decksCount,
      boardsCount,
      guideCount,
      cachedStartersCount,
      profileSize,
    });
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
