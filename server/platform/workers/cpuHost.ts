import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { log } from "../net/errors.ts";
import {
  CANCELLED,
  EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_DIM,
  unflatten,
  type WorkerJob,
  type WorkerReply,
} from "./protocol.ts";

export { EMBEDDING_MODEL_ID, LOCAL_EMBEDDING_DIM, CANCELLED };

const JOB_TIMEOUT_MS = 120_000;

type CustomLocalEmbedder = (
  texts: string[],
  dim: number,
) => Float32Array[] | Promise<Float32Array[]>;

let testEmbedderOverride: CustomLocalEmbedder | null = null;

export function setTestLocalEmbedder(fn: CustomLocalEmbedder | null): void {
  testEmbedderOverride = fn;
}

/**
 * Deterministic L2-normalized feature-hashing embedder used in test/offline-mock
 * environments so Vitest runs fast and offline without downloading ONNX weights.
 */
export function deterministicHashEmbed(
  texts: string[],
  dim: number = LOCAL_EMBEDDING_DIM,
): Float32Array[] {
  return texts.map((raw) => {
    const vec = new Float32Array(dim);
    const words = raw.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
    const features: Array<{ key: string; weight: number }> = [];
    for (const w of words) {
      features.push({ key: `w:${w}`, weight: 2.0 });
      if (w.length >= 4) {
        features.push({ key: `p:${w.slice(0, 4)}`, weight: 1.0 });
      }
      for (let i = 0; i + 3 <= w.length; i++) {
        features.push({ key: `g:${w.slice(i, i + 3)}`, weight: 0.5 });
      }
    }
    if (features.length === 0) {
      features.push({ key: `raw:${raw.slice(0, 64)}`, weight: 1.0 });
    }
    for (const f of features) {
      const digest = crypto.createHash("sha256").update(f.key).digest();
      for (let h = 0; h < 4; h++) {
        const idx = digest.readUInt16BE(h * 2) % dim;
        const sign = (digest[8 + h] & 1) === 0 ? 1 : -1;
        vec[idx] += sign * f.weight;
      }
    }
    let normSq = 0;
    for (let i = 0; i < dim; i++) normSq += vec[i] * vec[i];
    const norm = Math.sqrt(normSq) || 1;
    for (let i = 0; i < dim; i++) vec[i] /= norm;
    return vec;
  });
}

function shouldUseMockEmbedder(): boolean {
  return (
    process.env.NODE_ENV === "test" ||
    process.env.TOOLBOX_EMBEDDINGS_MOCK === "1"
  );
}

interface Pending {
  job: WorkerJob;
  signal?: AbortSignal;
  resolve: (reply: WorkerReply) => void;
  reject: (err: unknown) => void;
  cleanup?: () => void;
}

// Single persistent worker per process. Once `onnxruntime-node` has initialized
// inside a worker thread (`modelSpent = true`), NEVER terminate & respawn it in
// the same process — native ONNX Runtime global state is not multi-init safe.
let worker: Worker | null = null;
let modelSpent = false;
let unavailableReason: string | null = null;
let active: Pending | null = null;
const queue: Pending[] = [];
let nextId = 1;

function spawnPersistentWorker(): Worker {
  const w = new Worker(new URL("./cpuWorker.ts", import.meta.url));
  w.unref();
  w.on("message", (reply: WorkerReply) => {
    if (!active || active.job.id !== reply.id) return;
    const done = active;
    active = null;
    done.cleanup?.();
    done.resolve(reply);
    pump();
  });
  w.on("error", (err) =>
    failWorker(w, err instanceof Error ? err : new Error(String(err))),
  );
  w.on("exit", (code) => {
    if (w !== worker) return;
    failWorker(w, new Error(`cpuWorker exited (code ${code})`));
  });
  return w;
}

function failWorker(dead: Worker, err: Error): void {
  if (dead === worker) worker = null;
  if (modelSpent) {
    unavailableReason = err.message;
    log.warn(
      "cpuHost",
      `Local ONNX worker exited after initialization (${err.message}); falling back without respawning onnxruntime-node.`,
    );
  }
  if (active) {
    const failed = active;
    active = null;
    failed.cleanup?.();
    failed.reject(err);
  }
  pump();
}

function pump(): void {
  if (active) return;
  while (queue.length > 0) {
    const next = queue.shift()!;
    next.cleanup?.();
    if (next.signal?.aborted) {
      next.reject(CANCELLED);
      continue;
    }
    if (unavailableReason) {
      next.reject(new Error(`cpuWorker unavailable: ${unavailableReason}`));
      continue;
    }
    let w = worker;
    if (!w) {
      try {
        w = spawnPersistentWorker();
        worker = w;
      } catch (err) {
        unavailableReason = err instanceof Error ? err.message : String(err);
        next.reject(err);
        continue;
      }
    }
    modelSpent = true;
    active = next;
    const timer = setTimeout(() => {
      if (active !== next) return;
      log.warn("cpuHost", `cpuWorker job ${next.job.id} timed out`);
      active = null;
      next.cleanup?.();
      next.reject(
        new Error(`cpuWorker ${next.job.kind} timed out after ${JOB_TIMEOUT_MS}ms`),
      );
      pump();
    }, JOB_TIMEOUT_MS);
    timer.unref();
    next.cleanup = () => clearTimeout(timer);
    w.postMessage(next.job);
    return;
  }
}

function submitEmbedJob(
  texts: string[],
  signal?: AbortSignal,
): Promise<WorkerReply> {
  if (signal?.aborted) return Promise.reject(CANCELLED);
  if (unavailableReason) {
    return Promise.reject(new Error(`cpuWorker unavailable: ${unavailableReason}`));
  }
  return new Promise<WorkerReply>((resolve, reject) => {
    const entry: Pending = {
      job: { id: nextId++, kind: "embed", texts },
      signal,
      resolve,
      reject,
    };
    if (signal) {
      const onAbort = () => {
        const idx = queue.indexOf(entry);
        if (idx === -1) return;
        queue.splice(idx, 1);
        entry.cleanup?.();
        reject(CANCELLED);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      entry.cleanup = () => signal.removeEventListener("abort", onAbort);
    }
    queue.push(entry);
    pump();
  });
}

export async function embedTextsLocal(
  texts: string[],
  opts: { signal?: AbortSignal; dim?: number } = {},
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];
  opts.signal?.throwIfAborted();
  const dim = opts.dim ?? LOCAL_EMBEDDING_DIM;

  if (testEmbedderOverride) {
    return await testEmbedderOverride(texts, dim);
  }
  if (shouldUseMockEmbedder()) {
    return deterministicHashEmbed(texts, dim);
  }

  try {
    const reply = await submitEmbedJob(texts, opts.signal);
    if (!reply.ok) {
      throw new Error(`Embed (${reply.stage}): ${reply.error}`);
    }
    return unflatten(reply.flat, reply.count, reply.dims);
  } catch (err) {
    if (err === CANCELLED) throw err;
    log.warn(
      "cpuHost",
      `Local ONNX embedder unavailable (${err instanceof Error ? err.message : String(err)}); using deterministic hash fallback.`,
    );
    // ponytail: fallback to deterministic 384-dim hash projection when offline without prefetched ONNX weights; run `npm run fetch-models` to pre-stage real MiniLM weights.
    return deterministicHashEmbed(texts, dim);
  }
}

export function getLocalWorkerStatus(): {
  mode: "worker" | "mock" | "fallback";
  unavailableReason: string | null;
} {
  if (testEmbedderOverride || shouldUseMockEmbedder()) {
    return { mode: "mock", unavailableReason: null };
  }
  if (unavailableReason) {
    return { mode: "fallback", unavailableReason };
  }
  return { mode: "worker", unavailableReason: null };
}
