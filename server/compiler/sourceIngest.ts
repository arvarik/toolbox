import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type Database from "better-sqlite3";
import { kitsUploadsBaseDir, kitUploadsDir } from "../kits/kitService.ts";
import {
  AppError,
  NotFoundError,
  ValidationError,
} from "../platform/net/errors.ts";
import { readBytesCapped, safeFetch } from "../platform/net/originAndFetch.ts";
import { fetchReadablePage } from "../platform/research/pages.ts";
import type { Scope } from "../platform/tenancy/scope.ts";
import {
  DEFAULT_PDF_MAX_CHARS,
  DEFAULT_PDF_MAX_PAGES,
  DEFAULT_PDF_TIMEOUT_MS,
  extractPdfText,
  MAX_PDF_UPLOAD_BYTES,
} from "../platform/workers/cpuHost.ts";
import {
  upsertRagChunksBatch,
  type UpsertRagChunkInput,
} from "../search/hybridSearch.ts";

export const MAX_PDF_BYTES = MAX_PDF_UPLOAD_BYTES; // 25 MB
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024; // 2 MB
export const MAX_EXTRACTED_CHARS = DEFAULT_PDF_MAX_CHARS; // 500_000 chars
export const CHUNK_TARGET_WORDS = 300;
export const CHUNK_OVERLAP_WORDS = 40;

const SAFE_ID_RE = /^[A-Za-z0-9_-]{1,120}$/;
const STAGING_TTL_MS = 24 * 60 * 60 * 1000;

export type CompilerSourceKind = "pdf" | "markdown" | "text" | "url";

export interface StagedSourceSummary {
  stagedId: string;
  kind: CompilerSourceKind;
  title: string;
  url: string | null;
  mimeType: string | null;
  sizeBytes: number;
  wordCount: number;
  excerpt: string;
  safeBasename: string | null;
}

export interface LoadedStagedSource extends StagedSourceSummary {
  text: string;
  stagedFilePath: string | null;
  stagedDir: string;
}

interface StoredStagingMeta extends StagedSourceSummary {
  createdAtMs: number;
}

function sanitizeBasename(raw: string): string {
  const cleaned = path
    .basename(raw)
    .replace(/[^A-Za-z0-9._-]/g, "_")
    .replace(/^\.+/, "");
  return cleaned.slice(0, 140) || "source.bin";
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

function makeExcerpt(text: string, maxChars: number = 1_200): string {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length > maxChars ? `${compact.slice(0, maxChars)}…` : compact;
}

export function chunkTextByWords(
  text: string,
  targetWords: number = CHUNK_TARGET_WORDS,
  overlapWords: number = CHUNK_OVERLAP_WORDS,
): string[] {
  const words = text.replace(/\0/g, "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= targetWords) return [words.join(" ")];

  const step = Math.max(1, targetWords - Math.max(0, overlapWords));
  const chunks: string[] = [];
  for (let start = 0; start < words.length; start += step) {
    const slice = words.slice(start, start + targetWords);
    if (slice.length === 0) break;
    chunks.push(slice.join(" "));
    if (start + targetWords >= words.length) break;
  }
  return chunks;
}

function stagingRootDir(ownerId: string): string {
  return path.resolve(kitsUploadsBaseDir(ownerId), ".compiler-staging");
}

function resolveStagingEntryDir(ownerId: string, stagedId: string): string {
  if (!SAFE_ID_RE.test(stagedId)) {
    throw new ValidationError("Invalid staged source identifier");
  }
  const root = stagingRootDir(ownerId);
  const full = path.resolve(root, stagedId);
  if (!full.startsWith(root + path.sep)) {
    throw new ValidationError("Invalid staged source path");
  }
  return full;
}

export function pruneStaleStagingDirs(
  ownerId: string,
  maxAgeMs: number = STAGING_TTL_MS,
): void {
  const root = stagingRootDir(ownerId);
  if (!fs.existsSync(root)) return;
  const now = Date.now();
  try {
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = path.join(root, entry.name);
      try {
        const metaPath = path.join(full, "meta.json");
        const st = fs.statSync(fs.existsSync(metaPath) ? metaPath : full);
        if (now - st.mtimeMs > maxAgeMs) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      } catch {
        // Ignore concurrent deletion
      }
    }
  } catch {
    // Best-effort cleanup
  }
}

function persistStagedSource(
  scope: Scope,
  input: {
    kind: CompilerSourceKind;
    title: string;
    url: string | null;
    mimeType: string | null;
    sizeBytes: number;
    text: string;
    rawFile?: { basename: string; bytes: Uint8Array };
  },
): StagedSourceSummary {
  pruneStaleStagingDirs(scope.ownerId);

  const normalizedText = input.text
    .replace(/\0/g, "")
    .slice(0, MAX_EXTRACTED_CHARS)
    .trim();
  if (!normalizedText) {
    throw new ValidationError(
      `Source "${input.title}" contains no readable text content.`,
    );
  }

  const stagedId = crypto.randomUUID();
  const entryDir = resolveStagingEntryDir(scope.ownerId, stagedId);
  fs.mkdirSync(entryDir, { recursive: true });

  let safeBase: string | null = null;
  if (input.rawFile) {
    safeBase = sanitizeBasename(input.rawFile.basename);
    const rawDir = path.join(entryDir, "raw");
    fs.mkdirSync(rawDir, { recursive: true });
    fs.writeFileSync(path.join(rawDir, safeBase), input.rawFile.bytes);
  }

  fs.writeFileSync(path.join(entryDir, "extracted.txt"), normalizedText, "utf8");

  const summary: StagedSourceSummary = {
    stagedId,
    kind: input.kind,
    title: input.title.trim().slice(0, 200) || "Untitled Source",
    url: input.url,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    wordCount: countWords(normalizedText),
    excerpt: makeExcerpt(normalizedText),
    safeBasename: safeBase,
  };

  const meta: StoredStagingMeta = {
    ...summary,
    createdAtMs: Date.now(),
  };
  fs.writeFileSync(
    path.join(entryDir, "meta.json"),
    JSON.stringify(meta),
    "utf8",
  );
  return summary;
}

function isPdfBufferOrName(
  filename: string,
  mimeType: string,
  bytes: Uint8Array,
): boolean {
  const lowerName = filename.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  if (lowerName.endsWith(".pdf") || lowerMime === "application/pdf") {
    return true;
  }
  return (
    bytes.byteLength >= 5 &&
    bytes[0] === 0x25 && // %
    bytes[1] === 0x50 && // P
    bytes[2] === 0x44 && // D
    bytes[3] === 0x46 && // F
    bytes[4] === 0x2d // -
  );
}

export async function stageUploadedFile(
  scope: Scope,
  file: {
    originalname: string;
    mimetype?: string;
    buffer?: Buffer;
    path?: string;
    size?: number;
  },
): Promise<StagedSourceSummary> {
  const originalName = file.originalname || "uploaded-source";
  const mimeType = (file.mimetype || "application/octet-stream").toLowerCase();
  const bytes: Buffer = file.buffer
    ? file.buffer
    : file.path
      ? await fs.promises.readFile(file.path)
      : Buffer.alloc(0);

  if (bytes.byteLength === 0) {
    throw new ValidationError(`Uploaded file "${originalName}" is empty.`);
  }

  const isPdf = isPdfBufferOrName(originalName, mimeType, bytes);
  if (isPdf) {
    if (bytes.byteLength > MAX_PDF_BYTES) {
      throw new AppError("PDF upload exceeds the 25 MB limit.", 413, {
        code: "FILE_TOO_LARGE",
      });
    }
    let extracted;
    try {
      extracted = await extractPdfText(bytes, {
        timeoutMs: DEFAULT_PDF_TIMEOUT_MS,
        maxPages: DEFAULT_PDF_MAX_PAGES,
        maxChars: MAX_EXTRACTED_CHARS,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ValidationError(
        `Could not extract text from PDF "${originalName}": ${msg}`,
      );
    }
    if (!extracted.text.trim()) {
      throw new ValidationError(
        `PDF "${originalName}" contains no extractable text (image-only scans are not supported).`,
      );
    }
    const cleanTitle = path.basename(originalName, path.extname(originalName));
    return persistStagedSource(scope, {
      kind: "pdf",
      title: cleanTitle || originalName,
      url: null,
      mimeType: "application/pdf",
      sizeBytes: bytes.byteLength,
      text: extracted.text,
      rawFile: { basename: originalName, bytes },
    });
  }

  const ext = path.extname(originalName).toLowerCase();
  const allowedTextExts = new Set([".md", ".markdown", ".txt"]);
  const isTextMime =
    mimeType.startsWith("text/plain") ||
    mimeType.startsWith("text/markdown") ||
    mimeType.startsWith("text/x-markdown") ||
    mimeType === "application/octet-stream";

  if (!allowedTextExts.has(ext) && !isTextMime) {
    throw new ValidationError(
      `Unsupported file type for "${originalName}". Upload a .pdf, .md, or .txt file.`,
    );
  }
  if (!allowedTextExts.has(ext) && mimeType === "application/octet-stream") {
    throw new ValidationError(
      `Unsupported file extension "${ext || "none"}". Upload a .pdf, .md, or .txt file.`,
    );
  }
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) {
    throw new AppError(
      `Text/Markdown file "${originalName}" exceeds the 2 MB limit.`,
      413,
      { code: "FILE_TOO_LARGE" },
    );
  }

  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  const kind: CompilerSourceKind =
    ext === ".md" || ext === ".markdown" || mimeType.includes("markdown")
      ? "markdown"
      : "text";
  const cleanTitle = path.basename(originalName, path.extname(originalName));
  return persistStagedSource(scope, {
    kind,
    title: cleanTitle || originalName,
    url: null,
    mimeType: kind === "markdown" ? "text/markdown" : "text/plain",
    sizeBytes: bytes.byteLength,
    text: decoded,
    rawFile: { basename: originalName, bytes },
  });
}

async function fetchPdfUrlAndStage(
  scope: Scope,
  targetUrl: string,
  signal?: AbortSignal,
): Promise<StagedSourceSummary> {
  const { response, finalUrl } = await safeFetch(targetUrl, {
    allowPrivate: false,
    timeoutMs: 15_000,
    headers: {
      Accept: "application/pdf,*/*;q=0.8",
      "User-Agent": "ToolboxStudyBot/2.0 (+https://localhost)",
    },
    signal,
  });

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new ValidationError(
      `Failed to fetch PDF URL (${targetUrl}): HTTP ${response.status}`,
    );
  }

  const pdfBytes = await readBytesCapped(response, {
    maxBytes: MAX_PDF_BYTES,
    timeoutMs: 20_000,
    signal,
  });

  let extracted;
  try {
    extracted = await extractPdfText(pdfBytes, {
      timeoutMs: DEFAULT_PDF_TIMEOUT_MS,
      maxPages: DEFAULT_PDF_MAX_PAGES,
      maxChars: MAX_EXTRACTED_CHARS,
      signal,
    });
  } catch (err) {
    throw new ValidationError(
      `Failed to extract PDF from URL (${targetUrl}): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const parsedUrl = new URL(finalUrl);
  const rawBase = path.basename(parsedUrl.pathname) || "remote-document.pdf";
  const baseWithPdf = rawBase.toLowerCase().endsWith(".pdf")
    ? rawBase
    : `${rawBase}.pdf`;

  return persistStagedSource(scope, {
    kind: "pdf",
    title: path.basename(baseWithPdf, ".pdf") || parsedUrl.hostname,
    url: finalUrl,
    mimeType: "application/pdf",
    sizeBytes: pdfBytes.byteLength,
    text: extracted.text,
    rawFile: { basename: baseWithPdf, bytes: pdfBytes },
  });
}

export async function stageUrlSource(
  scope: Scope,
  rawUrl: string,
  opts: { signal?: AbortSignal } = {},
): Promise<StagedSourceSummary> {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    throw new ValidationError("URL cannot be empty");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError(`Invalid URL: ${trimmed}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Only http:// and https:// URLs are allowed");
  }

  if (parsed.pathname.toLowerCase().endsWith(".pdf")) {
    return fetchPdfUrlAndStage(scope, trimmed, opts.signal);
  }

  const pageResult = await fetchReadablePage(trimmed, {
    maxChars: 120_000,
    signal: opts.signal,
  });

  if (!pageResult.ok) {
    if (
      pageResult.reason.toLowerCase().includes("application/pdf")
    ) {
      return fetchPdfUrlAndStage(scope, trimmed, opts.signal);
    }
    throw new ValidationError(
      `Could not read URL "${trimmed}": ${pageResult.reason}`,
    );
  }

  const text = pageResult.page.excerpt.trim();
  if (!text) {
    throw new ValidationError(`No readable text found at URL "${trimmed}".`);
  }

  return persistStagedSource(scope, {
    kind: "url",
    title: pageResult.page.title || parsed.hostname,
    url: pageResult.page.finalUrl || trimmed,
    mimeType: "text/html",
    sizeBytes: Buffer.byteLength(text, "utf8"),
    text,
  });
}

export function stageRawTextSource(
  scope: Scope,
  rawText: string,
  title: string = "Pasted Notes / Syllabus",
): StagedSourceSummary {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new ValidationError("Pasted source text cannot be empty.");
  }
  const sizeBytes = Buffer.byteLength(trimmed, "utf8");
  if (sizeBytes > MAX_TEXT_FILE_BYTES) {
    throw new AppError("Pasted text exceeds the 2 MB limit.", 413, {
      code: "FILE_TOO_LARGE",
    });
  }
  return persistStagedSource(scope, {
    kind: "text",
    title: title.trim() || "Pasted Notes / Syllabus",
    url: null,
    mimeType: "text/plain",
    sizeBytes,
    text: trimmed,
  });
}

export function loadStagedSources(
  scope: Scope,
  stagedIds: readonly string[],
): LoadedStagedSource[] {
  const seen = new Set<string>();
  const out: LoadedStagedSource[] = [];

  for (const rawId of stagedIds) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const entryDir = resolveStagingEntryDir(scope.ownerId, id);
    const metaPath = path.join(entryDir, "meta.json");
    const textPath = path.join(entryDir, "extracted.txt");
    if (!fs.existsSync(metaPath) || !fs.existsSync(textPath)) {
      throw new NotFoundError("Staged source", id);
    }

    const meta = JSON.parse(
      fs.readFileSync(metaPath, "utf8"),
    ) as StoredStagingMeta;
    const text = fs.readFileSync(textPath, "utf8");

    let stagedFilePath: string | null = null;
    if (meta.safeBasename) {
      const candidate = path.resolve(
        entryDir,
        "raw",
        sanitizeBasename(meta.safeBasename),
      );
      if (
        candidate.startsWith(entryDir + path.sep) &&
        fs.existsSync(candidate) &&
        fs.lstatSync(candidate).isFile()
      ) {
        stagedFilePath = candidate;
      }
    }

    out.push({
      stagedId: meta.stagedId,
      kind: meta.kind,
      title: meta.title,
      url: meta.url,
      mimeType: meta.mimeType,
      sizeBytes: meta.sizeBytes,
      wordCount: meta.wordCount,
      excerpt: meta.excerpt,
      safeBasename: meta.safeBasename,
      text,
      stagedFilePath,
      stagedDir: entryDir,
    });
  }

  return out;
}

export function deleteStagedSource(scope: Scope, stagedId: string): void {
  const entryDir = resolveStagingEntryDir(scope.ownerId, stagedId);
  fs.rmSync(entryDir, { recursive: true, force: true });
}

export async function resolveInlineAndStagedSources(
  scope: Scope,
  input: {
    stagedSourceIds?: readonly string[];
    urls?: readonly string[];
    pastedText?: string;
    pastedTitle?: string;
    signal?: AbortSignal;
  },
): Promise<LoadedStagedSource[]> {
  const ids: string[] = [...(input.stagedSourceIds ?? [])];

  if (input.pastedText && input.pastedText.trim()) {
    const staged = stageRawTextSource(
      scope,
      input.pastedText,
      input.pastedTitle || "Pasted Notes / Syllabus",
    );
    ids.push(staged.stagedId);
  }

  if (input.urls && input.urls.length > 0) {
    for (const u of input.urls) {
      if (!u.trim()) continue;
      const staged = await stageUrlSource(scope, u, { signal: input.signal });
      ids.push(staged.stagedId);
    }
  }

  return loadStagedSources(scope, ids);
}

/**
 * Commits staged sources into `kitUploadsDir(scope.ownerId, kitId)/<sourceId>/<safeBasename>`,
 * inserts `kit_sources` + ~300-word (40-word overlap) `kit_source_chunks`,
 * indexes `rag_chunks` (`kind = "source_chunk"`), and cleans up staging dirs.
 */
export async function commitStagedSourcesToKit(
  db: Database.Database,
  scope: Scope,
  kitId: string,
  sources: readonly LoadedStagedSource[],
): Promise<{ sourceIds: string[]; chunkCount: number }> {
  if (sources.length === 0) {
    return { sourceIds: [], chunkCount: 0 };
  }

  const kitRoot = kitUploadsDir(scope.ownerId, kitId);
  const prepared: Array<{
    sourceId: string;
    source: LoadedStagedSource;
    relFilePath: string | null;
    chunks: Array<{ chunkId: string; chunkIndex: number; text: string }>;
  }> = [];

  for (const src of sources) {
    const sourceId = crypto.randomUUID();
    let relFilePath: string | null = null;

    if (src.stagedFilePath && src.safeBasename) {
      const safeBase = sanitizeBasename(src.safeBasename);
      const destDir = path.resolve(kitRoot, sourceId);
      if (!destDir.startsWith(kitRoot + path.sep)) {
        throw new ValidationError("Invalid destination source path");
      }
      fs.mkdirSync(destDir, { recursive: true });
      const destFile = path.join(destDir, safeBase);
      fs.copyFileSync(src.stagedFilePath, destFile);
      relFilePath = `${sourceId}/${safeBase}`;
    }

    const textChunks = chunkTextByWords(
      src.text,
      CHUNK_TARGET_WORDS,
      CHUNK_OVERLAP_WORDS,
    );
    const chunks = textChunks.map((text, chunkIndex) => ({
      chunkId: crypto.randomUUID(),
      chunkIndex,
      text,
    }));

    prepared.push({ sourceId, source: src, relFilePath, chunks });
  }

  const insSource = db.prepare(`
    INSERT INTO kit_sources (
      id, ownerId, kit_id, kind, title, url, file_path, mime_type, size_bytes, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `);
  const insChunk = db.prepare(`
    INSERT INTO kit_source_chunks (
      id, ownerId, kit_id, source_id, chunk_index, text
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const ragInputs: UpsertRagChunkInput[] = [];
  const writeTx = db.transaction(() => {
    for (const item of prepared) {
      insSource.run(
        item.sourceId,
        scope.ownerId,
        kitId,
        item.source.kind,
        item.source.title,
        item.source.url,
        item.relFilePath,
        item.source.mimeType,
        item.source.sizeBytes,
      );
      for (const ch of item.chunks) {
        insChunk.run(
          ch.chunkId,
          scope.ownerId,
          kitId,
          item.sourceId,
          ch.chunkIndex,
          ch.text,
        );
        ragInputs.push({
          kitId,
          kind: "source_chunk",
          sourceRefId: ch.chunkId,
          title: item.source.title,
          content: ch.text,
        });
      }
    }
  });
  writeTx();

  await upsertRagChunksBatch(db, scope, ragInputs);

  for (const src of sources) {
    fs.rmSync(src.stagedDir, { recursive: true, force: true });
  }

  return {
    sourceIds: prepared.map((p) => p.sourceId),
    chunkCount: ragInputs.length,
  };
}
