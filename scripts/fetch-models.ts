/**
 * Pre-fetches the local ONNX embedding model (`Xenova/all-MiniLM-L6-v2`, `q8`)
 * into `${DATA_DIR}/models` with SHA-256 verification so container builds and
 * offline deployments never download weights at runtime.
 *
 * Usage:
 *   node scripts/fetch-models.ts [destDir]
 *   node scripts/fetch-models.ts --check [destDir]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DATA_DIR } from "../server/appConfig.ts";
import {
  PINNED_MODELS,
  modelDir,
  modelsRootDir,
} from "../server/platform/workers/protocol.ts";

const FETCH_TIMEOUT_MS = 180_000;

function sha256File(filePath: string): string {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function readSidecarSha(filePath: string): string | undefined {
  try {
    const raw = fs.readFileSync(`${filePath}.sha256`, "utf8").trim();
    return /^[0-9a-f]{64}$/i.test(raw) ? raw.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

function presentAndValid(filePath: string, expectedSha?: string): boolean {
  try {
    const st = fs.statSync(filePath);
    if (!st.isFile() || st.size === 0) return false;
    const checkSha = expectedSha ?? readSidecarSha(filePath);
    if (checkSha) {
      return sha256File(filePath) === checkSha;
    }
    return true;
  } catch {
    return false;
  }
}

async function download(
  url: string,
  dest: string,
  expectedSha?: string,
): Promise<{ size: number; sha256: string }> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part-${process.pid}`;
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} fetching ${url}`);
    }
    await pipeline(
      Readable.fromWeb(res.body as never),
      fs.createWriteStream(tmp),
    );
    const stat = fs.statSync(tmp);
    if (stat.size === 0) throw new Error(`Zero-byte body from ${url}`);
    const digest = sha256File(tmp);
    if (expectedSha && digest !== expectedSha) {
      throw new Error(
        `SHA-256 mismatch for ${url}: expected ${expectedSha}, got ${digest}`,
      );
    }
    fs.renameSync(tmp, dest);
    fs.writeFileSync(`${dest}.sha256`, `${digest}\n`, "utf8");
    return { size: stat.size, sha256: digest };
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const checkOnly = args.includes("--check");
  const posArg = args.find((a) => !a.startsWith("--"));
  const root = posArg ? path.resolve(posArg) : modelsRootDir(DATA_DIR);

  let missing = 0;
  for (const spec of PINNED_MODELS) {
    const base = modelDir(root, spec.id);
    for (const [rel, url] of Object.entries(spec.files)) {
      const target = path.join(base, rel);
      const expectedSha = readSidecarSha(target);
      if (presentAndValid(target, expectedSha)) {
        const digest = sha256File(target);
        console.log(`[models] ok    ${spec.id}/${rel} (sha256:${digest.slice(0, 12)})`);
        continue;
      }
      if (checkOnly) {
        console.error(`[models] miss  ${spec.id}/${rel}`);
        missing++;
        continue;
      }
      process.stdout.write(`[models] fetch ${spec.id}/${rel} ... `);
      const { size, sha256 } = await download(url, target, expectedSha);
      console.log(`${(size / 1024 / 1024).toFixed(1)} MB (sha256:${sha256.slice(0, 12)})`);
    }
  }
  if (missing > 0) {
    console.error(`[models] ${missing} file(s) missing under ${root}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(
    "[models] failed:",
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
