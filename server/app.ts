import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Express } from "express";
import "./db.ts";
import { ensureLocalOwner } from "./platform/db/connection.ts";
import {
  attachRequestId,
  errorHandler,
  notFoundHandler,
  securityHeaders,
} from "./platform/net/errors.ts";
import { trustProxyHops } from "./platform/net/originAndFetch.ts";
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

import configRoutes from "./routes/config.ts";
import endpointRoutes from "./routes/endpoints.ts";
import deckRoutes from "./routes/decks.ts";
import boardRoutes from "./routes/boards.ts";
import chatRoutes from "./routes/chat.ts";
import studySessionRoutes from "./routes/study_sessions.ts";
import guideContentRoutes from "./routes/guide_content.ts";
import profileRoutes from "./routes/profile.ts";
import systemRoutes from "./routes/system.ts";
import searchRoutes from "./routes/search.ts";
import graphRoutes from "./routes/graph.ts";
import calculatorRoutes from "./routes/calculator.ts";
import { seedApiKeysFromEnv } from "./providers/index.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
  app.use(express.json({ limit: "10mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  app.use(attachPrincipal);
  app.use(attachRequestContext);
  app.use(guardReadOnlyToken);
  app.use(refuseCrossSiteWrites);

  app.use("/api/auth", authRouter);
  app.use("/api/admin", requireAdmin, requirePasswordCurrent, adminRouter);

  const authed = [requireAuth, requirePasswordCurrent];
  mountKitRoutes(app, authed);
  app.use("/api/config", ...authed, configRoutes);
  app.use("/api/endpoints", ...authed, endpointRoutes);
  app.use("/api/decks", ...authed, deckRoutes);
  app.use("/api/boards", ...authed, boardRoutes);
  app.use("/api/chat", ...authed, chatRoutes);
  app.use("/api/study_sessions", ...authed, studySessionRoutes);
  app.use("/api/guide-content", ...authed, guideContentRoutes);
  app.use("/api/profile", ...authed, profileRoutes);
  app.use("/api/system", ...authed, systemRoutes);
  app.use("/api/search", ...authed, searchRoutes);
  app.use("/api/graph", ...authed, graphRoutes);
  app.use("/api/calculator", ...authed, calculatorRoutes);

  app.use("/api", notFoundHandler);

  if (isProduction) {
    const distPath = path.join(__dirname, "..", "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      if (!req.path.startsWith("/api")) {
        res.sendFile(path.join(distPath, "index.html"));
      }
    });
  }

  app.use(errorHandler);
  return app;
}
