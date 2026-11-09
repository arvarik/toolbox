import zlib from "node:zlib";
import type { Request, Response, NextFunction, RequestHandler } from "express";

export const MIN_GZIP_BYTES = 1024;

export function isCompressibleContentType(raw: string): boolean {
  const mediaType = raw.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!mediaType || mediaType === "text/event-stream") return false;
  return (
    mediaType === "application/json" ||
    mediaType.endsWith("+json") ||
    mediaType.startsWith("text/") ||
    mediaType === "application/javascript" ||
    mediaType === "application/x-javascript" ||
    mediaType === "image/svg+xml"
  );
}

function acceptsGzip(header: string | string[] | undefined): boolean {
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  for (const part of raw.split(",")) {
    const [encoding, ...params] = part.trim().toLowerCase().split(";");
    if (encoding !== "gzip") continue;
    const qParam = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    if (qParam && Number(qParam.slice(2)) === 0) return false;
    return true;
  }
  return false;
}

function toBuffer(chunk: unknown, encoding?: BufferEncoding): Buffer {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  return Buffer.from(String(chunk), encoding ?? "utf8");
}

function canCompressResponse(res: Response): boolean {
  const status = res.statusCode;
  if (
    res.headersSent ||
    status === 204 ||
    status === 304 ||
    (status >= 100 && status < 200) ||
    Boolean(res.getHeader("Content-Encoding"))
  ) {
    return false;
  }
  return isCompressibleContentType(String(res.getHeader("Content-Type") ?? ""));
}

export const gzipCompression: RequestHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  if (req.method === "HEAD") {
    next();
    return;
  }

  const clientAcceptsGzip = acceptsGzip(req.headers["accept-encoding"]);
  const origWrite = res.write.bind(res);
  const origEnd = res.end.bind(res);
  const chunks: Buffer[] = [];
  let passthrough = false;
  let ended = false;

  res.write = ((
    chunk: unknown,
    encodingOrCb?: BufferEncoding | ((error: Error | null | undefined) => void),
    cb?: (error: Error | null | undefined) => void,
  ): boolean => {
    if (passthrough) {
      return origWrite(chunk as never, encodingOrCb as never, cb as never);
    }
    if (!clientAcceptsGzip || !canCompressResponse(res)) {
      passthrough = true;
      return origWrite(chunk as never, encodingOrCb as never, cb as never);
    }
    const enc = typeof encodingOrCb === "string" ? encodingOrCb : undefined;
    const callback = typeof encodingOrCb === "function" ? encodingOrCb : cb;
    if (chunk !== undefined && chunk !== null) {
      chunks.push(toBuffer(chunk, enc));
    }
    callback?.(null);
    return true;
  }) as Response["write"];

  res.end = ((
    chunkOrCb?: unknown,
    encodingOrCb?: BufferEncoding | (() => void),
    cb?: () => void,
  ): Response => {
    if (passthrough || ended) {
      return origEnd(chunkOrCb as never, encodingOrCb as never, cb as never);
    }
    ended = true;

    const hasChunk =
      chunkOrCb !== undefined &&
      chunkOrCb !== null &&
      typeof chunkOrCb !== "function";
    const enc = typeof encodingOrCb === "string" ? encodingOrCb : undefined;
    const callback =
      typeof chunkOrCb === "function"
        ? (chunkOrCb as () => void)
        : typeof encodingOrCb === "function"
          ? encodingOrCb
          : cb;

    if (canCompressResponse(res)) {
      res.vary("Accept-Encoding");
    }

    if (!clientAcceptsGzip || !canCompressResponse(res)) {
      for (const buf of chunks) origWrite(buf);
      return hasChunk
        ? origEnd(chunkOrCb as never, enc as never, callback)
        : origEnd(callback);
    }

    if (hasChunk) {
      chunks.push(toBuffer(chunkOrCb, enc));
    }
    const raw = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);

    if (raw.byteLength < MIN_GZIP_BYTES) {
      res.setHeader("Content-Length", String(raw.byteLength));
      return origEnd(raw, callback);
    }

    const gz = zlib.gzipSync(raw);
    const etag = res.getHeader("ETag");
    if (typeof etag === "string" && etag && !etag.startsWith("W/")) {
      res.setHeader("ETag", `W/${etag}`);
    }
    res.setHeader("Content-Encoding", "gzip");
    res.setHeader("Content-Length", String(gz.byteLength));
    return origEnd(gz, callback);
  }) as Response["end"];

  next();
};
