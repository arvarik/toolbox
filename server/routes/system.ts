import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import { BACKUPS_DIR } from "../appConfig.ts";
import db from "../db.ts";
import { requireAdmin } from "../platform/auth/authMiddleware.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import logger from "../utils/logger.ts";

const router = Router();
const EXPORT_TMP_DIRNAME = ".tmp";

interface StagedExport {
  tmpDir: string;
  tmpFile: string;
  activeReaders: number;
}

let inFlightExport: {
  promise: Promise<StagedExport>;
  waiters: number;
} | null = null;

function removeDirQuietly(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // Ignore temp cleanup failure
  }
}

async function acquireStagedExport(): Promise<{
  tmpFile: string;
  release: () => void;
}> {
  if (!inFlightExport) {
    const tmpRoot = path.join(BACKUPS_DIR, EXPORT_TMP_DIRNAME);
    const entry: {
      promise: Promise<StagedExport>;
      waiters: number;
    } = {
      waiters: 0,
      promise: (async () => {
        fs.mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") {
          fs.chmodSync(tmpRoot, 0o700);
        }
        const tmpDir = fs.mkdtempSync(path.join(tmpRoot, "toolbox-backup-"));
        if (process.platform !== "win32") {
          fs.chmodSync(tmpDir, 0o700);
        }
        const tmpFile = path.join(tmpDir, "toolbox_backup.db");
        try {
          await db.backup(tmpFile);
          if (process.platform !== "win32") {
            fs.chmodSync(tmpFile, 0o600);
          }
          return { tmpDir, tmpFile, activeReaders: 0 };
        } catch (err) {
          removeDirQuietly(tmpDir);
          throw err;
        }
      })(),
    };
    inFlightExport = entry;
  }

  const current = inFlightExport;
  current.waiters += 1;
  let staged: StagedExport;
  try {
    staged = await current.promise;
    staged.activeReaders += 1;
  } finally {
    current.waiters -= 1;
    if (current.waiters === 0 && inFlightExport === current) {
      inFlightExport = null;
    }
  }

  let released = false;
  return {
    tmpFile: staged.tmpFile,
    release: () => {
      if (released) return;
      released = true;
      staged.activeReaders -= 1;
      if (staged.activeReaders <= 0 && current.waiters <= 0) {
        removeDirQuietly(staged.tmpDir);
      }
    },
  };
}

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

router.get("/export-db", requireAdmin, async (_req, res, next) => {
  let release: (() => void) | null = null;
  try {
    const staged = await acquireStagedExport();
    release = staged.release;
    if (res.closed || res.destroyed || res.writableEnded) {
      release();
      return;
    }
    res.once("close", release);
    res.download(
      staged.tmpFile,
      "toolbox_backup.db",
      { dotfiles: "allow" },
      (err) => {
        release?.();
        if (err && !res.headersSent) {
          next(err);
        }
      },
    );
  } catch (err) {
    release?.();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[system] Error exporting db:", msg);
    if (!res.headersSent) {
      res.status(500).json({ message: "Failed to export database" });
    }
  }
});

export default router;
