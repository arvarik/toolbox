import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { DATA_DIR } from "../../appConfig.ts";
import {
  DEFAULT_PDF_TIMEOUT_MS,
  EMBEDDING_MODEL_ID,
  hasLocalModelBundle,
  modelsRootDir,
  type WorkerJob,
  type WorkerReply,
} from "./protocol.ts";

if (!parentPort) {
  throw new Error("cpuWorker must run inside node:worker_threads");
}
const port = parentPort;

type Embedder = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

let embedderPromise: Promise<Embedder> | null = null;

async function getEmbedder(): Promise<Embedder> {
  if (!embedderPromise) {
    embedderPromise = (async () => {
      const root = modelsRootDir(DATA_DIR);
      fs.mkdirSync(root, { recursive: true });
      const localOnly = hasLocalModelBundle(root);
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = root;
      env.localModelPath = root;
      env.allowLocalModels = true;
      env.allowRemoteModels =
        !localOnly && process.env.TRANSFORMERS_OFFLINE !== "1";
      const pipe = await pipeline("feature-extraction", EMBEDDING_MODEL_ID, {
        dtype: "q8",
        local_files_only: localOnly,
      });
      return pipe as unknown as Embedder;
    })().catch((err: unknown) => {
      embedderPromise = null;
      throw err;
    });
  }
  return embedderPromise;
}

function post(reply: WorkerReply, transfer?: ArrayBuffer[]): void {
  port.postMessage(reply, transfer ?? []);
}

async function runEmbed(id: number, texts: string[]): Promise<void> {
  if (texts.length === 0) {
    post({
      id,
      ok: true,
      kind: "embed",
      flat: new Float32Array(0),
      count: 0,
      dims: 0,
    });
    return;
  }
  let embedder: Embedder;
  try {
    embedder = await getEmbedder();
  } catch (err) {
    post({
      id,
      ok: false,
      stage: "load",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  try {
    const tensor = await embedder(texts, { pooling: "mean", normalize: true });
    const dims = tensor.dims[tensor.dims.length - 1];
    const flat =
      tensor.data.byteOffset === 0 &&
      tensor.data.byteLength === tensor.data.buffer.byteLength
        ? tensor.data
        : tensor.data.slice();
    post(
      { id, ok: true, kind: "embed", flat, count: texts.length, dims },
      [flat.buffer as ArrayBuffer],
    );
  } catch (err) {
    post({
      id,
      ok: false,
      stage: "run",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runExtractPdf(
  id: number,
  bytes: Uint8Array,
  maxPages: number,
  maxChars: number,
  timeoutMs: number = DEFAULT_PDF_TIMEOUT_MS,
): Promise<void> {
  if (!bytes || bytes.byteLength === 0) {
    post({ id, ok: false, stage: "run", error: "PDF buffer is empty" });
    return;
  }

  const effectiveTimeoutMs =
    typeof timeoutMs === "number" && Number.isFinite(timeoutMs) && timeoutMs > 0
      ? timeoutMs
      : DEFAULT_PDF_TIMEOUT_MS;
  const deadline = Date.now() + effectiveTimeoutMs;

  let getDocumentProxy: typeof import("unpdf").getDocumentProxy;
  try {
    ({ getDocumentProxy } = await import("unpdf"));
  } catch (err) {
    post({
      id,
      ok: false,
      stage: "load",
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  try {
    const hardenOpts = {
      isEvalSupported: false,
      enableScripting: false,
      verbosity: 0,
    } as Parameters<typeof getDocumentProxy>[1];

    const doc = await getDocumentProxy(bytes, hardenOpts);
    try {
      const totalPages = doc.numPages;
      const pageLimit = Math.min(totalPages, Math.max(1, maxPages));
      const charCap = Math.max(1, maxChars);
      const pageTexts: string[] = [];
      let accumulatedChars = 0;
      let extractedPages = 0;
      let hitCharCap = false;

      for (let pageNo = 1; pageNo <= pageLimit; pageNo++) {
        if (Date.now() >= deadline) {
          throw new Error(
            `PDF extraction exceeded per-page deadline (${effectiveTimeoutMs}ms)`,
          );
        }
        const page = await doc.getPage(pageNo);
        try {
          const content = await page.getTextContent();
          const pageStr = content.items
            .map((item) =>
              "str" in item && typeof item.str === "string"
                ? item.str + (item.hasEOL ? "\n" : " ")
                : "",
            )
            .join("")
            .replace(/[^\S\n]+/g, " ")
            .replace(/ ?\n ?/g, "\n")
            .trim();
          extractedPages++;
          if (pageStr) {
            pageTexts.push(pageStr);
            accumulatedChars += pageStr.length + 2;
            if (accumulatedChars >= charCap) {
              hitCharCap = true;
              break;
            }
          }
        } finally {
          page.cleanup();
        }
      }

      const merged = pageTexts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      const truncated =
        totalPages > pageLimit || hitCharCap || merged.length > charCap;
      const finalText =
        merged.length > charCap ? merged.slice(0, charCap) : merged;

      post({
        id,
        ok: true,
        kind: "extract_pdf",
        text: finalText,
        totalPages,
        extractedPages,
        truncated,
      });
    } finally {
      await doc.loadingTask.destroy().catch(() => {});
    }
  } catch (err) {
    post({
      id,
      ok: false,
      stage: "run",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

let chain: Promise<void> = Promise.resolve();
port.on("message", (job: WorkerJob & { timeoutMs?: number }) => {
  chain = chain.then(() => {
    if (job.kind === "embed") return runEmbed(job.id, job.texts);
    if (job.kind === "extract_pdf") {
      return runExtractPdf(
        job.id,
        job.bytes,
        job.maxPages,
        job.maxChars,
        job.timeoutMs,
      );
    }
  });
});
