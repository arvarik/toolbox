import fs from "node:fs";
import { parentPort } from "node:worker_threads";
import { DATA_DIR } from "../../appConfig.ts";
import {
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

let chain: Promise<void> = Promise.resolve();
port.on("message", (job: WorkerJob) => {
  chain = chain.then(() => {
    if (job.kind === "embed") return runEmbed(job.id, job.texts);
  });
});
