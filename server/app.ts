import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import { isBackgroundJobsDisabled } from "./appConfig.ts";
import db from "./db.ts";
import { ensureLocalOwner } from "./platform/db/connection.ts";
import {
  assertJsonDepth,
  attachRequestId,
  errorHandler,
  isApiSurface,
  log,
  notFoundHandler,
  safeJsonReviver,
  securityHeaders,
} from "./platform/net/errors.ts";
import { gzipCompression } from "./platform/net/compression.ts";
import {
  createCostRateLimiters,
  createRateLimiter,
} from "./platform/net/rateLimit.ts";
import {
  hasHttpsForwardedProto,
  trustProxyHops,
  warnIfTlsProxyUntrusted,
} from "./platform/net/originAndFetch.ts";
import { hostGuard, mcpCorsPreflight } from "./platform/net/hostGuard.ts";
import { attachRequestContext } from "./platform/tenancy/scope.ts";
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
import deckRoutes from "./routes/decks.ts";
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

const apiRateLimit = createRateLimiter({
  windowMs: 60_000,
  max: 1_200,
  name: "API",
});

// GET /api/chat/starters stays unmetered: it serves a per-topic cache and calls
// the AI only on a miss, so metering it would spend the chat budget on reads.
const aiCostLimiters = createCostRateLimiters([
  /^\/api\/chat(?:\/(?:stream|generate-flashcards|generate-reverse-cards|summarize|evaluate-interceptor|concept-map|commit))?$/,
  /^\/api\/feynman\/evaluate$/,
  /^\/api\/compiler\/(?:calibrate|compile|refine|commit)$/,
  /^\/api\/compiler\/kits\/[^/]+\/expand$/,
  /^\/api\/drills\/(?:generate|challenge\/[^/]+|[^/]+\/submit)$/,
  /^\/api\/boards\/[^/]+\/critique$/,
  /^\/api\/calculator\/audit$/,
]);

let proxyWarnEpoch = 0;

export function __resetAppRateLimits(): void {
  apiRateLimit.reset();
  aiCostLimiters.reset();
  proxyWarnEpoch++;
}

export function createApp(): Express {
  if (countPasswordAccounts() > 0) {
    setForcedAuth(true);
  } else if (!isAuthRequired()) {
    ensureLocalOwner();
  }

  seedApiKeysFromEnv();

  const app = express();
  app.disable("x-powered-by");
  const isProduction = process.env.NODE_ENV === "production";

  const proxyHops = trustProxyHops();
  app.set("trust proxy", proxyHops);
  warnIfTlsProxyUntrusted(proxyHops);
  let warnedUntrustedProxyEpoch = -1;
  app.use((req, _res, next) => {
    if (
      warnedUntrustedProxyEpoch !== proxyWarnEpoch &&
      !req.secure &&
      proxyHops === 0 &&
      trustProxyHops() === 0 &&
      hasHttpsForwardedProto(req)
    ) {
      warnedUntrustedProxyEpoch = proxyWarnEpoch;
      log.warn(
        "security",
        "Received X-Forwarded-Proto: https while TRUST_PROXY_HOPS is 0; ignoring untrusted header. Set TRUST_PROXY_HOPS=1 (or your proxy hop count) if Toolbox runs behind a trusted TLS reverse proxy so session cookies receive '; Secure' and Strict-Transport-Security.",
      );
    }
    next();
  });
  app.use(attachRequestId);
  app.use(securityHeaders);
  app.use(hostGuard);
  app.use(gzipCompression);
  app.use(
    express.json({
      limit: "10mb",
      verify: (_req, _res, buf) => assertJsonDepth(buf),
      reviver: safeJsonReviver,
    }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use("/api", apiRateLimit);
  app.use(aiCostLimiters.perIp);
  app.use(attachPrincipal);
  app.use(attachRequestContext);
  app.use(aiCostLimiters.perUser);
  app.use(guardReadOnlyToken);
  app.use(refuseCrossSiteWrites);

  app.use("/api/auth", authRouter);
  app.use("/api/mcp", mcpCorsPreflight);
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
        dotfiles: "deny",
      }),
    );
    app.use(
      express.static(distPath, {
        dotfiles: "deny",
        setHeaders: (res, filePath) => {
          if (path.basename(filePath) === "index.html") {
            res.setHeader("Cache-Control", "no-cache");
          }
        },
      }),
    );
    app.get("*all", (req, res, next) => {
      if (isApiSurface(req.path)) {
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
