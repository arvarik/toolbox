import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "../../appConfig.ts";
import {
  initPlatformSchema,
  ensureLocalOwner as ensureLocalOwnerOnDb,
} from "./platformSchema.ts";

export function applySqlitePragmas(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("cache_size = -32000");
  db.pragma("temp_store = MEMORY");
  db.pragma("journal_size_limit = 67108864");
  db.pragma("mmap_size = 134217728");
}

/** Opens the database, or fails startup with an error that names the file and the fix. */
export function openDatabase(dbPath: string): Database.Database {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    applySqlitePragmas(db);
    return db;
  } catch (err) {
    const code = (err as { code?: string }).code;
    throw new Error(
      `Cannot open the database at ${path.resolve(dbPath)}: ${err instanceof Error ? err.message : String(err)}` +
        `${code ? ` (${code})` : ""}. DATA_DIR must be a directory this user can write, and the file must be ` +
        "a Toolbox SQLite database. If the file is corrupt, restore a snapshot from DATA_DIR/backups.",
      { cause: err },
    );
  }
}

export const sqlite: Database.Database = openDatabase(DB_PATH);

initPlatformSchema(sqlite);

export function ensureLocalOwner(): string {
  return ensureLocalOwnerOnDb(sqlite);
}

/**
 * One-way boundary hook (Modularity Convention #1 & #3):
 * Domain registers owned-table metadata and purge/count callbacks once at boot,
 * keeping `server/platform/` completely independent of domain schemas.
 */
export interface OwnerDataHooks {
  countedTables: readonly string[];
  countDeviceItems: () => number;
  countItemsByOwner: () => Map<string, number>;
  ownedCounts: (ownerId: string) => Record<string, number>;
  purgeOwnerData?: (ownerId: string) => void;
}

let hooks: OwnerDataHooks = {
  countedTables: ["users"],
  countDeviceItems: () => 0,
  countItemsByOwner: () => new Map(),
  ownedCounts: () => ({}),
};

export function registerOwnerDataHooks(next: OwnerDataHooks): void {
  hooks = next;
}

export function getOwnerDataHooks(): OwnerDataHooks {
  return hooks;
}
