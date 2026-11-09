/**
 * Refuse to start if `dist/` has not been built yet.
 *
 * Every worker runs `NODE_ENV=production`, where Express serves `dist/` and
 * applies the SPA fallback. Checking once up front turns N server timeouts
 * into a single clear instruction.
 */
import { access } from "node:fs/promises";
import path from "node:path";
import { REPO_ROOT } from "./fixtures/paths.ts";

export default async function globalSetup(): Promise<void> {
  const indexHtml = path.join(REPO_ROOT, "dist", "index.html");
  try {
    await access(indexHtml);
  } catch {
    throw new Error(
      `dist/index.html is missing (${indexHtml}). Run \`npm run build\` before \`npm run test:e2e\`.`,
    );
  }
}
