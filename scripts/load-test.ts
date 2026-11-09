/**
 * Production load and soak test: `npm run build && npm run test:load`.
 *
 * Boots `server/index.ts` the way production runs it (NODE_ENV=production,
 * built `dist/`) on an ephemeral loopback port with a throwaway DATA_DIR,
 * seeds Kits, decks, cards, guide notes, and boards through the public API,
 * then drives concurrent hot read and write traffic for a fixed duration and
 * takes one online backup mid-run.
 *
 * Exits 1 on any non-2xx or network error, any p95 above its budget, server
 * RSS growth after warmup above MAX_RSS_GROWTH_MB (a leak signal), or a server
 * that does not drain and exit 0 on SIGTERM.
 *
 * Longer local soak: LOAD_DURATION_S=600 LOAD_CONCURRENCY=32 npm run test:load
 */
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { buildEuclideanGeometryKit } from "../tests/e2e/fixtures/kits.ts";

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DURATION_MS = envInt("LOAD_DURATION_S", 30) * 1000;
const WARMUP_MS = envInt("LOAD_WARMUP_S", 10) * 1000;
const CONCURRENCY = envInt("LOAD_CONCURRENCY", 8);
const KITS = 6;
const CARDS_PER_KIT = 120;
const MAX_RSS_GROWTH_MB = 64;
const REQUEST_TIMEOUT_MS = 15_000;

// p95 budgets in ms: about 5x the p95 measured with 8 virtual users on 2026-11-09
// (M-series laptop, about 815 req/s), which leaves room for slower CI runners.
const BUDGETS: Record<string, number> = {
  "GET /api/kits": 100,
  "GET /api/kits/:slug": 100,
  "GET /api/decks": 100,
  "GET /api/decks/:id": 100,
  "GET /api/decks/all/cards/due": 100,
  "GET /api/search": 125,
  "GET /api/graph/health": 100,
  "GET /api/guide-content/:p/:t": 100,
  "GET / (SPA)": 250,
  "GET /assets/index-*.js": 500,
  "POST review": 100,
  "PUT guide note": 100,
  "PUT board": 100,
  "POST+DELETE card": 175,
};

interface KitTarget {
  slug: string;
  deckId: string;
  cardIds: string[];
  boardId: string;
  sections: Array<[string, string, string]>;
}

interface Op {
  name: string;
  weight: number;
  run: (kit: KitTarget) => Promise<Response>;
}

const WORDS = ["quorum", "consensus", "replica", "partition", "lease", "fencing", "gossip", "snapshot"];
const pick = <T>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)];

const failures: string[] = [];
const logTail: string[] = [];
let ipCounter = 0;

function nextClientIp(): string {
  ipCounter = (ipCounter + 1) % 16_777_216;
  return `10.${ipCounter >> 16}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address() as net.AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

function rssMb(pid: number): number {
  return Number(execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim()) / 1024;
}

function percentile(sorted: number[], p: number): number {
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] : 0;
}

const indexHtml = path.join(ROOT, "dist", "index.html");
const assetPath = fs.existsSync(indexHtml)
  ? fs.readFileSync(indexHtml, "utf8").match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1]
  : undefined;
if (!assetPath) {
  console.error(`No built entry script in ${indexHtml}. Run \`npm run build\` before \`npm run test:load\`.`);
  process.exit(1);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "toolbox-load-"));
const server = spawn(process.execPath, ["server/index.ts"], {
  cwd: ROOT,
  stdio: ["ignore", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOST: "127.0.0.1",
    PORT: String(port),
    DATA_DIR: dataDir,
    DB_PATH: path.join(dataDir, "toolbox.db"),
    PUBLIC_URL: base,
    AUTH_REQUIRED: "false",
    // Mock embeddings and no background AI jobs: the run measures Toolbox, not a provider.
    DISABLE_BACKGROUND_JOBS: "true",
    // Each request sends its own X-Forwarded-For, like many clients behind one proxy,
    // so the per-IP API limit (1,200/min) does not cap the load.
    TRUST_PROXY_HOPS: "1",
    GEMINI_API_KEY: "",
    OPENAI_API_KEY: "",
    CLAUDE_API_KEY: "",
    ANTHROPIC_API_KEY: "",
  },
});
const exited = new Promise<number | null>((resolve) => server.once("exit", resolve));
for (const stream of [server.stdout, server.stderr]) {
  stream.on("data", (chunk: Buffer) => {
    logTail.push(...chunk.toString().split("\n").filter(Boolean));
    logTail.splice(0, Math.max(0, logTail.length - 60));
  });
}

async function stopServer(): Promise<void> {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
    const code = await Promise.race([
      exited,
      new Promise<"timeout">((r) => setTimeout(r, 15_000, "timeout")),
    ]);
    if (code !== 0) {
      failures.push(`Server did not drain and exit 0 on SIGTERM (got ${code}).`);
      server.kill("SIGKILL");
      await exited;
    }
  } else {
    failures.push(`Server exited on its own (code ${server.exitCode}, signal ${server.signalCode}).`);
  }
  fs.rmSync(dataDir, { recursive: true, force: true });
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.kill("SIGKILL");
    fs.rmSync(dataDir, { recursive: true, force: true });
    process.exit(130);
  });
}

async function call(
  method: string,
  route: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${base}${route}`, {
    method,
    headers: {
      "X-Forwarded-For": nextClientIp(),
      "Accept-Encoding": "gzip",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

async function api<T>(method: string, route: string, body?: unknown, kit?: string): Promise<T> {
  const res = await call(method, `/api${route}`, body, kit ? { "X-Toolbox-Kit": kit } : {});
  if (!res.ok) throw new Error(`${method} /api${route} -> ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

async function waitForHealth(): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Server exited with code ${server.exitCode} during boot.`);
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Server did not answer /api/health within 45s.");
}

async function seed(): Promise<KitTarget[]> {
  await api("POST", "/shared-kits/system-design/fork", {});
  for (let i = 0; i < KITS; i++) {
    await api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit({ slug: `load-kit-${i}`, name: `Load Kit ${i}` }),
    });
  }
  const { kits } = await api<{ kits: Array<{ slug: string }> }>("GET", "/kits");
  const targets: KitTarget[] = [];
  for (const { slug } of kits) {
    const { kit } = await api<{
      kit: { skeleton: { pillars: Array<{ id: string; topics: Array<{ id: string }>; sections: Array<{ id: string }> }> } };
    }>("GET", `/kits/${slug}`);
    const decks = await api<Array<{ id: string }>>("GET", "/decks", undefined, slug);
    const deckId =
      decks[0]?.id ?? (await api<{ id: string }>("POST", "/decks", { name: `${slug} deck` }, slug)).id;
    const cardIds: string[] = [];
    for (let batch = 0; batch < CARDS_PER_KIT; batch += 10) {
      const created = await Promise.all(
        Array.from({ length: 10 }, (_, j) =>
          api<{ id: string }>(
            "POST",
            `/decks/${deckId}/cards`,
            {
              front: `${slug} card ${batch + j}: what does ${pick(WORDS)} guarantee under ${pick(WORDS)}?`,
              back: `It preserves the ${pick(WORDS)} invariant across ${pick(WORDS)} failures. `.repeat(3),
            },
            slug,
          ),
        ),
      );
      cardIds.push(...created.map((c) => c.id));
    }
    const board = await api<{ id: string }>("POST", "/boards", { name: "Load board", data: boardData() }, slug);
    const sections = kit.skeleton.pillars.flatMap((p) =>
      p.topics.flatMap((t) => p.sections.map((s) => [p.id, t.id, s.id] as [string, string, string])),
    );
    for (const [p, t, s] of sections.slice(0, 12)) {
      await api("PUT", `/guide-content/${p}/${t}/${s}`, { content: noteText() }, slug);
    }
    targets.push({ slug, deckId, cardIds, boardId: board.id, sections });
  }
  return targets;
}

function boardData(): unknown {
  const nodes = Array.from({ length: 24 }, (_, i) => ({
    id: `n${i}`,
    x: (i % 6) * 180,
    y: Math.floor(i / 6) * 120,
    label: `${pick(WORDS)} ${i}`,
  }));
  return { nodes, edges: nodes.slice(1).map((n, i) => ({ from: `n${i}`, to: n.id })) };
}

function noteText(): string {
  return `## ${pick(WORDS)}\n\n${`The ${pick(WORDS)} keeps ${pick(WORDS)} safe when a ${pick(WORDS)} fails. `.repeat(12)}`;
}

const inKit = (k: KitTarget) => ({ "X-Toolbox-Kit": k.slug });

const OPS: Op[] = [
  { name: "GET /api/kits", weight: 8, run: () => call("GET", "/api/kits") },
  { name: "GET /api/kits/:slug", weight: 6, run: (k) => call("GET", `/api/kits/${k.slug}`) },
  { name: "GET /api/decks", weight: 8, run: (k) => call("GET", "/api/decks", undefined, inKit(k)) },
  { name: "GET /api/decks/:id", weight: 6, run: (k) => call("GET", `/api/decks/${k.deckId}`) },
  { name: "GET /api/decks/all/cards/due", weight: 8, run: () => call("GET", "/api/decks/all/cards/due") },
  { name: "GET /api/search", weight: 8, run: () => call("GET", `/api/search?q=${pick(WORDS)}`) },
  { name: "GET /api/graph/health", weight: 6, run: (k) => call("GET", "/api/graph/health", undefined, inKit(k)) },
  {
    name: "GET /api/guide-content/:p/:t",
    weight: 6,
    run: (k) => call("GET", `/api/guide-content/${k.sections[0][0]}/${k.sections[0][1]}`, undefined, inKit(k)),
  },
  { name: "GET / (SPA)", weight: 2, run: () => call("GET", "/") },
  { name: "GET /assets/index-*.js", weight: 1, run: () => call("GET", assetPath) },
  {
    name: "POST review",
    weight: 12,
    run: (k) =>
      call(
        "POST",
        `/api/decks/${k.deckId}/cards/${pick(k.cardIds)}/review`,
        { quality: 1 + Math.floor(Math.random() * 5), confidence: "high" },
        inKit(k),
      ),
  },
  {
    name: "PUT guide note",
    weight: 6,
    run: (k) => {
      const [p, t, s] = pick(k.sections.slice(0, 12));
      return call("PUT", `/api/guide-content/${p}/${t}/${s}`, { content: noteText() }, inKit(k));
    },
  },
  { name: "PUT board", weight: 6, run: (k) => call("PUT", `/api/boards/${k.boardId}`, { data: boardData() }) },
  {
    // Create then delete, so a long soak keeps the database size (and page cache) steady.
    name: "POST+DELETE card",
    weight: 3,
    run: async (k) => {
      const body = { front: `New ${pick(WORDS)} card?`, back: `Because ${pick(WORDS)}.` };
      const created = await call("POST", `/api/decks/${k.deckId}/cards`, body, inKit(k));
      if (!created.ok) return created;
      const { id } = (await created.json()) as { id: string };
      return call("DELETE", `/api/decks/${k.deckId}/cards/${id}`);
    },
  },
];
const totalWeight = OPS.reduce((sum, op) => sum + op.weight, 0);

function pickOp(): Op {
  let roll = Math.random() * totalWeight;
  for (const op of OPS) {
    roll -= op.weight;
    if (roll < 0) return op;
  }
  return OPS[OPS.length - 1];
}

const samples = new Map<string, number[]>(OPS.map((op) => [op.name, []]));
const errors = new Map<string, number>();
const errorSamples: string[] = [];

function recordError(name: string, detail: string): void {
  errors.set(name, (errors.get(name) ?? 0) + 1);
  if (errorSamples.length < 10) errorSamples.push(`${name}: ${detail}`);
}

async function virtualUser(targets: KitTarget[], measureFrom: number, stopAt: number): Promise<void> {
  while (performance.now() < stopAt && server.exitCode === null) {
    const op = pickOp();
    const kit = pick(targets);
    const started = performance.now();
    try {
      const res = await op.run(kit);
      const text = await res.text();
      if (!res.ok) recordError(op.name, `HTTP ${res.status} ${text.slice(0, 200)}`);
    } catch (err) {
      recordError(op.name, err instanceof Error ? err.message : String(err));
      continue;
    }
    if (started >= measureFrom) samples.get(op.name)!.push(performance.now() - started);
  }
}

let exitCode = 0;
try {
  await waitForHealth();
  const seedStarted = performance.now();
  const targets = await seed();
  console.log(
    `Seeded ${targets.length} Kits and ${targets.reduce((n, k) => n + k.cardIds.length, 0)} cards in ${Math.round(performance.now() - seedStarted)}ms; ` +
      `running ${CONCURRENCY} virtual users for ${WARMUP_MS / 1000}s warmup + ${DURATION_MS / 1000}s.`,
  );

  const start = performance.now();
  const measureFrom = start + WARMUP_MS;
  const stopAt = measureFrom + DURATION_MS;
  const rss: number[] = [];
  let baselineRss = 0;
  const sampler = setInterval(() => {
    try {
      const value = rssMb(server.pid!);
      if (!baselineRss && performance.now() >= measureFrom) baselineRss = value;
      if (baselineRss) rss.push(value);
    } catch {
      // The server exited; request errors report it.
    }
  }, 1000);

  let backupMs = 0;
  const backup = new Promise<void>((resolve) =>
    setTimeout(async () => {
      const t0 = performance.now();
      try {
        const { backup: info } = await api<{ backup: { verification: { ok: boolean; problem?: string } } }>(
          "POST",
          "/admin/backups",
        );
        if (!info.verification.ok) failures.push(`Mid-run backup failed verification: ${info.verification.problem}`);
      } catch (err) {
        failures.push(`Mid-run backup failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      backupMs = performance.now() - t0;
      resolve();
    }, WARMUP_MS + DURATION_MS / 2),
  );

  await Promise.all([
    ...Array.from({ length: CONCURRENCY }, () => virtualUser(targets, measureFrom, stopAt)),
    backup,
  ]);
  clearInterval(sampler);
  const elapsedS = (performance.now() - measureFrom) / 1000;

  const rows = OPS.map((op) => {
    const sorted = samples.get(op.name)!.sort((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    const budget = BUDGETS[op.name];
    const errCount = errors.get(op.name) ?? 0;
    if (errCount) failures.push(`${op.name}: ${errCount} failed request(s).`);
    if (budget !== undefined && p95 > budget) failures.push(`${op.name}: p95 ${p95.toFixed(1)}ms exceeds the ${budget}ms budget.`);
    return {
      endpoint: op.name,
      count: sorted.length,
      errors: errCount,
      "p50 ms": Number(percentile(sorted, 0.5).toFixed(1)),
      "p95 ms": Number(p95.toFixed(1)),
      "p99 ms": Number(percentile(sorted, 0.99).toFixed(1)),
      "max ms": Number((sorted.at(-1) ?? 0).toFixed(1)),
      "budget ms": budget ?? "-",
    };
  });
  console.table(rows);

  const total = rows.reduce((n, r) => n + r.count, 0);
  const finalRss = rss.at(-1) ?? baselineRss;
  const growth = finalRss - baselineRss;
  console.log(
    `${total} measured requests in ${elapsedS.toFixed(1)}s (${Math.round(total / elapsedS)} req/s). ` +
      `Online backup during writes: ${Math.round(backupMs)}ms.`,
  );
  console.log(
    `Server RSS: ${baselineRss.toFixed(1)}MB after warmup, ${finalRss.toFixed(1)}MB at end, ` +
      `peak ${Math.max(baselineRss, ...rss).toFixed(1)}MB, growth ${growth.toFixed(1)}MB (bound ${MAX_RSS_GROWTH_MB}MB).`,
  );
  if (!rss.length) failures.push("No RSS samples: `ps -o rss= -p <pid>` failed, so the leak check did not run.");
  if (growth > MAX_RSS_GROWTH_MB) failures.push(`Server RSS grew ${growth.toFixed(1)}MB after warmup (bound ${MAX_RSS_GROWTH_MB}MB).`);
  if (errorSamples.length) console.log(`First errors:\n  ${errorSamples.join("\n  ")}`);
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
} finally {
  await stopServer();
  if (failures.length) {
    console.error(`\nLoad test FAILED:\n  ${failures.join("\n  ")}\n\nServer log tail:\n${logTail.join("\n")}`);
    exitCode = 1;
  } else {
    console.log("Load test passed.");
  }
}
process.exit(exitCode);
