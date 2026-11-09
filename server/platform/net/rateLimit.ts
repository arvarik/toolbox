import type { Request, Response, NextFunction } from "express";
import { RateLimitedError, trimTrailingSlashes } from "./errors.ts";

export const MAX_BUCKETS = 10_000;

interface WindowState {
  count: number;
  resetAt: number;
}

export interface RateLimiter {
  (req: Request, res: Response, next: NextFunction): void;
  reset(): void;
  size(): number;
}

export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  name: string;
  keyBy?: (req: Request) => string | null;
  maxBuckets?: number;
}): RateLimiter {
  const { windowMs, max, name, keyBy, maxBuckets = MAX_BUCKETS } = options;
  const bucketCap = Math.max(1, maxBuckets);
  const windows = new Map<string, WindowState>();

  const middleware = (
    req: Request,
    _res: Response,
    next: NextFunction,
  ): void => {
    const now = Date.now();
    const key = keyBy ? keyBy(req) : (req.ip ?? "unknown");
    if (key === null) return next();

    const state = windows.get(key);
    if (!state || state.resetAt <= now) {
      if (state) windows.delete(key);
      // Map insertion order is monotonic by resetAt: sweep expired front entries in O(expired)
      for (const [k, v] of windows) {
        if (v.resetAt <= now) windows.delete(k);
        else break;
      }
      while (windows.size >= bucketCap) {
        const oldest = windows.keys().next().value;
        if (oldest === undefined) break;
        windows.delete(oldest);
      }
      windows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    state.count += 1;
    if (state.count > max) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((state.resetAt - now) / 1000),
      );
      return next(
        new RateLimitedError(
          `Too many requests to ${name} - retry in ${retryAfterSeconds}s`,
          { retryAfterSeconds },
        ),
      );
    }
    next();
  };

  middleware.reset = () => windows.clear();
  middleware.size = () => windows.size;
  return middleware;
}

/**
 * Data-driven cost rate limiters: domain code passes `patterns` (Modularity Convention #3)
 * so `platform/` never hardcodes domain route regexes.
 */
export function createCostRateLimiters(patterns: readonly RegExp[]) {
  const isCostPath = (path: string): boolean => {
    const normalized = trimTrailingSlashes(path.toLowerCase());
    return patterns.some((p) => p.test(normalized));
  };

  const perIpLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 60,
    name: "AI endpoints",
  });

  const perUserLimiter = createRateLimiter({
    windowMs: 60_000,
    max: 30,
    name: "AI endpoints for this account",
    keyBy: (req) => req.principal?.user.id ?? null,
  });

  return {
    isCostPath,
    perIp(req: Request, res: Response, next: NextFunction): void {
      if (isCostPath(req.path)) return perIpLimiter(req, res, next);
      next();
    },
    perUser(req: Request, res: Response, next: NextFunction): void {
      if (isCostPath(req.path)) return perUserLimiter(req, res, next);
      next();
    },
    reset(): void {
      perIpLimiter.reset();
      perUserLimiter.reset();
    },
  };
}
