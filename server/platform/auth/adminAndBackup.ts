import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import type {
  BackupInfo,
  BackupVerification,
} from "../../../shared/platform/auth.ts";
import { BACKUPS_DIR, BACKUP_FILE_PREFIX, UPLOADS_DIR } from "../../appConfig.ts";
import { auditService } from "../audit/auditService.ts";
import { getOwnerDataHooks, sqlite } from "../db/connection.ts";
import {
  AppError,
  NotFoundError,
  ValidationError,
  getErrorMessage,
  log,
} from "../net/errors.ts";
import {
  SETTING_KEYS,
  getSetting,
  setSetting,
} from "../settings/settingsService.ts";
import {
  assertInstanceSecured,
  createUser as createAccount,
  revokeOtherSessions,
  type User,
} from "./authService.ts";
import { isAuthRequired } from "./authMiddleware.ts";
import { hashPassword } from "./passwords.ts";

// ============================================================================
// Admin Account Management
// ============================================================================

export interface AdminContext {
  actor: User;
  ip: string | null;
}

export interface AdminUserSummary {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  credentialState: string;
  mustChangePassword: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  itemCount: number;
  sessionCount: number;
  tokenCount: number;
  isLocalOwner: boolean;
  isSelf: boolean;
  avatarUrl: string | null;
}

const USER_LIST_SQL = `SELECT id, email, username, displayName, role, status,
                              credentialState, mustChangePassword, createdAt,
                              lastLoginAt, passwordChangedAt, avatarUrl
                         FROM users`;

interface UserListRow {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  status: string;
  credentialState: string;
  mustChangePassword: number;
  createdAt: string;
  lastLoginAt: string | null;
  passwordChangedAt: string | null;
  avatarUrl: string | null;
}

function scalar(sql: string, ...params: unknown[]): number {
  return (sqlite.prepare(sql).get(...params) as { n: number }).n;
}

function countByKey(sql: string): Map<string, number> {
  const rows = sqlite.prepare(sql).all() as { k: string | null; n: number }[];
  const out = new Map<string, number>();
  for (const row of rows) if (row.k) out.set(row.k, row.n);
  return out;
}

function toSummary(
  row: UserListRow,
  selfId: string,
): Omit<AdminUserSummary, "itemCount" | "sessionCount" | "tokenCount"> {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.displayName,
    role: row.role,
    status: row.status,
    credentialState: row.credentialState,
    mustChangePassword: row.mustChangePassword === 1,
    createdAt: row.createdAt,
    lastLoginAt: row.lastLoginAt,
    passwordChangedAt: row.passwordChangedAt,
    isLocalOwner: row.credentialState === "none",
    isSelf: row.id === selfId,
    avatarUrl: row.avatarUrl ?? null,
  };
}

function loadTarget(id: string): UserListRow {
  const row = sqlite.prepare(`${USER_LIST_SQL} WHERE id = ?`).get(id) as
    | UserListRow
    | undefined;
  if (!row) throw new NotFoundError("Account", id);
  return row;
}

function summaryOf(id: string, ctx: AdminContext): AdminUserSummary {
  const row = loadTarget(id);
  const itemsByOwner = getOwnerDataHooks().countItemsByOwner();
  return {
    ...toSummary(row, ctx.actor.id),
    itemCount: itemsByOwner.get(id) ?? 0,
    sessionCount: scalar(
      `SELECT COUNT(*) AS n FROM sessions
        WHERE userId = ? AND datetime(expiresAt) > datetime('now')`,
      id,
    ),
    tokenCount: scalar(
      `SELECT COUNT(*) AS n FROM api_tokens WHERE userId = ? AND revokedAt IS NULL`,
      id,
    ),
  };
}

export function listUsers(ctx: AdminContext): AdminUserSummary[] {
  const rows = sqlite
    .prepare(`${USER_LIST_SQL} ORDER BY createdAt ASC`)
    .all() as UserListRow[];
  const items = getOwnerDataHooks().countItemsByOwner();
  const sessions = countByKey(
    `SELECT userId AS k, COUNT(*) AS n FROM sessions
      WHERE datetime(expiresAt) > datetime('now') GROUP BY userId`,
  );
  const tokens = countByKey(
    `SELECT userId AS k, COUNT(*) AS n FROM api_tokens
      WHERE revokedAt IS NULL GROUP BY userId`,
  );

  return rows.map((row) => ({
    ...toSummary(row, ctx.actor.id),
    itemCount: items.get(row.id) ?? 0,
    sessionCount: sessions.get(row.id) ?? 0,
    tokenCount: tokens.get(row.id) ?? 0,
  }));
}

export function getUser(
  ctx: AdminContext,
  id: string,
): { user: AdminUserSummary; counts: Record<string, number> } {
  return {
    user: summaryOf(id, ctx),
    counts: getOwnerDataHooks().ownedCounts(id),
  };
}

function countActiveAdmins(): number {
  return scalar(
    `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'`,
  );
}

function assertNotSelf(ctx: AdminContext, id: string): void {
  if (ctx.actor.id === id) {
    throw new AppError(
      "You cannot do this to your own account. Ask another administrator.",
      400,
      { code: "CANNOT_TARGET_SELF" },
    );
  }
}

function assertNotLastAdmin(target: UserListRow): void {
  if (target.role !== "admin" || target.status !== "active") return;
  if (countActiveAdmins() > 1) return;
  throw new AppError(
    "This is the last administrator on the instance. Promote another account first.",
    409,
    { code: "LAST_ADMIN" },
  );
}

function assertNotProtectedLocalOwner(target: UserListRow): void {
  if (target.credentialState !== "none") return;
  if (isAuthRequired()) return;
  throw new AppError(
    "This is the local account, which holds the data while sign-in is off. Secure the instance first.",
    409,
    { code: "LOCAL_OWNER_PROTECTED" },
  );
}

const TEMPORARY_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const TEMPORARY_LENGTH = 20;

export function generateTemporaryPassword(): string {
  let out = "";
  for (let i = 0; i < TEMPORARY_LENGTH; i++) {
    out += TEMPORARY_ALPHABET[crypto.randomInt(TEMPORARY_ALPHABET.length)];
  }
  return out;
}

export async function createAdminUser(
  ctx: AdminContext,
  input: {
    email: unknown;
    username: unknown;
    displayName?: unknown;
    role: "admin" | "member";
    temporaryPassword?: unknown;
  },
): Promise<{ user: AdminUserSummary; temporaryPassword: string }> {
  assertInstanceSecured(ctx.actor);
  const temporaryPassword =
    typeof input.temporaryPassword === "string" && input.temporaryPassword
      ? input.temporaryPassword
      : generateTemporaryPassword();

  const created = await createAccount({
    email: input.email,
    username: input.username,
    password: temporaryPassword,
    displayName: input.displayName,
    role: input.role,
    createdBy: ctx.actor.id,
    mustChangePassword: true,
    emailTrusted: true,
  });

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.created",
    targetType: "user",
    targetId: created.id,
    details: { username: created.username, role: created.role },
    ip: ctx.ip,
  });

  return { user: summaryOf(created.id, ctx), temporaryPassword };
}

export function updateAdminUser(
  ctx: AdminContext,
  id: string,
  patch: { role?: "admin" | "member"; displayName?: string | null },
): AdminUserSummary {
  const target = loadTarget(id);
  if (patch.role !== undefined && patch.role !== target.role) {
    if (target.role === "admin") assertNotLastAdmin(target);
    sqlite
      .prepare(
        `UPDATE users SET role = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(patch.role, id);
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "user.role.changed",
      targetType: "user",
      targetId: id,
      details: { username: target.username, from: target.role, to: patch.role },
      ip: ctx.ip,
    });
  }
  if (patch.displayName !== undefined) {
    const displayName = patch.displayName?.trim()
      ? patch.displayName.trim().slice(0, 100)
      : null;
    sqlite
      .prepare(
        `UPDATE users SET displayName = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?`,
      )
      .run(displayName, id);
  }
  return summaryOf(id, ctx);
}

export async function resetPassword(
  ctx: AdminContext,
  id: string,
): Promise<{ temporaryPassword: string }> {
  const target = loadTarget(id);
  assertNotSelf(ctx, id);
  if (target.credentialState === "none") {
    throw new ValidationError(
      "This account has no password to reset. Secure the instance first.",
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET passwordHash = ?, mustChangePassword = 1,
                passwordChangedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(hash, id);
    revokeOtherSessions(id, null);
    sqlite
      .prepare(
        `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND revokedAt IS NULL`,
      )
      .run(id);
    const removed = sqlite
      .prepare("DELETE FROM user_identities WHERE userId = ?")
      .run(id).changes;
    if (removed > 0) {
      auditService.record({
        actorUserId: ctx.actor.id,
        action: "auth.oidc.unlinked",
        targetType: "user",
        targetId: id,
        details: { reason: "password-reset", count: removed },
        ip: ctx.ip,
      });
    }
  })();

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.password.reset",
    targetType: "user",
    targetId: id,
    details: { username: target.username, via: "temporary" },
    ip: ctx.ip,
  });

  return { temporaryPassword };
}

export function disableUser(ctx: AdminContext, id: string): AdminUserSummary {
  const target = loadTarget(id);
  assertNotProtectedLocalOwner(target);
  assertNotLastAdmin(target);
  assertNotSelf(ctx, id);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET status = 'disabled', disabledAt = CURRENT_TIMESTAMP,
                updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(id);
    revokeOtherSessions(id, null);
    sqlite
      .prepare(
        `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND revokedAt IS NULL`,
      )
      .run(id);
  })();

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.disabled",
    targetType: "user",
    targetId: id,
    details: { username: target.username },
    ip: ctx.ip,
  });
  return summaryOf(id, ctx);
}

export function enableUser(ctx: AdminContext, id: string): AdminUserSummary {
  const target = loadTarget(id);
  sqlite
    .prepare(
      `UPDATE users
          SET status = 'active', disabledAt = NULL, updatedAt = CURRENT_TIMESTAMP
        WHERE id = ?`,
    )
    .run(id);

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.enabled",
    targetType: "user",
    targetId: id,
    details: { username: target.username },
    ip: ctx.ip,
  });
  return summaryOf(id, ctx);
}

export function deleteUser(
  ctx: AdminContext,
  id: string,
  decision: string | undefined,
): { deleted: true; counts: Record<string, number> } {
  const target = loadTarget(id);
  assertNotProtectedLocalOwner(target);
  assertNotLastAdmin(target);
  assertNotSelf(ctx, id);

  const hooks = getOwnerDataHooks();
  const counts = hooks.ownedCounts(id);
  if (decision !== "purge") {
    throw new AppError(
      'Deleting this account removes everything it owns. Send { "decision": "purge" } to confirm.',
      409,
      { code: "USER_HAS_DATA", details: { counts } },
    );
  }

  sqlite.transaction(() => {
    hooks.purgeOwnerData?.(id);
    sqlite.prepare(`DELETE FROM jobs WHERE ownerId = ?`).run(id);
    sqlite.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  })();

  try {
    const ownerDir = path.join(UPLOADS_DIR, "u", id);
    fs.rmSync(ownerDir, { recursive: true, force: true });
  } catch (err) {
    log.warn("Admin", `Failed to remove upload directory for ${id}: ${String(err)}`);
  }

  auditService.record({
    actorUserId: ctx.actor.id,
    action: "user.deleted",
    targetType: "user",
    targetId: id,
    details: { username: target.username, ...counts },
    ip: ctx.ip,
  });

  return { deleted: true, counts };
}

// ============================================================================
// Online SQLite Backups (`sqlite.backup()`)
// ============================================================================

export function isBackupIntervalEnvSet(): boolean {
  return process.env.BACKUP_INTERVAL_HOURS !== undefined && process.env.BACKUP_INTERVAL_HOURS.trim() !== "";
}

export function isBackupKeepEnvSet(): boolean {
  return process.env.BACKUP_KEEP !== undefined && process.env.BACKUP_KEEP.trim() !== "";
}

export function getBackupIntervalHours(): { value: number; source: "env" | "setting" | "default" } {
  if (isBackupIntervalEnvSet()) {
    const n = Number(process.env.BACKUP_INTERVAL_HOURS);
    if (Number.isInteger(n) && n >= 0 && n <= 168) return { value: n, source: "env" };
  }
  const stored = getSetting<number>(SETTING_KEYS.backupIntervalHours);
  if (typeof stored === "number" && Number.isInteger(stored) && stored >= 0 && stored <= 168) {
    return { value: stored, source: "setting" };
  }
  return { value: 24, source: "default" };
}

export function setBackupIntervalHours(hours: number): void {
  setSetting(SETTING_KEYS.backupIntervalHours, hours);
}

export function getBackupKeep(): { value: number; source: "env" | "setting" | "default" } {
  if (isBackupKeepEnvSet()) {
    const n = Number(process.env.BACKUP_KEEP);
    if (Number.isInteger(n) && n >= 1 && n <= 50) return { value: n, source: "env" };
  }
  const stored = getSetting<number>(SETTING_KEYS.backupKeep);
  if (typeof stored === "number" && Number.isInteger(stored) && stored >= 1 && stored <= 50) {
    return { value: stored, source: "setting" };
  }
  return { value: 7, source: "default" };
}

export function setBackupKeep(keep: number): void {
  setSetting(SETTING_KEYS.backupKeep, keep);
}

function sidecarPath(file: string): string {
  return `${file}.json`;
}

function countTableRows(db: Database.Database, table: string): number | null {
  try {
    return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  } catch {
    return null;
  }
}

export function verifyBackup(file: string): BackupVerification {
  const checkedAt = new Date().toISOString();
  const rows: Record<string, number> = {};
  const liveRows: Record<string, number> = {};
  const tables = getOwnerDataHooks().countedTables;

  for (const table of tables) {
    liveRows[table] = countTableRows(sqlite, table) ?? 0;
  }

  const companions = [`${file}-shm`, `${file}-wal`].filter(
    (c) => !fs.existsSync(c),
  );

  let snapshot: Database.Database | null = null;
  try {
    snapshot = new Database(file, { readonly: true, fileMustExist: true });
    sqliteVec.load(snapshot);
    const integrity = String(
      snapshot.pragma("quick_check", { simple: true }) ?? "unknown",
    );

    const missing: string[] = [];
    const empty: string[] = [];
    for (const table of tables) {
      const count = countTableRows(snapshot, table);
      if (count === null) {
        missing.push(table);
        continue;
      }
      rows[table] = count;
      if (count === 0 && liveRows[table] > 0) empty.push(table);
    }

    let problem: string | undefined;
    if (integrity !== "ok") problem = `Integrity check: ${integrity}`;
    else if (missing.length > 0) problem = `Missing table(s): ${missing.join(", ")}`;
    else if (empty.length > 0) problem = `Empty in snapshot: ${empty.join(", ")}`;

    return {
      ok: !problem,
      checkedAt,
      integrity,
      rows,
      liveRows,
      ...(problem ? { problem } : {}),
    };
  } catch (err) {
    return {
      ok: false,
      checkedAt,
      integrity: "unreadable",
      rows,
      liveRows,
      problem: `Could not read snapshot: ${getErrorMessage(err)}`,
    };
  } finally {
    snapshot?.close();
    for (const companion of companions) {
      try {
        if (fs.existsSync(companion) && (companion.endsWith("-shm") || fs.statSync(companion).size === 0)) {
          fs.rmSync(companion, { force: true });
        }
      } catch {
        // Ignore cleanup litter
      }
    }
  }
}

function readVerification(file: string): BackupVerification | null {
  try {
    return JSON.parse(fs.readFileSync(sidecarPath(file), "utf8")) as BackupVerification;
  } catch {
    return null;
  }
}

export function listBackups(): BackupInfo[] {
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.startsWith(BACKUP_FILE_PREFIX) && f.endsWith(".db"))
    .map((filename) => {
      const file = path.join(BACKUPS_DIR, filename);
      const stat = fs.statSync(file);
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        verification: readVerification(file),
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function snapshotFile(filename: string): string | null {
  if (
    !filename ||
    path.basename(filename) !== filename ||
    !filename.startsWith(BACKUP_FILE_PREFIX) ||
    !filename.endsWith(".db")
  ) {
    return null;
  }
  fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  const candidate = path.join(BACKUPS_DIR, filename);
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

function rotateBackups(): void {
  const excess = listBackups().slice(getBackupKeep().value);
  for (const backup of excess) {
    try {
      const file = path.join(BACKUPS_DIR, backup.filename);
      fs.rmSync(file, { force: true });
      fs.rmSync(sidecarPath(file), { force: true });
      fs.rmSync(`${file}-shm`, { force: true });
      fs.rmSync(`${file}-wal`, { force: true });
    } catch (err) {
      log.warn("Backup", `Failed to rotate ${backup.filename}: ${getErrorMessage(err)}`);
    }
  }
}

let activeBackupPromise: Promise<BackupInfo> | null = null;

export async function runBackup(): Promise<BackupInfo> {
  if (activeBackupPromise) return activeBackupPromise;
  activeBackupPromise = (async () => {
    try {
      fs.mkdirSync(BACKUPS_DIR, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      let filename = `${BACKUP_FILE_PREFIX}${stamp}.db`;
      if (fs.existsSync(path.join(BACKUPS_DIR, filename))) {
        filename = `${BACKUP_FILE_PREFIX}${stamp}-${crypto.randomBytes(2).toString("hex")}.db`;
      }
      const dest = path.join(BACKUPS_DIR, filename);
      const partial = `${dest}.partial`;
      for (const name of fs.readdirSync(BACKUPS_DIR)) {
        if (name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(".partial")) {
          fs.rmSync(path.join(BACKUPS_DIR, name), { force: true });
        }
      }
      let stat: fs.Stats;
      let verification: BackupVerification;
      try {
        await sqlite.backup(partial);
        stat = fs.statSync(partial);
        verification = verifyBackup(partial);
        if (!verification.ok) {
          throw new AppError(
            `Backup verification failed: ${verification.problem ?? "unknown error"}`,
            500,
            { code: "BACKUP_VERIFICATION_FAILED" },
          );
        }
        fs.renameSync(partial, dest);
      } catch (err) {
        fs.rmSync(partial, { force: true });
        throw err;
      }
      try {
        fs.writeFileSync(sidecarPath(dest), JSON.stringify(verification, null, 2));
      } catch {
        // Non-fatal
      }
      rotateBackups();
      return {
        filename,
        sizeBytes: stat.size,
        createdAt: stat.mtime.toISOString(),
        verification,
      };
    } finally {
      activeBackupPromise = null;
    }
  })();
  return activeBackupPromise;
}

/**
 * Takes a backup when the newest snapshot is older than BACKUP_INTERVAL_HOURS
 * (0 disables). Snapshot file times survive restarts, so a restart neither
 * skips nor repeats a backup.
 */
export async function runScheduledBackup(now = Date.now()): Promise<BackupInfo | null> {
  const hours = getBackupIntervalHours().value;
  const newest = listBackups()[0];
  if (hours === 0 || (newest && now - Date.parse(newest.createdAt) < hours * 3_600_000)) {
    return null;
  }
  return runBackup();
}

const BACKUP_CHECK_INTERVAL_MS = 15 * 60_000;

/**
 * Checks for a due backup every `checkEveryMs` on an unref'd timer. runBackup()
 * joins a run already in flight and rotates to BACKUP_KEEP snapshots. A failed
 * run is logged and retried at the next check. Returns stop().
 */
export function startBackupScheduler(checkEveryMs = BACKUP_CHECK_INTERVAL_MS): () => void {
  const timer = setInterval(() => {
    runScheduledBackup()
      .then((backup) => {
        if (backup?.verification?.ok === false) {
          log.warn("Backup", `Scheduled backup ${backup.filename} failed verification: ${backup.verification.problem}`);
        }
      })
      .catch((err: unknown) => {
        log.warn("Backup", `Scheduled backup failed, retrying at the next check: ${getErrorMessage(err)}`);
      });
  }, checkEveryMs);
  timer.unref();
  return () => clearInterval(timer);
}
