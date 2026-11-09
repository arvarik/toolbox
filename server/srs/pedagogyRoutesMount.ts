import type { Express, RequestHandler } from "express";
import drillsRoutes from "../routes/drills.ts";
import feynmanRoutes from "../routes/feynman.ts";

/**
 * Wave 1D seam: mounts `/api/drills` and `/api/feynman` without editing `server/app.ts`.
 */
export function mountPedagogyRoutes(
  app: Express,
  authed: RequestHandler[],
): void {
  app.use("/api/drills", ...authed, drillsRoutes);
  app.use("/api/feynman", ...authed, feynmanRoutes);
}
