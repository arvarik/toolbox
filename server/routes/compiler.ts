import fs from "node:fs";
import os from "node:os";
import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import multer from "multer";
import { z } from "zod";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import { calibrateKitScope } from "../compiler/calibration.ts";
import { compileKitDag, refineBlueprint } from "../compiler/dagCompiler.ts";
import { expandLivingKit } from "../compiler/livingExpand.ts";
import {
  commitCompiledKit,
  getKitSeedStatus,
} from "../compiler/seedHydrator.ts";
import {
  deleteStagedSource,
  loadStagedSources,
  MAX_PDF_BYTES,
  resolveInlineAndStagedSources,
  stageRawTextSource,
  stageUploadedFile,
  stageUrlSource,
  type StagedSourceSummary,
} from "../compiler/sourceIngest.ts";
import {
  buildVerifiedSourcePool,
  type VerifiedSourcePool,
} from "../compiler/verifiedPool.ts";
import db from "../db.ts";
import {
  AppError,
  asyncHandler,
  ValidationError,
} from "../platform/net/errors.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";

const router = Router();

const uploadCompilerFiles = multer({
  dest: os.tmpdir(),
  limits: {
    fileSize: MAX_PDF_BYTES,
    files: 8,
  },
});

function runMulterAny(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const ct = req.headers["content-type"] ?? "";
  if (!ct.toLowerCase().includes("multipart/form-data")) {
    next();
    return;
  }
  uploadCompilerFiles.any()(req, res, (err: unknown) => {
    if (!err) {
      next();
      return;
    }
    if (err instanceof multer.MulterError) {
      if (err.code === "LIMIT_FILE_SIZE") {
        next(
          new AppError("Uploaded file exceeds the 25 MB limit.", 413, {
            code: "FILE_TOO_LARGE",
          }),
        );
        return;
      }
      next(new ValidationError(`Upload error: ${err.message}`));
      return;
    }
    next(err);
  });
}

const DepthEnumSchema = z
  .enum(["quick", "standard", "deep"])
  .default("standard");

const JsonIngestSchema = z.object({
  url: z.string().max(2048).optional(),
  urls: z.array(z.string().max(2048)).max(10).optional(),
  text: z.string().max(2_100_000).optional(),
  title: z.string().max(200).optional(),
});

const CalibrateBodySchema = z.object({
  topicPrompt: z.string().min(1).max(4000),
  depth: DepthEnumSchema,
  stagedSourceIds: z.array(z.string().max(120)).max(20).default([]),
  urls: z.array(z.string().max(2048)).max(10).default([]),
  pastedText: z.string().max(2_100_000).optional(),
  pastedTitle: z.string().max(200).optional(),
  model: z.string().max(120).optional(),
});

const CompileBodySchema = z.object({
  topicPrompt: z.string().min(1).max(4000),
  depth: DepthEnumSchema,
  stagedSourceIds: z.array(z.string().max(120)).max(20).default([]),
  urls: z.array(z.string().max(2048)).max(10).default([]),
  pastedText: z.string().max(2_100_000).optional(),
  pastedTitle: z.string().max(200).optional(),
  enableWebResearch: z.boolean().default(false),
  suggestedTitle: z.string().max(140).optional(),
  suggestedIcon: z.string().max(24).optional(),
  suggestedDescription: z.string().max(800).optional(),
  suggestedCapabilities: z
    .object({
      canvas: z.enum(["none", "concept", "architecture"]).optional(),
      calculator: z.boolean().optional(),
      webResearchDefault: z.boolean().optional(),
      enableSvgDiagrams: z.boolean().optional(),
    })
    .optional(),
  calibrationAnswers: z.record(z.string(), z.string()).optional(),
  customInstructions: z.string().max(4000).optional(),
  model: z.string().max(120).optional(),
});

const VerifiedPoolInputSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(32),
        kind: z.enum(["pdf", "markdown", "text", "url", "web"]),
        title: z.string().max(300),
        url: z.string().max(2048).nullable(),
        note: z.string().max(400).nullable(),
        excerpt: z.string().max(20_000),
      }),
    )
    .max(50),
  gapCheckQueries: z.array(z.string().max(300)).default([]),
});

const RefineBodySchema = z.object({
  skeleton: z.record(z.string(), z.any()),
  instruction: z.string().min(1).max(4000),
  stagedSourceIds: z.array(z.string().max(120)).max(20).default([]),
  pool: VerifiedPoolInputSchema.optional(),
  model: z.string().max(120).optional(),
});

const CommitBodySchema = z.object({
  skeleton: z.record(z.string(), z.any()),
  stagedSourceIds: z.array(z.string().max(120)).max(20).default([]),
  model: z.string().max(120).optional(),
});

const ExpandBodySchema = z.object({
  prompt: z.string().min(1).max(4000),
  stagedSourceIds: z.array(z.string().max(120)).max(20).default([]),
  urls: z.array(z.string().max(2048)).max(10).default([]),
  pastedText: z.string().max(2_100_000).optional(),
  pastedTitle: z.string().max(200).optional(),
  enableWebResearch: z.boolean().default(false),
  model: z.string().max(120).optional(),
});

const handleIngestSources = asyncHandler(async (req, res) => {
  const scope = scopeOf(req);
  const uploadedFiles = Array.isArray(req.files) ? req.files : [];

  try {
    const staged: StagedSourceSummary[] = [];

    for (const file of uploadedFiles) {
      const summary = await stageUploadedFile(scope, file);
      staged.push(summary);
    }

    if (req.body && typeof req.body === "object") {
      const parsed = JsonIngestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ValidationError(
          parsed.error.issues.map((i) => i.message).join("; "),
        );
      }
      const { url, urls, text, title } = parsed.data;
      const allUrls = [
        ...(url?.trim() ? [url.trim()] : []),
        ...(urls ?? []).map((u) => u.trim()).filter(Boolean),
      ];
      for (const targetUrl of allUrls) {
        staged.push(await stageUrlSource(scope, targetUrl));
      }
      if (text?.trim()) {
        staged.push(
          stageRawTextSource(
            scope,
            text,
            title?.trim() || "Pasted Notes / Syllabus",
          ),
        );
      }
    }

    if (staged.length === 0) {
      throw new ValidationError(
        "Provide at least one file (.pdf, .md, .txt), URL, or pasted text block.",
      );
    }

    res.status(201).json({ sources: staged });
  } finally {
    for (const file of uploadedFiles) {
      if (file.path) {
        fs.rmSync(file.path, { force: true });
      }
    }
  }
});

router.post("/sources", runMulterAny, handleIngestSources);
router.post("/ingest", runMulterAny, handleIngestSources);

router.delete("/sources/:stagedId", (req, res) => {
  const scope = scopeOf(req);
  deleteStagedSource(scope, req.params.stagedId);
  res.json({ ok: true });
});

router.post(
  "/calibrate",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const parsed = CalibrateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const body = parsed.data;

    const loaded = await resolveInlineAndStagedSources(scope, {
      stagedSourceIds: body.stagedSourceIds,
      urls: body.urls,
      pastedText: body.pastedText,
      pastedTitle: body.pastedTitle,
    });

    const calibration = await calibrateKitScope({
      topicPrompt: body.topicPrompt,
      depth: body.depth,
      sourceSummaries: loaded.map((s) => ({
        title: s.title,
        kind: s.kind,
        excerpt: s.excerpt,
      })),
      scope,
      model: body.model,
    });

    const stagedSources: StagedSourceSummary[] = loaded.map(
      ({ text: _t, stagedFilePath: _fp, stagedDir: _d, ...summary }) => summary,
    );

    res.json({ calibration, stagedSources });
  }),
);

router.post(
  "/compile",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const parsed = CompileBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const body = parsed.data;

    const loaded = await resolveInlineAndStagedSources(scope, {
      stagedSourceIds: body.stagedSourceIds,
      urls: body.urls,
      pastedText: body.pastedText,
      pastedTitle: body.pastedTitle,
    });

    const calibrationContext = [
      body.calibrationAnswers
        ? Object.entries(body.calibrationAnswers)
            .map(([k, v]) => `${k}: ${v}`)
            .join("; ")
        : "",
      body.customInstructions ?? "",
    ]
      .filter(Boolean)
      .join(" | ");

    const pool = await buildVerifiedSourcePool({
      topicPrompt: body.topicPrompt,
      depth: body.depth,
      stagedSources: loaded,
      enableWebResearch: body.enableWebResearch,
      calibrationContext,
      scope,
      model: body.model,
    });

    const compiled = await compileKitDag({
      topicPrompt: body.topicPrompt,
      depth: body.depth,
      suggestedTitle: body.suggestedTitle,
      suggestedIcon: body.suggestedIcon,
      suggestedDescription: body.suggestedDescription,
      suggestedCapabilities: body.suggestedCapabilities,
      calibrationAnswers: body.calibrationAnswers,
      customInstructions: body.customInstructions,
      pool,
      scope,
      model: body.model,
    });

    const stagedSources: StagedSourceSummary[] = loaded.map(
      ({ text: _t, stagedFilePath: _fp, stagedDir: _d, ...summary }) => summary,
    );

    res.json({
      skeleton: compiled.skeleton,
      pool,
      citedSourceIds: compiled.citedSourceIds,
      dagRepair: compiled.dagRepair,
      stagedSources,
    });
  }),
);

router.post(
  "/refine",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const parsed = RefineBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const body = parsed.data;

    let pool: VerifiedSourcePool;
    if (body.pool) {
      pool = body.pool;
    } else {
      const loaded = loadStagedSources(scope, body.stagedSourceIds);
      pool = await buildVerifiedSourcePool({
        topicPrompt: "",
        stagedSources: loaded,
        enableWebResearch: false,
        scope,
      });
    }

    const refined = await refineBlueprint({
      draftSkeleton: body.skeleton as unknown as KitSkeletonV1,
      instruction: body.instruction,
      pool,
      scope,
      model: body.model,
    });

    res.json({
      skeleton: refined.skeleton,
      citedSourceIds: refined.citedSourceIds,
      dagRepair: refined.dagRepair,
    });
  }),
);

router.post(
  "/commit",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const parsed = CommitBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const body = parsed.data;
    const stagedSources = loadStagedSources(scope, body.stagedSourceIds);

    const committed = await commitCompiledKit(db, scope, {
      skeleton: body.skeleton as unknown as KitSkeletonV1,
      stagedSources,
      model: body.model,
    });

    res.status(201).json(committed);
  }),
);

router.get("/kits/:id/seed-status", (req, res) => {
  const scope = scopeOf(req);
  const status = getKitSeedStatus(db, scope, req.params.id);
  res.json(status);
});

router.post(
  "/kits/:id/expand",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const parsed = ExpandBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues.map((i) => i.message).join("; "),
      );
    }
    const body = parsed.data;

    const stagedSources = await resolveInlineAndStagedSources(scope, {
      stagedSourceIds: body.stagedSourceIds,
      urls: body.urls,
      pastedText: body.pastedText,
      pastedTitle: body.pastedTitle,
    });

    const expanded = await expandLivingKit(db, scope, {
      slugOrId: String(req.params.id),
      prompt: body.prompt,
      stagedSources,
      enableWebResearch: body.enableWebResearch,
      model: body.model,
    });

    res.json(expanded);
  }),
);

export default router;
