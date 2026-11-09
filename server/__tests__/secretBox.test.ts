// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SecretUnavailableError,
  getOrInitSecretKey,
  open,
  seal,
  validateSecretKey,
} from "../platform/crypto/secretBox.ts";

describe("secretBox AES-256-GCM sealing", () => {
  it("round-trips UTF-8 secrets with distinct random IVs", () => {
    const key = crypto.randomBytes(32);
    const plain = "sk-ant-api03-super-secret-key-🔑";
    const s1 = seal(plain, key);
    const s2 = seal(plain, key);

    expect(s1.startsWith("v1:")).toBe(true);
    expect(s1).not.toBe(s2);
    expect(open(s1, key)).toBe(plain);
    expect(open(s2, key)).toBe(plain);
  });

  it("rejects wrong keys and tampered ciphertexts", () => {
    const keyA = crypto.randomBytes(32);
    const keyB = crypto.randomBytes(32);
    const sealed = seal("top-secret-token", keyA);

    expect(() => open(sealed, keyB)).toThrow(SecretUnavailableError);

    const buf = Buffer.from(sealed.slice(3), "base64");
    buf[buf.length - 1] ^= 0xff;
    const tampered = `v1:${buf.toString("base64")}`;
    expect(() => open(tampered, keyA)).toThrow(SecretUnavailableError);
    expect(() => open("plaintext-not-sealed", keyA)).toThrow(
      SecretUnavailableError,
    );
  });

  it("validates 64-char hex keys and auto-creates secret.key on disk", () => {
    expect(() => validateSecretKey("")).not.toThrow();
    expect(() => validateSecretKey("a".repeat(64))).not.toThrow();
    expect(() => validateSecretKey("not-hex")).toThrow(/64-character hex/);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tbx-secret-"));
    try {
      const k1 = getOrInitSecretKey(tmpDir);
      const k2 = getOrInitSecretKey(tmpDir);
      expect(k1.length).toBe(32);
      expect(k1.equals(k2)).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "secret.key"))).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
