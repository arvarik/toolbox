import crypto from "node:crypto";
import { Worker } from "node:worker_threads";
import { log } from "../net/errors.ts";
import {
  CANCELLED,
  DEFAULT_PDF_MAX_CHARS,
  DEFAULT_PDF_MAX_PAGES,
  DEFAULT_PDF_TIMEOUT_MS,
  EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_DIM,
  MAX_PDF_UPLOAD_BYTES,
  unflatten,
  type WorkerJob,
  type WorkerReply,
} from "./protocol.ts";

export {
  EMBEDDING_MODEL_ID,
  LOCAL_EMBEDDING_DIM,
  CANCELLED,
  DEFAULT_PDF_MAX_CHARS,
  DEFAULT_PDF_MAX_PAGES,
  DEFAULT_PDF_TIMEOUT_MS,
  MAX_PDF_UPLOAD_BYTES,
};

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
  transfer?: ArrayBuffer[];
  timeoutMs: number;
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
  w.on("message", (reply: WorkerReply) => {
    if (!active || active.job.id !== reply.id) return;
    const done = active;
    active = null;
    done.cleanup?.();
    w.unref();
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
  w.unref();
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
    if (next.job.kind === "embed") {
      modelSpent = true;
    }
    active = next;
    const timeoutMs = next.timeoutMs;
    const timer = setTimeout(() => {
      if (active !== next) return;
      log.warn("cpuHost", `cpuWorker job ${next.job.id} timed out`);
      active = null;
      next.cleanup?.();
      next.reject(
        new Error(`cpuWorker ${next.job.kind} timed out after ${timeoutMs}ms`),
      );
      if (w && !modelSpent) {
        if (w === worker) worker = null;
        void w.terminate().catch(() => {});
      }
      pump();
    }, timeoutMs);
    timer.unref();
    next.cleanup = () => {
      clearTimeout(timer);
      w?.unref();
    };
    w.ref();
    w.postMessage(next.job, next.transfer ?? []);
    return;
  }
}

function submitJob(
  job: WorkerJob,
  opts: {
    transfer?: ArrayBuffer[];
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<WorkerReply> {
  if (opts.signal?.aborted) return Promise.reject(CANCELLED);
  if (unavailableReason) {
    return Promise.reject(new Error(`cpuWorker unavailable: ${unavailableReason}`));
  }
  return new Promise<WorkerReply>((resolve, reject) => {
    const entry: Pending = {
      job,
      transfer: opts.transfer,
      timeoutMs: opts.timeoutMs ?? JOB_TIMEOUT_MS,
      signal: opts.signal,
      resolve,
      reject,
    };
    if (opts.signal) {
      const onAbort = () => {
        const idx = queue.indexOf(entry);
        if (idx === -1) return;
        queue.splice(idx, 1);
        entry.cleanup?.();
        reject(CANCELLED);
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
      entry.cleanup = () => opts.signal?.removeEventListener("abort", onAbort);
    }
    queue.push(entry);
    pump();
  });
}

function submitEmbedJob(
  texts: string[],
  signal?: AbortSignal,
): Promise<WorkerReply> {
  return submitJob(
    { id: nextId++, kind: "embed", texts },
    { timeoutMs: JOB_TIMEOUT_MS, signal },
  );
}

export interface ExtractPdfOptions {
  timeoutMs?: number;
  maxPages?: number;
  maxChars?: number;
  signal?: AbortSignal;
}

export interface ExtractPdfResult {
  text: string;
  totalPages: number;
  extractedPages: number;
  truncated: boolean;
}

export async function extractPdfText(
  bytes: Uint8Array,
  opts: ExtractPdfOptions = {},
): Promise<ExtractPdfResult> {
  opts.signal?.throwIfAborted();
  if (!bytes || bytes.byteLength === 0) {
    throw new Error("PDF file is empty");
  }
  if (bytes.byteLength > MAX_PDF_UPLOAD_BYTES) {
    throw new Error(
      `PDF exceeds maximum size of ${Math.round(MAX_PDF_UPLOAD_BYTES / (1024 * 1024))} MB`,
    );
  }

  // Copy into a standalone ArrayBuffer so transferring ownership to the worker
  // never detaches a caller's Buffer or shared Node slab pool.
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const transferBuf = owned.buffer as ArrayBuffer;

  const reply = await submitJob(
    {
      id: nextId++,
      kind: "extract_pdf",
      bytes: owned,
      maxPages: opts.maxPages ?? DEFAULT_PDF_MAX_PAGES,
      maxChars: opts.maxChars ?? DEFAULT_PDF_MAX_CHARS,
    },
    {
      transfer: [transferBuf],
      timeoutMs: opts.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS,
      signal: opts.signal,
    },
  );

  if (!reply.ok) {
    throw new Error(`PDF extraction failed (${reply.stage}): ${reply.error}`);
  }
  if (reply.kind !== "extract_pdf") {
    throw new Error("Unexpected worker reply kind for extract_pdf");
  }
  return {
    text: reply.text,
    totalPages: reply.totalPages,
    extractedPages: reply.extractedPages,
    truncated: reply.truncated,
  };
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
    if (reply.kind !== "embed") {
      throw new Error("Unexpected worker reply kind for embed");
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
