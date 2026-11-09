// @vitest-environment node
import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import db from "../db.ts";
import { createApp } from "../app.ts";
import { runText } from "../ai/engine.ts";
import { extractZipArchive } from "../platform/archive/zip.ts";
import {
  normalizeEndpointBaseUrl,
  upsertUserCustomEndpoint,
  validateEndpointBaseUrl,
} from "../platform/ai/aiSettingsService.ts";
import { scopeForOwnerId } from "../platform/tenancy/scope.ts";
import { fetchEndpointModels } from "../providers/defs.ts";
import { makeKitSkeleton } from "./testHelpers.ts";
import { topologicalSort } from "../../shared/kits/kitSkeleton.ts";
import { makeDataPrivate } from "../platform/fs/privateFiles.ts";
import {
  CONTENT_SECURITY_POLICY,
  trimTrailingSlashes,
} from "../platform/net/errors.ts";
import { __resetHostGuard } from "../platform/net/hostGuard.ts";
import { __resetMcpRateLimit } from "../platform/mcp/mcpPrimitives.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";

function craftSingleEntryZip(opts: {
  name: string;
  rawData: Buffer;
  method?: number;
  crc?: number;
  uncompSize?: number;
}): Buffer {
  const nameBuf = Buffer.from(opts.name, "utf8");
  const method = opts.method ?? 0;
  const crc = opts.crc ?? zlib.crc32(opts.rawData) >>> 0;
  const compSize = opts.rawData.byteLength;
  const uncompSize = opts.uncompSize ?? compSize;

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0);
  lfh.writeUInt16LE(20, 4);
  lfh.writeUInt16LE(0x0800, 6);
  lfh.writeUInt16LE(method, 8);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(compSize, 18);
  lfh.writeUInt32LE(uncompSize, 22);
  lfh.writeUInt16LE(nameBuf.byteLength, 26);

  const localRecord = Buffer.concat([lfh, nameBuf, opts.rawData]);

  const cdfh = Buffer.alloc(46);
  cdfh.writeUInt32LE(0x02014b50, 0);
  cdfh.writeUInt16LE(0x0314, 4);
  cdfh.writeUInt16LE(20, 6);
  cdfh.writeUInt16LE(0x0800, 8);
  cdfh.writeUInt16LE(method, 10);
  cdfh.writeUInt32LE(crc, 16);
  cdfh.writeUInt32LE(compSize, 20);
  cdfh.writeUInt32LE(uncompSize, 24);
  cdfh.writeUInt16LE(nameBuf.byteLength, 28);
  cdfh.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  cdfh.writeUInt32LE(0, 42);

  const cdRecord = Buffer.concat([cdfh, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(cdRecord.byteLength, 12);
  eocd.writeUInt32LE(localRecord.byteLength, 16);

  return Buffer.concat([localRecord, cdRecord, eocd]);
}

describe("Adversarial Security & Runtime Hardening Suite", () => {
  let app: Express;
  let adminAgent: ReturnType<typeof request.agent>;
  let memberAgent: ReturnType<typeof request.agent>;
  let memberId = "";
  let readOnlyToken = "";

  beforeAll(async () => {
    __resetAuthRateLimits();
    __resetMcpRateLimit();
    __resetHostGuard();
    app = createApp();

    adminAgent = request.agent(app);
    await adminAgent
      .post("/api/auth/setup")
      .send({
        email: "sec-admin@toolbox.test",
        username: "sec_admin",
        displayName: "Security Admin",
        password: "correct-horse-battery-staple-admin",
      })
      .expect(201);

    const inviteRes = await adminAgent
      .post("/api/admin/invitations")
      .send({ email: "sec-member@toolbox.test", role: "member" })
      .expect(201);
    const inviteToken = new URL(
      inviteRes.body.link as string,
    ).searchParams.get("token")!;

    memberAgent = request.agent(app);
    const memberRes = await memberAgent
      .post("/api/auth/accept-invitation")
      .send({
        token: inviteToken,
        email: "sec-member@toolbox.test",
        username: "sec_member",
        displayName: "Security Member",
        password: "correct-horse-battery-staple-member",
      })
      .expect(201);
    memberId = memberRes.body.user.id as string;

    const tokenRes = await adminAgent
      .post("/api/auth/tokens")
      .send({ name: "Adversarial ReadOnly Token", readOnly: true })
      .expect(201);
    readOnlyToken = tokenRes.body.token as string;
  });

  afterAll(() => {
    __resetHostGuard();
  });

  it("1. blocks multi-tenant PUT /api/config privilege escalation and redacts GET /api/config for non-admins", async () => {
    // Admin can write instance configuration keys and API keys
    await adminAgent
      .put("/api/config")
      .send({
        gemini_api_key: "AIza-super-secret-instance-key-9999",
        internal_instance_note: "sensitive-admin-metadata",
      })
      .expect(200);

    // Non-admin CANNOT overwrite ANY key in global config (even non-API-key fields!)
    const nonAdminWrite = await memberAgent
      .put("/api/config")
      .send({ internal_instance_note: "pwned-by-member" })
      .expect(403);
    expect(nonAdminWrite.body.error.code).toBe("FORBIDDEN");

    const rowAfterAttack = db
      .prepare("SELECT value FROM config WHERE key = 'internal_instance_note'")
      .get() as { value: string } | undefined;
    expect(rowAfterAttack?.value).toBe("sensitive-admin-metadata");

    // Non-admin GET /api/config receives ONLY boolean provider availability flags
    const memberRead = await memberAgent.get("/api/config").expect(200);
    expect(Object.keys(memberRead.body).sort()).toEqual([
      "api_key_configured",
      "api_keys_configured",
    ]);
    expect(memberRead.body.api_key_configured).toBe(true);
    expect(memberRead.body.api_keys_configured.gemini).toBe(true);
    expect(memberRead.body.internal_instance_note).toBeUndefined();
    expect(memberRead.body.gemini_api_key).toBeUndefined();

    // Admin GET /api/config continues receiving full config with masked secrets
    const adminRead = await adminAgent.get("/api/config").expect(200);
    expect(adminRead.body.internal_instance_note).toBe(
      "sensitive-admin-metadata",
    );
    expect(adminRead.body.gemini_api_key).toBe("••••9999");
    expect(adminRead.body.gemini_api_key).not.toContain(
      "super-secret-instance-key",
    );
  });

  it("2. blocks SSRF cloud metadata & credential URLs for ALL users and blocks private/loopback BYOK endpoints for non-admins", async () => {
    const alwaysBlockedUrls = [
      "http://169.254.169.254/latest/meta-data",
      "http://[::ffff:169.254.169.254]/latest/meta-data",
      "http://169.254.170.2/v2/credentials",
      "http://metadata.google.internal/computeMetadata/v1",
      "http://metadata.goog/computeMetadata/v1",
      "http://0.0.0.0:11434/v1",
      "http://[fe80::1]:8080/v1",
      "http://user:pass@example.com/v1",
    ];

    for (const blockedUrl of alwaysBlockedUrls) {
      expect(() =>
        normalizeEndpointBaseUrl(blockedUrl, { allowPrivate: true }),
      ).toThrow();
      await expect(
        validateEndpointBaseUrl(blockedUrl, { allowPrivate: true }),
      ).rejects.toThrow();

      // Blocked on Admin instance endpoints too
      await adminAgent
        .post("/api/endpoints/test")
        .send({ baseUrl: blockedUrl })
        .expect(400);
      await adminAgent
        .post("/api/endpoints")
        .send({ name: "Metadata Probe", baseUrl: blockedUrl })
        .expect(400);
    }

    // Admin can still normalize local Ollama / vLLM loopback & LAN URLs
    expect(
      normalizeEndpointBaseUrl("http://127.0.0.1:11434/v1/", {
        allowPrivate: true,
      }),
    ).toBe("http://127.0.0.1:11434/v1");
    await expect(
      validateEndpointBaseUrl("http://127.0.0.1:11434/v1", {
        allowPrivate: true,
      }),
    ).resolves.toBe("http://127.0.0.1:11434/v1");

    // Non-admin BYOK users are blocked (400) from probing loopback & RFC1918 targets
    for (const internalUrl of [
      "http://127.0.0.1:6379",
      "http://10.0.0.1:8080",
      "http://192.168.1.10:11434/v1",
      "http://localhost:11434/v1",
    ]) {
      const testRes = await memberAgent
        .post("/api/ai-settings/endpoints/test")
        .send({ baseUrl: internalUrl })
        .expect(400);
      expect(testRes.body.error?.code).toBe("VALIDATION_ERROR");

      const saveRes = await memberAgent
        .post("/api/ai-settings/endpoints")
        .send({
          name: "Internal SSRF Probe",
          baseUrl: internalUrl,
          skipProbe: true,
        })
        .expect(400);
      expect(saveRes.body.error?.code).toBe("VALIDATION_ERROR");
    }

    // DNS rebinding check: domain resolving via dns.lookup({ all: true }) to RFC1918 / metadata IP is blocked
    const lookupSpy = vi.spyOn(dns, "lookup");
    try {
      lookupSpy.mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.42", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
      await expect(
        validateEndpointBaseUrl("https://rebind.attacker.example/v1", {
          allowPrivate: false,
        }),
      ).rejects.toThrow(/private address/i);

      lookupSpy.mockResolvedValueOnce([
        { address: "169.254.169.254", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
      await expect(
        validateEndpointBaseUrl("https://rebind-meta.attacker.example/v1", {
          allowPrivate: true,
        }),
      ).rejects.toThrow(/blocked address/i);
    } finally {
      lookupSpy.mockRestore();
    }
  });

  it("3. enforces cross-site CSRF write protection on cookie-authenticated sessions", async () => {
    const csrfRes = await adminAgent
      .post("/api/decks")
      .set("Origin", "https://evil.example")
      .send({ name: "CSRF Forged Deck" })
      .expect(403);
    expect(csrfRes.body.error.code).toBe("CROSS_SITE_REQUEST");

    const secFetchRes = await adminAgent
      .put("/api/profile")
      .set("Sec-Fetch-Site", "cross-site")
      .send({ profileText: "Forged via cross-site fetch" })
      .expect(403);
    expect(secFetchRes.body.error.code).toBe("CROSS_SITE_REQUEST");
  });

  it("4. blocks DNS rebinding via forged Host headers in hostGuard", async () => {
    const rebindRes = await request(app)
      .get("/api/health")
      .set("Host", "evil.attacker.example")
      .expect(403);
    expect(rebindRes.body.error.code).toBe("HOST_NOT_ALLOWED");
  });

  it("5. enforces readOnly tbk_ personal API tokens across both REST mutations and /api/mcp tools", async () => {
    // Allowed on read endpoints
    await request(app)
      .get("/api/decks")
      .set("Authorization", `Bearer ${readOnlyToken}`)
      .expect(200);

    // Blocked on mutating REST endpoints
    const restWrite = await request(app)
      .post("/api/decks")
      .set("Authorization", `Bearer ${readOnlyToken}`)
      .send({ name: "Blocked REST Deck" })
      .expect(403);
    expect(restWrite.body.error.code).toBe("TOKEN_READ_ONLY");

    // Blocked on mutating MCP tools (`create_flashcards`) while allowed on `list_kits`
    const mcpRead = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${readOnlyToken}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_kits", arguments: {} },
      })
      .expect(200);
    expect(mcpRead.text).not.toContain('"isError":true');

    const mcpMutate = await request(app)
      .post("/api/mcp")
      .set("Authorization", `Bearer ${readOnlyToken}`)
      .set("Accept", "application/json, text/event-stream")
      .send({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "create_flashcards",
          arguments: {
            kit: "system-design",
            cards: [{ front: "Q", back: "A" }],
          },
        },
      })
      .expect(200);
    expect(
      mcpMutate.text.includes('"isError":true') ||
        mcpMutate.text.includes('"error"'),
    ).toBe(true);
  });

  it("6. rejects malicious .toolbox-backup.zip archives with path traversal or zip-bomb oversized payloads", async () => {
    const traversalZip = craftSingleEntryZip({
      name: "../evil.txt",
      rawData: Buffer.from("escaped", "utf8"),
    });

    await expect(extractZipArchive(traversalZip)).rejects.toThrow(
      /Path traversal/i,
    );

    const traversalRes = await adminAgent
      .post("/api/kits/import-backup")
      .attach("file", traversalZip, "traversal.toolbox-backup.zip")
      .expect(400);
    expect(traversalRes.body.message).toMatch(/Path traversal/i);

    // Deflated zero-byte zip bomb: ~2 KB compressed inflating to 2 MB (> cap)
    const rawZeros = Buffer.alloc(2 * 1024 * 1024, 0);
    const deflatedZeros = zlib.deflateRawSync(rawZeros, { level: 9 });
    const zipBomb = craftSingleEntryZip({
      name: "kit.json",
      rawData: deflatedZeros,
      method: 8,
      crc: zlib.crc32(rawZeros) >>> 0,
      uncompSize: rawZeros.byteLength,
    });

    await expect(
      extractZipArchive(zipBomb, { maxTotalUncompressedBytes: 256 * 1024 }),
    ).rejects.toThrow(/exceeds.*limit/i);

    // Oversized declared uncompressed entry (>150 MB global archive cap) rejected on /api/kits/import-backup
    const oversizedHeaderBomb = craftSingleEntryZip({
      name: "kit.json",
      rawData: deflatedZeros,
      method: 8,
      crc: zlib.crc32(rawZeros) >>> 0,
      uncompSize: 200 * 1024 * 1024,
    });
    await adminAgent
      .post("/api/kits/import-backup")
      .attach("file", oversizedHeaderBomb, "bomb.toolbox-backup.zip")
      .expect(400);
  });

  it("7. sets strict HTTP security headers + CSP, enforces private 0700/0600 data modes, and cleans up private DB exports", async () => {
    const res = await request(app).get("/api/health").expect(200);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(res.headers["permissions-policy"]).toBe(
      "camera=(), microphone=(), geolocation=()",
    );
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["content-security-policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(res.headers["content-security-policy"]).toContain(
      "default-src 'self'",
    );
    expect(res.headers["content-security-policy"]).toContain(
      "object-src 'none'",
    );

    if (process.platform !== "win32") {
      const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "tbx-priv-test-"));
      try {
        fs.chmodSync(tmpData, 0o755);
        const dbFile = path.join(tmpData, "toolbox.db");
        const walFile = path.join(tmpData, "toolbox.db-wal");
        const shmFile = path.join(tmpData, "toolbox.db-shm");
        const keyFile = path.join(tmpData, "secret.key");
        for (const f of [dbFile, walFile, shmFile, keyFile]) {
          fs.writeFileSync(f, "test", { mode: 0o644 });
          fs.chmodSync(f, 0o644);
        }

        const failed = makeDataPrivate(tmpData);
        expect(failed).toEqual([]);
        expect(fs.statSync(tmpData).mode & 0o777).toBe(0o700);
        for (const f of [dbFile, walFile, shmFile, keyFile]) {
          expect(fs.statSync(f).mode & 0o777).toBe(0o600);
        }
      } finally {
        fs.rmSync(tmpData, { recursive: true, force: true });
      }
    }

    // Verify GET /api/system/export-db streams valid SQLite bytes for admin and removes its private temp dir
    await memberAgent.get("/api/system/export-db").expect(403);
    const beforeDirs = new Set(
      fs
        .readdirSync(os.tmpdir())
        .filter((n) => n.startsWith("toolbox-backup-")),
    );
    const exportRes = await adminAgent
      .get("/api/system/export-db")
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((exportRes.body as Buffer).subarray(0, 15).toString("utf8")).toBe(
      "SQLite format 3",
    );
    const leakedDirs = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith("toolbox-backup-") && !beforeDirs.has(n));
    expect(leakedDirs).toEqual([]);
  });

  it("8. re-checks custom endpoint targets on every connection and redirect, not only when saved (CodeQL js/request-forgery, js/polynomial-redos)", async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url?.startsWith("/redirect/")) {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: [{ id: "tiny" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    try {
      // A member's probe (default policy) never reaches a private address.
      await expect(fetchEndpointModels("", `${base}/v1`)).rejects.toThrow(/private address/);
      expect(hits).toEqual([]);

      // Admin endpoints may be on the LAN, but a redirect to cloud metadata is refused.
      await expect(
        fetchEndpointModels("", `${base}/v1`, { allowPrivate: true }),
      ).resolves.toEqual([{ id: "tiny", releasedAt: null }]);
      await expect(
        fetchEndpointModels("", `${base}/redirect`, { allowPrivate: true }),
      ).rejects.toThrow(/blocked address/);

      // A member endpoint saved earlier (DNS rebinding, or the opt-in env var was
      // later removed) now points at loopback. Chat calls must not reach it.
      hits.length = 0;
      const memberScope = scopeForOwnerId(memberId);
      const endpoint = await upsertUserCustomEndpoint(
        memberScope,
        { name: "Rebound endpoint", baseUrl: `${base}/v1` },
        undefined,
        { skipProbe: true, allowPrivate: true },
      );
      await expect(
        runText({ model: `custom:${endpoint.id}:tiny`, scope: memberScope, prompt: "hi" }),
      ).rejects.toThrow(/private address/);
      expect(hits).toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    // Trailing-slash and trailing-dot regexes are O(n^2): over-long URLs are refused first.
    const started = performance.now();
    expect(() =>
      normalizeEndpointBaseUrl(`http://a${"/".repeat(1_000_000)}x`),
    ).toThrow(/too long/);
    expect(() =>
      normalizeEndpointBaseUrl(`http://a${".".repeat(1_000_000)}b/v1`),
    ).toThrow(/too long/);
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it("9. bounds CPU and memory on untrusted input: request paths, Kit graph size, and multipart field count", async () => {
    // /\/+$/ was O(n^2) on every request path (rate limiter, read-only token guard).
    const started = performance.now();
    expect(trimTrailingSlashes(`/api${"/".repeat(200_000)}x`)).toBe(
      `/api${"/".repeat(200_000)}x`,
    );
    expect(trimTrailingSlashes("/api/mcp///")).toBe("/api/mcp");
    expect(trimTrailingSlashes("///")).toBe("/");
    // The old queue re-sort made topologicalSort O(n^2): 40,000 nodes took 14 s.
    topologicalSort(
      Array.from({ length: 100_000 }, (_, i) => ({ id: `n${i}` })),
      [],
    );
    expect(performance.now() - started).toBeLessThan(2_000);

    // A 3 MB Kit with 50,000 nodes is refused by the schema caps, not processed.
    const hugeKit = makeKitSkeleton((s) => {
      s.graph.nodes = Array.from({ length: 50_000 }, (_, i) => ({
        ...s.graph.nodes[0],
        id: `n${i}`,
      }));
    });
    const capRes = await memberAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: hugeKit })
      .expect(400);
    expect(capRes.body.error.code).toBe("VALIDATION_ERROR");

    // Multer keeps every text field in memory; unlimited fields were a memory DoS.
    let manyFields = memberAgent.post("/api/kits/import-backup");
    for (let i = 0; i < 20; i++) manyFields = manyFields.field(`f${i}`, "x");
    const fieldsRes = await manyFields
      .attach("file", Buffer.from("PK"), "x.toolbox-backup.zip")
      .expect(413);
    expect(fieldsRes.body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });
});
