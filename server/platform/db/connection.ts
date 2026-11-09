import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { DB_PATH } from "../../appConfig.ts";
import {
  initPlatformSchema,
  ensureLocalOwner as ensureLocalOwnerOnDb,
  primaryAdminId as primaryAdminIdOnDb,
} from "./platformSchema.ts";

const dbDir = path.dirname(DB_PATH);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const sqlite: Database.Database = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
sqlite.pragma("busy_timeout = 5000");

initPlatformSchema(sqlite);

export function ensureLocalOwner(): string {
  return ensureLocalOwnerOnDb(sqlite);
}

export function primaryAdminId(): string {
  return primaryAdminIdOnDb(sqlite);
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
