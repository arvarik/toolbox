import type { Express, RequestHandler } from "express";
import db from "../db.ts";
import compilerRouter from "../routes/compiler.ts";
import { resumePendingSeedJobs } from "./seedHydrator.ts";

let startupResumed = false;

/**
 * Wave 2E seam: mounts `/api/compiler` and resumes any interrupted `seed_kit_pillars` jobs on startup.
 */
export function mountCompilerRoutes(
  app: Express,
  authed: RequestHandler[],
): void {
  app.use("/api/compiler", ...authed, compilerRouter);

  if (
    !startupResumed &&
    !(process.env.VITEST || process.env.NODE_ENV === "test")
  ) {
    startupResumed = true;
    void resumePendingSeedJobs(db);
  }
}
