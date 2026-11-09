import path from "node:path";

export const APP_NAME = "Toolbox";
export const APP_SLUG = "toolbox";
export const SESSION_COOKIE = "toolbox_session";
export const SESSION_HEADER = "x-toolbox-session";
export const OIDC_COOKIE_PREFIX = "toolbox_oidc_";
export const TOKEN_PREFIX = "tbk_";
export const SECRET_KEY_ENV = "TOOLBOX_SECRET_KEY";
export const LOCAL_OWNER_EMAIL = "local@toolbox.local";
export const BACKUP_FILE_PREFIX = "toolbox-";
export const DEFAULT_PORT = 3100;

export const DB_PATH =
  process.env.DB_PATH ||
  (process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, "toolbox.db")
    : "./data/toolbox.db");

export const DATA_DIR = process.env.DATA_DIR || path.dirname(DB_PATH);
export const BACKUPS_DIR = path.join(DATA_DIR, "backups");
export const UPLOADS_DIR = path.join(DATA_DIR, "uploads");

export function isBackgroundJobsDisabled(): boolean {
  const raw = process.env.DISABLE_BACKGROUND_JOBS?.trim().toLowerCase();
  return raw === "true" || raw === "1";
}
