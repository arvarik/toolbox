import net from "node:net";
import http from "node:http";
import https from "node:https";
import { Readable } from "node:stream";
import dns from "node:dns/promises";
import {
  lookup as dnsCallbackLookup,
  type LookupOptions,
  type LookupAddress,
} from "node:dns";
import type { Request } from "express";
import {
  AppError,
  UpstreamTimeoutError,
  ValidationError,
} from "./errors.ts";

const MAX_HOPS = 10;

export function trustProxyHops(
  raw: string | undefined = process.env.TRUST_PROXY_HOPS,
): number {
  const value = raw?.trim();
  if (!value) return 0;
  if (!/^\d+$/.test(value) || Number(value) > MAX_HOPS) {
    throw new Error(
      `TRUST_PROXY_HOPS must be a whole number from 0 to ${MAX_HOPS} (got "${raw}")`,
    );
  }
  return Number(value);
}

const HOST_SHAPE = /^(?:\[[0-9a-fA-F:]+\]|[A-Za-z0-9.\-_]+)(?::\d{1,5})?$/;

export function validatePublicUrl(raw?: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const trimmed = raw.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(
      `PUBLIC_URL must be a valid http or https origin with no path (got "${raw}")`,
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `PUBLIC_URL must have an http or https protocol (got "${parsed.protocol}")`,
    );
  }
  if (parsed.pathname !== "" && parsed.pathname !== "/") {
    throw new Error(
      `PUBLIC_URL must not include a path (got "${parsed.pathname}")`,
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      "PUBLIC_URL must not include query parameters or a hash fragment",
    );
  }
  return parsed.origin;
}

export function publicOrigin(req: Request): string {
  const configured = process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN;
  if (configured) {
    const validated = validatePublicUrl(configured);
    if (validated) return validated;
  }
  const host = req.host;
  return `${req.protocol}://${host && HOST_SHAPE.test(host) ? host : "localhost"}`;
}

export function oidcCallbackUrl(req: Request): string {
  return `${publicOrigin(req)}/api/auth/oidc/callback`;
}

export function isOwnOrigin(req: Request, origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const configured = process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN;
  return (
    host === (req.host ?? "").toLowerCase() ||
    origin === validatePublicUrl(configured)
  );
}

export function mailLinkOrigin(): string | null {
  return validatePublicUrl(process.env.PUBLIC_URL);
}

export function getRpIdFromOrigin(origin: string): string {
  let hostname: string;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    throw new AppError(
      "Passkeys require a valid domain name or localhost.",
      400,
      { code: "PASSKEY_UNSUPPORTED_ORIGIN" },
    );
  }
  const bareHost = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(bareHost)) {
    throw new AppError(
      "Passkeys require a domain name or localhost (IP addresses are not supported).",
      400,
      { code: "PASSKEY_UNSUPPORTED_ORIGIN" },
    );
  }
  return hostname;
}

export function getPasskeyRp(req: Request): { rpID: string; origin: string } {
  const rawOrigin = publicOrigin(req);
  const rpID = getRpIdFromOrigin(rawOrigin);
  const origin =
    rpID !== "localhost" && rawOrigin.startsWith("http://")
      ? `https://${rawOrigin.slice("http://".length)}`
      : rawOrigin;
  return { rpID, origin };
}

// SSRF protection & connect-time DNS rebinding guard

function extractEmbeddedIPv4(lowerIPv6: string): string | null {
  const mapped = lowerIPv6.match(/^::ffff:(.+)$/);
  const nat64 = lowerIPv6.match(/^64:ff9b::(.+)$/);
  const tail = mapped?.[1] ?? nat64?.[1];
  if (!tail) return null;
  if (net.isIPv4(tail)) return tail;
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!hex) return null;
  const high = parseInt(hex[1], 16);
  const low = parseInt(hex[2], 16);
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  const lower = address.toLowerCase();
  const embedded = extractEmbeddedIPv4(lower);
  if (embedded) return isPrivateAddress(embedded);
  return (
    lower === "::1" ||
    lower === "::" ||
    lower.startsWith("fe80:") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  );
}

export const UNRESOLVABLE_HOST_MESSAGE = "Could not resolve URL host";

export async function assertPublicHttpUrl(targetUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new ValidationError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http(s) URLs are allowed");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new ValidationError("URL resolves to a private address");
    }
    return url;
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new ValidationError("URL resolves to a private address");
  }
  try {
    const { address } = await dns.lookup(hostname);
    if (isPrivateAddress(address)) {
      throw new ValidationError("URL resolves to a private address");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new ValidationError(UNRESOLVABLE_HOST_MESSAGE);
  }
  return url;
}

export function guardedLookup(
  hostname: string,
  options: LookupOptions,
  callback: (
    err: NodeJS.ErrnoException | null,
    address: string | LookupAddress[],
    family?: number,
  ) => void,
): void {
  dnsCallbackLookup(hostname, options, (err, result, family) => {
    if (err) return callback(err, result, family);
    const addresses = Array.isArray(result)
      ? result.map((entry) => entry.address)
      : [String(result)];
    if (addresses.some((addr) => isPrivateAddress(addr))) {
      const blocked: NodeJS.ErrnoException = new Error(
        "URL resolves to a private address",
      );
      blocked.code = "ERR_PRIVATE_ADDRESS";
      return callback(blocked, result, family);
    }
    callback(null, result, family);
  });
}

function assertHttpUrl(targetUrl: string): URL {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new ValidationError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ValidationError("Only http(s) URLs are allowed");
  }
  return url;
}

function fetchViaNodeHttp(
  url: URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    allowPrivate: boolean;
  },
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request(
      url,
      {
        method: init.method ?? "GET",
        headers: init.headers,
        signal: init.signal,
        ...(init.allowPrivate ? {} : { lookup: guardedLookup }),
      },
      (res) => {
        const headers = new Headers();
        for (const [k, v] of Object.entries(res.headers)) {
          if (Array.isArray(v)) {
            for (const item of v) headers.append(k, item);
          } else if (v !== undefined) {
            headers.set(k, v);
          }
        }
        const status = res.statusCode ?? 500;
        const nullBodyStatus = status === 204 || status === 205 || status === 304;
        const stream = nullBodyStatus
          ? null
          : (Readable.toWeb(res) as unknown as ReadableStream);
        resolve(
          new Response(stream, {
            status,
            statusText: res.statusMessage ?? "",
            headers,
          }),
        );
      },
    );
    req.on("error", reject);
    if (init.body !== undefined) req.write(init.body);
    req.end();
  });
}

function normalizeHeaders(
  headers?: HeadersInit | Record<string, string>,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  if (headers instanceof Headers) {
    headers.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(headers)) {
    for (const [k, v] of headers) out[k] = v;
    return out;
  }
  return { ...headers };
}

export async function safeFetch(
  targetUrl: string | URL,
  options: {
    method?: string;
    headers?: HeadersInit | Record<string, string>;
    body?: string;
    allowPrivate?: boolean;
    timeoutMs?: number;
    maxRedirects?: number;
    redirect?: RequestRedirect;
    signal?: AbortSignal | null;
  } = {},
): Promise<{ response: Response; finalUrl: string }> {
  const { timeoutMs = 6000, maxRedirects = 3, allowPrivate = false } = options;
  options.signal?.throwIfAborted();
  let currentUrl = String(targetUrl);
  const initialUrl = allowPrivate
    ? assertHttpUrl(currentUrl)
    : await assertPublicHttpUrl(currentUrl);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const currentHeaders = normalizeHeaders(options.headers);
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const combinedSignal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      const response = await fetchViaNodeHttp(new URL(currentUrl), {
        method: options.method,
        headers: currentHeaders,
        body: options.body,
        signal: combinedSignal,
        allowPrivate,
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location || options.redirect === "manual") {
          return { response, finalUrl: currentUrl };
        }
        void response.body?.cancel().catch(() => undefined);
        const nextUrlObj = new URL(location, currentUrl);
        currentUrl = nextUrlObj.toString();
        if (allowPrivate) assertHttpUrl(currentUrl);
        else await assertPublicHttpUrl(currentUrl);
        if (currentHeaders && initialUrl.origin !== nextUrlObj.origin) {
          delete currentHeaders.Authorization;
          delete currentHeaders.authorization;
        }
        continue;
      }
      return { response, finalUrl: currentUrl };
    }
    throw new AppError("Too many redirects", 502);
  } finally {
    clearTimeout(timer);
  }
}

export interface ReadCappedOptions {
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal | null;
}

export async function readBytesCapped(
  res: Response,
  options: ReadCappedOptions | number = {},
  legacySignal?: AbortSignal | null,
  legacyTimeoutMs?: number,
): Promise<Uint8Array> {
  const opts: ReadCappedOptions =
    typeof options === "number"
      ? { maxBytes: options, signal: legacySignal, timeoutMs: legacyTimeoutMs }
      : options;
  const maxBytes = opts.maxBytes ?? 25 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const declared = Number(res.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    void res.body?.cancel().catch(() => undefined);
    throw new AppError(
      `Upstream response exceeds ${maxBytes} bytes.`,
      413,
      { code: "RESPONSE_TOO_LARGE" },
    );
  }
  if (!res.body) return new Uint8Array(0);

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const combined = opts.signal
    ? AbortSignal.any([timeoutSignal, opts.signal])
    : timeoutSignal;
  combined.throwIfAborted();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => {
      void reader.cancel().catch(() => undefined);
      if (timeoutSignal.aborted && !opts.signal?.aborted) {
        reject(new UpstreamTimeoutError("Upstream body stream timed out."));
      } else {
        reject(combined.reason ?? new DOMException("Aborted", "AbortError"));
      }
    };
    combined.addEventListener("abort", onAbort, { once: true });
  });

  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), abortPromise]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AppError(
          `Upstream response exceeds ${maxBytes} bytes.`,
          413,
          { code: "RESPONSE_TOO_LARGE" },
        );
      }
      chunks.push(value);
    }
  } finally {
    if (onAbort) combined.removeEventListener("abort", onAbort);
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export async function readBodyCapped(
  res: Response,
  options: ReadCappedOptions = {},
): Promise<string> {
  const bytes = await readBytesCapped(res, {
    maxBytes: options.maxBytes ?? 2 * 1024 * 1024,
    timeoutMs: options.timeoutMs ?? 8_000,
    signal: options.signal,
  });
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}
