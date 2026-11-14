import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import {
  APP_NAME,
  APP_SLUG,
  OIDC_COOKIE_PREFIX,
  SESSION_COOKIE,
  SESSION_HEADER,
  TOKEN_PREFIX,
} from "../../appConfig.ts";
import { sqlite } from "../db/connection.ts";
import { AppError, trimTrailingSlashes } from "../net/errors.ts";
import { isOwnOrigin } from "../net/originAndFetch.ts";
import {
  getUserById,
  resolveSession,
  resolveToken,
  type User,
} from "./authService.ts";

export type Principal =
  | { kind: "user"; user: User; via: "session"; sessionId: string }
  | {
      kind: "user";
      user: User;
      via: "token";
      tokenId: string;
      readOnly: boolean;
    }
  | { kind: "user"; user: User; via: "implicit" };

export function currentUser(req: Request): User | null {
  return req.principal?.user ?? null;
}

export function currentSessionId(req: Request): string | null {
  return req.principal?.via === "session" ? req.principal.sessionId : null;
}

let forcedAuth = false;

export function setForcedAuth(value: boolean): void {
  forcedAuth = value;
}

export function isAuthRequired(): boolean {
  return forcedAuth || process.env.AUTH_REQUIRED === "true";
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        continue;
      }
    }
  }
  return null;
}

function cookieAttributes(
  req: Request,
  maxAgeSeconds: number | null,
  path = "/",
): string {
  // Relies on req.secure (honoring TRUST_PROXY_HOPS) rather than raw X-Forwarded-Proto;
  // createApp() warns at startup and once at runtime if TLS proxy headers arrive with TRUST_PROXY_HOPS=0.
  const secure = req.secure ? "; Secure" : "";
  const maxAge = maxAgeSeconds !== null ? `; Max-Age=${maxAgeSeconds}` : "";
  return `HttpOnly; SameSite=Lax; Path=${path}${secure}${maxAge}`;
}

export function setSessionCookie(
  req: Request,
  res: Response,
  secret: string,
  expiresAt: string,
  options?: { sessionOnly?: boolean },
): void {
  const maxAge = options?.sessionOnly
    ? null
    : Math.max(
        0,
        Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000),
      );
  res.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(secret)}; ${cookieAttributes(req, maxAge)}`,
  );
}

export function clearSessionCookie(req: Request, res: Response): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`);
}

const OIDC_COOKIE_PATH = "/api/auth/oidc";

function oidcCookieName(state: string): string {
  return `${OIDC_COOKIE_PREFIX}${crypto.hash("sha256", state).slice(0, 12)}`;
}

export function setOidcFlowCookie(
  req: Request,
  res: Response,
  flow: { state: string; binding: string },
  maxAgeSeconds: number,
): void {
  res.append(
    "Set-Cookie",
    `${oidcCookieName(flow.state)}=${encodeURIComponent(flow.binding)}; ${cookieAttributes(req, maxAgeSeconds, OIDC_COOKIE_PATH)}`,
  );
}

export function clearOidcFlowCookie(
  req: Request,
  res: Response,
  state: string,
): void {
  setOidcFlowCookie(req, res, { state, binding: "" }, 0);
}

export function presentedOidcBinding(req: Request, state: string): string | null {
  return readCookie(req, oidcCookieName(state));
}

export function presentedSessionSecret(req: Request): string | null {
  const fromCookie = readCookie(req, SESSION_COOKIE);
  if (fromCookie) return fromCookie;
  const header = req.headers[SESSION_HEADER];
  const value = Array.isArray(header) ? header[0] : header;
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

const localOwnerStmt = sqlite.prepare(
  `SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`,
);

function resolveLocalOwner(): User | null {
  const row = localOwnerStmt.get() as { id: string } | undefined;
  return row ? getUserById(row.id) : null;
}

export function attachPrincipal(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const header = req.headers.authorization;
  const presented = header?.startsWith("Bearer ")
    ? header.slice(7).trim()
    : null;

  if (presented?.startsWith(TOKEN_PREFIX)) {
    const resolved = resolveToken(presented);
    if (resolved) {
      req.principal = {
        kind: "user",
        user: resolved.user,
        via: "token",
        tokenId: resolved.tokenId,
        readOnly: resolved.readOnly,
      };
      return next();
    }
  }

  const secret = presentedSessionSecret(req);
  if (secret) {
    const resolved = resolveSession(secret);
    if (resolved && resolved.user.status !== "disabled") {
      req.principal = {
        kind: "user",
        user: resolved.user,
        via: "session",
        sessionId: resolved.sessionId,
      };
      return next();
    }
  }

  if (!isAuthRequired()) {
    const owner = resolveLocalOwner();
    if (owner) {
      req.principal = { kind: "user", user: owner, via: "implicit" };
      return next();
    }
  }

  next();
}

export function isAuthenticated(req: Request): boolean {
  return req.principal !== undefined;
}

export function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (isAuthenticated(req)) return next();
  const sentToken = req.headers.authorization?.startsWith("Bearer ") === true;
  res.setHeader(
    "WWW-Authenticate",
    [
      `Bearer realm="${APP_SLUG}"`,
      ...(sentToken ? ['error="invalid_token"'] : []),
    ].join(", "),
  );
  next(
    new AppError(
      sentToken
        ? "This token is not valid. It may be revoked or expired. Create a new one in Settings -> Account -> API tokens."
        : "Authentication required. Sign in, or send a token as Authorization: Bearer <token>.",
      401,
      { code: "UNAUTHORIZED" },
    ),
  );
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const PASSWORD_CHANGE_EXEMPT = new Set([
  "/api/auth/status",
  "/api/auth/setup",
  "/api/auth/login",
  "/api/auth/logout",
  "/api/auth/change-password",
]);

export function requirePasswordCurrent(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const user = req.principal?.user;
  if (!user || user.mustChangePassword !== 1) return next();

  const pathOnly = trimTrailingSlashes(req.originalUrl.split("?")[0].toLowerCase());
  if (
    PASSWORD_CHANGE_EXEMPT.has(pathOnly) ||
    (pathOnly === "/api/auth/me" && READ_METHODS.has(req.method))
  ) {
    return next();
  }

  next(
    new AppError(
      "Set a new password before you use this instance. The one you were given is temporary.",
      403,
      { code: "PASSWORD_CHANGE_REQUIRED" },
    ),
  );
}

const READ_ONLY_DENIED_GET_PATHS: ReadonlyArray<string | RegExp> = [
  "/api/chat/starters",
  /^\/api\/drills\/challenge\//,
];

function isReadOnlyDeniedGet(path: string): boolean {
  return READ_ONLY_DENIED_GET_PATHS.some((pattern) =>
    typeof pattern === "string" ? path === pattern : pattern.test(path),
  );
}

export function guardReadOnlyToken(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const principal = req.principal;
  if (principal?.via !== "token" || !principal.readOnly) return next();

  const path = trimTrailingSlashes(req.originalUrl.split("?")[0].toLowerCase());
  const blockedGet =
    (req.method === "GET" || req.method === "HEAD") && isReadOnlyDeniedGet(path);
  if (!blockedGet && (READ_METHODS.has(req.method) || (req.method === "POST" && path === "/api/mcp"))) {
    return next();
  }

  next(
    new AppError(
      "This token is read-only. Create a token with read and write access to change data.",
      403,
      { code: "TOKEN_READ_ONLY" },
    ),
  );
}

export function requireSession(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (req.principal?.via === "session") return next();
  if (!isAuthRequired() && req.principal?.via === "implicit") return next();
  if (req.principal) {
    return next(
      new AppError(
        "This endpoint needs a signed-in session, not a token.",
        403,
        { code: "SESSION_REQUIRED" },
      ),
    );
  }
  next(new AppError("Authentication required", 401, { code: "UNAUTHORIZED" }));
}

export function adminRefusal(req: Request): AppError | null {
  const principal = req.principal;
  if (!principal) {
    return new AppError("Authentication required", 401, {
      code: "UNAUTHORIZED",
    });
  }
  if (principal.user.role !== "admin") {
    return new AppError("This endpoint needs an admin account.", 403, {
      code: "ADMIN_REQUIRED",
    });
  }
  if (principal.via === "session") return null;
  if (principal.via === "implicit" && !isAuthRequired()) return null;
  return new AppError(
    "Instance administration needs a signed-in session. A token cannot use it.",
    403,
    { code: "SESSION_REQUIRED" },
  );
}

export function requireAdmin(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const refused = adminRefusal(req);
  if (refused) return next(refused);
  next();
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function refuseCrossSiteWrites(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const ambient =
    req.principal?.via === "implicit" ||
    (req.principal?.via === "session" && Boolean(readCookie(req, SESSION_COOKIE)));
  if (!ambient || !WRITE_METHODS.has(req.method)) {
    return next();
  }
  const origin = req.headers.origin;
  const site = req.headers["sec-fetch-site"];
  const own = origin
    ? isOwnOrigin(req, origin)
    : site === undefined || site === "same-origin" || site === "none";
  if (own) return next();
  next(
    new AppError(
      origin
        ? `This request came from ${origin}, which is not the server's address. Set PUBLIC_URL if you opened ${APP_NAME} there.`
        : "This request came from another site, so it was refused.",
      403,
      { code: "CROSS_SITE_REQUEST" },
    ),
  );
}
