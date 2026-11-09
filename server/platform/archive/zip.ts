import util from "node:util";
import zlib from "node:zlib";
import { AppError } from "../net/errors.ts";

const deflateRawAsync = util.promisify(zlib.deflateRaw);
const inflateRawAsync = util.promisify(zlib.inflateRaw);

const SIG_LFH = 0x04034b50;
const SIG_CDFH = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;

const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const FLAG_UTF8 = 0x0800;

const DEFAULT_MAX_ARCHIVE_BYTES = 100 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 150 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 500;
const MAX_EOCD_SCAN = 65_557; // 22-byte EOCD + 65,535-byte max comment

const PRECOMPRESSED_EXT_RE = /\.(?:pdf|png|jpe?g|webp|gif|zip|gz|mp4|mp3)$/i;

export class BadRequestError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, { code: "BAD_REQUEST", details });
  }
}

export interface ZipCreateEntry {
  name: string;
  data: Buffer;
  compress?: boolean;
}

export interface ZipExtractOptions {
  maxArchiveBytes?: number;
  maxTotalUncompressedBytes?: number;
  maxEntries?: number;
  allowedPath?: (name: string) => boolean;
  maxEntryBytes?: (name: string) => number;
}

export function canonicalizeZipPath(raw: string): string {
  if (!raw || raw.includes("\0") || raw.includes("\\")) {
    throw new BadRequestError("Invalid archive entry path");
  }
  if (raw.startsWith("/") || raw.endsWith("/")) {
    throw new BadRequestError(`Disallowed archive path format: ${raw}`);
  }
  const parts = raw.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new BadRequestError(`Path traversal or empty segment in: ${raw}`);
    }
  }
  return parts.join("/");
}

function hasZip64ExtraField(extra: Buffer): boolean {
  let pos = 0;
  while (pos + 4 <= extra.byteLength) {
    const headerId = extra.readUInt16LE(pos);
    const dataSize = extra.readUInt16LE(pos + 2);
    if (headerId === 0x0001) return true;
    pos += 4 + dataSize;
  }
  return false;
}

export async function createZipArchive(
  entries: ZipCreateEntry[],
): Promise<Buffer> {
  if (entries.length > 0xffff) {
    throw new BadRequestError("Too many ZIP entries");
  }

  const seen = new Set<string>();
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const cleanName = canonicalizeZipPath(entry.name);
    if (seen.has(cleanName)) {
      throw new BadRequestError(`Duplicate ZIP entry path: ${cleanName}`);
    }
    seen.add(cleanName);

    const nameBuf = Buffer.from(cleanName, "utf8");
    const shouldCompress =
      entry.compress ?? !PRECOMPRESSED_EXT_RE.test(cleanName);
    const method =
      shouldCompress && entry.data.byteLength > 0
        ? METHOD_DEFLATE
        : METHOD_STORE;
    const payload =
      method === METHOD_DEFLATE
        ? await deflateRawAsync(entry.data)
        : Buffer.from(entry.data);

    const crc = zlib.crc32(entry.data) >>> 0;
    const compSize = payload.byteLength;
    const uncompSize = entry.data.byteLength;

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(SIG_LFH, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(FLAG_UTF8, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0, 10);
    lfh.writeUInt16LE(0x0021, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compSize, 18);
    lfh.writeUInt32LE(uncompSize, 22);
    lfh.writeUInt16LE(nameBuf.byteLength, 26);
    lfh.writeUInt16LE(0, 28);

    const cdfh = Buffer.alloc(46);
    cdfh.writeUInt32LE(SIG_CDFH, 0);
    cdfh.writeUInt16LE(0x0314, 4); // Unix + ZIP 2.0
    cdfh.writeUInt16LE(20, 6);
    cdfh.writeUInt16LE(FLAG_UTF8, 8);
    cdfh.writeUInt16LE(method, 10);
    cdfh.writeUInt16LE(0, 12);
    cdfh.writeUInt16LE(0x0021, 14);
    cdfh.writeUInt32LE(crc, 16);
    cdfh.writeUInt32LE(compSize, 20);
    cdfh.writeUInt32LE(uncompSize, 24);
    cdfh.writeUInt16LE(nameBuf.byteLength, 28);
    cdfh.writeUInt16LE(0, 30);
    cdfh.writeUInt16LE(0, 32);
    cdfh.writeUInt16LE(0, 34);
    cdfh.writeUInt16LE(0, 36);
    cdfh.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    cdfh.writeUInt32LE(localOffset, 42);

    localParts.push(lfh, nameBuf, payload);
    cdParts.push(cdfh, nameBuf);
    localOffset += 30 + nameBuf.byteLength + compSize;
  }

  const cdBuf = Buffer.concat(cdParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.byteLength, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

interface ParsedEntry {
  name: string;
  method: number;
  crc32: number;
  compSize: number;
  uncompSize: number;
  localHeaderOffset: number;
  dataStart: number;
  dataEnd: number;
  entryCap: number;
}

export async function extractZipArchive(
  zipBuf: Buffer,
  opts: ZipExtractOptions = {},
): Promise<Map<string, Buffer>> {
  const maxArchiveBytes = opts.maxArchiveBytes ?? DEFAULT_MAX_ARCHIVE_BYTES;
  const maxTotalUncompressedBytes =
    opts.maxTotalUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES;
  const maxEntries = opts.maxEntries ?? DEFAULT_MAX_ENTRIES;

  if (!Buffer.isBuffer(zipBuf) || zipBuf.byteLength < 22) {
    throw new BadRequestError("Invalid or truncated ZIP archive");
  }
  if (zipBuf.byteLength > maxArchiveBytes) {
    throw new BadRequestError("ZIP archive exceeds maximum allowed size");
  }

  let eocdPos = -1;
  const minPos = Math.max(0, zipBuf.byteLength - MAX_EOCD_SCAN);
  for (let pos = zipBuf.byteLength - 22; pos >= minPos; pos--) {
    if (zipBuf.readUInt32LE(pos) === SIG_EOCD) {
      const commentLen = zipBuf.readUInt16LE(pos + 20);
      if (pos + 22 + commentLen === zipBuf.byteLength) {
        eocdPos = pos;
        break;
      }
    }
  }
  if (eocdPos === -1) {
    throw new BadRequestError("Missing or malformed ZIP End of Central Directory");
  }
  if (eocdPos >= 20 && zipBuf.readUInt32LE(eocdPos - 20) === SIG_ZIP64_LOCATOR) {
    throw new BadRequestError("ZIP64 archives are not supported");
  }

  const diskNo = zipBuf.readUInt16LE(eocdPos + 4);
  const cdDisk = zipBuf.readUInt16LE(eocdPos + 6);
  const diskEntries = zipBuf.readUInt16LE(eocdPos + 8);
  const totalEntries = zipBuf.readUInt16LE(eocdPos + 10);
  const cdSize = zipBuf.readUInt32LE(eocdPos + 12);
  const cdOffset = zipBuf.readUInt32LE(eocdPos + 16);

  if (
    diskNo === 0xffff ||
    cdDisk === 0xffff ||
    diskEntries === 0xffff ||
    totalEntries === 0xffff ||
    cdSize === 0xffffffff ||
    cdOffset === 0xffffffff
  ) {
    throw new BadRequestError("ZIP64 archives are not supported");
  }
  if (diskNo !== 0 || cdDisk !== 0 || diskEntries !== totalEntries) {
    throw new BadRequestError("Multi-disk ZIP archives are not supported");
  }
  if (totalEntries > maxEntries) {
    throw new BadRequestError(`ZIP exceeds maximum entry limit (${maxEntries})`);
  }
  if (cdOffset + cdSize > eocdPos) {
    throw new BadRequestError("Corrupt ZIP Central Directory bounds");
  }

  const seenNames = new Set<string>();
  const parsed: ParsedEntry[] = [];
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;
  let declaredUncompressedTotal = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (cursor + 46 > cdEnd || zipBuf.readUInt32LE(cursor) !== SIG_CDFH) {
      throw new BadRequestError("Malformed ZIP Central Directory header");
    }

    const gpFlag = zipBuf.readUInt16LE(cursor + 8);
    const method = zipBuf.readUInt16LE(cursor + 10);
    const crc32 = zipBuf.readUInt32LE(cursor + 16);
    const compSize = zipBuf.readUInt32LE(cursor + 20);
    const uncompSize = zipBuf.readUInt32LE(cursor + 24);
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const diskStart = zipBuf.readUInt16LE(cursor + 34);
    const externalAttrs = zipBuf.readUInt32LE(cursor + 38);
    const localHeaderOffset = zipBuf.readUInt32LE(cursor + 42);

    if (gpFlag & 1) {
      throw new BadRequestError("Encrypted ZIP entries are not supported");
    }
    if (diskStart !== 0) {
      throw new BadRequestError("Multi-disk ZIP entries are not supported");
    }
    if (
      compSize === 0xffffffff ||
      uncompSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new BadRequestError("ZIP64 entries are not supported");
    }
    if (method !== METHOD_STORE && method !== METHOD_DEFLATE) {
      throw new BadRequestError(`Unsupported ZIP compression method: ${method}`);
    }

    const unixType = (externalAttrs >>> 16) & 0o170000;
    if (unixType === 0o120000) {
      throw new BadRequestError("Symbolic link entries are forbidden in ZIP archives");
    }
    if (unixType !== 0 && unixType !== 0o100000) {
      throw new BadRequestError("Non-regular file entries are forbidden in ZIP archives");
    }

    const entryEnd = cursor + 46 + nameLen + extraLen + commentLen;
    if (entryEnd > cdEnd) {
      throw new BadRequestError("Truncated ZIP Central Directory entry");
    }

    const extraBuf = zipBuf.subarray(cursor + 46 + nameLen, cursor + 46 + nameLen + extraLen);
    if (hasZip64ExtraField(extraBuf)) {
      throw new BadRequestError("ZIP64 extra field entries are not supported");
    }

    const rawName = zipBuf.subarray(cursor + 46, cursor + 46 + nameLen).toString("utf8");
    const name = canonicalizeZipPath(rawName);
    if (seenNames.has(name)) {
      throw new BadRequestError(`Duplicate archive entry path: ${name}`);
    }
    seenNames.add(name);

    if (opts.allowedPath && !opts.allowedPath(name)) {
      throw new BadRequestError(`Disallowed archive entry path: ${name}`);
    }

    const entryCap = opts.maxEntryBytes
      ? opts.maxEntryBytes(name)
      : maxTotalUncompressedBytes;
    if (uncompSize > entryCap) {
      throw new BadRequestError(`Archive entry exceeds size limit: ${name}`);
    }
    declaredUncompressedTotal += uncompSize;
    if (declaredUncompressedTotal > maxTotalUncompressedBytes) {
      throw new BadRequestError("Archive exceeds cumulative uncompressed size limit");
    }

    if (localHeaderOffset + 30 > cdOffset || zipBuf.readUInt32LE(localHeaderOffset) !== SIG_LFH) {
      throw new BadRequestError(`Missing or invalid Local File Header for: ${name}`);
    }
    const lfhFlag = zipBuf.readUInt16LE(localHeaderOffset + 6);
    const lfhMethod = zipBuf.readUInt16LE(localHeaderOffset + 8);
    const lfhNameLen = zipBuf.readUInt16LE(localHeaderOffset + 26);
    const lfhExtraLen = zipBuf.readUInt16LE(localHeaderOffset + 28);
    if ((lfhFlag & 1) !== 0 || lfhMethod !== method || lfhNameLen !== nameLen) {
      throw new BadRequestError(`Local/Central header mismatch for: ${name}`);
    }

    const dataStart = localHeaderOffset + 30 + lfhNameLen + lfhExtraLen;
    const dataEnd = dataStart + compSize;
    if (dataStart > cdOffset || dataEnd > cdOffset || dataEnd < dataStart) {
      throw new BadRequestError(`Out-of-bounds Local File payload for: ${name}`);
    }
    const lfhName = zipBuf
      .subarray(localHeaderOffset + 30, localHeaderOffset + 30 + lfhNameLen)
      .toString("utf8");
    if (lfhName !== rawName) {
      throw new BadRequestError(`Local/Central filename mismatch for: ${name}`);
    }

    parsed.push({
      name,
      method,
      crc32,
      compSize,
      uncompSize,
      localHeaderOffset,
      dataStart,
      dataEnd,
      entryCap,
    });
    cursor = entryEnd;
  }

  if (cursor !== cdEnd) {
    throw new BadRequestError("Trailing bytes in ZIP Central Directory");
  }

  const sortedByOffset = [...parsed].sort(
    (a, b) => a.localHeaderOffset - b.localHeaderOffset,
  );
  for (let i = 1; i < sortedByOffset.length; i++) {
    if (sortedByOffset[i - 1].dataEnd > sortedByOffset[i].localHeaderOffset) {
      throw new BadRequestError("Overlapping ZIP local file entries detected");
    }
  }

  const outMap = new Map<string, Buffer>();
  let actualUncompressedTotal = 0;

  for (const entry of parsed) {
    const slice = zipBuf.subarray(entry.dataStart, entry.dataEnd);
    let out: Buffer;
    if (entry.method === METHOD_STORE) {
      if (entry.compSize !== entry.uncompSize) {
        throw new BadRequestError(`STORE size mismatch for: ${entry.name}`);
      }
      out = Buffer.from(slice);
    } else {
      const remainingBudget = maxTotalUncompressedBytes - actualUncompressedTotal;
      const maxOut = Math.min(entry.entryCap, remainingBudget);
      try {
        out = await inflateRawAsync(slice, { maxOutputLength: maxOut });
      } catch (err) {
        throw new BadRequestError(
          `Failed to decompress ZIP entry "${entry.name}"`,
          { cause: err instanceof Error ? err.message : String(err) },
        );
      }
    }

    if (out.byteLength !== entry.uncompSize) {
      throw new BadRequestError(`Uncompressed length mismatch for: ${entry.name}`);
    }
    actualUncompressedTotal += out.byteLength;
    if (actualUncompressedTotal > maxTotalUncompressedBytes) {
      throw new BadRequestError("Archive exceeds cumulative uncompressed size limit");
    }

    const computedCrc = zlib.crc32(out) >>> 0;
    if (computedCrc !== (entry.crc32 >>> 0)) {
      throw new BadRequestError(`CRC-32 integrity check failed for: ${entry.name}`);
    }

    outMap.set(entry.name, out);
  }

  return outMap;
}
