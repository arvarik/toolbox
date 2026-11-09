import net from "node:net";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "./errors.ts";

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
  const name = stripBracketsAndPort(hostHeader);
  if (!name) return false;
  if (net.isIP(name) !== 0) return true;
  if (!name.includes(".")) return true;
  const { exact, suffixes } = getHostConfig();
  if (exact.has(name)) return true;
  return suffixes.some((s) => name.endsWith(s));
}

function isApiSurface(pathname: string): boolean {
  return (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/.well-known/")
  );
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
