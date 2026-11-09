/**
 * ToolboxInstance — a disposable production Toolbox server for E2E workers.
 *
 * Spawns `node server/index.ts` with `NODE_ENV=production` serving `dist/`,
 * loopback ephemeral port, isolated `mkdtemp` `DATA_DIR` + `DB_PATH`, blank
 * provider keys so `.env` credentials never leak into tests, and background
 * jobs disabled.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { REPO_ROOT } from "./paths.ts";

const BOOT_TIMEOUT_MS = 45_000;
const STOP_TIMEOUT_MS = 5_000;

/**
 * Workaround when the checkout lives inside a dot-prefixed directory (e.g.
 * `~/.gemini/...` worktrees or `~/.local/...`): `server/app.ts:107` calls
 * `res.sendFile(path.join(distPath, "index.html"))` without `{ root: distPath }`,
 * causing `send` to reject any absolute path containing a `.segment` with 404/500.
 */
async function resolveServerRoot(dataDir: string): Promise<string> {
  const hasDotSegment = REPO_ROOT.split(path.sep).some(
    (seg) => seg.startsWith(".") && seg.length > 1,
  );
  if (!hasDotSegment) return REPO_ROOT;

  const appRoot = path.join(dataDir, "runtime");
  await mkdir(appRoot, { recursive: true });
  await Promise.all([
    cp(path.join(REPO_ROOT, "server"), path.join(appRoot, "server"), {
      recursive: true,
    }),
    cp(path.join(REPO_ROOT, "shared"), path.join(appRoot, "shared"), {
      recursive: true,
    }),
    cp(path.join(REPO_ROOT, "dist"), path.join(appRoot, "dist"), {
      recursive: true,
    }),
    cp(
      path.join(REPO_ROOT, "package.json"),
      path.join(appRoot, "package.json"),
    ),
    symlink(
      path.join(REPO_ROOT, "node_modules"),
      path.join(appRoot, "node_modules"),
      "dir",
    ),
  ]);
  return appRoot;
}

export interface InstanceOptions {
  authRequired?: boolean;
  env?: Record<string, string>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a loopback port"));
        return;
      }
      server.close(() => resolve(address.port));
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class ToolboxInstance {
  readonly baseURL: string;
  readonly dataDir: string;
  readonly dbPath: string;
  #child: ChildProcess;
  #output: string[] = [];
  #exited: Promise<number | null>;

  private constructor(
    baseURL: string,
    dataDir: string,
    dbPath: string,
    child: ChildProcess,
  ) {
    this.baseURL = baseURL;
    this.dataDir = dataDir;
    this.dbPath = dbPath;
    this.#child = child;
    child.stdout?.on("data", (chunk: Buffer) =>
      this.#output.push(chunk.toString()),
    );
    child.stderr?.on("data", (chunk: Buffer) =>
      this.#output.push(chunk.toString()),
    );
    this.#exited = new Promise((resolve) => child.once("exit", resolve));
  }

  static async start(options: InstanceOptions = {}): Promise<ToolboxInstance> {
    const port = await freePort();
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "toolbox-e2e-"));
    const dbPath = path.join(dataDir, "toolbox.db");
    const baseURL = `http://127.0.0.1:${port}`;
    const serverRoot = await resolveServerRoot(dataDir);

    const child = spawn(process.execPath, ["server/index.ts"], {
      cwd: serverRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(port),
        HOST: "127.0.0.1",
        DATA_DIR: dataDir,
        DB_PATH: dbPath,
        AUTH_REQUIRED: options.authRequired ? "true" : "false",
        GEMINI_API_KEY: "",
        OPENAI_API_KEY: "",
        CLAUDE_API_KEY: "",
        ANTHROPIC_API_KEY: "",
        AI_EMBEDDINGS_MODEL: "",
        CORS_ORIGIN: "",
        DISABLE_BACKGROUND_JOBS: "true",
        TRANSFORMERS_CACHE: path.join(dataDir, ".cache"),
        PUBLIC_URL: baseURL,
        ...options.env,
      },
    });

    const instance = new ToolboxInstance(baseURL, dataDir, dbPath, child);
    try {
      await instance.#waitUntilHealthy();
    } catch (error) {
      await instance.stop();
      throw error;
    }
    return instance;
  }

  async #waitUntilHealthy(): Promise<void> {
    const deadline = Date.now() + BOOT_TIMEOUT_MS;
    let exitCode: number | null | undefined;
    void this.#exited.then((code) => {
      exitCode = code;
    });
    while (Date.now() < deadline) {
      if (exitCode !== undefined) {
        throw new Error(
          `Toolbox exited with code ${exitCode} before /api/health answered.\n${this.log()}`,
        );
      }
      try {
        const res = await fetch(`${this.baseURL}/api/health`);
        if (res.ok) return;
      } catch {
        // Server not listening yet.
      }
      await sleep(100);
    }
    throw new Error(
      `Toolbox did not answer /api/health within ${BOOT_TIMEOUT_MS}ms.\n${this.log()}`,
    );
  }

  log(): string {
    return this.#output.join("");
  }

  mark(): number {
    return this.#output.length;
  }

  logSince(mark: number): string {
    return this.#output.slice(mark).join("");
  }

  async api<T = unknown>(
    method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
    route: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<T> {
    const reqHeaders: Record<string, string> = { ...headers };
    if (body !== undefined) {
      reqHeaders["Content-Type"] = "application/json";
    }
    const res = await fetch(`${this.baseURL}/api${route}`, {
      method,
      headers: reqHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      throw new Error(
        `${method} /api${route} -> ${res.status}: ${await res.text()}`,
      );
    }
    return (await res.json()) as T;
  }

  async stop(): Promise<void> {
    if (this.#child.exitCode === null && !this.#child.killed) {
      this.#child.kill("SIGTERM");
      const timeout = sleep(STOP_TIMEOUT_MS).then(() => "timeout" as const);
      if ((await Promise.race([this.#exited, timeout])) === "timeout") {
        this.#child.kill("SIGKILL");
        await this.#exited;
      }
    }
    await rm(this.dataDir, { recursive: true, force: true });
  }
}
