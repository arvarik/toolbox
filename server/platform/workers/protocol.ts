import fs from "node:fs";
import path from "node:path";

export const EMBEDDING_MODEL_ID = "Xenova/all-MiniLM-L6-v2";
export const LOCAL_EMBEDDING_DIM = 384;

export const MAX_PDF_UPLOAD_BYTES = 25 * 1024 * 1024;
export const DEFAULT_PDF_TIMEOUT_MS = 15_000;
export const DEFAULT_PDF_MAX_PAGES = 200;
export const DEFAULT_PDF_MAX_CHARS = 500_000;

export interface PinnedModelSpec {
  id: string;
  revision: string;
  files: Record<string, string>;
}

export const PINNED_MODELS: PinnedModelSpec[] = [
  {
    id: EMBEDDING_MODEL_ID,
    revision: "e4ce9877abf3edfe10b0d82785e83bdcb973e22e",
    files: {
      "config.json":
        "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/e4ce9877abf3edfe10b0d82785e83bdcb973e22e/config.json",
      "tokenizer.json":
        "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/e4ce9877abf3edfe10b0d82785e83bdcb973e22e/tokenizer.json",
      "tokenizer_config.json":
        "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/e4ce9877abf3edfe10b0d82785e83bdcb973e22e/tokenizer_config.json",
      "special_tokens_map.json":
        "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/e4ce9877abf3edfe10b0d82785e83bdcb973e22e/special_tokens_map.json",
      "onnx/model_quantized.onnx":
        "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/e4ce9877abf3edfe10b0d82785e83bdcb973e22e/onnx/model_quantized.onnx",
    },
  },
];

export function modelsRootDir(dataDir: string): string {
  return process.env.MODELS_DIR
    ? path.resolve(process.env.MODELS_DIR)
    : path.resolve(dataDir, "models");
}

export function modelDir(root: string, modelId: string): string {
  return path.join(root, ...modelId.split("/"));
}

export function hasLocalModelBundle(
  root: string,
  spec: PinnedModelSpec = PINNED_MODELS[0],
): boolean {
  const base = modelDir(root, spec.id);
  for (const rel of Object.keys(spec.files)) {
    try {
      const st = fs.statSync(path.join(base, rel));
      if (!st.isFile() || st.size === 0) return false;
    } catch {
      return false;
    }
  }
  return true;
}

export interface EmbedJob {
  id: number;
  kind: "embed";
  texts: string[];
}

export interface ExtractPdfJob {
  id: number;
  kind: "extract_pdf";
  bytes: Uint8Array;
  maxPages: number;
  maxChars: number;
}

export type WorkerJob = EmbedJob | ExtractPdfJob;

export type WorkerReply =
  | {
      id: number;
      ok: true;
      kind: "embed";
      flat: Float32Array;
      count: number;
      dims: number;
    }
  | {
      id: number;
      ok: true;
      kind: "extract_pdf";
      text: string;
      totalPages: number;
      extractedPages: number;
      truncated: boolean;
    }
  | { id: number; ok: false; error: string; stage: "load" | "run" };

export const CANCELLED = Symbol("cancelled");

export function unflatten(
  flat: Float32Array,
  count: number,
  dims: number,
): Float32Array[] {
  const out: Float32Array[] = new Array(count);
  for (let i = 0; i < count; i++) {
    out[i] = flat.slice(i * dims, (i + 1) * dims);
  }
  return out;
}
