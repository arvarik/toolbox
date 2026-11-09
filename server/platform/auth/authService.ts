import crypto from "node:crypto";
import type {
  ApiToken,
  InvitationStatus,
  InvitationSummary,
  PublicUser,
  SessionMethod,
} from "../../../shared/platform/auth.ts";
import { TOKEN_PREFIX } from "../../appConfig.ts";
import { auditService } from "../audit/auditService.ts";
import { sqlite } from "../db/connection.ts";
import { mailService, renderInvitationEmail } from "../mail/mailService.ts";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  log,
} from "../net/errors.ts";
import { mailLinkOrigin } from "../net/originAndFetch.ts";
import { getSetting, setSetting } from "../settings/settingsService.ts";
import {
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
} from "./passwords.ts";

export const SESSION_TTL_SETTING = "auth.sessionTtlDays";
export const DEFAULT_SESSION_TTL_DAYS = 30;
export const MIN_SESSION_TTL_DAYS = 1;
export const MAX_SESSION_TTL_DAYS = 365;
export const REGISTRATION_SETTING = "auth.registrationOpen";
export const MAGIC_LINK_SETTING = "auth.magicLinkSignIn";
export const INSTANCE_NAME_SETTING = "instance.name";
export const INSTANCE_NAME_MAX = 60;

const USER_AGENT_MAX = 200;

export function getSessionTtlDays(): number {
  const stored = getSetting<number>(SESSION_TTL_SETTING);
  if (typeof stored !== "number" || !Number.isFinite(stored)) {
    return DEFAULT_SESSION_TTL_DAYS;
  }
  return Math.min(
    MAX_SESSION_TTL_DAYS,
    Math.max(MIN_SESSION_TTL_DAYS, Math.round(stored)),
  );
}

export function setSessionTtlDays(value: unknown): number {
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days) || !Number.isInteger(days)) {
    throw new ValidationError("Session length must be a whole number of days.");
  }
  if (days < MIN_SESSION_TTL_DAYS || days > MAX_SESSION_TTL_DAYS) {
    throw new ValidationError(
      `Session length must be between ${MIN_SESSION_TTL_DAYS} and ${MAX_SESSION_TTL_DAYS} days.`,
    );
  }
  setSetting(SESSION_TTL_SETTING, days);
  return days;
}

export function isRegistrationOpen(): boolean {
  return getSetting<boolean>(REGISTRATION_SETTING) === true;
}

export function setRegistrationOpen(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError("Registration must be on or off.");
  }
  setSetting(REGISTRATION_SETTING, value);
  return value;
}

export function isMagicLinkSignIn(): boolean {
  return getSetting<boolean>(MAGIC_LINK_SETTING) === true;
}

export function setMagicLinkSignIn(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new ValidationError("Magic link sign-in must be on or off.");
  }
  setSetting(MAGIC_LINK_SETTING, value);
  return value;
}

export function getInstanceName(): string {
  const stored = getSetting<string>(INSTANCE_NAME_SETTING);
  return typeof stored === "string" ? stored.slice(0, INSTANCE_NAME_MAX) : "";
}

export function setInstanceName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("The instance name must be text.");
  }
  const cleaned = value.replace(/\p{Cc}/gu, " ").trim();
  if (cleaned.length > INSTANCE_NAME_MAX) {
    throw new ValidationError(
      `The instance name must be ${INSTANCE_NAME_MAX} characters or fewer.`,
    );
  }
  setSetting(INSTANCE_NAME_SETTING, cleaned);
  return cleaned;
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
  status: string;
  credentialState: string;
  mustChangePassword: number;
  passwordChangedAt: string | null;
  disabledAt: string | null;
  createdBy: string | null;
  avatarUrl: string | null;
}

interface UserRow extends User {
  passwordHash: string;
}

export interface SessionInfo {
  id: string;
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string;
  userAgent: string | null;
  method: string | null;
  current: boolean;
}

export function publicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    status: user.status,
    credentialState: user.credentialState,
    mustChangePassword: user.mustChangePassword === 1,
    avatarUrl: user.avatarUrl ?? null,
  };
}

const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESERVED_USERNAMES = new Set(["local"]);

export function normalizeUsername(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

export function validateUsername(username: string): string | null {
  if (!username) return "Enter a username.";
  if (username.length < 2) return "Usernames need at least 2 characters.";
  if (username.length > 32) return "Usernames can be at most 32 characters.";
  if (!USERNAME_PATTERN.test(username)) {
    return "Use lowercase letters, numbers, dots, dashes and underscores; start and end with a letter or number.";
  }
  if (RESERVED_USERNAMES.has(username)) return "That username is reserved.";
  return null;
}

export function validateEmail(email: string): string | null {
  if (!email) return "Enter an email address.";
  if (email.length > 254) return "That email address is too long.";
  if (!EMAIL_PATTERN.test(email)) return "Enter a valid email address.";
  return null;
}

const USER_COLUMNS = `id, email, username, displayName, passwordHash, role,
                      createdAt, updatedAt, lastLoginAt,
                      status, credentialState, mustChangePassword,
                      passwordChangedAt, disabledAt, createdBy, avatarUrl`;

const stmts = {
  sessionById: sqlite.prepare(
    `SELECT userId, expiresAt, lastSeenAt FROM sessions WHERE id = ?`,
  ),
  deleteSessionById: sqlite.prepare(`DELETE FROM sessions WHERE id = ?`),
  touchSession: sqlite.prepare(
    `UPDATE sessions SET lastSeenAt = CURRENT_TIMESTAMP WHERE id = ?`,
  ),
  userById: sqlite.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`),
};

function stripHash(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastLoginAt: row.lastLoginAt,
    status: row.status,
    credentialState: row.credentialState,
    mustChangePassword: row.mustChangePassword,
    passwordChangedAt: row.passwordChangedAt,
    disabledAt: row.disabledAt,
    createdBy: row.createdBy,
    avatarUrl: row.avatarUrl ?? null,
  };
}

export function countUsers(): number {
  return (sqlite.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number })
    .n;
}

export function getUserById(id: string): User | null {
  const row = stmts.userById.get(id) as UserRow | undefined;
  return row ? stripHash(row) : null;
}

function findUserRowByIdentifier(identifier: string): UserRow | undefined {
  const value = identifier.trim().toLowerCase();
  if (!value) return undefined;
  return sqlite
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users WHERE username = ? OR email = ? LIMIT 1`,
    )
    .get(value, value) as UserRow | undefined;
}

export function accountIdForIdentifier(identifier: string): string | null {
  return findUserRowByIdentifier(identifier)?.id ?? null;
}

function assertIdentifiersFree(
  email: string,
  username: string,
  exceptUserId: string | null,
): void {
  const clash = sqlite
    .prepare(
      `SELECT id FROM users WHERE (email = ? OR username = ?) AND id IS NOT ? LIMIT 1`,
    )
    .get(email, username, exceptUserId) as { id: string } | undefined;
  if (clash) {
    throw new ConflictError("That username or email address is already taken.");
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string" &&
    (err as { code: string }).code.startsWith("SQLITE_CONSTRAINT")
  );
}

export async function createUser(input: {
  email: unknown;
  username: unknown;
  password: unknown;
  displayName?: unknown;
  role?: string;
  createdBy?: string | null;
  mustChangePassword?: boolean;
  setupOnly?: boolean;
  emailTrusted?: boolean;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);

  const emailError = validateEmail(email);
  if (emailError) throw new ValidationError(emailError);
  const usernameError = validateUsername(username);
  if (usernameError) throw new ValidationError(usernameError);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new ValidationError(passwordError);

  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim().slice(0, 100)
      : null;

  assertIdentifiersFree(email, username, null);

  const passwordHash = await hashPassword(input.password as string);
  const id = crypto.randomUUID();

  const created = sqlite.transaction(() => {
    const isFirst = countPasswordAccounts() === 0 && !hasLocalOwner();
    if (input.setupOnly && countPasswordAccounts() > 0) {
      throw new AppError(
        "This instance already has an account. Sign in instead.",
        409,
        { code: "SETUP_COMPLETE" },
      );
    }
    const role = isFirst || input.setupOnly
      ? "admin"
      : input.role === "admin"
        ? "admin"
        : "member";
    try {
      sqlite
        .prepare(
          `INSERT INTO users (id, email, username, displayName, passwordHash, role,
                              createdBy, mustChangePassword, passwordChangedAt,
                              emailTrustedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP,
                   CASE WHEN ? THEN CURRENT_TIMESTAMP END)`,
        )
        .run(
          id,
          email,
          username,
          displayName,
          passwordHash,
          role,
          input.createdBy ?? null,
          input.mustChangePassword ? 1 : 0,
          input.emailTrusted ? 1 : 0,
        );
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictError(
          "That username or email address is already taken.",
        );
      }
      throw err;
    }
    return getUserById(id)!;
  })();

  log.info("Auth", `Created ${created.role} account ${created.id}`);
  return created;
}

const DUMMY_HASH =
  "scrypt$65536$8$1$" +
  crypto.randomBytes(16).toString("base64") +
  "$" +
  crypto.randomBytes(64).toString("base64");

export async function verifyCredentials(
  identifier: string,
  password: unknown,
): Promise<User | null> {
  const row = findUserRowByIdentifier(identifier);
  if (typeof password !== "string" || !password) return null;

  if (!row) {
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }

  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;

  if (needsRehash(row.passwordHash)) {
    try {
      const upgraded = await hashPassword(password);
      sqlite
        .prepare(
          `UPDATE users SET passwordHash = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(upgraded, row.id);
    } catch (err) {
      log.warn("Auth", `Password hash upgrade failed: ${String(err)}`);
    }
  }

  if (row.status !== "disabled") {
    sqlite
      .prepare(`UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(row.id);
  }

  return stripHash(row);
}

export async function assertCurrentPassword(
  id: string,
  password: unknown,
): Promise<UserRow> {
  const row = sqlite
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(id) as UserRow | undefined;
  if (!row) throw new AppError("Account not found", 404);
  const ok =
    typeof password === "string" &&
    (await verifyPassword(password, row.passwordHash));
  if (!ok) {
    throw new AppError("That is not your current password.", 401, {
      code: "INVALID_CREDENTIALS",
    });
  }
  return row;
}

export type AuthLinkKind = "reset" | "magic" | "email";

export interface AuthLinkRow {
  id: string;
  kind: AuthLinkKind;
  userId: string;
  tokenHash: string;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  requestIp: string | null;
  email: string | null;
}

export const RESET_LINK_TTL_SECONDS = 3600;
export const MAGIC_LINK_TTL_SECONDS = 900;
export const ADMIN_RESET_LINK_TTL_SECONDS = 86400;
export const EMAIL_CHANGE_LINK_TTL_SECONDS = 86400;
export const HOURLY_CREATION_CAP = 3;

function sha256(value: string): string {
  return crypto.hash("sha256", value);
}

function revokeUnusedAuthLinks(userId: string, kind?: AuthLinkKind): void {
  sqlite
    .prepare(
      `UPDATE auth_links SET usedAt = CURRENT_TIMESTAMP
        WHERE userId = ? AND usedAt IS NULL AND (? IS NULL OR kind = ?)`,
    )
    .run(userId, kind ?? null, kind ?? null);
}

export function createAuthLink(
  kind: AuthLinkKind,
  userId: string,
  ttlSeconds: number,
  createdBy?: string | null,
  requestIp?: string | null,
  email?: string | null,
): { id: string; token: string; expiresAt: string } | null {
  if (!createdBy) {
    const recent = sqlite
      .prepare(
        `SELECT COUNT(*) AS count FROM auth_links
         WHERE userId = ? AND datetime(createdAt) > datetime('now', '-1 hour')`,
      )
      .get(userId) as { count: number };
    if (recent.count >= HOURLY_CREATION_CAP) return null;
  }
  const id = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO auth_links (id, kind, userId, tokenHash, createdBy, createdAt, expiresAt, requestIp, email)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, ?, ?)`,
    )
    .run(
      id,
      kind,
      userId,
      sha256(token),
      createdBy ?? null,
      expiresAt,
      requestIp ?? null,
      email ?? null,
    );
  return { id, token, expiresAt };
}

export function discardAuthLink(id: string): void {
  sqlite.prepare(`DELETE FROM auth_links WHERE id = ?`).run(id);
}

function parseDbDate(dateStr: string): number {
  let normalized = dateStr.trim();
  if (!normalized.includes("T") && normalized.includes(" ")) {
    normalized = normalized.replace(" ", "T");
  }
  if (!normalized.endsWith("Z") && !/[+-]\d{2}:\d{2}$/.test(normalized)) {
    normalized += "Z";
  }
  return new Date(normalized).getTime();
}

export function redeemAuthLink(kind: AuthLinkKind, token: string): AuthLinkRow {
  const row = sqlite
    .prepare(`SELECT * FROM auth_links WHERE tokenHash = ? AND kind = ?`)
    .get(sha256(token), kind) as AuthLinkRow | undefined;

  if (!row) {
    throw new AppError("That link is not valid.", 404, {
      code: "LINK_INVALID",
    });
  }
  if (row.usedAt !== null) {
    throw new AppError("That link has already been used.", 410, {
      code: "LINK_USED",
    });
  }
  if (parseDbDate(row.expiresAt) <= Date.now()) {
    throw new AppError("That link has expired.", 410, {
      code: "LINK_EXPIRED",
    });
  }

  const usedAt = new Date().toISOString();
  const res = sqlite.transaction(() => {
    const used = sqlite
      .prepare(
        `UPDATE auth_links SET usedAt = ? WHERE id = ? AND usedAt IS NULL`,
      )
      .run(usedAt, row.id);
    if (used.changes > 0 && kind !== "email") {
      sqlite
        .prepare(
          `UPDATE users SET emailTrustedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(row.userId);
    }
    return used;
  })();

  if (res.changes === 0) {
    throw new AppError("That link has already been used.", 410, {
      code: "LINK_USED",
    });
  }
  return { ...row, usedAt };
}

export async function updateUser(
  id: string,
  input: { email?: unknown; username?: unknown; displayName?: unknown },
): Promise<User> {
  const current = getUserById(id);
  if (!current) throw new AppError("Account not found", 404);

  const updates: Record<string, string | null> = {};
  if (input.email !== undefined) {
    const email = normalizeEmail(input.email);
    const error = validateEmail(email);
    if (error) throw new ValidationError(error);
    if (email !== current.email) updates.email = email;
  }
  if (input.username !== undefined) {
    const username = normalizeUsername(input.username);
    const error = validateUsername(username);
    if (error) throw new ValidationError(error);
    if (username !== current.username) updates.username = username;
  }
  if (input.displayName !== undefined) {
    const displayName =
      typeof input.displayName === "string" && input.displayName.trim()
        ? input.displayName.trim().slice(0, 100)
        : null;
    if (displayName !== current.displayName) updates.displayName = displayName;
  }

  if (Object.keys(updates).length === 0) return current;

  assertIdentifiersFree(
    (updates.email as string) ?? current.email,
    (updates.username as string) ?? current.username,
    id,
  );

  if (updates.email !== undefined) updates.emailTrustedAt = null;
  const assignments = Object.keys(updates)
    .map((k) => `${k} = ?`)
    .join(", ");
  try {
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `UPDATE users SET ${assignments}, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(...Object.values(updates), id);
      if (updates.email !== undefined) revokeUnusedAuthLinks(id);
    })();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        "That username or email address is already taken.",
      );
    }
    throw err;
  }

  return getUserById(id)!;
}

export async function changePassword(
  id: string,
  currentPassword: unknown,
  newPassword: unknown,
  keepSessionId: string | null,
): Promise<void> {
  await assertCurrentPassword(id, currentPassword);
  const error = validatePassword(newPassword);
  if (error) throw new ValidationError(error);

  const hash = await hashPassword(newPassword as string);
  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET passwordHash = ?, mustChangePassword = 0,
                passwordChangedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(hash, id);
    revokeOtherSessions(id, keepSessionId);
    revokeUnusedAuthLinks(id);
  })();
}

export function pendingEmail(userId: string): string | null {
  const row = sqlite
    .prepare(
      `SELECT email FROM auth_links
        WHERE userId = ? AND kind = 'email' AND usedAt IS NULL AND expiresAt > ?
        ORDER BY createdAt DESC LIMIT 1`,
    )
    .get(userId, new Date().toISOString()) as
    | { email: string | null }
    | undefined;
  return row?.email ?? null;
}

export function checkNewEmail(id: string, value: unknown): string {
  const current = getUserById(id);
  if (!current) throw new AppError("Account not found", 404);
  const email = normalizeEmail(value);
  const error = validateEmail(email);
  if (error) throw new ValidationError(error);
  assertIdentifiersFree(email, current.username, id);
  return email;
}

export function cancelEmailChange(userId: string): void {
  revokeUnusedAuthLinks(userId, "email");
}

export function completeEmailChange(token: string): {
  user: User;
  previousEmail: string;
} {
  const link = redeemAuthLink("email", token);
  const current = getUserById(link.userId);
  if (!current || !link.email) {
    throw new AppError("That link is not valid.", 404, {
      code: "LINK_INVALID",
    });
  }
  assertIdentifiersFree(link.email, current.username, current.id);
  try {
    sqlite.transaction(() => {
      sqlite
        .prepare(
          `UPDATE users SET email = ?, emailTrustedAt = CURRENT_TIMESTAMP,
                            updatedAt = CURRENT_TIMESTAMP
            WHERE id = ?`,
        )
        .run(link.email, current.id);
      revokeUnusedAuthLinks(current.id);
    })();
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError("That email address is already taken.");
    }
    throw err;
  }
  return { user: getUserById(current.id)!, previousEmail: current.email };
}

export function findUserByTrustedEmail(email: string): User | null {
  if (!/^[\x21-\x7e]+$/.test(email)) return null;
  const value = email.replace(/[A-Z]/g, (c) => c.toLowerCase());
  const row = sqlite
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users
        WHERE lower(email) = ? AND credentialState = 'password'
          AND emailTrustedAt IS NOT NULL
        LIMIT 1`,
    )
    .get(value) as UserRow | undefined;
  return row ? stripHash(row) : null;
}

export function findUserByEmail(email: string): User | null {
  const value = email.trim().toLowerCase();
  if (!value) return null;
  const row = sqlite
    .prepare(
      `SELECT ${USER_COLUMNS} FROM users WHERE lower(email) = ? AND credentialState = 'password' LIMIT 1`,
    )
    .get(value) as UserRow | undefined;
  return row ? stripHash(row) : null;
}

export async function resetUserPasswordWithToken(
  userId: string,
  newPassword: string,
  ip: string | null,
): Promise<User> {
  const row = sqlite
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`)
    .get(userId) as UserRow | undefined;
  if (!row) {
    throw new AppError("Account not found", 404, { code: "USER_NOT_FOUND" });
  }
  if (row.status === "disabled") {
    throw new AppError(
      "This account has been disabled. Ask an administrator to re-enable it.",
      403,
      { code: "ACCOUNT_DISABLED" },
    );
  }
  const error = validatePassword(newPassword);
  if (error) throw new ValidationError(error);
  const hash = await hashPassword(newPassword);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET passwordHash = ?, mustChangePassword = 0,
                passwordChangedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(hash, userId);
    revokeOtherSessions(userId, null);
    sqlite
      .prepare(
        `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND revokedAt IS NULL`,
      )
      .run(userId);
    revokeUnusedAuthLinks(userId);
    const removed = sqlite
      .prepare("DELETE FROM user_identities WHERE userId = ?")
      .run(userId).changes;
    if (removed > 0) {
      auditService.record({
        actorUserId: userId,
        action: "auth.oidc.unlinked",
        targetType: "user",
        targetId: userId,
        details: { reason: "password-reset", count: removed },
        ip,
      });
    }
  })();

  return stripHash(row);
}

// Sessions

export function createSession(
  userId: string,
  userAgent?: string | null,
  options?: { method?: SessionMethod | null; remember?: boolean },
): { secret: string; expiresAt: string } {
  const secret = crypto.randomBytes(32).toString("base64url");
  const ttlDays =
    options?.remember === false
      ? Math.min(getSessionTtlDays(), 1)
      : getSessionTtlDays();
  const expiresAt = new Date(
    Date.now() + ttlDays * 24 * 60 * 60 * 1000,
  ).toISOString();

  sqlite
    .prepare(
      `INSERT INTO sessions (id, userId, expiresAt, userAgent, method)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      sha256(secret),
      userId,
      expiresAt,
      userAgent ? userAgent.slice(0, USER_AGENT_MAX) : null,
      options?.method ?? null,
    );

  return { secret, expiresAt };
}

export function resolveSession(
  secret: string,
): { user: User; sessionId: string } | null {
  if (!secret) return null;
  const id = sha256(secret);
  const row = stmts.sessionById.get(id) as
    | { userId: string; expiresAt: string; lastSeenAt: string }
    | undefined;
  if (!row) return null;

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    stmts.deleteSessionById.run(id);
    return null;
  }

  const user = getUserById(row.userId);
  if (!user) {
    stmts.deleteSessionById.run(id);
    return null;
  }

  const lastSeen = new Date(row.lastSeenAt).getTime();
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60 * 60 * 1000) {
    stmts.touchSession.run(id);
  }

  return { user, sessionId: id };
}

export function destroySession(secret: string): void {
  if (!secret) return;
  stmts.deleteSessionById.run(sha256(secret));
}

export function listSessions(
  userId: string,
  currentSessionId: string | null,
): SessionInfo[] {
  const rows = sqlite
    .prepare(
      `SELECT id, createdAt, expiresAt, lastSeenAt, userAgent, method
         FROM sessions
        WHERE userId = ? AND datetime(expiresAt) > datetime('now')
        ORDER BY lastSeenAt DESC`,
    )
    .all(userId) as Omit<SessionInfo, "current">[];
  return rows.map((row) => ({ ...row, current: row.id === currentSessionId }));
}

export function revokeOtherSessions(
  userId: string,
  keepSessionId: string | null,
): number {
  return sqlite
    .prepare(`DELETE FROM sessions WHERE userId = ? AND id IS NOT ?`)
    .run(userId, keepSessionId).changes;
}

export async function convertLocalOwner(input: {
  email: unknown;
  username: unknown;
  password: unknown;
  displayName?: unknown;
}): Promise<User> {
  const email = normalizeEmail(input.email);
  const username = normalizeUsername(input.username);

  const emailError = validateEmail(email);
  if (emailError) throw new ValidationError(emailError);
  const usernameError = validateUsername(username);
  if (usernameError) throw new ValidationError(usernameError);
  const passwordError = validatePassword(input.password);
  if (passwordError) throw new ValidationError(passwordError);

  const local = sqlite
    .prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { id: string } | undefined;
  if (!local) {
    throw new AppError(
      "This instance already has an account. Sign in instead.",
      409,
      { code: "SETUP_COMPLETE" },
    );
  }

  assertIdentifiersFree(email, username, local.id);

  const displayName =
    typeof input.displayName === "string" && input.displayName.trim()
      ? input.displayName.trim().slice(0, 100)
      : null;
  const passwordHash = await hashPassword(input.password as string);

  try {
    const result = sqlite
      .prepare(
        `UPDATE users
            SET email = ?, username = ?, displayName = ?, passwordHash = ?,
                credentialState = 'password', passwordChangedAt = CURRENT_TIMESTAMP,
                role = 'admin', status = 'active', updatedAt = CURRENT_TIMESTAMP,
                emailTrustedAt = CURRENT_TIMESTAMP
          WHERE id = ? AND credentialState = 'none'`,
      )
      .run(email, username, displayName, passwordHash, local.id);

    if (result.changes === 0) {
      throw new AppError(
        "This instance already has an account. Sign in instead.",
        409,
        { code: "SETUP_COMPLETE" },
      );
    }
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new ConflictError(
        "That username or email address is already taken.",
      );
    }
    throw err;
  }

  return getUserById(local.id)!;
}

export function hasLocalOwner(): boolean {
  const row = sqlite
    .prepare(`SELECT 1 AS ok FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { ok: number } | undefined;
  return row !== undefined;
}

export function countPasswordAccounts(): number {
  return (
    sqlite
      .prepare(
        `SELECT COUNT(*) AS n FROM users WHERE credentialState = 'password'`,
      )
      .get() as { n: number }
  ).n;
}

// Personal API tokens (`tbk_...`)

const DISPLAY_PREFIX_LENGTH = 12;
const MAX_TOKEN_NAME = 60;
const MAX_TOKEN_DAYS = 3650;

export function createToken(
  user: User,
  input: { name: unknown; expiresInDays?: unknown; readOnly?: unknown },
  ip: string | null,
): {
  id: string;
  name: string;
  token: string;
  tokenPrefix: string;
  expiresAt: string | null;
  readOnly: boolean;
} {
  const name =
    typeof input.name === "string" && input.name.trim()
      ? input.name.trim().slice(0, MAX_TOKEN_NAME)
      : "";
  if (!name) throw new ValidationError("Give the token a name.");

  let expiresAt: string | null = null;
  if (input.expiresInDays !== undefined && input.expiresInDays !== null) {
    const days = Number(input.expiresInDays);
    if (!Number.isInteger(days) || days < 1 || days > MAX_TOKEN_DAYS) {
      throw new ValidationError(
        `An expiry must be a whole number of days between 1 and ${MAX_TOKEN_DAYS}.`,
      );
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  }

  const readOnly = input.readOnly === true;
  const token = `${TOKEN_PREFIX}${crypto.randomBytes(32).toString("base64url")}`;
  const id = crypto.randomUUID();
  const tokenPrefix = token.slice(0, DISPLAY_PREFIX_LENGTH);

  sqlite
    .prepare(
      `INSERT INTO api_tokens (id, userId, name, tokenHash, tokenPrefix, expiresAt, readOnly)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(id, user.id, name, sha256(token), tokenPrefix, expiresAt, readOnly ? 1 : 0);

  auditService.record({
    actorUserId: user.id,
    action: "auth.token.created",
    targetType: "token",
    targetId: id,
    details: { name, expiresAt, readOnly },
    ip,
  });

  return { id, name, token, tokenPrefix, expiresAt, readOnly };
}

export function listTokens(userId: string): ApiToken[] {
  const rows = sqlite
    .prepare(
      `SELECT id, name, tokenPrefix, createdAt, lastUsedAt, expiresAt, revokedAt, readOnly, kind
         FROM api_tokens WHERE userId = ? ORDER BY createdAt DESC`,
    )
    .all(userId) as (Omit<ApiToken, "readOnly"> & { readOnly: number })[];
  return rows.map((row) => ({ ...row, readOnly: row.readOnly === 1 }));
}

export function revokeToken(
  user: User,
  id: string,
  ip: string | null,
): { revoked: true } {
  const result = sqlite
    .prepare(
      `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND userId = ? AND revokedAt IS NULL`,
    )
    .run(id, user.id);

  if (result.changes === 0) {
    const own = sqlite
      .prepare(`SELECT id FROM api_tokens WHERE id = ? AND userId = ?`)
      .get(id, user.id) as { id: string } | undefined;
    if (!own) throw new NotFoundError("Token");
    return { revoked: true };
  }

  auditService.record({
    actorUserId: user.id,
    action: "auth.token.revoked",
    targetType: "token",
    targetId: id,
    ip,
  });
  return { revoked: true };
}

export function resolveToken(
  presented: string,
): { user: User; tokenId: string; readOnly: boolean } | null {
  const row = sqlite
    .prepare(
      `SELECT id, userId, readOnly FROM api_tokens
        WHERE tokenHash = ? AND revokedAt IS NULL AND kind = 'personal'
          AND (expiresAt IS NULL OR datetime(expiresAt) > datetime('now'))`,
    )
    .get(sha256(presented)) as
    | { id: string; userId: string; readOnly: number }
    | undefined;
  if (!row) return null;

  const user = getUserById(row.userId);
  if (!user || user.status === "disabled") return null;

  sqlite
    .prepare(
      `UPDATE api_tokens SET lastUsedAt = CURRENT_TIMESTAMP
        WHERE id = ?
          AND (lastUsedAt IS NULL OR lastUsedAt < datetime('now', '-1 hour'))`,
    )
    .run(row.id);
  return { user, tokenId: row.id, readOnly: row.readOnly === 1 };
}

// Invitations

const DEFAULT_INVITATION_DAYS = 7;
const MIN_INVITATION_DAYS = 1;
const MAX_INVITATION_DAYS = 90;

const SELECT_INVITATIONS = `
  SELECT i.id, i.email, i.role, i.createdAt, i.expiresAt, i.acceptedAt,
         i.acceptedBy, i.revokedAt, i.invitedBy, u.username AS invitedByUsername
    FROM invitations i
    LEFT JOIN users u ON u.id = i.invitedBy`;

function invitationStatusOf(row: {
  acceptedAt: string | null;
  revokedAt: string | null;
  expiresAt: string;
}): InvitationStatus {
  if (row.acceptedAt) return "accepted";
  if (row.revokedAt) return "revoked";
  if (new Date(row.expiresAt).getTime() <= Date.now()) return "expired";
  return "pending";
}

export function assertInstanceSecured(actor: User): void {
  if (actor.credentialState !== "none") return;
  throw new AppError(
    "This is the local account, which holds the data while sign-in is off. Secure the instance first.",
    409,
    { code: "LOCAL_OWNER_PROTECTED" },
  );
}

export async function createInvitation(
  ctx: { actor: User; ip: string | null },
  input: {
    email?: string | null;
    role: "admin" | "member";
    expiresInDays?: number;
    send?: boolean;
  },
  origin: string,
): Promise<{ id: string; link: string; expiresAt: string; sent: boolean }> {
  assertInstanceSecured(ctx.actor);
  const days = Math.min(
    MAX_INVITATION_DAYS,
    Math.max(
      MIN_INVITATION_DAYS,
      input.expiresInDays ?? DEFAULT_INVITATION_DAYS,
    ),
  );
  const secret = crypto.randomBytes(32).toString("base64url");
  const id = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const email = input.email?.trim().toLowerCase() || null;

  sqlite
    .prepare(
      `INSERT INTO invitations (id, email, role, tokenHash, invitedBy, expiresAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(id, email, input.role, sha256(secret), ctx.actor.id, expiresAt);

  const link = `${origin}/join?token=${secret}`;
  let sent = false;

  if (input.send && email) {
    const mailOrigin = mailLinkOrigin();
    if (mailService.isConfigured() && mailOrigin) {
      const template = renderInvitationEmail({
        instanceName: getInstanceName(),
        link: `${mailOrigin}/join?token=${secret}`,
        role: input.role,
        expiresAt,
      });
      sent = await mailService.send({ to: email, ...template });
    }
  }

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.invited",
    targetType: "invitation",
    targetId: id,
    details: { email, role: input.role, expiresAt, sent },
    ip: ctx.ip,
  });

  return { id, link, expiresAt, sent };
}

export function listInvitations(): InvitationSummary[] {
  const rows = sqlite
    .prepare(`${SELECT_INVITATIONS} ORDER BY i.createdAt DESC`)
    .all() as Omit<InvitationSummary, "status">[];
  return rows.map((row) => ({ ...row, status: invitationStatusOf(row) }));
}

export function revokeInvitation(
  ctx: { actor: User; ip: string | null },
  id: string,
): { revoked: true } {
  const row = sqlite
    .prepare(`SELECT id, acceptedAt FROM invitations WHERE id = ?`)
    .get(id) as { id: string; acceptedAt: string | null } | undefined;
  if (!row) throw new NotFoundError("Invitation", id);

  if (row.acceptedAt) {
    throw new AppError(
      "This invitation has already been accepted. Disable the account instead.",
      409,
      { code: "INVITATION_USED" },
    );
  }

  sqlite
    .prepare(
      `UPDATE invitations SET revokedAt = CURRENT_TIMESTAMP
        WHERE id = ? AND revokedAt IS NULL`,
    )
    .run(id);

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.invitation.revoked",
    targetType: "invitation",
    targetId: id,
    ip: ctx.ip,
  });
  return { revoked: true };
}

function unknownInvitation(): AppError {
  return new AppError("That invitation link is not valid.", 404, {
    code: "INVITATION_NOT_FOUND",
  });
}

function deadInvitation(status: InvitationStatus): AppError {
  const message: Record<string, [string, string]> = {
    accepted: ["INVITATION_USED", "That invitation has already been used."],
    revoked: ["INVITATION_REVOKED", "That invitation was revoked."],
    expired: ["INVITATION_EXPIRED", "That invitation has expired."],
  };
  const [code, text] = message[status] ?? [
    "INVITATION_USED",
    "That invitation cannot be used.",
  ];
  return new AppError(`${text} Ask an administrator for a new link.`, 410, {
    code,
  });
}

function pendingInvitation(token: unknown) {
  if (typeof token !== "string" || !token) throw unknownInvitation();
  const row = sqlite
    .prepare(
      `SELECT id, email, role, invitedBy, acceptedAt, revokedAt, expiresAt
         FROM invitations WHERE tokenHash = ?`,
    )
    .get(sha256(token)) as
    | {
        id: string;
        email: string | null;
        role: string;
        invitedBy: string | null;
        acceptedAt: string | null;
        revokedAt: string | null;
        expiresAt: string;
      }
    | undefined;
  if (!row) throw unknownInvitation();
  const status = invitationStatusOf(row);
  if (status !== "pending") throw deadInvitation(status);
  return row;
}

export function checkInvitation(token: unknown): void {
  pendingInvitation(token);
}

export async function acceptInvitation(
  input: {
    token: unknown;
    email: unknown;
    username: unknown;
    password: unknown;
    displayName?: unknown;
  },
  ip: string | null,
): Promise<User> {
  const row = pendingInvitation(input.token);
  const user = await createUser({
    email: input.email,
    username: input.username,
    password: input.password,
    displayName: input.displayName,
    role: row.role === "admin" ? "admin" : "member",
    createdBy: row.invitedBy,
    emailTrusted:
      row.email !== null && normalizeEmail(input.email) === row.email,
  });

  const claimed = sqlite
    .prepare(
      `UPDATE invitations
          SET acceptedAt = CURRENT_TIMESTAMP, acceptedBy = ?
        WHERE id = ? AND acceptedAt IS NULL AND revokedAt IS NULL`,
    )
    .run(user.id, row.id);
  if (claimed.changes === 0) {
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(user.id);
    throw deadInvitation("accepted");
  }

  auditService.record({
    actorUserId: user.id,
    action: "user.invitation.accepted",
    targetType: "invitation",
    targetId: row.id,
    details: { username: user.username, role: user.role },
    ip,
  });

  return user;
}
