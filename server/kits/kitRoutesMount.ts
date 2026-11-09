import type { Express, RequestHandler } from "express";
import kitsRouter from "../routes/kits.ts";
import sharedKitsRouter from "../routes/sharedKits.ts";

/**
 * Wave 1A seam: mounts `/api/kits` and `/api/shared-kits` without editing `server/app.ts`.
 */
export function mountKitRoutes(
  app: Express,
  authed: RequestHandler[],
): void {
  app.use("/api/kits", ...authed, kitsRouter);
  app.use("/api/shared-kits", ...authed, sharedKitsRouter);
}
