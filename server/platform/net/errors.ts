import crypto from "node:crypto";
import type { Request, Response, NextFunction, RequestHandler } from "express";
import { ZodError, type ZodType } from "zod";

const isTest = process.env.NODE_ENV === "test";

export const log = {
  info(scope: string, message: string, meta?: Record<string, unknown>): void {
    if (isTest) return;
    if (meta) console.info("[%s] %s", scope, message, meta);
    else console.info("[%s] %s", scope, message);
  },
  warn(scope: string, message: string, meta?: Record<string, unknown>): void {
    if (isTest) return;
    if (meta) console.warn("[%s] %s", scope, message, meta);
    else console.warn("[%s] %s", scope, message);
  },
  error(scope: string, message: string, meta?: Record<string, unknown>): void {
    if (isTest) return;
    if (meta) console.error("[%s] %s", scope, message, meta);
    else console.error("[%s] %s", scope, message);
  },
  debug(scope: string, message: string, meta?: Record<string, unknown>): void {
    if (isTest || process.env.NODE_ENV === "production") return;
    if (meta) console.debug("[%s] %s", scope, message, meta);
    else console.debug("[%s] %s", scope, message);
  },
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

const SENSITIVE_QUERY = /([?&](?:token|code|state|key|secret)=)[^&]*/gi;
export function redactUrlForLog(url: string): string {
  return url.replace(SENSITIVE_QUERY, "$1[redacted]");
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

function defaultCodeForStatus(status: number): string {
  switch (status) {
    case 400:
      return "BAD_REQUEST";
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 410:
      return "GONE";
    case 422:
      return "UNPROCESSABLE";
    case 429:
      return "RATE_LIMITED";
    case 503:
      return "SERVICE_UNAVAILABLE";
    case 504:
      return "TIMEOUT";
    default:
      return status >= 500 ? "INTERNAL" : "ERROR";
  }
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

export class ServiceUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 503, { code: "SERVICE_UNAVAILABLE", details });
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

export function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  next();
}

interface SqliteLikeError {
  code?: string;
  message?: string;
  type?: string;
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

  if (t.statusCode === 429 && !res.getHeader("Retry-After")) {
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
  if (
    req.path === "/api" ||
    req.path.startsWith("/api/") ||
    req.path.startsWith("/.well-known/")
  ) {
    return next(
      new AppError(`Unknown API endpoint: ${req.method} ${req.path}`, 404, {
        code: "ROUTE_NOT_FOUND",
      }),
    );
  }
  next();
}
