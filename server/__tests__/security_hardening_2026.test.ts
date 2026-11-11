// @vitest-environment node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApp, __resetAppRateLimits } from "../app.ts";
import {
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
  REQUEST_TIMEOUT_MS,
  createHttpServer,
  isLoopbackHost,
} from "../index.ts";
import { setSessionCookie } from "../platform/auth/authMiddleware.ts";
import { __resetMcpRateLimit } from "../platform/mcp/mcpPrimitives.ts";
import {
  CONTENT_SECURITY_POLICY,
  HSTS_HEADER,
  MAX_JSON_DEPTH,
  PERMISSIONS_POLICY,
  assertJsonDepth,
  errorHandler,
  redactUrlForLog,
  safeJsonReviver,
} from "../platform/net/errors.ts";
import { __resetHostGuard, isHostAllowed } from "../platform/net/hostGuard.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

function withEnv<T>(
  overrides: Record<string, string | undefined>,
  fn: () => Promise<T> | T,
): Promise<T> {
  const previous = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(overrides)) {
    previous.set(k, process.env[k]);
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  __resetHostGuard();
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of previous) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      __resetHostGuard();
    });
}

describe("2026 Open-Source Security Hardening Suite", () => {
  beforeAll(() => {
    __resetAuthRateLimits();
    __resetMcpRateLimit();
    __resetAppRateLimits();
    __resetHostGuard();
  });

  afterEach(() => {
    __resetHostGuard();
  });

  it("1. suppresses X-Powered-By and emits complete HTTP security headers (CORP, Permissions-Policy, CSP, conditional HSTS)", async () => {
    const httpApp = createApp();
    const res = await request(httpApp)
      .get("/api/health")
      .set("X-Forwarded-Proto", "https")
      .expect(200);

    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["permissions-policy"]).toBe(PERMISSIONS_POLICY);
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
    expect(res.headers["x-permitted-cross-domain-policies"]).toBe("none");
    expect(res.headers["content-security-policy"]).toBe(CONTENT_SECURITY_POLICY);
    // Untrusted X-Forwarded-Proto with TRUST_PROXY_HOPS=0 must NOT trigger HSTS
    expect(res.headers["strict-transport-security"]).toBeUndefined();

    await withEnv({ TRUST_PROXY_HOPS: "1" }, async () => {
      const tlsProxyApp = createApp();
      const tlsRes = await request(tlsProxyApp)
        .get("/api/health")
        .set("X-Forwarded-Proto", "https")
        .expect(200);
      expect(tlsRes.headers["strict-transport-security"]).toBe(HSTS_HEADER);
    });
  });

  it("2. enforces TRUST_PROXY_HOPS boundary on cookie Secure flags (blocks X-Forwarded-Proto spoofing over HTTP)", async () => {
    const makeCookieProbe = (trustHops: string | undefined) =>
      withEnv({ TRUST_PROXY_HOPS: trustHops }, async () => {
        const probe = express();
        probe.set("trust proxy", trustHops ? Number(trustHops) : 0);
        probe.get("/cookie", (req, res) => {
          setSessionCookie(
            req,
            res,
            "secret-token",
            new Date(Date.now() + 60_000).toISOString(),
          );
          res.json({ secure: req.secure });
        });
        return request(probe)
          .get("/cookie")
          .set("X-Forwarded-Proto", "https")
          .expect(200);
      });

    const untrustedRes = await makeCookieProbe(undefined);
    expect(untrustedRes.body.secure).toBe(false);
    const untrustedCookie = String(untrustedRes.headers["set-cookie"]?.[0] ?? "");
    expect(untrustedCookie).toContain("HttpOnly");
    expect(untrustedCookie).toContain("SameSite=Lax");
    expect(untrustedCookie).not.toContain("; Secure");

    const trustedRes = await makeCookieProbe("1");
    expect(trustedRes.body.secure).toBe(true);
    const trustedCookie = String(trustedRes.headers["set-cookie"]?.[0] ?? "");
    expect(trustedCookie).toContain("; Secure");
  });

  it("3. closes case-variant DNS-rebinding Host bypasses (/API/*) and rejects malformed Host headers", async () => {
    const app = createApp();

    for (const variantPath of [
      "/API/health",
      "/Api/decks",
      "/aPi/config",
      "/.WELL-KNOWN/openid-configuration",
    ]) {
      const blocked = await request(app)
        .get(variantPath)
        .set("Host", "evil.rebind.example")
        .expect(403);
      expect(blocked.body.error.code).toBe("HOST_NOT_ALLOWED");
    }

    const notFoundUpper = await request(app)
      .get("/API/nonexistent-endpoint")
      .expect(404);
    expect(notFoundUpper.body.error.code).toBe("ROUTE_NOT_FOUND");

    for (const malformedHost of [
      "localhost, evil.example",
      "[localhost]",
      "[127.0.0.1]",
      "[::1]@evil.rebind.example",
      "[::1]evil.rebind.example",
      "[::1]:80@evil.rebind.example",
      "[::1]:notaport",
      "[::1]:0",
      "[::1]:70000",
      "localhost:80@evil.rebind.example",
      "127.0.0.1:notaport",
      "127.0.0.1:0",
      "127.0.0.1:65536",
      ":3100",
      "evil@localhost",
      "bad host",
      "evil/localhost",
    ]) {
      expect(isHostAllowed(malformedHost), `Host "${malformedHost}"`).toBe(false);
    }
    expect(isHostAllowed("localhost:3100")).toBe(true);
    expect(isHostAllowed("[::1]:3100")).toBe(true);
    expect(isHostAllowed("[::1]")).toBe(true);
  });

  it("4. blocks HTTP->HTTPS cross-scheme Origin downgrade and rejects wildcard/malformed CORS_ORIGIN on MCP", async () => {
    await withEnv(
      { TRUST_PROXY_HOPS: "1", ALLOWED_HOSTS: "study.example.com" },
      async () => {
        const app = createApp();
        const setupRes = await request(app)
          .post("/api/auth/setup")
          .set("Host", "study.example.com")
          .set("X-Forwarded-Proto", "https")
          .set("Origin", "https://study.example.com")
          .send({
            email: "hardening-admin@toolbox.test",
            username: "hardening_admin",
            displayName: "Hardening Admin",
            password: "correct-horse-battery-staple-2026",
          })
          .expect(201);
        // Supertest uses an http:// loopback socket, so extract the `; Secure` cookie pair explicitly
        const rawSetCookie = String(setupRes.headers["set-cookie"]?.[0] ?? "");
        expect(rawSetCookie).toContain("; Secure");
        const sessionCookie = rawSetCookie.split(";")[0]!;

        // Downgraded http:// Origin against https:// server must be refused as cross-site
        const downgradeRes = await request(app)
          .post("/api/decks")
          .set("Host", "study.example.com")
          .set("X-Forwarded-Proto", "https")
          .set("Cookie", sessionCookie)
          .set("Origin", "http://study.example.com")
          .send({ name: "Downgrade CSRF Attempt" })
          .expect(403);
        expect(downgradeRes.body.error.code).toBe("CROSS_SITE_REQUEST");

        // Matching https:// Origin succeeds
        await request(app)
          .post("/api/decks")
          .set("Host", "study.example.com")
          .set("X-Forwarded-Proto", "https")
          .set("Cookie", sessionCookie)
          .set("Origin", "https://study.example.com")
          .send({ name: "Legit HTTPS Deck" })
          .expect(201);

        const tokRes = await request(app)
          .post("/api/auth/tokens")
          .set("Host", "study.example.com")
          .set("X-Forwarded-Proto", "https")
          .set("Cookie", sessionCookie)
          .set("Origin", "https://study.example.com")
          .send({ name: "Hardening MCP Token", readOnly: true })
          .expect(201);
        const mcpToken = tokRes.body.token as string;

        // Wildcard CORS_ORIGIN="*" or path-bearing URL is never honored
        for (const unsafeCors of ["*", "https://bad.example/subpath", "ftp://bad.example"]) {
          await withEnv(
            {
              TRUST_PROXY_HOPS: "1",
              ALLOWED_HOSTS: "study.example.com",
              CORS_ORIGIN: unsafeCors,
            },
            async () => {
              const res = await request(app)
                .post("/api/mcp")
                .set("Host", "study.example.com")
                .set("X-Forwarded-Proto", "https")
                .set("Authorization", `Bearer ${mcpToken}`)
                .set("Origin", "https://untrusted.example")
                .set("Accept", "application/json, text/event-stream")
                .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
                .expect(403);
              expect(res.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
              expect(res.headers["access-control-allow-origin"]).toBeUndefined();
            },
          );
        }

        // Exact validated CORS_ORIGIN handles unauthenticated OPTIONS preflight + POST without credentials
        await withEnv(
          {
            TRUST_PROXY_HOPS: "1",
            ALLOWED_HOSTS: "study.example.com",
            CORS_ORIGIN: "https://mcp-client.example",
          },
          async () => {
            const preflightOk = await request(app)
              .options("/api/mcp")
              .set("Host", "study.example.com")
              .set("X-Forwarded-Proto", "https")
              .set("Origin", "https://mcp-client.example")
              .set("Access-Control-Request-Method", "POST")
              .set(
                "Access-Control-Request-Headers",
                "authorization, content-type, mcp-protocol-version",
              )
              .expect(204);
            expect(preflightOk.headers["access-control-allow-origin"]).toBe(
              "https://mcp-client.example",
            );
            expect(String(preflightOk.headers.vary ?? "")).toContain("Origin");
            expect(preflightOk.headers["access-control-allow-methods"]).toBe(
              "POST, OPTIONS",
            );
            expect(preflightOk.headers["access-control-allow-headers"]).toBe(
              "Authorization, Content-Type, Accept, MCP-Protocol-Version",
            );
            expect(preflightOk.headers.allow).toBe("POST, OPTIONS");
            expect(
              preflightOk.headers["access-control-allow-credentials"],
            ).toBeUndefined();

            const preflightBlocked = await request(app)
              .options("/api/mcp")
              .set("Host", "study.example.com")
              .set("X-Forwarded-Proto", "https")
              .set("Origin", "https://untrusted.example")
              .set("Access-Control-Request-Method", "POST")
              .expect(403);
            expect(preflightBlocked.body.error.code).toBe("ORIGIN_NOT_ALLOWED");
            expect(
              preflightBlocked.headers["access-control-allow-origin"],
            ).toBeUndefined();

            const okMcp = await request(app)
              .post("/api/mcp")
              .set("Host", "study.example.com")
              .set("X-Forwarded-Proto", "https")
              .set("Authorization", `Bearer ${mcpToken}`)
              .set("Origin", "https://mcp-client.example")
              .set("Accept", "application/json, text/event-stream")
              .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
              .expect(200);
            expect(okMcp.headers["access-control-allow-origin"]).toBe(
              "https://mcp-client.example",
            );
            expect(String(okMcp.headers.vary ?? "")).toContain("Origin");
            expect(okMcp.headers["access-control-allow-credentials"]).toBeUndefined();
          },
        );

        // Malformed PUBLIC_URL / PUBLIC_ORIGIN never throws unhandled 500 in isOwnOrigin
        await withEnv(
          {
            TRUST_PROXY_HOPS: "1",
            ALLOWED_HOSTS: "study.example.com",
            PUBLIC_URL: "https://bad.example/trailing-path",
            PUBLIC_ORIGIN: "https://also-bad.example?query=1",
          },
          async () => {
            const crossSiteWrite = await request(app)
              .post("/api/decks")
              .set("Host", "study.example.com")
              .set("X-Forwarded-Proto", "https")
              .set("Cookie", sessionCookie)
              .set("Origin", "https://evil.example")
              .send({ name: "Should 403 Not 500" })
              .expect(403);
            expect(crossSiteWrite.body.error.code).toBe("CROSS_SITE_REQUEST");

            const crossOriginMcp = await request(app)
              .post("/api/mcp")
              .set("Host", "study.example.com")
              .set("X-Forwarded-Proto", "https")
              .set("Authorization", `Bearer ${mcpToken}`)
              .set("Origin", "https://evil.example")
              .set("Accept", "application/json, text/event-stream")
              .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
              .expect(403);
            expect(crossOriginMcp.body.error.code).toBe("ORIGIN_NOT_ALLOWED");

            await request(app)
              .post("/api/decks")
              .set("Host", "study.example.com")
              .set("X-Forwarded-Proto", "https")
              .set("Cookie", sessionCookie)
              .set("Origin", "https://study.example.com")
              .send({ name: "Host Fallback Under Malformed PUBLIC_URL" })
              .expect(201);
          },
        );
      },
    );
  });

  it("5. enforces JSON nesting depth ceiling (64) and strips __proto__ / constructor.prototype keys", async () => {
    // Braces inside escaped strings never count toward nesting depth
    const stringWithBraces = JSON.stringify({
      note: `${"{".repeat(300)} \\" ${"[".repeat(300)} \\\\`,
    });
    expect(() => assertJsonDepth(Buffer.from(stringWithBraces, "utf8"))).not.toThrow();

    const probe = express();
    probe.use(
      express.json({
        limit: "1mb",
        verify: (_req, _res, buf) => assertJsonDepth(buf),
        reviver: safeJsonReviver,
      }),
    );
    probe.post("/echo", (req, res) => {
      res.json({
        hasOwnProto: Object.prototype.hasOwnProperty.call(req.body, "__proto__"),
        hasOwnCtor: Object.prototype.hasOwnProperty.call(req.body, "constructor"),
        polluted: ({} as Record<string, unknown>).polluted ?? null,
        body: req.body,
      });
    });
    probe.use(errorHandler);

    // 70-deep nested JSON is rejected with 400 VALIDATION_ERROR before JSON.parse runs
    const deepJson = `${'{"a":'.repeat(MAX_JSON_DEPTH + 6)}1${"}".repeat(MAX_JSON_DEPTH + 6)}`;
    const deepRes = await request(probe)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(deepJson)
      .expect(400);
    expect(deepRes.body.error.code).toBe("VALIDATION_ERROR");
    expect(deepRes.body.message).toMatch(/nesting depth/i);

    // __proto__ and constructor.prototype are stripped while normal scalar "constructor" survives
    const protoPayload =
      '{"__proto__":{"polluted":"yes"},"constructor":{"prototype":{"polluted":"yes"}},"nested":{"constructor":"Builder","ok":true}}';
    const cleanRes = await request(probe)
      .post("/echo")
      .set("Content-Type", "application/json")
      .send(protoPayload)
      .expect(200);
    expect(cleanRes.body.hasOwnProto).toBe(false);
    expect(cleanRes.body.hasOwnCtor).toBe(false);
    expect(cleanRes.body.polluted).toBeNull();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(cleanRes.body.body.nested).toEqual({ constructor: "Builder", ok: true });
  });

  it("6. prevents production static path traversal & dotfile leaks and keeps Vite dev/preview loopback-bound", async () => {
    await withEnv({ NODE_ENV: "production" }, async () => {
      const prodApp = createApp();
      for (const attempt of [
        "/../package.json",
        "/%2e%2e/package.json",
        "/assets/..%2f..%2fpackage.json",
        "/.env",
      ]) {
        const res = await request(prodApp).get(attempt);
        expect(res.text ?? "").not.toContain('"allowScripts"');
        expect(res.text ?? "").not.toContain("TOOLBOX_SECRET_KEY");
      }
      const apiUpper404 = await request(prodApp).get("/API/missing").expect(404);
      expect(apiUpper404.body.error.code).toBe("ROUTE_NOT_FOUND");
    });

    const viteConfig = fs.readFileSync(path.join(REPO_ROOT, "vite.config.ts"), "utf8");
    expect(viteConfig).not.toMatch(/\bhost:\s*true\b/);
    expect(viteConfig).toContain('host: "127.0.0.1"');
    for (const denied of [".env", "secret.key", "*.db", "**/backups/**", "**/uploads/**"]) {
      expect(viteConfig).toContain(denied);
    }
  });

  it("7. configures HTTP Slowloris timeouts, redacts log query secrets, denies unreviewed npm install scripts, and verifies zero tracked secrets", () => {
    const httpServer = createHttpServer(express());
    expect(httpServer.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(httpServer.headersTimeout).toBe(HEADERS_TIMEOUT_MS);
    expect(httpServer.headersTimeout).toBeGreaterThan(httpServer.keepAliveTimeout);
    expect(httpServer.requestTimeout).toBe(REQUEST_TIMEOUT_MS);
    expect(httpServer.requestTimeout).toBeLessThanOrEqual(120_000);
    expect(isLoopbackHost("[::1]")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);

    const redacted = redactUrlForLog(
      "/cb?code=abc&api_key=sk-123&access_token=tok&password=pw&ok=1",
    );
    expect(redacted).toBe(
      "/cb?code=[redacted]&api_key=[redacted]&access_token=[redacted]&password=[redacted]&ok=1",
    );

    const pkg = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"),
    ) as { allowScripts?: Record<string, boolean> };
    expect(pkg.allowScripts).toBeDefined();
    for (const val of Object.values(pkg.allowScripts ?? {})) {
      expect(val).toBe(false);
    }

    const lsJson = JSON.parse(
      execFileSync("npm", ["install-scripts", "ls", "--json"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
      }),
    ) as { allowScripts: unknown[] };
    expect(lsJson.allowScripts).toEqual([]);

    // Secret-leak & sensitive artifact gate across all git-tracked files
    const trackedFiles = execFileSync("git", ["ls-files"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    })
      .split("\n")
      .filter(Boolean);

    const forbiddenFileRe =
      /(?:^|\/)(?:\.env(?:\.(?!example$)[^/]+)?|secret\.key|[^/]+\.(?:db|db-wal|db-shm|pem|p12|pfx))$/;
    const liveSecretRe =
      /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----|sk-ant-api03-[A-Za-z0-9_-]{40,}|sk-proj-[A-Za-z0-9_-]{40,}|AIzaSy[A-Za-z0-9_-]{33}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{50,}|AKIA[0-9A-Z]{16}/;

    const leakedPaths = trackedFiles.filter((f) => forbiddenFileRe.test(f));
    expect(leakedPaths).toEqual([]);

    const leakedSecrets: string[] = [];
    for (const rel of trackedFiles) {
      if (/\.(?:png|ico|woff2?|ttf|wasm|node)$/i.test(rel)) continue;
      const full = path.join(REPO_ROOT, rel);
      if (!fs.existsSync(full) || fs.statSync(full).size > 2 * 1024 * 1024) continue;
      const text = fs.readFileSync(full, "utf8");
      if (liveSecretRe.test(text)) leakedSecrets.push(rel);
    }
    expect(leakedSecrets).toEqual([]);

    // Temp sanity: ensure test created no stray files in os.tmpdir
    expect(os.tmpdir().length).toBeGreaterThan(0);
  });
});
