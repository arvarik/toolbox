import net from "node:net";
import type { Request, Response, NextFunction } from "express";
import { AppError, isApiSurface } from "./errors.ts";
import { isOwnOrigin, validatePublicUrl } from "./originAndFetch.ts";

interface HostConfig {
  key: string;
  exact: Set<string>;
  suffixes: string[];
}

let cached: HostConfig | null = null;

function stripBracketsAndPort(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return "";
  if (trimmed.startsWith("[")) {
    const close = trimmed.indexOf("]");
    return close === -1 ? "" : trimmed.slice(1, close);
  }
  const firstColon = trimmed.indexOf(":");
  const lastColon = trimmed.lastIndexOf(":");
  if (firstColon !== -1 && firstColon === lastColon) {
    return trimmed.slice(0, firstColon);
  }
  return trimmed;
}

function getHostConfig(): HostConfig {
  const pubOrigin = process.env.PUBLIC_ORIGIN ?? "";
  const pubUrl = process.env.PUBLIC_URL ?? "";
  const allowedEnv = process.env.ALLOWED_HOSTS ?? "";
  const key = `${pubOrigin}|${pubUrl}|${allowedEnv}`;
  if (cached && cached.key === key) return cached;

  const exact = new Set<string>(["localhost"]);
  const suffixes = [".localhost", ".local"];

  for (const rawUrl of [pubOrigin, pubUrl]) {
    if (!rawUrl.trim()) continue;
    try {
      const host = stripBracketsAndPort(new URL(rawUrl.trim()).hostname);
      if (host) exact.add(host);
    } catch {
      // Invalid URL env is surfaced by validatePublicUrl elsewhere.
    }
  }

  for (const token of allowedEnv.split(",")) {
    const entry = token.trim().toLowerCase();
    if (!entry) continue;
    if (entry.startsWith(".")) {
      suffixes.push(entry);
    } else {
      const host = stripBracketsAndPort(entry);
      if (host) exact.add(host);
    }
  }

  cached = { key, exact, suffixes };
  return cached;
}

export function __resetHostGuard(): void {
  cached = null;
}

export function isHostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return true;
  if (hostHeader.includes(",")) return false;
  const name = stripBracketsAndPort(hostHeader);
  if (!name) return false;
  const ipKind = net.isIP(name);
  if (hostHeader.trimStart().startsWith("[")) return ipKind === 6;
  if (ipKind !== 0) return true;
  if (!/^[a-z0-9._-]+$/.test(name)) return false;
  if (!name.includes(".")) return true;
  const { exact, suffixes } = getHostConfig();
  if (exact.has(name)) return true;
  return suffixes.some((s) => name.endsWith(s));
}

/**
 * DNS-rebinding Host-header guard (essential when AUTH_REQUIRED=false).
 * Rejects forged multi-label Host headers (e.g. `evil-rebind.com`) with 403.
 */
export function hostGuard(req: Request, _res: Response, next: NextFunction): void {
  if (!isApiSurface(req.path)) return next();
  if (isHostAllowed(req.headers.host)) return next();
  next(
    new AppError("Request Host header is not allowed.", 403, {
      code: "HOST_NOT_ALLOWED",
    }),
  );
}

function configuredCorsOrigin(): string | null {
  const raw = process.env.CORS_ORIGIN?.trim();
  if (!raw || raw === "*") return null;
  try {
    return validatePublicUrl(raw);
  } catch {
    return null;
  }
}

/**
 * MCP Streamable HTTP Origin guard (2025-2026 MCP security specification).
 * Native CLI/desktop MCP clients send no `Origin` header and pass through.
 * Browser-initiated requests carry `Origin` and are accepted ONLY when the
 * origin is `http://` or `https://` and matches this server's own origin
 * (`Host` / `PUBLIC_URL` / `PUBLIC_ORIGIN`) or explicit `CORS_ORIGIN`.
 */
export function mcpOriginGuard(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const origin = req.headers.origin;
  if (!origin) return next();

  const trimmed = origin.trim();
  const isHttpScheme =
    trimmed.startsWith("http://") || trimmed.startsWith("https://");

  if (isHttpScheme && isOwnOrigin(req, trimmed)) {
    return next();
  }

  const allowedCors = configuredCorsOrigin();
  if (isHttpScheme && allowedCors !== null && trimmed === allowedCors) {
    res.setHeader("Access-Control-Allow-Origin", allowedCors);
    res.vary("Origin");
    return next();
  }

  next(
    new AppError(
      `The MCP server does not accept requests from origin "${trimmed}". Set CORS_ORIGIN to allow a trusted web client.`,
      403,
      { code: "ORIGIN_NOT_ALLOWED" },
    ),
  );
}
