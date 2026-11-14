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
  log,
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

export function hasHttpsForwardedProto(req: Request): boolean {
  const header = req.headers["x-forwarded-proto"];
  const raw = Array.isArray(header) ? header.join(",") : header;
  if (!raw) return false;
  return raw.split(",").some((part) => part.trim().toLowerCase() === "https");
}

export function warnIfTlsProxyUntrusted(hops = trustProxyHops()): boolean {
  if (hops > 0) return false;
  for (const [name, raw] of [
    ["PUBLIC_URL", process.env.PUBLIC_URL],
    ["PUBLIC_ORIGIN", process.env.PUBLIC_ORIGIN],
  ] as const) {
    const trimmed = raw?.trim();
    if (!trimmed) continue;
    try {
      if (new URL(trimmed).protocol === "https:") {
        log.warn(
          "security",
          `${name} uses https:// (${trimmed}) while TRUST_PROXY_HOPS is 0; req.secure, "; Secure" session cookies, and Strict-Transport-Security will remain inactive behind a reverse proxy until TRUST_PROXY_HOPS=1 (or your proxy hop count) is set.`,
        );
        return true;
      }
    } catch {
      // Invalid URLs are surfaced by validatePublicUrl().
    }
  }
  return false;
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

function safeConfiguredOrigin(): string | null {
  const configured = process.env.PUBLIC_URL || process.env.PUBLIC_ORIGIN;
  if (!configured) return null;
  try {
    return validatePublicUrl(configured);
  } catch {
    return null;
  }
}

export function isOwnOrigin(req: Request, origin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const configuredOrigin = safeConfiguredOrigin();
  if (configuredOrigin !== null && origin === configuredOrigin) return true;
  if (req.secure && parsed.protocol !== "https:") return false;
  return parsed.host === (req.host ?? "").toLowerCase();
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

// IPv4-mapped (::ffff:), IPv4-translated (::ffff:0:) and NAT64 (64:ff9b::/96) forms.
function extractEmbeddedIPv4(lowerIPv6: string): string | null {
  const match =
    lowerIPv6.match(/^::ffff:(?:0:)?([\d.]+|[0-9a-f]{1,4}:[0-9a-f]{1,4})$/) ??
    lowerIPv6.match(/^64:ff9b::([\d.]+|(?:[0-9a-f]{1,4}:)?[0-9a-f]{1,4})?$/);
  if (!match) return null;
  const tail = match[1] ?? "";
  if (tail.includes(".")) return net.isIPv4(tail) ? tail : null;
  // Canonical IPv6 text drops leading zero groups: "64:ff9b::1" is 0.0.0.1.
  const [high, low] = `0:0:${tail || "0"}`
    .split(":")
    .slice(-2)
    .map((g) => parseInt(g, 16));
  return `${high >> 8}.${high & 0xff}.${low >> 8}.${low & 0xff}`;
}

/**
 * Cloud metadata, link-local, unspecified, and multicast targets, and the deprecated IPv6 forms
 * that carry an IPv4 host. Refused even when private targets are allowed.
 */
export function isAlwaysBlockedAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split(".").map(Number);
    return a === 0 || (a === 169 && b === 254) || a >= 224;
  }
  const lower = address.toLowerCase();
  const embedded = extractEmbeddedIPv4(lower);
  if (embedded) return isAlwaysBlockedAddress(embedded);
  return (
    /^::(?!1$)/.test(lower) || // "::" and IPv4-compatible ::a.b.c.d, but not the loopback ::1
    /^2002:|^2001:0?:/.test(lower) || // 6to4 (2002::/16) and Teredo (2001::/32)
    lower === "fd00:ec2::254" ||
    /^fe[89ab][0-9a-f]*:/.test(lower) ||
    lower.startsWith("ff")
  );
}

export function isPrivateAddress(address: string): boolean {
  if (isAlwaysBlockedAddress(address)) return true;
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
    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    const records = Array.isArray(resolved) ? resolved : resolved ? [resolved] : [];
    if (records.length === 0) {
      throw new ValidationError(UNRESOLVABLE_HOST_MESSAGE);
    }
    if (records.some((record) => isPrivateAddress(record.address))) {
      throw new ValidationError("URL resolves to a private address");
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new ValidationError(UNRESOLVABLE_HOST_MESSAGE);
  }
  return url;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

// Connect-time check: it sees the address the socket really uses, so DNS rebinding cannot pass it.
function lookupRefusing(isBlocked: (address: string) => boolean) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    dnsCallbackLookup(hostname, options, (err, result, family) => {
      if (err) return callback(err, result, family);
      const addresses = Array.isArray(result)
        ? result.map((entry) => entry.address)
        : [String(result)];
      if (addresses.some(isBlocked)) {
        const blocked: NodeJS.ErrnoException = new Error(
          "URL resolves to a private address",
        );
        blocked.code = "ERR_PRIVATE_ADDRESS";
        return callback(blocked, result, family);
      }
      callback(null, result, family);
    });
  };
}

export const guardedLookup = lookupRefusing(isPrivateAddress);
const metadataGuardedLookup = lookupRefusing(isAlwaysBlockedAddress);

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
  // An IP literal skips DNS lookup, so check it here (initial URL and every redirect hop).
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(host) && isAlwaysBlockedAddress(host)) {
    throw new ValidationError("URL resolves to a blocked address");
  }
  return url;
}

function fetchViaNodeHttp(
  url: URL,
  init: {
    method?: string;
    headers?: Record<string, string>;
    body?: string | Uint8Array;
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
        lookup: init.allowPrivate ? metadataGuardedLookup : guardedLookup,
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

function deleteHeaders(
  headers: Record<string, string> | undefined,
  names: readonly string[],
): void {
  if (!headers) return;
  const targets = new Set(names.map((n) => n.toLowerCase()));
  for (const key of Object.keys(headers)) {
    if (targets.has(key.toLowerCase())) {
      delete headers[key];
    }
  }
}

function hasHeader(
  headers: Record<string, string> | undefined,
  name: string,
): boolean {
  if (!headers) return false;
  const target = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === target);
}

async function toSafeFetchBody(
  raw: unknown,
): Promise<string | Uint8Array | undefined> {
  if (raw == null) return undefined;
  if (typeof raw === "string") return raw;
  if (raw instanceof URLSearchParams) return raw.toString();
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (ArrayBuffer.isView(raw)) {
    return Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  if (typeof Blob !== "undefined" && raw instanceof Blob) {
    return Buffer.from(await raw.arrayBuffer());
  }
  throw new TypeError(
    "guardedFetch supports string, URLSearchParams, ArrayBuffer, ArrayBufferView, or Blob bodies",
  );
}

export async function safeFetch(
  targetUrl: string | URL,
  options: {
    method?: string;
    headers?: HeadersInit | Record<string, string>;
    body?: string | Uint8Array;
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
  timer.unref();
  const currentHeaders = normalizeHeaders(options.headers);
  let currentMethod = (options.method ?? "GET").toUpperCase();
  let currentBody = options.body;
  try {
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const combinedSignal = options.signal
        ? AbortSignal.any([controller.signal, options.signal])
        : controller.signal;
      const prevUrlObj = new URL(currentUrl);
      const response = await fetchViaNodeHttp(prevUrlObj, {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        signal: combinedSignal,
        allowPrivate,
      });
      if (response.status >= 300 && response.status < 400) {
        if (response.status === 304) {
          return { response, finalUrl: currentUrl };
        }
        const location = response.headers.get("location");
        if (!location || options.redirect === "manual") {
          return { response, finalUrl: currentUrl };
        }
        void response.body?.cancel().catch(() => undefined);
        if (options.redirect === "error") {
          throw new AppError("Redirect not allowed", 502);
        }
        const nextUrlObj = new URL(location, currentUrl);
        currentUrl = nextUrlObj.toString();
        if (allowPrivate) assertHttpUrl(currentUrl);
        else await assertPublicHttpUrl(currentUrl);

        const crossOrigin =
          prevUrlObj.origin !== nextUrlObj.origin ||
          initialUrl.origin !== nextUrlObj.origin;
        if (crossOrigin) {
          deleteHeaders(currentHeaders, ["authorization"]);
        }

        const isGetOrHead = currentMethod === "GET" || currentMethod === "HEAD";
        if (
          (response.status === 301 ||
            response.status === 302 ||
            response.status === 303) &&
          !isGetOrHead
        ) {
          currentMethod = "GET";
          currentBody = undefined;
          deleteHeaders(currentHeaders, ["content-type", "content-length"]);
        } else if (
          (response.status === 307 || response.status === 308) &&
          !isGetOrHead &&
          crossOrigin
        ) {
          throw new AppError(
            "Cross-origin 307/308 redirects with a request body are not allowed",
            400,
            { code: "CROSS_ORIGIN_REDIRECT" },
          );
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

/** A `fetch` for libraries (for example the AI SDK) that sends every request and redirect through `safeFetch`. */
export function guardedFetch(opts: {
  allowPrivate: boolean;
  timeoutMs?: number;
}): typeof fetch {
  return (async (input: string | URL | globalThis.Request, init?: RequestInit) => {
    const req = input instanceof globalThis.Request ? input : null;
    const targetUrl = input instanceof globalThis.Request ? input.url : input;
    const method = init?.method ?? req?.method;
    const headers = normalizeHeaders(init?.headers ?? req?.headers);
    const callerSignal = init?.signal ?? req?.signal;
    const signal =
      callerSignal ?? AbortSignal.timeout(opts.timeoutMs ?? 120_000);

    let body: string | Uint8Array | undefined;
    if (init?.body !== undefined) {
      if (
        init.body instanceof URLSearchParams &&
        !hasHeader(headers, "content-type")
      ) {
        if (headers) {
          headers["content-type"] =
            "application/x-www-form-urlencoded;charset=UTF-8";
        }
      }
      body = await toSafeFetchBody(init.body);
    } else if (req && req.body !== null) {
      body = Buffer.from(await req.arrayBuffer());
    }

    const { response } = await safeFetch(targetUrl, {
      method,
      headers:
        init?.body instanceof URLSearchParams && !headers
          ? { "content-type": "application/x-www-form-urlencoded;charset=UTF-8" }
          : headers,
      body,
      signal,
      allowPrivate: opts.allowPrivate,
      timeoutMs: opts.timeoutMs,
    });
    return response;
  }) as typeof fetch;
}

export interface ReadCappedOptions {
  maxBytes?: number;
  timeoutMs?: number;
  signal?: AbortSignal | null;
}

export async function readBytesCapped(
  res: Response,
  opts: ReadCappedOptions = {},
): Promise<Uint8Array> {
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
