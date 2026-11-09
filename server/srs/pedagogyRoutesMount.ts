import type { Express, RequestHandler } from "express";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { collectDueReviewQueue } from "../routes/decks.ts";
import drillsRoutes from "../routes/drills.ts";
import feynmanRoutes from "../routes/feynman.ts";

/**
 * Wave 1D seam: mounts `/api/drills`, `/api/feynman`, and the cross-Kit due queue at
 * `/api/review/due` and `/api/srs/due`.
 */
export function mountPedagogyRoutes(
  app: Express,
  authed: RequestHandler[],
): void {
  app.use("/api/drills", ...authed, drillsRoutes);
  app.use("/api/feynman", ...authed, feynmanRoutes);
  for (const path of ["/api/review/due", "/api/srs/due"]) {
    app.get(path, ...authed, (req, res) => {
      const kitSelector =
        typeof req.query.kitId === "string"
          ? req.query.kitId
          : typeof req.query.kit === "string"
            ? req.query.kit
            : null;
      res.json(collectDueReviewQueue(scopeOf(req), { kitSelector }));
    });
  }
}
