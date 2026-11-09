import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { isBackgroundJobsDisabled } from "./appConfig.ts";
import db from "./db.ts";
import { ensureLocalOwner } from "./platform/db/connection.ts";
import {
  attachRequestId,
  errorHandler,
  notFoundHandler,
  securityHeaders,
} from "./platform/net/errors.ts";
import { gzipCompression } from "./platform/net/compression.ts";
import { trustProxyHops } from "./platform/net/originAndFetch.ts";
import { hostGuard } from "./platform/net/hostGuard.ts";
import { attachRequestContext, scopeOf } from "./platform/tenancy/scope.ts";
import { countPasswordAccounts } from "./platform/auth/authService.ts";
import {
  attachPrincipal,
  guardReadOnlyToken,
  isAuthRequired,
  refuseCrossSiteWrites,
  requireAdmin,
  requireAuth,
  requirePasswordCurrent,
  setForcedAuth,
} from "./platform/auth/authMiddleware.ts";
import { authRouter } from "./platform/routes/authRoutes.ts";
import { adminRouter } from "./platform/routes/adminRoutes.ts";
import { mountKitRoutes } from "./kits/kitRoutesMount.ts";
import { mountMcpRoutes } from "./mcp/mcpRoutesMount.ts";

import configRoutes from "./routes/config.ts";
import endpointRoutes from "./routes/endpoints.ts";
import deckRoutes, { collectDueReviewQueue } from "./routes/decks.ts";
import boardRoutes from "./routes/boards.ts";
import chatRoutes from "./routes/chat.ts";
import studySessionRoutes from "./routes/study_sessions.ts";
import { mountAiRoutes } from "./platform/ai/aiRoutesMount.ts";
import guideContentRoutes from "./routes/guide_content.ts";
import profileRoutes from "./routes/profile.ts";
import systemRoutes from "./routes/system.ts";
import searchRoutes from "./routes/search.ts";
import graphRoutes from "./routes/graph.ts";
import calculatorRoutes from "./routes/calculator.ts";
import { seedApiKeysFromEnv } from "./providers/index.ts";
import { mountPedagogyRoutes } from "./srs/pedagogyRoutesMount.ts";
import { mountCompilerRoutes } from "./compiler/compilerRoutesMount.ts";
import { recoverOrphanedRunningJobs } from "./compiler/seedHydrator.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let startupOrphansRecovered = false;

export function createApp(): Express {
  if (countPasswordAccounts() > 0) {
    setForcedAuth(true);
  } else if (!isAuthRequired()) {
    ensureLocalOwner();
  }

  seedApiKeysFromEnv();

  const app = express();
  const isProduction = process.env.NODE_ENV === "production";

  app.set("trust proxy", trustProxyHops());
  app.use(attachRequestId);
  app.use(securityHeaders);
  app.use(hostGuard);
  app.use(gzipCompression);
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use(attachPrincipal);
  app.use(attachRequestContext);
  app.use(guardReadOnlyToken);
  app.use(refuseCrossSiteWrites);

  app.use("/api/auth", authRouter);
  mountMcpRoutes(app);
  app.use("/api/admin", requireAdmin, requirePasswordCurrent, adminRouter);

  const authed = [requireAuth, requirePasswordCurrent];
  mountKitRoutes(app, authed);
  app.use("/api/config", ...authed, configRoutes);
  app.use("/api/endpoints", ...authed, endpointRoutes);
  app.use("/api/decks", ...authed, deckRoutes);
  app.use("/api/boards", ...authed, boardRoutes);
  app.use("/api/chat", ...authed, chatRoutes);
  app.use("/api/study_sessions", ...authed, studySessionRoutes);
  mountAiRoutes(app, authed, [requireAdmin, requirePasswordCurrent]);
  app.use("/api/guide-content", ...authed, guideContentRoutes);
  app.use("/api/profile", ...authed, profileRoutes);
  app.use("/api/system", ...authed, systemRoutes);
  app.use("/api/search", ...authed, searchRoutes);
  app.use("/api/graph", ...authed, graphRoutes);
  app.use("/api/calculator", ...authed, calculatorRoutes);
  mountPedagogyRoutes(app, authed);
  app.get("/api/srs/due", ...authed, (req, res) => {
    const kitSelector =
      typeof req.query.kitId === "string"
        ? req.query.kitId
        : typeof req.query.kit === "string"
          ? req.query.kit
          : null;
    res.json(collectDueReviewQueue(scopeOf(req), { kitSelector }));
  });

  if (
    !startupOrphansRecovered &&
    !(process.env.VITEST || process.env.NODE_ENV === "test") &&
    !isBackgroundJobsDisabled()
  ) {
    startupOrphansRecovered = true;
    recoverOrphanedRunningJobs(db);
  }
  mountCompilerRoutes(app, authed);

  app.use("/api", notFoundHandler);

  if (isProduction) {
    const distPath = path.join(__dirname, "..", "dist");
    app.use(
      "/assets",
      express.static(path.join(distPath, "assets"), {
        maxAge: "1y",
        immutable: true,
      }),
    );
    app.use(
      express.static(distPath, {
        setHeaders: (res, filePath) => {
          if (path.basename(filePath) === "index.html") {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get("*all", (req, res, next) => {
      if (
        req.path === "/api" ||
        req.path.startsWith("/api/") ||
        req.path.startsWith("/.well-known/")
      ) {
        notFoundHandler(req, res, next);
        return;
      }
      res.sendFile(
        "index.html",
        {
          root: distPath,
          cacheControl: false,
          headers: { "Cache-Control": "no-cache" },
        },
        (err) => {
          if (err) next();
        },
      );
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
