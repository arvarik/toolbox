import crypto from "node:crypto";
import type Database from "better-sqlite3";
import { LOCAL_OWNER_EMAIL } from "../../appConfig.ts";
import { log } from "../net/errors.ts";

export function primaryAdminId(db: Database.Database): string {
  const row = db
    .prepare(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'
       ORDER BY createdAt ASC LIMIT 1`,
    )
    .get() as { id: string } | undefined;
  if (!row) throw new Error("No active admin account exists");
  return row.id;
}

export function ensureLocalOwner(db: Database.Database): string {
  const existing = db
    .prepare(`SELECT id FROM users WHERE credentialState = 'none' LIMIT 1`)
    .get() as { id: string } | undefined;
  if (existing) return existing.id;

  const count = (
    db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }
  ).n;
  if (count > 0) return primaryAdminId(db);

  const id = crypto.randomUUID();
  db.prepare(
    `INSERT INTO users (id, email, username, displayName, passwordHash, role, credentialState)
     VALUES (?, ?, 'local', 'Local account', 'none$', 'admin', 'none')`,
  ).run(id, LOCAL_OWNER_EMAIL);
  log.info("Database", `Created local owner account (${id})`);
  return id;
}

export function initPlatformSchema(db: Database.Database): string {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL UNIQUE,
      displayName TEXT,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      lastLoginAt TEXT,
      avatarUrl TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      credentialState TEXT NOT NULL DEFAULT 'password',
      mustChangePassword INTEGER NOT NULL DEFAULT 0,
      passwordChangedAt TEXT,
      disabledAt TEXT,
      createdBy TEXT REFERENCES users(id) ON DELETE SET NULL,
      emailTrustedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      expiresAt TEXT NOT NULL,
      lastSeenAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      userAgent TEXT,
      method TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expiresAt);

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      PRIMARY KEY (userId, key)
    );

    CREATE TABLE IF NOT EXISTS api_tokens (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      tokenHash TEXT NOT NULL UNIQUE,
      tokenPrefix TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      lastUsedAt TEXT,
      expiresAt TEXT,
      revokedAt TEXT,
      readOnly INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT 'personal',
      clientId TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(userId);

    CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'member',
      tokenHash TEXT NOT NULL UNIQUE,
      invitedBy TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      expiresAt TEXT NOT NULL,
      acceptedAt TEXT,
      acceptedBy TEXT REFERENCES users(id) ON DELETE SET NULL,
      revokedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      actorUserId TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      targetType TEXT,
      targetId TEXT,
      details TEXT,
      ip TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(createdAt DESC, id DESC);

    CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      publicKey BLOB NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      transports TEXT,
      deviceType TEXT NOT NULL DEFAULT 'singleDevice',
      backedUp INTEGER NOT NULL DEFAULT 0,
      aaguid TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      lastUsedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_passkeys_user ON passkeys(userId);

    CREATE TABLE IF NOT EXISTS auth_challenges (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      userId TEXT REFERENCES users(id) ON DELETE CASCADE,
      challenge TEXT NOT NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      expiresAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_auth_challenges_expires ON auth_challenges(expiresAt);

    CREATE TABLE IF NOT EXISTS auth_links (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      tokenHash TEXT NOT NULL UNIQUE,
      createdBy TEXT REFERENCES users(id) ON DELETE SET NULL,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      requestIp TEXT,
      email TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_links_user ON auth_links(userId, createdAt);

    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      issuer TEXT NOT NULL,
      subject TEXT NOT NULL,
      email TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      lastUsedAt TEXT,
      UNIQUE(issuer, subject),
      UNIQUE(userId, issuer)
    );

    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      ownerId TEXT REFERENCES users(id) ON DELETE CASCADE,
      payload TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      runAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      attempts INTEGER NOT NULL DEFAULT 0,
      maxAttempts INTEGER NOT NULL DEFAULT 3,
      lastError TEXT,
      progress TEXT,
      dedupeKey TEXT,
      createdAt TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
      startedAt TEXT,
      finishedAt TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, runAt);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_dedupe
      ON jobs(dedupeKey) WHERE status IN ('queued', 'running');
  `);

  return ensureLocalOwner(db);
}
