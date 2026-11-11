import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
const UPLOAD_DIR = path.resolve(os.tmpdir());
const uploadBackup = multer({
  dest: UPLOAD_DIR,
  limits: {
    fileSize: MAX_BACKUP_UPLOAD_BYTES,
    files: 1,
    // Busboy keeps every text field in memory and allows unlimited fields by default.
    fields: 8,
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

function parseBody<T>(schema: z.ZodType<T>, raw: unknown, fallback: string): T {
  const parsed = schema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.issues[0]?.message ?? fallback);
  }
  return parsed.data;
}

function sendAttachment(
  res: Response,
  contentType: string,
  filename: string,
  payload: string | Buffer,
): void {
  res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(payload);
}

async function syncRagIfPopulated(
  scope: ReturnType<typeof scopeOf>,
  kitId: string,
): Promise<void> {
  const existingChunks = (
    db
      .prepare("SELECT COUNT(*) as c FROM rag_chunks WHERE ownerId = ? AND kit_id = ?")
      .get(scope.ownerId, kitId) as { c: number }
  ).c;
  if (existingChunks > 0) {
    await syncDomainSourcesToRag(db, scope, kitId, { pruneStale: true });
  }
}

async function handleSkeletonImport(
  req: Request,
  res: Response,
  errMessage: string,
): Promise<void> {
  const scope = scopeOf(req);
  const body = req.body as Record<string, unknown> | undefined;
  if (!body || typeof body !== "object") {
    throw new BadRequestError(errMessage);
  }
  const hasWrapper = "skeleton" in body && body.skeleton !== undefined;
  const rawSkeleton = hasWrapper ? body.skeleton : body;
  const onCollision = parseCollision(
    (hasWrapper ? body.onCollision : undefined) ?? req.query.onCollision,
  );
  const result = importKitMode1(db, scope, rawSkeleton, { onCollision });
  if (result.mode === "updated") {
    await syncRagIfPopulated(scope, result.kit.id);
  }
  res
    .status(result.mode === "created" || result.mode === "copied" ? 201 : 200)
    .json(result);
}

async function handleBackupUpload(req: Request, res: Response): Promise<void> {
  const scope = scopeOf(req);
  // Multer names the file with random bytes inside UPLOAD_DIR. Check that before any file access.
  const uploadPath = req.file?.path ? path.resolve(req.file.path) : "";
  if (!uploadPath.startsWith(UPLOAD_DIR + path.sep)) {
    throw new BadRequestError("Missing backup archive file upload");
  }
  try {
    const onCollision = parseCollision(
      req.body?.onCollision ?? req.query.onCollision,
    );
    const zipBuf = await fs.promises.readFile(uploadPath);
    const result = await importKitBackupZip(db, scope, zipBuf, { onCollision });
    if (result.mode === "updated") {
      await syncRagIfPopulated(scope, result.kit.id);
    }
    res
      .status(result.mode === "created" || result.mode === "copied" ? 201 : 200)
      .json(result);
  } finally {
    await fs.promises.unlink(uploadPath).catch(() => {});
  }
}

router.get("/", (req, res) => {
  res.json({ kits: listOwnedKits(db, scopeOf(req)) });
});

router.post(
  "/import-kit",
  asyncHandler(async (req, res) => {
    await handleSkeletonImport(req, res, "Expected JSON Kit skeleton payload");
  }),
);

router.post(
  "/import-backup",
  uploadBackup.single("file"),
  asyncHandler(handleBackupUpload),
);

router.post(
  "/import",
  (req, res, next) => {
    if ((req.headers["content-type"] ?? "").includes("multipart/form-data")) {
      return uploadBackup.single("file")(req, res, next);
    }
    next();
  },
  asyncHandler(async (req, res) => {
    if (req.file) {
      await handleBackupUpload(req, res);
      return;
    }
    await handleSkeletonImport(
      req,
      res,
      "Expected JSON skeleton or multipart backup archive",
    );
  }),
);

router.get("/:id", (req, res) => {
  res.json({ kit: getOwnedKit(db, scopeOf(req), String(req.params.id)) });
});

function handleUpdateKit(req: Request, res: Response): void {
  const patch = parseBody(
    UpdateKitPatchSchema,
    req.body,
    "Invalid kit update payload",
  );
  res.json({
    kit: updateOwnedKit(db, scopeOf(req), String(req.params.id), patch),
  });
}

router.patch("/:id", handleUpdateKit);
router.put("/:id", handleUpdateKit);

router.delete("/:id", (req, res) => {
  deleteOwnedKit(db, scopeOf(req), String(req.params.id));
  res.json({ ok: true });
});

router.post("/:id/touch", (req, res) => {
  touchOwnedKit(db, scopeOf(req), String(req.params.id));
  res.json({ ok: true });
});

router.get("/:id/archived-notes", (req, res) => {
  res.json({
    notes: getArchivedGuideNotes(db, scopeOf(req), String(req.params.id)),
  });
});

router.post(
  "/:id/archived-notes/refile",
  asyncHandler(async (req, res) => {
    const data = parseBody(
      RefileArchivedSchema,
      req.body,
      "Invalid refile payload",
    );
    await refileArchivedGuideNote(
      db,
      scopeOf(req),
      String(req.params.id),
      data,
    );
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
  await syncRagIfPopulated(scope, result.kit.id);
  res.json(result);
});

router.post("/:id/sync", handleSyncKit);
router.post("/:id/sync-upstream", handleSyncKit);

router.post("/:id/publish", (req, res) => {
  const user = currentUser(req);
  if (!user) {
    throw new AppError("Authentication required", 401, { code: "UNAUTHORIZED" });
  }
  const data = parseBody(PublishKitSchema, req.body, "Invalid publish payload");
  const sharedKit = publishKitToSharedLibrary(
    db,
    user,
    scopeOf(req),
    String(req.params.id),
    data,
  );
  res.status(201).json({ sharedKit });
});

function sendMode1Export(req: Request, res: Response): void {
  const includeGuideNotes =
    req.query.includeGuideNotes === "true" ||
    req.query.includeGuideNotes === "1";
  const { filename, skeleton } = exportKitMode1(
    db,
    scopeOf(req),
    String(req.params.id),
    { includeGuideNotes },
  );
  sendAttachment(
    res,
    "application/json; charset=utf-8",
    filename,
    JSON.stringify(skeleton, null, 2),
  );
}

async function sendBackupExport(req: Request, res: Response): Promise<void> {
  const { filename, buffer } = await exportKitBackupZip(
    db,
    scopeOf(req),
    String(req.params.id),
  );
  sendAttachment(res, "application/zip", filename, buffer);
}

router.get(
  "/:id/export",
  asyncHandler(async (req, res) => {
    if (req.query.mode === "backup") {
      await sendBackupExport(req, res);
      return;
    }
    sendMode1Export(req, res);
  }),
);

router.get("/:id/export-kit", sendMode1Export);
router.get("/:id/export-backup", asyncHandler(sendBackupExport));

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
