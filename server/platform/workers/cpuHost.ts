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

export function shouldUseMockEmbedder(): boolean {
  const disableBg = process.env.DISABLE_BACKGROUND_JOBS?.trim().toLowerCase();
  return (
    process.env.NODE_ENV === "test" ||
    process.env.TOOLBOX_EMBEDDINGS_MOCK === "1" ||
    disableBg === "true" ||
    disableBg === "1"
  );
}

interface Pending {
  job: WorkerJob;
  transfer?: ArrayBuffer[];
  timeoutMs: number;
  signal?: AbortSignal;
  aborted?: boolean;
  resolve: (reply: WorkerReply) => void;
  reject: (err: unknown) => void;
  cleanupTimeout?: () => void;
  cleanupAbort?: () => void;
}

interface WorkerSlot {
  name: "pdf" | "embed";
  disposable: boolean;
  worker: Worker | null;
  modelSpent: boolean;
  unavailableReason: string | null;
  active: Pending | null;
  queue: Pending[];
}

function createSlot(name: "pdf" | "embed", disposable: boolean): WorkerSlot {
  return {
    name,
    disposable,
    worker: null,
    modelSpent: false,
    unavailableReason: null,
    active: null,
    queue: [],
  };
}

// Isolated worker slots:
// - `pdfSlot` runs disposable PDF extraction workers that never load ONNX and
//   are ALWAYS terminated on timeout or caller abort.
// - `embedSlot` hosts the single persistent ONNX Runtime worker (`modelSpent`),
//   which must never be terminated and respawned in-process after initialization.
const pdfSlot = createSlot("pdf", true);
const embedSlot = createSlot("embed", false);
let nextId = 1;

function terminateSlotWorker(slot: WorkerSlot, w: Worker): void {
  if (slot.worker === w) {
    slot.worker = null;
  }
  void w.terminate().catch(() => {});
}

function spawnSlotWorker(slot: WorkerSlot): Worker {
  const w = new Worker(new URL("./cpuWorker.ts", import.meta.url));
  w.on("message", (reply: WorkerReply) => {
    if (w !== slot.worker || !slot.active || slot.active.job.id !== reply.id) {
      return;
    }
    const done = slot.active;
    slot.active = null;
    done.cleanupTimeout?.();
    done.cleanupAbort?.();
    w.unref();
    if (!done.aborted) {
      done.resolve(reply);
    }
    pumpSlot(slot);
  });
  w.on("error", (err) => {
    failSlotWorker(slot, w, err instanceof Error ? err : new Error(String(err)));
  });
  w.on("exit", (code) => {
    if (w !== slot.worker) return;
    failSlotWorker(slot, w, new Error(`${slot.name} cpuWorker exited (code ${code})`));
  });
  w.unref();
  return w;
}

function failSlotWorker(slot: WorkerSlot, dead: Worker, err: Error): void {
  if (dead !== slot.worker) return;
  slot.worker = null;
  if (!slot.disposable && slot.modelSpent) {
    slot.unavailableReason = err.message;
    log.warn(
      "cpuHost",
      `Local ONNX worker exited after initialization (${err.message}); falling back without respawning onnxruntime-node.`,
    );
  }
  if (slot.active) {
    const failed = slot.active;
    slot.active = null;
    failed.cleanupTimeout?.();
    failed.cleanupAbort?.();
    if (!failed.aborted) {
      failed.reject(err);
    }
  }
  pumpSlot(slot);
}

function pumpSlot(slot: WorkerSlot): void {
  if (slot.active) return;
  while (slot.queue.length > 0) {
    const next = slot.queue.shift()!;
    if (next.signal?.aborted) {
      next.cleanupAbort?.();
      next.reject(CANCELLED);
      continue;
    }
    if (slot.unavailableReason) {
      next.cleanupAbort?.();
      next.reject(new Error(`cpuWorker unavailable: ${slot.unavailableReason}`));
      continue;
    }
    let w = slot.worker;
    if (!w) {
      try {
        w = spawnSlotWorker(slot);
        slot.worker = w;
      } catch (err) {
        if (!slot.disposable) {
          slot.unavailableReason = err instanceof Error ? err.message : String(err);
        }
        next.cleanupAbort?.();
        next.reject(err);
        continue;
      }
    }
    if (!slot.disposable && next.job.kind === "embed") {
      slot.modelSpent = true;
    }
    slot.active = next;
    const timeoutMs = next.timeoutMs;
    const activeWorker = w;
    const timer = setTimeout(() => {
      if (slot.active !== next) return;
      log.warn("cpuHost", `${slot.name} cpuWorker job ${next.job.id} timed out`);
      slot.active = null;
      next.cleanupAbort?.();
      activeWorker.unref();
      if (!next.aborted) {
        next.reject(
          new Error(`cpuWorker ${next.job.kind} timed out after ${timeoutMs}ms`),
        );
      }
      if (slot.disposable || !slot.modelSpent) {
        terminateSlotWorker(slot, activeWorker);
      }
      pumpSlot(slot);
    }, timeoutMs);
    timer.unref();
    next.cleanupTimeout = () => {
      clearTimeout(timer);
      activeWorker.unref();
    };
    activeWorker.ref();
    activeWorker.postMessage(next.job, next.transfer ?? []);
    return;
  }
}

function submitToSlot(
  slot: WorkerSlot,
  job: WorkerJob,
  opts: {
    transfer?: ArrayBuffer[];
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<WorkerReply> {
  if (opts.signal?.aborted) return Promise.reject(CANCELLED);
  if (slot.unavailableReason) {
    return Promise.reject(new Error(`cpuWorker unavailable: ${slot.unavailableReason}`));
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
        const idx = slot.queue.indexOf(entry);
        if (idx !== -1) {
          slot.queue.splice(idx, 1);
          entry.cleanupTimeout?.();
          reject(CANCELLED);
          return;
        }
        if (slot.active !== entry || entry.aborted) return;
        entry.aborted = true;
        entry.cleanupTimeout?.();
        reject(CANCELLED);
        if (slot.disposable || !slot.modelSpent) {
          const w = slot.worker;
          slot.active = null;
          if (w) terminateSlotWorker(slot, w);
          pumpSlot(slot);
        }
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
      entry.cleanupAbort = () => opts.signal?.removeEventListener("abort", onAbort);
    }
    slot.queue.push(entry);
    pumpSlot(slot);
  });
}

function submitEmbedJob(
  texts: string[],
  signal?: AbortSignal,
): Promise<WorkerReply> {
  return submitToSlot(
    embedSlot,
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

  const timeoutMs = opts.timeoutMs ?? DEFAULT_PDF_TIMEOUT_MS;
  const pdfJob: WorkerJob & { timeoutMs?: number } = {
    id: nextId++,
    kind: "extract_pdf",
    bytes: owned,
    maxPages: opts.maxPages ?? DEFAULT_PDF_MAX_PAGES,
    maxChars: opts.maxChars ?? DEFAULT_PDF_MAX_CHARS,
    timeoutMs,
  };
  const reply = await submitToSlot(pdfSlot, pdfJob, {
    transfer: [transferBuf],
    timeoutMs,
    signal: opts.signal,
  });

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
    // ponytail: fallback to deterministic 384-dim hash projection when offline without prefetched ONNX weights; run `node scripts/fetch-models.ts` to pre-stage real MiniLM weights.
    return deterministicHashEmbed(texts, dim);
  }
}
