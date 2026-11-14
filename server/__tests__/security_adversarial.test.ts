// @vitest-environment node
import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import zlib from "node:zlib";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import db from "../db.ts";
import { BACKUPS_DIR } from "../appConfig.ts";
import { createApp, __resetAppRateLimits } from "../app.ts";
import { runText } from "../ai/engine.ts";
import { extractZipArchive } from "../platform/archive/zip.ts";
import {
  normalizeEndpointBaseUrl,
  upsertUserCustomEndpoint,
  validateEndpointBaseUrl,
} from "../platform/ai/aiSettingsService.ts";
import { sealCredential } from "../platform/crypto/secretBox.ts";
import { scopeForOwnerId } from "../platform/tenancy/scope.ts";
import { fetchEndpointModels } from "../providers/defs.ts";
import { craftRawZip, makeKitSkeleton } from "./testHelpers.ts";
import { topologicalSort } from "../../shared/kits/kitSkeleton.ts";
import { makeDataPrivate } from "../platform/fs/privateFiles.ts";
import {
  CONTENT_SECURITY_POLICY,
  PERMISSIONS_POLICY,
  trimTrailingSlashes,
} from "../platform/net/errors.ts";
import { __resetHostGuard } from "../platform/net/hostGuard.ts";
import {
  assertPublicHttpUrl,
  guardedFetch,
  safeFetch,
} from "../platform/net/originAndFetch.ts";
import { __resetMcpRateLimit } from "../platform/mcp/mcpPrimitives.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import { embedTextsLocal, extractPdfText } from "../platform/workers/cpuHost.ts";

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

  it("1. blocks PUT /api/config unknown keys, fences tbk_ bearer tokens from admin endpoints, and redacts non-session views", async () => {
    // Admin session can update allowlisted API keys
    await adminAgent
      .put("/api/config")
      .send({
        gemini_api_key: "AIza-super-secret-instance-key-9999",
      })
      .expect(200);

    // Unknown keys are rejected even from an admin session (allowlist enforcement)
    const unknownWrite = await adminAgent
      .put("/api/config")
      .send({ internal_instance_note: "arbitrary-key-rejected" })
      .expect(400);
    expect(unknownWrite.body.error.code).toBe("VALIDATION_ERROR");

    // Non-admin session CANNOT modify global config
    const nonAdminWrite = await memberAgent
      .put("/api/config")
      .send({ gemini_api_key: "pwned-by-member" })
      .expect(403);
    expect(nonAdminWrite.body.error.code).toBe("ADMIN_REQUIRED");

    const rowAfterAttack = db
      .prepare("SELECT value FROM config WHERE key = 'internal_instance_note'")
      .get() as { value: string } | undefined;
    expect(rowAfterAttack).toBeUndefined();

    // Non-admin GET /api/config receives ONLY boolean provider availability flags
    const memberRead = await memberAgent.get("/api/config").expect(200);
    expect(Object.keys(memberRead.body).sort()).toEqual([
      "api_key_configured",
      "api_keys_configured",
    ]);
    expect(memberRead.body.api_key_configured).toBe(true);
    expect(memberRead.body.api_keys_configured.gemini).toBe(true);
    expect(memberRead.body.gemini_api_key).toBeUndefined();

    // Admin read/write tbk_ token gets the non-admin redacted view on GET /api/config and GET /api/endpoints
    // and is refused (403 SESSION_REQUIRED) on /api/config, /api/endpoints mutations, and /api/system/export-db.
    const adminRwToken = (
      await adminAgent
        .post("/api/auth/tokens")
        .send({ name: "Admin Bearer Fence", readOnly: false })
        .expect(201)
    ).body.token as string;
    const epId = "test-ep-redact";
    db.prepare(
      `INSERT INTO custom_endpoints (id, name, base_url, api_key) VALUES (?, ?, ?, ?)`,
    ).run(epId, "LanLLM", "https://api.example.com/v1", sealCredential("sk-lan-secret-4321"));
    try {
      const tokenConfigRead = await request(app)
        .get("/api/config")
        .set("Authorization", `Bearer ${adminRwToken}`)
        .expect(200);
      expect(Object.keys(tokenConfigRead.body).sort()).toEqual([
        "api_key_configured",
        "api_keys_configured",
      ]);
      expect(tokenConfigRead.body.gemini_api_key).toBeUndefined();

      const tokenEpRead = await request(app)
        .get("/api/endpoints")
        .set("Authorization", `Bearer ${adminRwToken}`)
        .expect(200);
      const tokenEp = (tokenEpRead.body as Array<{ id: string; apiKeyMasked: string }>).find(
        (e) => e.id === epId,
      );
      expect(tokenEp?.apiKeyMasked).toBe("••••");

      for (const [method, url] of [
        ["put", "/api/config"],
        ["post", "/api/config/test-key"],
        ["post", "/api/config/refresh-models"],
        ["post", "/api/endpoints/test"],
        ["post", "/api/endpoints"],
        ["put", `/api/endpoints/${epId}`],
        ["post", `/api/endpoints/${epId}/refresh-models`],
        ["delete", `/api/endpoints/${epId}`],
        ["get", "/api/system/export-db"],
      ] as const) {
        const res = await request(app)[method](url)
          .set("Authorization", `Bearer ${adminRwToken}`)
          .send({})
          .expect(403);
        expect(res.body.error.code, `${method} ${url}`).toBe("SESSION_REQUIRED");
      }
    } finally {
      db.prepare("DELETE FROM custom_endpoints WHERE id = ?").run(epId);
    }

    // Admin session GET /api/config continues receiving masked secret prefixes
    const adminRead = await adminAgent.get("/api/config").expect(200);
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

    // Blocked on mutating REST endpoints and mutating/LLM-spending GET endpoints
    const restWrite = await request(app)
      .post("/api/decks")
      .set("Authorization", `Bearer ${readOnlyToken}`)
      .send({ name: "Blocked REST Deck" })
      .expect(403);
    expect(restWrite.body.error.code).toBe("TOKEN_READ_ONLY");

    for (const spendGet of [
      "/api/chat/starters?pillarId=p&topicId=t",
      "/api/drills/challenge/node-1",
    ]) {
      const blockedGet = await request(app)
        .get(spendGet)
        .set("Authorization", `Bearer ${readOnlyToken}`)
        .expect(403);
      expect(blockedGet.body.error.code, spendGet).toBe("TOKEN_READ_ONLY");
    }

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
    const traversalZip = craftRawZip({
      entries: [{ name: "../evil.txt", payload: Buffer.from("escaped", "utf8") }],
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
    const bombEntry = (uncompSizeOverride: number) =>
      craftRawZip({
        entries: [
          {
            name: "kit.json",
            payload: deflatedZeros,
            method: 8,
            crc: zlib.crc32(rawZeros) >>> 0,
            uncompSizeOverride,
          },
        ],
      });

    await expect(
      extractZipArchive(bombEntry(rawZeros.byteLength), { maxTotalUncompressedBytes: 256 * 1024 }),
    ).rejects.toThrow(/exceeds.*limit/i);

    // Oversized declared uncompressed entry (>150 MB global archive cap) rejected on /api/kits/import-backup
    const oversizedHeaderBomb = bombEntry(200 * 1024 * 1024);
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
      "camera=(), microphone=(self), geolocation=()",
    );
    expect(res.headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["content-security-policy"]).toBe(
      CONTENT_SECURITY_POLICY,
    );
    expect(res.headers["content-security-policy"]).toContain(
      "img-src 'self' data: blob:;",
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

    // Verify GET /api/system/export-db stages under BACKUPS_DIR/.tmp, serves valid SQLite concurrently,
    // never touches os.tmpdir(), and removes its private staging dir on completion.
    await memberAgent.get("/api/system/export-db").expect(403);
    const osTmpBefore = new Set(
      fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith("toolbox-backup-")),
    );
    const [exportA, exportB] = await Promise.all([
      adminAgent.get("/api/system/export-db").responseType("blob").expect(200),
      adminAgent.get("/api/system/export-db").responseType("blob").expect(200),
    ]);
    for (const exportRes of [exportA, exportB]) {
      expect((exportRes.body as Buffer).subarray(0, 15).toString("utf8")).toBe(
        "SQLite format 3",
      );
    }
    const osTmpLeaked = fs
      .readdirSync(os.tmpdir())
      .filter((n) => n.startsWith("toolbox-backup-") && !osTmpBefore.has(n));
    expect(osTmpLeaked).toEqual([]);
    const exportTmpRoot = path.join(BACKUPS_DIR, ".tmp");
    if (fs.existsSync(exportTmpRoot)) {
      await vi.waitFor(() => {
        expect(fs.readdirSync(exportTmpRoot)).toEqual([]);
      });
    }
  });

  it("8. re-checks custom endpoint targets on every connection and redirect, not only when saved (CodeQL js/request-forgery, js/polynomial-redos)", async () => {
    const hits: string[] = [];
    const server = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url?.startsWith("/redirect/")) {
        res.writeHead(302, { Location: "http://169.254.169.254/latest/meta-data/" }).end();
        return;
      }
      if (req.url?.startsWith("/huge/")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(`{"data":[{"id":"${"x".repeat(3 * 1024 * 1024)}"}]}`);
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
      // A user-configured endpoint cannot make the server buffer an unbounded body.
      await expect(
        fetchEndpointModels("", `${base}/huge`, { allowPrivate: true }),
      ).rejects.toThrow(/exceeds/);

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

  it("10. blocks multi-A DNS SSRF, strips POST bodies/headers across 301/302/303 redirects, rejects cross-origin 307/308, and handles Request/binary bodies in guardedFetch", async () => {
    const lookupSpy = vi.spyOn(dns, "lookup");
    try {
      lookupSpy.mockResolvedValueOnce([
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.42", family: 4 },
      ] as unknown as Awaited<ReturnType<typeof dns.lookup>>);
      await expect(
        assertPublicHttpUrl("https://multi-a-ssrf.example/v1"),
      ).rejects.toThrow(/private address/i);

      lookupSpy.mockResolvedValueOnce(
        [] as unknown as Awaited<ReturnType<typeof dns.lookup>>,
      );
      await expect(
        assertPublicHttpUrl("https://empty-dns.example/v1"),
      ).rejects.toThrow(/resolve/i);
    } finally {
      lookupSpy.mockRestore();
    }

    interface SeenReq {
      method: string | undefined;
      url: string | undefined;
      headers: http.IncomingHttpHeaders;
      body: string;
    }
    const seenA: SeenReq[] = [];
    const seenB: SeenReq[] = [];
    const readBody = async (req: http.IncomingMessage) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      return body;
    };

    const serverB = http.createServer(async (req, res) => {
      seenB.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: await readBody(req),
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, server: "B" }));
    });
    let baseB = "";
    const serverA = http.createServer(async (req, res) => {
      const body = await readBody(req);
      seenA.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body,
      });
      if (req.url === "/r301") {
        return res.writeHead(301, { Location: `${baseB}/landed-301` }).end();
      }
      if (req.url === "/r302") {
        return res.writeHead(302, { Location: `${baseB}/landed-302` }).end();
      }
      if (req.url === "/r303") {
        return res.writeHead(303, { Location: `${baseB}/landed-303` }).end();
      }
      if (req.url === "/r307-cross") {
        return res.writeHead(307, { Location: `${baseB}/nope` }).end();
      }
      if (req.url === "/r307-same") {
        return res.writeHead(307, { Location: "/echo" }).end();
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ method: req.method, body, header: req.headers["x-custom"] ?? null }));
    });

    await new Promise<void>((r) => serverB.listen(0, "127.0.0.1", r));
    baseB = `http://127.0.0.1:${(serverB.address() as { port: number }).port}`;
    await new Promise<void>((r) => serverA.listen(0, "127.0.0.1", r));
    const baseA = `http://127.0.0.1:${(serverA.address() as { port: number }).port}`;

    try {
      for (const pathHop of ["/r301", "/r302", "/r303"]) {
        seenB.length = 0;
        const { response } = await safeFetch(`${baseA}${pathHop}`, {
          method: "POST",
          headers: {
            Authorization: "Bearer super-secret-token",
            "Content-Type": "application/json",
            "Content-Length": "19",
          },
          body: '{"secret":"leakme"}',
          allowPrivate: true,
        });
        expect(response.status).toBe(200);
        expect(seenB).toHaveLength(1);
        expect(seenB[0]?.method).toBe("GET");
        expect(seenB[0]?.body).toBe("");
        expect(seenB[0]?.headers.authorization).toBeUndefined();
        expect(seenB[0]?.headers["content-type"]).toBeUndefined();
        expect(seenB[0]?.headers["content-length"]).toBeUndefined();
      }

      // Cross-origin 307/308 with a body must be refused cleanly without hitting target B
      seenB.length = 0;
      await expect(
        safeFetch(`${baseA}/r307-cross`, {
          method: "POST",
          body: '{"secret":"stay-put"}',
          allowPrivate: true,
        }),
      ).rejects.toThrow(/307\/308/i);
      expect(seenB).toHaveLength(0);

      // Same-origin 307 preserves POST + body
      seenA.length = 0;
      const same307 = await safeFetch(`${baseA}/r307-same`, {
        method: "POST",
        body: "same-origin-payload",
        allowPrivate: true,
      });
      expect(await same307.response.json()).toMatchObject({
        method: "POST",
        body: "same-origin-payload",
      });

      // guardedFetch extracts Request properties and forwards Uint8Array / ArrayBuffer / URLSearchParams
      const gf = guardedFetch({ allowPrivate: true, timeoutMs: 2000 });
      const reqRes = await gf(
        new Request(`${baseA}/echo`, {
          method: "POST",
          headers: { "x-custom": "from-request" },
          body: "request-object-body",
        }),
      );
      expect(await reqRes.json()).toEqual({
        method: "POST",
        body: "request-object-body",
        header: "from-request",
      });

      const u8Res = await gf(`${baseA}/echo`, {
        method: "POST",
        body: new TextEncoder().encode("u8-bytes"),
      });
      expect(await u8Res.json()).toMatchObject({ body: "u8-bytes" });

      const ab = new TextEncoder().encode("ab-bytes").buffer;
      const abRes = await gf(`${baseA}/echo`, { method: "POST", body: ab });
      expect(await abRes.json()).toMatchObject({ body: "ab-bytes" });

      const paramsRes = await gf(`${baseA}/echo`, {
        method: "POST",
        body: new URLSearchParams({ k: "v" }),
      });
      expect(await paramsRes.json()).toMatchObject({ body: "k=v" });
    } finally {
      await new Promise<void>((r) => serverA.close(() => r()));
      await new Promise<void>((r) => serverB.close(() => r()));
    }
  });

  it("11. terminates timed-out/aborted PDF workers without wedging subsequent PDFs or ONNX embeddings", async () => {
    const buildSinglePagePdf = (label: string): Buffer => {
      const content = `BT /F1 12 Tf 72 720 Td (${label}) Tj ET`;
      const objs = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        `4 0 obj << /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream\nendobj\n`,
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
      ];
      let out = "%PDF-1.4\n";
      const offsets: number[] = [];
      for (const o of objs) {
        offsets.push(Buffer.byteLength(out, "latin1"));
        out += o;
      }
      const xrefOffset = Buffer.byteLength(out, "latin1");
      out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
      for (const off of offsets) {
        out += `${String(off).padStart(10, "0")} 00000 n \n`;
      }
      out += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
      return Buffer.from(out, "latin1");
    };

    const samplePdf = buildSinglePagePdf("Worker Recovery OK");
    const terminateSpy = vi.spyOn(Worker.prototype, "terminate");
    try {
      // 1ms deadline triggers disposable PDF worker termination
      await expect(extractPdfText(samplePdf, { timeoutMs: 1 })).rejects.toThrow(
        /timed out|deadline/i,
      );
      expect(terminateSpy).toHaveBeenCalled();
      const termsAfterTimeout = terminateSpy.mock.calls.length;

      // In-flight AbortSignal also terminates the disposable PDF worker cleanly
      const ac = new AbortController();
      const abortPromise = extractPdfText(samplePdf, {
        signal: ac.signal,
        timeoutMs: 10_000,
      });
      setTimeout(() => ac.abort(), 5);
      await expect(abortPromise).rejects.toThrow();
      expect(terminateSpy.mock.calls.length).toBeGreaterThanOrEqual(termsAfterTimeout);

      // Next PDF spawns a clean disposable worker and succeeds, and embeddings remain healthy
      const recovered = await extractPdfText(samplePdf);
      expect(recovered.text).toContain("Worker Recovery OK");
      const vecs = await embedTextsLocal(["isolation check"]);
      expect(vecs).toHaveLength(1);
      expect(vecs[0]?.length).toBeGreaterThan(0);
    } finally {
      terminateSpy.mockRestore();
    }
  });

  it("12. meters compiler ingest/sources and admin key/endpoint probe endpoints under aiCostLimiters", async () => {
    __resetAppRateLimits();
    try {
      for (let i = 0; i < 30; i++) {
        await memberAgent.post("/api/chat").send({}).expect(400);
        await adminAgent.post("/api/chat").send({}).expect(400);
      }
      for (const [agent, route] of [
        [memberAgent, "/api/compiler/sources"],
        [memberAgent, "/api/compiler/ingest"],
        [adminAgent, "/api/config/test-key"],
        [adminAgent, "/api/config/refresh-models"],
        [adminAgent, "/api/endpoints/test"],
        [adminAgent, "/api/endpoints/probe-id/refresh-models"],
      ] as const) {
        const res = await agent.post(route).send({}).expect(429);
        expect(res.body.error?.code, route).toBe("RATE_LIMITED");
      }
    } finally {
      __resetAppRateLimits();
    }
  });
});
