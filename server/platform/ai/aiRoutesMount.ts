import type { Express, RequestHandler } from "express";
import {
  adminAiSettingsRouter,
  userAiSettingsRouter,
} from "../../routes/aiSettings.ts";

/**
 * Mounts `/api/ai-settings` (per-user BYOK & capability overrides) and
 * `/api/admin/ai-settings` (instance capabilities, embeddings & SearXNG)
 * without modifying `server/app.ts`.
 */
export function mountAiRoutes(
  app: Express,
  authed: RequestHandler[],
  adminAuthed: RequestHandler[],
): void {
  app.use("/api/ai-settings", ...authed, userAiSettingsRouter);
  app.use("/api/admin/ai-settings", ...adminAuthed, adminAiSettingsRouter);
}
