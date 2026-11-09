import fs from "node:fs";
import path from "node:path";

export const PRIVATE_UMASK = 0o077;

const PRIVATE_FILE_PATTERN = /\.(?:db|db-wal|db-shm|key)$/;

/**
 * Enforce owner-only permissions on `dataDir` (`0o700`) and sensitive database
 * / key files inside it (`0o600`). No-op on Windows (`win32`) or when `dataDir`
 * does not exist yet.
 */
export function makeDataPrivate(dataDir: string): string[] {
  if (process.platform === "win32") return [];
  process.umask(PRIVATE_UMASK);

  if (!fs.existsSync(dataDir)) return [];

  const failed: string[] = [];
  const setMode = (target: string, mode: number) => {
    try {
      const current = fs.statSync(target).mode & 0o777;
      if (current !== mode) {
        fs.chmodSync(target, mode);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        failed.push(target);
      }
    }
  };

  setMode(dataDir, 0o700);

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dataDir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      failed.push(dataDir);
    }
    return failed;
  }

  for (const entry of entries) {
    if (entry.isFile() && PRIVATE_FILE_PATTERN.test(entry.name)) {
      setMode(path.join(dataDir, entry.name), 0o600);
    }
  }

  return failed;
}
