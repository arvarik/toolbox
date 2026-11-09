import fs from "node:fs";
import os from "node:os";
import { Router, type Request, type Response } from "express";
import multer from "multer";
import { z } from "zod";
import db from "../db.ts";
import { currentUser } from "../platform/auth/authMiddleware.ts";
import { BadRequestError } from "../platform/archive/zip.ts";
import {
  AppError,
  asyncHandler,
  ValidationError,
} from "../platform/net/errors.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import {
  exportKitBackupZip,
  exportKitMode1,
  importKitBackupZip,
  importKitMode1,
  type ImportCollisionPolicy,
} from "../kits/kitExportImport.ts";
import {
  deleteArchivedGuideNote,
  deleteOwnedKit,
  getArchivedGuideNotes,
  getKitSourceFile,
  getOwnedKit,
  listOwnedKits,
  publishKitToSharedLibrary,
  refileArchivedGuideNote,
  touchOwnedKit,
  updateOwnedKit,
} from "../kits/kitService.ts";
import {
  pullUpstreamKitUpdate,
  syncKitStructure,
} from "../kits/kitSync.ts";
import { syncDomainSourcesToRag } from "../search/hybridSearch.ts";

const router = Router();

const MAX_BACKUP_UPLOAD_BYTES = 100 * 1024 * 1024;
const uploadBackup = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: MAX_BACKUP_UPLOAD_BYTES,
    files: 1,
  },
});

const CollisionSchema = z
  .enum(["error", "copy", "replace", "update"])
  .default("error");

const UpdateKitPatchSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(600).optional(),
  icon: z.string().max(16).optional(),
  color: z.string().max(32).optional(),
  slug: z.string().min(1).max(80).optional(),
});

const RefileArchivedSchema = z.object({
  fromPillarId: z.string().min(1),
  fromTopicId: z.string().min(1),
  fromSectionId: z.string().min(1),
  toPillarId: z.string().min(1),
  toTopicId: z.string().min(1),
  toSectionId: z.string().min(1),
});

const PublishKitSchema = z.object({
  changelog: z.string().max(1000).optional(),
  includeBaselineNotes: z.boolean().optional(),
  slug: z.string().min(1).max(80).optional(),
});

function parseCollision(raw: unknown): ImportCollisionPolicy {
  const parsed = CollisionSchema.safeParse(raw ?? "error");
  if (!parsed.success) {
    throw new ValidationError("Invalid onCollision policy");
  }
  return parsed.data;
}

router.get("/", (req, res) => {
  const scope = scopeOf(req);
  const kits = listOwnedKits(db, scope);
  res.json({ kits });
});

router.post(
  "/import-kit",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      throw new BadRequestError("Expected JSON Kit skeleton payload");
    }
    const hasWrapper = "skeleton" in body && body.skeleton !== undefined;
    const rawSkeleton = hasWrapper ? body.skeleton : body;
    const onCollision = parseCollision(
      (hasWrapper ? body.onCollision : undefined) ?? req.query.onCollision,
    );

    const result = importKitMode1(db, scope, rawSkeleton, { onCollision });
    const status =
      result.mode === "created" || result.mode === "copied" ? 201 : 200;
    res.status(status).json(result);
  }),
);

async function handleBackupUpload(req: Request, res: Response): Promise<void> {
  const scope = scopeOf(req);
  const file = req.file;
  if (!file?.path) {
    throw new BadRequestError("Missing backup archive file upload");
  }
  try {
    const onCollision = parseCollision(
      req.body?.onCollision ?? req.query.onCollision,
    );
    const zipBuf = await fs.promises.readFile(file.path);
    const result = await importKitBackupZip(db, scope, zipBuf, { onCollision });
    const status =
      result.mode === "created" || result.mode === "copied" ? 201 : 200;
    res.status(status).json(result);
  } finally {
    await fs.promises.unlink(file.path).catch(() => {});
  }
}

router.post(
  "/import-backup",
  uploadBackup.single("file"),
  asyncHandler(handleBackupUpload),
);

router.post(
  "/import",
  (req, res, next) => {
    const ct = req.headers["content-type"] ?? "";
    if (ct.includes("multipart/form-data")) {
      return uploadBackup.single("file")(req, res, next);
    }
    next();
  },
  asyncHandler(async (req, res) => {
    if (req.file) {
      await handleBackupUpload(req, res);
      return;
    }
    const scope = scopeOf(req);
    const body = req.body as Record<string, unknown> | undefined;
    if (!body || typeof body !== "object") {
      throw new BadRequestError("Expected JSON skeleton or multipart backup archive");
    }
    const hasWrapper = "skeleton" in body && body.skeleton !== undefined;
    const rawSkeleton = hasWrapper ? body.skeleton : body;
    const onCollision = parseCollision(
      (hasWrapper ? body.onCollision : undefined) ?? req.query.onCollision,
    );
    const result = importKitMode1(db, scope, rawSkeleton, { onCollision });
    const status =
      result.mode === "created" || result.mode === "copied" ? 201 : 200;
    res.status(status).json(result);
  }),
);

router.get("/:id", (req, res) => {
  const scope = scopeOf(req);
  const kit = getOwnedKit(db, scope, String(req.params.id));
  res.json({ kit });
});

function handleUpdateKit(req: Request, res: Response): void {
  const scope = scopeOf(req);
  const parsed = UpdateKitPatchSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid kit update payload",
    );
  }
  const kit = updateOwnedKit(db, scope, String(req.params.id), parsed.data);
  res.json({ kit });
}

router.patch("/:id", handleUpdateKit);
router.put("/:id", handleUpdateKit);

router.delete("/:id", (req, res) => {
  const scope = scopeOf(req);
  deleteOwnedKit(db, scope, String(req.params.id));
  res.json({ ok: true });
});

router.post("/:id/touch", (req, res) => {
  const scope = scopeOf(req);
  touchOwnedKit(db, scope, String(req.params.id));
  res.json({ ok: true });
});

router.get("/:id/archived-notes", (req, res) => {
  const scope = scopeOf(req);
  const notes = getArchivedGuideNotes(db, scope, String(req.params.id));
  res.json({ notes });
});

router.post(
  "/:id/archived-notes/refile",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const parsed = RefileArchivedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message ?? "Invalid refile payload",
      );
    }
    await refileArchivedGuideNote(db, scope, String(req.params.id), parsed.data);
    res.json({ ok: true });
  }),
);

router.delete("/:id/archived-notes", (req, res) => {
  const scope = scopeOf(req);
  const src = {
    pillarId: req.body?.pillarId ?? req.query.pillarId,
    topicId: req.body?.topicId ?? req.query.topicId,
    sectionId: req.body?.sectionId ?? req.query.sectionId,
  };
  if (
    typeof src.pillarId !== "string" ||
    typeof src.topicId !== "string" ||
    typeof src.sectionId !== "string" ||
    !src.pillarId ||
    !src.topicId ||
    !src.sectionId
  ) {
    throw new ValidationError("pillarId, topicId, and sectionId are required");
  }
  deleteArchivedGuideNote(db, scope, String(req.params.id), {
    pillarId: src.pillarId,
    topicId: src.topicId,
    sectionId: src.sectionId,
  });
  res.json({ ok: true });
});

const handleSyncKit = asyncHandler(async (req, res) => {
  const scope = scopeOf(req);
  const kitId = String(req.params.id);
  const body = req.body as { skeleton?: unknown } | undefined;
  const result =
    body && typeof body === "object" && body.skeleton !== undefined
      ? syncKitStructure(db, scope, kitId, body.skeleton)
      : pullUpstreamKitUpdate(db, scope, kitId);
  const existingChunks = (
    db
      .prepare("SELECT COUNT(*) as c FROM rag_chunks WHERE ownerId = ? AND kit_id = ?")
      .get(scope.ownerId, result.kit.id) as { c: number }
  ).c;
  if (existingChunks > 0) {
    await syncDomainSourcesToRag(db, scope, result.kit.id, { pruneStale: true });
  }
  res.json(result);
});

router.post("/:id/sync", handleSyncKit);
router.post("/:id/sync-upstream", handleSyncKit);

router.post("/:id/publish", (req, res) => {
  const scope = scopeOf(req);
  const user = currentUser(req);
  if (!user) {
    throw new AppError("Authentication required", 401, { code: "UNAUTHORIZED" });
  }
  const parsed = PublishKitSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid publish payload",
    );
  }
  const sharedKit = publishKitToSharedLibrary(
    db,
    user,
    scope,
    String(req.params.id),
    parsed.data,
  );
  res.status(201).json({ sharedKit });
});

router.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const id = String(req.params.id);
    const mode = req.query.mode === "backup" ? "backup" : "kit";

    if (mode === "backup") {
      const { filename, buffer } = await exportKitBackupZip(db, scope, id);
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(buffer);
      return;
    }

    const includeGuideNotes =
      req.query.includeGuideNotes === "true" ||
      req.query.includeGuideNotes === "1";
    const { filename, skeleton } = exportKitMode1(db, scope, id, {
      includeGuideNotes,
    });
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(JSON.stringify(skeleton, null, 2));
  }),
);

router.get("/:id/export-kit", (req, res) => {
  const scope = scopeOf(req);
  const includeGuideNotes =
    req.query.includeGuideNotes === "true" ||
    req.query.includeGuideNotes === "1";
  const { filename, skeleton } = exportKitMode1(
    db,
    scope,
    String(req.params.id),
    { includeGuideNotes },
  );
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(JSON.stringify(skeleton, null, 2));
});

router.get(
  "/:id/export-backup",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { filename, buffer } = await exportKitBackupZip(
      db,
      scope,
      String(req.params.id),
    );
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  }),
);

router.get(
  "/:id/sources/:sourceId/file",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { filePath, downloadName, mimeType } = getKitSourceFile(
      db,
      scope,
      String(req.params.id),
      String(req.params.sourceId),
    );
    const safeMime =
      mimeType.startsWith("text/html") || mimeType.includes("svg")
        ? "application/octet-stream"
        : mimeType;

    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
    res.setHeader("Content-Type", safeMime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${downloadName}"`,
    );

    const buf = await fs.promises.readFile(filePath);
    res.send(buf);
  }),
);

export default router;
