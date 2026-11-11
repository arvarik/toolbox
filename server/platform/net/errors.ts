import crypto from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";

const isTest = process.env.NODE_ENV === "test";

const logAt =
  (level: "info" | "warn" | "error" | "debug", skip = () => isTest) =>
  (scope: string, message: string, meta?: Record<string, unknown>): void => {
    if (!skip()) console[level]("[%s] %s", scope, message, ...(meta ? [meta] : []));
  };

export const log = {
  info: logAt("info"),
  warn: logAt("warn"),
  error: logAt("error"),
  debug: logAt("debug", () => isTest || process.env.NODE_ENV === "production"),
};

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

// A loop, not /\/+$/: that regex is O(n^2) and runs on every request path.
export function trimTrailingSlashes(value: string): string {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end) || "/";
}

const SENSITIVE_QUERY =
  /([?&](?:token|access_token|code|state|key|api_key|apikey|secret|password)=)[^&]*/gi;
export function redactUrlForLog(url: string): string {
  return url.replace(SENSITIVE_QUERY, "$1[redacted]");
}

export function isApiSurface(pathname: string): boolean {
  const lower = pathname.toLowerCase();
  return (
    lower === "/api" ||
    lower.startsWith("/api/") ||
    lower.startsWith("/.well-known/")
  );
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly code: string;
  public readonly details?: unknown;

  constructor(
    message: string,
    statusCode: number = 500,
    options: {
      code?: string;
      details?: unknown;
      cause?: unknown;
      isOperational?: boolean;
    } = {},
  ) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = options.isOperational ?? true;
    this.code = options.code ?? defaultCodeForStatus(statusCode);
    this.details = options.details;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

const CODE_FOR_STATUS: Partial<Record<number, string>> = {
  400: "BAD_REQUEST",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  410: "GONE",
  422: "UNPROCESSABLE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
  504: "TIMEOUT",
};

function defaultCodeForStatus(status: number): string {
  return CODE_FOR_STATUS[status] ?? (status >= 500 ? "INTERNAL" : "ERROR");
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} ${id} not found` : `${entity} not found`, 404, {
      code: "NOT_FOUND",
      details: { entity, id },
    });
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = "Forbidden", details?: unknown) {
    super(message, 403, { code: "FORBIDDEN", details });
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 400, { code: "VALIDATION_ERROR", details });
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 409, { code: "CONFLICT", details });
  }
}

export class RateLimitedError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 429, { code: "RATE_LIMITED", details });
  }
}

export class UpstreamTimeoutError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 504, { code: "UPSTREAM_TIMEOUT", details });
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function validateBody<T>(schema: ZodType<T>): RequestHandler {
  return (req, _res, next) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0]?.message ?? "Invalid request payload";
      return next(new ValidationError(firstIssue, parsed.error.issues));
    }
    req.body = parsed.data;
    next();
  };
}

export function parseQuery<T>(schema: ZodType<T>, rawQuery: unknown): T {
  const parsed = schema.safeParse(rawQuery);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0]?.message ?? "Invalid query parameters";
    throw new ValidationError(firstIssue, parsed.error.issues);
  }
  return parsed.data;
}

export function attachRequestId(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const id = crypto.randomBytes(6).toString("hex");
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}

export const CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'";

export const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=()";
export const HSTS_HEADER = "max-age=63072000; includeSubDomains";
export const MAX_JSON_DEPTH = 64;

export function assertJsonDepth(buf: Buffer, maxDepth = MAX_JSON_DEPTH): void {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (inString) {
      if (b === 0x5c) i++;
      else if (b === 0x22) inString = false;
      continue;
    }
    if (b === 0x22) inString = true;
    else if (b === 0x7b || b === 0x5b) {
      if (++depth > maxDepth) {
        throw new ValidationError(
          `JSON nesting depth exceeds maximum of ${maxDepth}`,
        );
      }
    } else if (b === 0x7d || b === 0x5d) {
      if (depth > 0) depth--;
    }
  }
}

export function safeJsonReviver(key: string, value: unknown): unknown {
  if (
    key === "__proto__" ||
    (key === "constructor" &&
      value !== null &&
      typeof value === "object" &&
      "prototype" in value)
  ) {
    return undefined;
  }
  return value;
}

export function securityHeaders(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  if (req.secure) {
    res.setHeader("Strict-Transport-Security", HSTS_HEADER);
  }
  next();
}

interface SqliteLikeError {
  code?: string;
  message?: string;
  type?: string;
}

interface ProviderCallError {
  name?: string;
  statusCode?: number;
  responseHeaders?: Record<string, string | undefined>;
  lastError?: unknown;
}

/** An AI SDK provider call that still failed with HTTP 429 or 5xx after the SDK's own retries. */
function failedProviderCall(err: unknown): ProviderCallError | null {
  const e = err as ProviderCallError | null;
  if (e?.name === "AI_RetryError") return failedProviderCall(e.lastError);
  const status = e?.name === "AI_APICallError" ? (e.statusCode ?? 0) : 0;
  return status === 429 || status >= 500 ? e : null;
}

function translate(err: unknown): {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  isOperational: boolean;
  cause?: unknown;
} {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      code: err.code,
      message: err.message,
      details: err.details,
      isOperational: err.isOperational,
      cause: (err as { cause?: unknown }).cause,
    };
  }
  if (err instanceof ZodError) {
    return {
      statusCode: 400,
      code: "VALIDATION_ERROR",
      message: err.issues[0]?.message ?? "Invalid request payload",
      details: err.issues,
      isOperational: true,
    };
  }
  const e = err as SqliteLikeError;
  if (e?.code?.startsWith("LIMIT_") || e?.type === "entity.too.large") {
    return {
      statusCode: 413,
      code: "PAYLOAD_TOO_LARGE",
      message: "Request body exceeds the size limit for this endpoint",
      isOperational: true,
    };
  }
  if (e?.type === "entity.parse.failed") {
    return {
      statusCode: 400,
      code: "INVALID_JSON",
      message: "Invalid JSON payload format",
      isOperational: true,
    };
  }
  if (e?.code?.startsWith("SQLITE_CONSTRAINT")) {
    return {
      statusCode: 400,
      code: "DB_CONSTRAINT",
      message: "Database constraint violation",
      details:
        process.env.NODE_ENV !== "production"
          ? { sqliteMessage: e.message }
          : undefined,
      isOperational: true,
    };
  }
  if (e?.code?.startsWith("SQLITE_BUSY") || e?.code?.startsWith("SQLITE_LOCKED")) {
    return {
      statusCode: 503,
      code: "DB_BUSY",
      message: "Database is currently busy, please retry shortly",
      isOperational: true,
    };
  }
  const provider = failedProviderCall(err);
  if (provider?.statusCode === 429) {
    const retryAfterSeconds = Number(provider.responseHeaders?.["retry-after"]);
    return {
      statusCode: 503,
      code: "AI_PROVIDER_RATE_LIMITED",
      message: "The AI provider is rate limiting this instance. Try again shortly.",
      details: retryAfterSeconds > 0 ? { retryAfterSeconds } : undefined,
      isOperational: true,
    };
  }
  if (provider) {
    return {
      statusCode: 502,
      code: "AI_PROVIDER_ERROR",
      message: `The AI provider failed with HTTP ${provider.statusCode}. Try again shortly.`,
      isOperational: true,
    };
  }
  if ((err as { name?: string } | null)?.name === "TimeoutError") {
    return {
      statusCode: 504,
      code: "UPSTREAM_TIMEOUT",
      message: "An upstream service did not answer in time. Try again shortly.",
      isOperational: true,
    };
  }
  return {
    statusCode: 500,
    code: "INTERNAL",
    message: "Internal server error",
    isOperational: false,
  };
}

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProd = process.env.NODE_ENV === "production";
  const requestId = req.requestId;
  const t = translate(err);

  if (!t.isOperational) {
    const stack = (err as Error)?.stack ?? String(err);
    log.error(
      "Unhandled",
      `[${requestId ?? "-"}] ${req.method} ${redactUrlForLog(req.originalUrl)} -> ${t.statusCode} ${t.code}: ${stack}`,
    );
  } else {
    log.warn(
      "Operational",
      `[${requestId ?? "-"}] ${req.method} ${redactUrlForLog(req.originalUrl)} -> ${t.statusCode} ${t.code}: ${t.message}`,
    );
  }

  if (res.headersSent) {
    res.end();
    return;
  }

  if ((t.statusCode === 429 || t.statusCode === 503) && !res.getHeader("Retry-After")) {
    const seconds = (t.details as { retryAfterSeconds?: unknown } | undefined)
      ?.retryAfterSeconds;
    if (typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0) {
      res.setHeader("Retry-After", String(Math.ceil(seconds)));
    }
  }

  res.status(t.statusCode).json({
    message: t.message,
    error: {
      code: t.code,
      message: t.message,
      ...(requestId ? { requestId } : {}),
      ...(t.details !== undefined ? { details: t.details } : {}),
      ...(!isProd && (err as Error)?.stack ? { stack: (err as Error).stack } : {}),
    },
  });
}

export function notFoundHandler(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isApiSurface(req.path)) {
    return next(
      new AppError(`Unknown API endpoint: ${req.method} ${req.path}`, 404, {
        code: "ROUTE_NOT_FOUND",
      }),
    );
  }
  next();
}
