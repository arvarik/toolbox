import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR, SECRET_KEY_ENV } from "../../appConfig.ts";
import { makeDataPrivate } from "../fs/privateFiles.ts";
import { AppError } from "../net/errors.ts";

export class SecretUnavailableError extends AppError {
  constructor(
    message = "Secret is unavailable or could not be decrypted",
    cause?: unknown,
  ) {
    super(message, 500, { code: "SECRET_UNAVAILABLE", cause });
  }
}

export function validateSecretKey(
  key: string | undefined = process.env[SECRET_KEY_ENV],
): void {
  makeDataPrivate(DATA_DIR);
  if (key === undefined || key === "") {
    return;
  }
  if (!/^[0-9a-fA-F]{64}$/.test(key)) {
    throw new Error(
      `${SECRET_KEY_ENV} must be a 64-character hex string (32 bytes)`,
    );
  }
}

let cachedKey: Buffer | null = null;

export function getOrInitSecretKey(dataDir: string = DATA_DIR): Buffer {
  const envVal = process.env[SECRET_KEY_ENV];
  if (envVal) {
    validateSecretKey(envVal);
    return Buffer.from(envVal, "hex");
  }

  if (cachedKey && dataDir === DATA_DIR) {
    return cachedKey;
  }

  const keyPath = path.join(dataDir, "secret.key");
  if (fs.existsSync(keyPath)) {
    const raw = fs.readFileSync(keyPath, "utf8").trim();
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      const key = Buffer.from(raw, "hex");
      if (dataDir === DATA_DIR) cachedKey = key;
      return key;
    }
    const buf = fs.readFileSync(keyPath);
    if (buf.length === 32) {
      if (dataDir === DATA_DIR) cachedKey = buf;
      return buf;
    }
    throw new Error(`Invalid secret key in ${keyPath}: expected 32 bytes`);
  }

  fs.mkdirSync(dataDir, { recursive: true });
  const rawKey = crypto.randomBytes(32);
  const hexKey = rawKey.toString("hex");
  fs.writeFileSync(keyPath, hexKey, { mode: 0o600, flag: "wx" });
  try {
    fs.chmodSync(keyPath, 0o600);
  } catch {
    // Best effort on non-POSIX filesystems
  }

  if (dataDir === DATA_DIR) {
    cachedKey = rawKey;
  }
  return rawKey;
}

export function seal(plaintext: string, explicitKey?: Buffer): string {
  const key = explicitKey ?? getOrInitSecretKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, ciphertext]).toString("base64");
  return `v1:${payload}`;
}

export function open(sealed: string, explicitKey?: Buffer): string {
  if (typeof sealed !== "string" || !sealed.startsWith("v1:")) {
    throw new SecretUnavailableError(
      "Invalid sealed secret: missing v1 prefix",
    );
  }

  const key = explicitKey ?? getOrInitSecretKey();
  let buf: Buffer;
  try {
    buf = Buffer.from(sealed.slice(3), "base64");
  } catch (err) {
    throw new SecretUnavailableError("Invalid base64 encoding", err);
  }

  if (buf.length < 28) {
    throw new SecretUnavailableError("Sealed secret payload is too short");
  }

  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const ciphertext = buf.subarray(28);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    return plaintext.toString("utf8");
  } catch (err) {
    throw new SecretUnavailableError(
      "Failed to decrypt secret: invalid key or corrupted data",
      err,
    );
  }
}

/** Seals a credential for storage. A value that is already sealed stays as it is. */
export function sealCredential(plain: string | null | undefined): string {
  if (!plain) return "";
  return plain.startsWith("v1:") ? plain : seal(plain);
}

/** Opens a stored credential. A legacy plaintext value is returned as it is. */
export function openCredential(stored: string | null | undefined): string {
  if (!stored) return "";
  return !stored.startsWith("v1:") ? stored : open(stored);
}
