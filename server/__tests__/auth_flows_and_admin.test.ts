// @vitest-environment node
/**
 * Credential, SSO and instance-admin flows over HTTP with every network
 * boundary faked locally: a raw-socket SMTP server, an in-process OIDC issuer
 * (discovery, JWKS, token endpoint with PKCE + client auth) and a software
 * WebAuthn authenticator. No external service is called.
 */
import crypto from "node:crypto";
import http from "node:http";
import net from "node:net";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.ts";
import { sqlite } from "../platform/db/connection.ts";
import { __resetAdminRateLimits } from "../platform/routes/adminRoutes.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import { setupTwoTenants } from "./testHelpers.ts";

const ORIGIN = "http://localhost:3100";
type Agent = ReturnType<typeof request.agent>;
type Client = Agent | ReturnType<typeof request>;

function listen(server: net.Server): Promise<number> {
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve((server.address() as net.AddressInfo).port)),
  );
}

async function closedPort(): Promise<number> {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

interface Mail {
  auth: string;
  to: string[];
  text: string;
}

/** Minimal ESMTP server: records AUTH PLAIN credentials, recipients and the decoded text body. */
function fakeSmtp() {
  const inbox: Mail[] = [];
  const server = net.createServer((sock) => {
    let mail: Mail = { auth: "", to: [], text: "" };
    let data: string[] | null = null;
    let pending = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      pending += chunk.toString();
      for (let end = pending.indexOf("\r\n"); end !== -1; end = pending.indexOf("\r\n")) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data) {
          if (line !== ".") {
            data.push(line);
            continue;
          }
          const raw = data.join("\n");
          const body = raw.slice(raw.indexOf("\n\n") + 2);
          mail.text = /quoted-printable/i.test(raw)
            ? body
                .replace(/=\n/g, "")
                .replace(/=([0-9A-F]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
            : body;
          inbox.push(mail);
          mail = { auth: mail.auth, to: [], text: "" };
          data = null;
          sock.write("250 queued\r\n");
          continue;
        }
        const [verb = "", , arg = ""] = line.split(" ");
        if (/^EHLO$/i.test(verb)) sock.write("250-fake\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH$/i.test(verb)) {
          mail.auth = Buffer.from(arg, "base64").toString().split("\0").slice(1).join(":");
          sock.write("235 ok\r\n");
        } else if (/^RCPT$/i.test(verb)) {
          mail.to.push(/<(.*)>/.exec(line)?.[1] ?? "");
          sock.write("250 ok\r\n");
        } else if (/^DATA$/i.test(verb)) {
          data = [];
          sock.write("354 go\r\n");
        } else if (/^QUIT$/i.test(verb)) sock.end("221 bye\r\n");
        else sock.write("250 ok\r\n");
      }
    });
  });
  return { server, inbox };
}

function linkToken(mail: Mail, pathname: string): string {
  const url = new RegExp(`${ORIGIN}${pathname}\\?token=\\S+`).exec(mail.text)?.[0];
  if (!url) throw new Error(`No ${pathname} link in: ${mail.text}`);
  return new URL(url).searchParams.get("token")!;
}

const CLIENT_ID = "toolboxClient";
const CLIENT_SECRET = "idpClientSecret42";

/** OIDC issuer on loopback: signs ES256 ID tokens and enforces PKCE, redirect_uri and client_secret_basic. */
async function fakeIdp() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "ES256", use: "sig" };
  const grants = new Map<string, { claims: Record<string, unknown>; challenge: string; redirectUri: string }>();
  let issuer = "";
  const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const { pathname } = new URL(req.url ?? "/", issuer);
    if (pathname === "/.well-known/openid-configuration") {
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["ES256"],
      });
    }
    if (pathname === "/jwks") return send(200, { keys: [jwk] });
    if (pathname !== "/token") return send(404, {});
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const form = new URLSearchParams(raw);
    const grant = grants.get(form.get("code") ?? "");
    grants.delete(form.get("code") ?? "");
    const verifier = crypto.hash("sha256", form.get("code_verifier") ?? "", "base64url");
    const basic = `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64")}`;
    if (
      !grant ||
      verifier !== grant.challenge ||
      form.get("redirect_uri") !== grant.redirectUri ||
      req.headers.authorization !== basic
    ) {
      return send(400, { error: "invalid_grant" });
    }
    const now = Math.floor(Date.now() / 1000);
    const input = `${b64({ alg: "ES256", kid: "k1", typ: "JWT" })}.${b64({ iss: issuer, aud: CLIENT_ID, iat: now, exp: now + 300, ...grant.claims })}`;
    const signature = crypto.sign("sha256", Buffer.from(input), { key: privateKey, dsaEncoding: "ieee-p1363" });
    send(200, {
      access_token: crypto.randomUUID(),
      token_type: "Bearer",
      expires_in: 300,
      id_token: `${input}.${signature.toString("base64url")}`,
    });
  });
  issuer = `http://127.0.0.1:${await listen(server)}`;
  return {
    server,
    issuer,
    /** The user consents at the provider: returns the authorization code the browser carries back. */
    authorize(authUrl: string, claims: Record<string, unknown>): string {
      const q = new URL(authUrl).searchParams;
      expect(authUrl.startsWith(`${issuer}/authorize?`)).toBe(true);
      expect(q.get("client_id")).toBe(CLIENT_ID);
      expect(q.get("code_challenge_method")).toBe("S256");
      const code = crypto.randomUUID();
      grants.set(code, {
        claims: { ...claims, nonce: q.get("nonce") },
        challenge: q.get("code_challenge")!,
        redirectUri: q.get("redirect_uri")!,
      });
      return code;
    },
  };
}

/** Software WebAuthn authenticator (ES256, "none" attestation) bound to rpId `localhost`. */
function softAuthenticator() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const { x, y } = publicKey.export({ format: "jwk" });
  const rawId = crypto.randomBytes(16);
  const id = rawId.toString("base64url");
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  const authData = (flags: number, counter: number, attested: Uint8Array = Buffer.alloc(0)) => {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(counter);
    return Buffer.concat([crypto.hash("sha256", "localhost", "buffer"), Buffer.from([flags]), count, attested]);
  };
  return {
    id,
    attest(challenge: string) {
      const cose = isoCBOR.encode(
        new Map<number, number | Uint8Array>([
          [1, 2],
          [3, -7],
          [-1, 1],
          [-2, Buffer.from(x!, "base64url")],
          [-3, Buffer.from(y!, "base64url")],
        ]),
      );
      const idLength = Buffer.alloc(2);
      idLength.writeUInt16BE(rawId.length);
      const attestation = isoCBOR.encode(
        new Map<string, Uint8Array | string | Map<string, string>>([
          ["fmt", "none"],
          ["attStmt", new Map()],
          ["authData", authData(0x45, 0, Buffer.concat([Buffer.alloc(16), idLength, rawId, cose]))],
        ]),
      );
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          clientDataJSON: b64(clientData("webauthn.create", challenge, ORIGIN)),
          attestationObject: b64(attestation),
          transports: ["internal"],
        },
      };
    },
    assert(challenge: string, counter: number, origin = ORIGIN) {
      const data = authData(0x05, counter);
      const json = clientData("webauthn.get", challenge, origin);
      const signature = crypto.sign("sha256", Buffer.concat([data, crypto.hash("sha256", json, "buffer")]), privateKey);
      return {
        id,
        rawId: id,
        type: "public-key",
        clientExtensionResults: {},
        response: { clientDataJSON: b64(json), authenticatorData: b64(data), signature: b64(signature) },
      };
    },
  };
}

async function passkeyLogin(client: Client, sign: (challenge: string) => unknown) {
  const { ceremonyId, options } = (await client.post("/api/auth/passkeys/login/options").expect(200)).body;
  return client.post("/api/auth/passkeys/login/verify").send({ ceremonyId, response: sign(options.challenge) });
}

const sessionCookieOf = (res: request.Response) =>
  ([] as string[]).concat(res.headers["set-cookie"] ?? []).find((c) => /^toolbox_session=[^;]/.test(c));

describe("Credential lifecycle, email links, passkeys, OIDC SSO & instance administration", () => {
  let app: Express;
  let alice: Agent;
  let bob: Agent;
  let aliceId = "";
  let bobId = "";
  const ALICE_PASSWORD = "alice-strong-password-123";
  let bobPassword = "bob-strong-password-123";
  const smtp = fakeSmtp();
  let smtpPort = 0;
  const secrets: string[] = [CLIENT_SECRET];
  const previousPublicUrl = process.env.PUBLIC_URL;

  const login = (identifier: string, password: string, agent: Client = request(app)) =>
    agent.post("/api/auth/login").send({ identifier, password });
  const bobLogin = () => login("bob_auth", bobPassword, bob).expect(200);

  beforeAll(async () => {
    process.env.PUBLIC_URL = ORIGIN;
    __resetAuthRateLimits();
    __resetAdminRateLimits();
    app = createApp();
    ({ aliceAgent: alice, bobAgent: bob, aliceId, bobId } = await setupTwoTenants(app, "auth"));
    smtpPort = await listen(smtp.server);
  });

  afterAll(async () => {
    if (previousPublicUrl === undefined) delete process.env.PUBLIC_URL;
    else process.env.PUBLIC_URL = previousPublicUrl;
    await new Promise((resolve) => smtp.server.close(resolve));
  });

  it("1. throttles password guessing, honours remember-me and session TTL, rotates passwords, and fences tbk_ tokens", async () => {
    __resetAuthRateLimits();
    for (let i = 0; i < 10; i++) {
      await login(i % 2 ? "bob_auth" : "nobody", "wrong-password-000").expect(401);
    }
    const throttled = await login("bob_auth", bobPassword).expect(429);
    expect(throttled.body.error.code).toBe("RATE_LIMITED");
    expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
    const failures = (await alice.get("/api/admin/audit?action=auth.login.failed&limit=20").expect(200)).body.entries;
    expect(failures.map((e: { details: { matched: boolean } }) => e.details.matched).sort()).toEqual([
      ...Array(5).fill(false),
      ...Array(5).fill(true),
    ]);

    __resetAuthRateLimits();
    await alice.put("/api/admin/settings").send({ sessionTtlDays: 2 }).expect(200);
    const remembered = sessionCookieOf(await login("BOB@auth.test", bobPassword).expect(200))!;
    expect(Number(/Max-Age=(\d+)/.exec(remembered)?.[1])).toBeGreaterThan(2 * 86400 - 60);
    expect(sessionCookieOf(await login("bob_auth", bobPassword).send({ remember: false }).expect(200))).not.toMatch(/Max-Age/);

    const sessions = (await bob.get("/api/auth/sessions").expect(200)).body.sessions as Array<{ current: boolean }>;
    expect(sessions).toHaveLength(3);
    expect(sessions.filter((s) => s.current)).toHaveLength(1);
    expect((await bob.delete("/api/auth/sessions").expect(200)).body.revoked).toBe(2);

    // Password rotation: wrong current password and weak passwords are refused; other sessions end
    const laptop = request.agent(app);
    await login("bob_auth", bobPassword, laptop).expect(200);
    await bob.post("/api/auth/change-password").send({ currentPassword: "nope-nope-nope", newPassword: "bob-rotated-password-456" }).expect(401);
    await bob.post("/api/auth/change-password").send({ currentPassword: bobPassword, newPassword: "short" }).expect(400);
    await bob.post("/api/auth/change-password").send({ currentPassword: bobPassword, newPassword: "bob-rotated-password-456" }).expect(200);
    await laptop.get("/api/auth/me").expect(401);
    await bob.get("/api/auth/me").expect(200);
    await login("bob_auth", bobPassword).expect(401);
    bobPassword = "bob-rotated-password-456";

    // tbk_ tokens: validated expiry, no session-only or admin surfaces, owner-scoped revoke, hard expiry
    await bob.post("/api/auth/tokens").send({ name: "ci", expiresInDays: 0 }).expect(400);
    const token = (await bob.post("/api/auth/tokens").send({ name: "ci", expiresInDays: 30 }).expect(201)).body;
    secrets.push(token.token);
    const bearer = { Authorization: `Bearer ${token.token}` };
    await request(app).get("/api/decks").set(bearer).expect(200);
    expect((await request(app).get("/api/auth/tokens").set(bearer).expect(403)).body.error.code).toBe("SESSION_REQUIRED");
    await alice.delete(`/api/auth/tokens/${token.id}`).expect(404);
    const listed = (await bob.get("/api/auth/tokens").expect(200)).body.tokens;
    expect(JSON.stringify(listed)).not.toContain(token.token);
    await bob.delete(`/api/auth/tokens/${token.id}`).expect(200);
    const revoked = await request(app).get("/api/decks").set(bearer).expect(401);
    expect(revoked.headers["www-authenticate"]).toBe('Bearer realm="toolbox", error="invalid_token"');

    const adminToken = (await alice.post("/api/auth/tokens").send({ name: "ops" }).expect(201)).body;
    secrets.push(adminToken.token);
    const adminBearer = { Authorization: `Bearer ${adminToken.token}` };
    expect((await request(app).get("/api/admin/users").set(adminBearer).expect(403)).body.error.code).toBe("SESSION_REQUIRED");
    sqlite.prepare("UPDATE api_tokens SET expiresAt = ? WHERE id = ?").run("2000-01-01T00:00:00.000Z", adminToken.id);
    await request(app).get("/api/decks").set(adminBearer).expect(401);

    __resetAuthRateLimits();
    for (let i = 0; i < 10; i++) await bob.post("/api/auth/tokens").send({ name: `bulk-${i}` }).expect(201);
    await bob.post("/api/auth/tokens").send({ name: "one-too-many" }).expect(429);
  });

  it("2. seals SMTP credentials and delivers reset, magic-link, invitation and email-change links over real SMTP", async () => {
    const mailConfig = { host: "127.0.0.1", port: smtpPort, user: "mailer", password: "smtp-secret-pass", from: "Toolbox <noreply@auth.test>" };
    secrets.push(mailConfig.password);
    const saved = await alice.put("/api/admin/mail").send(mailConfig).expect(200);
    expect(saved.body).toMatchObject({ source: "settings", hasPassword: true, publicUrl: ORIGIN });
    expect(JSON.stringify(saved.body)).not.toContain(mailConfig.password);
    const stored = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'mail.smtp'").get() as { value: string };
    expect(JSON.parse(stored.value).passwordSealed).toMatch(/^v1:/);
    expect(stored.value).not.toContain(mailConfig.password);

    // Re-saving without a password keeps the sealed one: AUTH still carries it
    await alice.put("/api/admin/mail").send({ ...mailConfig, password: undefined, replyTo: "help@auth.test" }).expect(200);
    __resetAdminRateLimits();
    expect((await alice.post("/api/admin/mail/test").send({}).expect(200)).body.sentTo).toBe("alice@auth.test");
    expect(smtp.inbox.at(-1)).toMatchObject({ auth: "mailer:smtp-secret-pass", to: ["alice@auth.test"] });

    const nextMail = async (count: number) => {
      await vi.waitFor(() => expect(smtp.inbox.length).toBe(count), { timeout: 5000 });
      return smtp.inbox[count - 1]!;
    };

    // Password reset: no account enumeration, single-use links, revokes sessions and tokens
    __resetAuthRateLimits();
    const before = smtp.inbox.length;
    await request(app).post("/api/auth/password-reset/request").send({ email: "ghost@auth.test" }).expect(202);
    await request(app).post("/api/auth/password-reset/request").send({ email: "BOB@auth.test" }).expect(202);
    const resetMail = await nextMail(before + 1);
    expect(resetMail.to).toEqual(["bob@auth.test"]);
    const resetToken = linkToken(resetMail, "/reset-password");
    secrets.push(resetToken);
    const bobToken = (await bob.post("/api/auth/tokens").send({ name: "pre-reset" }).expect(201)).body.token as string;
    await request(app).post("/api/auth/password-reset/complete").send({ token: resetToken, password: "short" }).expect(400);
    expect((await request(app).post("/api/auth/password-reset/complete").send({ token: "f".repeat(64), password: "bob-reset-password-789" }).expect(404)).body.error.code).toBe("LINK_INVALID");
    const phone = request.agent(app);
    const reset = await phone.post("/api/auth/password-reset/complete").send({ token: resetToken, password: "bob-reset-password-789" }).expect(200);
    expect(reset.body.user.id).toBe(bobId);
    bobPassword = "bob-reset-password-789";
    await bob.get("/api/auth/me").expect(401);
    await request(app).get("/api/decks").set("Authorization", `Bearer ${bobToken}`).expect(401);
    await phone.get("/api/auth/me").expect(200);
    expect((await request(app).post("/api/auth/password-reset/complete").send({ token: resetToken, password: "bob-another-password-1" }).expect(410)).body.error.code).toBe("LINK_USED");

    __resetAuthRateLimits();
    await request(app).post("/api/auth/password-reset/request").send({ email: "bob@auth.test" }).expect(202);
    const staleToken = linkToken(await nextMail(before + 2), "/reset-password");
    sqlite.prepare("UPDATE auth_links SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE userId = ? AND usedAt IS NULL").run(bobId);
    expect((await request(app).post("/api/auth/password-reset/complete").send({ token: staleToken, password: "bob-another-password-1" }).expect(410)).body.error.code).toBe("LINK_EXPIRED");

    // Magic links stay off until an admin enables them, then sign in exactly once
    await request(app).post("/api/auth/magic-link/request").send({ email: "bob@auth.test" }).expect(404);
    await alice.put("/api/admin/settings").send({ magicLinkSignIn: true }).expect(200);
    expect((await request(app).get("/api/auth/status").expect(200)).body).toMatchObject({ mailConfigured: true, magicLinkSignIn: true });
    __resetAuthRateLimits();
    await request(app).post("/api/auth/magic-link/request").send({ email: "bob@auth.test" }).expect(202);
    const magicToken = linkToken(await nextMail(before + 3), "/signin-link");
    secrets.push(magicToken);
    await request(app).post("/api/auth/magic-link/complete").send({ token: magicToken }).expect(200);
    await bobLogin();
    expect((await bob.get("/api/auth/me").expect(200)).body.user.username).toBe("bob_auth");
    await request(app).post("/api/auth/magic-link/complete").send({ token: magicToken }).expect(410);

    // Hourly per-account cap (3 links): the 4th request still answers 202 but sends nothing
    __resetAuthRateLimits();
    await request(app).post("/api/auth/magic-link/request").send({ email: "bob@auth.test" }).expect(202);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(smtp.inbox).toHaveLength(before + 3);

    // Email change: needs the current password, confirms at the NEW address, and can be cancelled
    __resetAuthRateLimits();
    await alice.patch("/api/auth/me").send({ email: "alice.new@auth.test" }).expect(401);
    await alice.patch("/api/auth/me").send({ email: "BOB@auth.test", currentPassword: ALICE_PASSWORD }).expect(409);
    const pending = await alice.patch("/api/auth/me").send({ email: "alice.new@auth.test", currentPassword: ALICE_PASSWORD, displayName: "Alice A." }).expect(200);
    expect(pending.body).toMatchObject({ pendingEmail: "alice.new@auth.test", user: { email: "alice@auth.test", displayName: "Alice A." } });
    const confirmMail = await nextMail(before + 4);
    expect(confirmMail.to).toEqual(["alice.new@auth.test"]);
    const confirmToken = linkToken(confirmMail, "/confirm-email");
    expect((await request(app).post("/api/auth/email-change/complete").send({ token: confirmToken }).expect(200)).body.email).toBe("alice.new@auth.test");
    expect((await alice.get("/api/auth/me").expect(200)).body).toMatchObject({ user: { email: "alice.new@auth.test" }, pendingEmail: null });

    await alice.patch("/api/auth/me").send({ email: "alice.other@auth.test", currentPassword: ALICE_PASSWORD }).expect(200);
    const cancelled = linkToken(await nextMail(before + 5), "/confirm-email");
    await alice.delete("/api/auth/email-change").expect(200);
    await request(app).post("/api/auth/email-change/complete").send({ token: cancelled }).expect(410);
    expect((await alice.get("/api/auth/me").expect(200)).body.user.email).toBe("alice.new@auth.test");

    // Emailed invitations and admin reset links use PUBLIC_URL; a failed send discards the link
    const invite = await alice.post("/api/admin/invitations").send({ email: "dana@auth.test", send: true }).expect(201);
    expect(invite.body.sent).toBe(true);
    expect(linkToken(await nextMail(before + 6), "/join")).toBe(new URL(invite.body.link).searchParams.get("token"));
    expect((await alice.post(`/api/admin/users/${bobId}/reset-link`).expect(200)).body.sentTo).toBe("bob@auth.test");
    secrets.push(linkToken(await nextMail(before + 7), "/reset-password"));

    await alice.put("/api/admin/mail").send({ ...mailConfig, port: await closedPort() }).expect(200);
    const linksBefore = sqlite.prepare("SELECT COUNT(*) AS n FROM auth_links WHERE userId = ?").get(bobId) as { n: number };
    expect((await alice.post(`/api/admin/users/${bobId}/reset-link`).expect(502)).body.error.code).toBe("MAIL_SEND_FAILED");
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM auth_links WHERE userId = ?").get(bobId)).toEqual(linksBefore);
    expect((await alice.post("/api/admin/mail/test").send({}).expect(502)).body.error.code).toBe("MAIL_SEND_FAILED");

    // SMTP_URL wins over stored settings and locks the admin form
    process.env.SMTP_URL = `smtp://envuser:${encodeURIComponent("env-pass")}@127.0.0.1:${smtpPort}`;
    try {
      const envView = (await alice.get("/api/admin/mail").expect(200)).body;
      expect(envView).toMatchObject({ source: "env", user: "envuser", hasPassword: true });
      expect(JSON.stringify(envView)).not.toContain("env-pass");
      expect((await alice.put("/api/admin/mail").send(mailConfig).expect(409)).body.error.code).toBe("MAIL_CONFIGURED_BY_ENV");
      await alice.delete("/api/admin/mail").expect(409);
    } finally {
      delete process.env.SMTP_URL;
    }
    expect((await alice.delete("/api/admin/mail").expect(200)).body.source).toBe("none");
    __resetAuthRateLimits();
    await request(app).post("/api/auth/magic-link/request").send({ email: "bob@auth.test" }).expect(404);
    await alice.put("/api/admin/settings").send({ magicLinkSignIn: true }).expect(409);
  });

  it("3. runs passkey ceremonies with a software authenticator and rejects replayed, cloned, foreign-origin and cross-account use", async () => {
    __resetAuthRateLimits();
    const key = softAuthenticator();
    const reg = (await alice.post("/api/auth/passkeys/register/options").expect(200)).body;
    expect(reg.options).toMatchObject({ rp: { id: "localhost" }, attestation: "none" });

    await bobLogin();
    await bob.post("/api/auth/passkeys/register/verify").send({ ceremonyId: reg.ceremonyId, response: key.attest(reg.options.challenge) }).expect(410);
    await alice.post("/api/auth/passkeys/register/verify").send({ ceremonyId: reg.ceremonyId, response: key.attest(reg.options.challenge), name: "x".repeat(101) }).expect(400);
    const added = await alice.post("/api/auth/passkeys/register/verify").send({ ceremonyId: reg.ceremonyId, response: key.attest(reg.options.challenge), name: "Laptop key" }).expect(201);
    expect(added.body.passkey).toMatchObject({ id: key.id, name: "Laptop key", transports: ["internal"], backedUp: false });
    expect((await alice.post("/api/auth/passkeys/register/verify").send({ ceremonyId: reg.ceremonyId, response: key.attest(reg.options.challenge) }).expect(410)).body.error.code).toBe("CEREMONY_EXPIRED");
    const again = (await alice.post("/api/auth/passkeys/register/options").expect(200)).body;
    expect(again.options.excludeCredentials).toEqual([expect.objectContaining({ id: key.id })]);

    __resetAuthRateLimits();
    const browser = request.agent(app);
    const signedIn = await passkeyLogin(browser, (c) => key.assert(c, 1));
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.id).toBe(aliceId);
    const sessions = (await browser.get("/api/auth/sessions").expect(200)).body.sessions as Array<{ current: boolean; method: string }>;
    expect(sessions.find((s) => s.current)?.method).toBe("passkey");

    // A cloned authenticator replays an old signature counter
    expect((await passkeyLogin(request(app), (c) => key.assert(c, 1))).body.error.code).toBe("PASSKEY_VERIFICATION_FAILED");
    expect((await passkeyLogin(request(app), (c) => key.assert(c, 2, "https://evil.example"))).status).toBe(401);
    expect((await passkeyLogin(request(app), (c) => softAuthenticator().assert(c, 1))).body.error.code).toBe("PASSKEY_NOT_FOUND");

    __resetAuthRateLimits();
    const { ceremonyId, options } = (await request(app).post("/api/auth/passkeys/login/options").expect(200)).body;
    const assertion = key.assert(options.challenge, 3);
    await request(app).post("/api/auth/passkeys/login/verify").send({ ceremonyId, response: assertion }).expect(200);
    await request(app).post("/api/auth/passkeys/login/verify").send({ ceremonyId, response: assertion }).expect(410);

    sqlite.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(aliceId);
    try {
      expect((await passkeyLogin(request(app), (c) => key.assert(c, 4))).body.error.code).toBe("ACCOUNT_DISABLED");
    } finally {
      sqlite.prepare("UPDATE users SET status = 'active' WHERE id = ?").run(aliceId);
    }

    // Management is scoped to the owner
    await bob.patch(`/api/auth/passkeys/${key.id}`).send({ name: "Stolen" }).expect(404);
    await bob.delete(`/api/auth/passkeys/${key.id}`).expect(404);
    await alice.patch(`/api/auth/passkeys/${key.id}`).send({ name: "   " }).expect(400);
    await alice.patch(`/api/auth/passkeys/${key.id}`).send({ name: "Desk key" }).expect(200);
    await alice.post("/api/auth/passkey-nudge/dismiss").expect(200);
    expect((await alice.get("/api/auth/passkeys").expect(200)).body).toMatchObject({
      nudgeDismissed: true,
      passkeys: [{ id: key.id, name: "Desk key", lastUsedAt: expect.any(String) }],
    });
    expect((await bob.get("/api/auth/passkeys").expect(200)).body.passkeys).toEqual([]);
    await alice.delete(`/api/auth/passkeys/${key.id}`).expect(200);
    __resetAuthRateLimits();
    expect((await passkeyLogin(request(app), (c) => key.assert(c, 5))).status).toBe(404);
  });

  it("4. signs in and links accounts through a local OIDC issuer with PKCE, nonce, browser binding and email-trust checks", async () => {
    const idp = await fakeIdp();
    try {
      const provider = { issuer: idp.issuer, clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, name: "Corp SSO", matchByEmail: false };
      await alice.put("/api/admin/integrations").send({ oidc: { ...provider, issuer: "http://idp.example.com" } }).expect(400);
      const dead = await alice.put("/api/admin/integrations").send({ oidc: { ...provider, issuer: `http://127.0.0.1:${await closedPort()}` } }).expect(400);
      expect(dead.body.error.code).toBe("OIDC_DISCOVERY_FAILED");
      const saved = (await alice.put("/api/admin/integrations").send({ oidc: provider }).expect(200)).body;
      expect(saved.oidc).toMatchObject({ configured: true, source: "setting", clientSecretPreview: "••••et42", redirectUri: `${ORIGIN}/api/auth/oidc/callback` });
      const sealed = sqlite.prepare("SELECT value FROM app_settings WHERE key = 'auth.oidc'").get() as { value: string };
      expect(sealed.value).toMatch(/^"v1:/);
      expect(sealed.value).not.toContain(CLIENT_SECRET);
      expect((await request(app).get("/api/auth/status").expect(200)).body.oidc).toEqual({ name: "Corp SSO" });

      __resetAuthRateLimits();
      const start = async (agent: Agent, query = "") =>
        (await agent.get(`/api/auth/oidc/start${query}`).redirects(0).expect(302)).headers.location as string;
      const callback = async (agent: Agent, authUrl: string, claims: Record<string, unknown> | null) => {
        const state = new URL(authUrl).searchParams.get("state");
        const params = claims ? `code=${idp.authorize(authUrl, claims)}` : "error=access_denied";
        const res = await agent.get(`/api/auth/oidc/callback?${params}&state=${state}`).redirects(0).expect(302);
        return { landing: res.headers.location as string, session: sessionCookieOf(res) };
      };
      const fresh = async (claims: Record<string, unknown>, query = "") => {
        const browser = request.agent(app);
        return callback(browser, await start(browser, query), claims);
      };
      const aliceClaims = { sub: "alice-sub", email: "alice.new@auth.test", email_verified: true };

      // Unknown identity without email matching: no session
      expect(await fresh(aliceClaims)).toEqual({ landing: "/?oidc=no-account", session: undefined });
      const victim = request.agent(app);
      const victimUrl = await start(victim);
      expect((await callback(request.agent(app), victimUrl, aliceClaims)).landing).toBe("/?oidc=failed");
      expect((await callback(victim, await start(victim), null)).landing).toBe("/?oidc=denied");
      const slow = request.agent(app);
      const slowUrl = await start(slow);
      sqlite.prepare("UPDATE auth_challenges SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(new URL(slowUrl).searchParams.get("state"));
      expect((await callback(slow, slowUrl, aliceClaims)).landing).toBe("/?oidc=expired");

      // Linking needs the current password, then the identity signs in and honours safe returnTo only
      __resetAuthRateLimits();
      await alice.post("/api/auth/oidc/link").send({ currentPassword: "wrong-password-0" }).expect(401);
      const linkUrl = (await alice.post("/api/auth/oidc/link").send({ currentPassword: ALICE_PASSWORD }).expect(200)).body.url;
      expect((await callback(alice, linkUrl, aliceClaims)).landing).toBe("/settings?oidc=linked");
      const identities = (await alice.get("/api/auth/identities").expect(200)).body;
      expect(identities).toMatchObject({ matchByEmail: false, identities: [{ issuer: idp.issuer, current: true }] });

      const sso = request.agent(app);
      const signedIn = await callback(sso, await start(sso, "?returnTo=/k/system-design"), aliceClaims);
      expect(signedIn.landing).toBe("/k/system-design");
      expect(signedIn.session).toBeDefined();
      expect((await sso.get("/api/auth/me").expect(200)).body.user.id).toBe(aliceId);
      expect((await callback(sso, await start(sso, "?returnTo=//evil.example/x"), aliceClaims)).landing).toBe("/");

      __resetAuthRateLimits();
      await bobLogin();
      const bobLink = (await bob.post("/api/auth/oidc/link").send({ currentPassword: bobPassword }).expect(200)).body.url;
      expect((await callback(bob, bobLink, aliceClaims)).landing).toBe("/settings?oidc=taken");

      await alice.delete(`/api/auth/identities/${identities.identities[0].id}`).send({ currentPassword: "wrong-password-0" }).expect(401);
      await alice.delete(`/api/auth/identities/${identities.identities[0].id}`).send({ currentPassword: ALICE_PASSWORD }).expect(200);
      expect((await fresh(aliceClaims)).landing).toBe("/?oidc=no-account");

      // Email matching: re-saving without a secret keeps it; only a verified email that the instance trusts matches
      __resetAuthRateLimits();
      await alice.put("/api/admin/integrations").send({ oidc: { ...provider, clientSecret: undefined, matchByEmail: true } }).expect(200);
      const bobClaims = { sub: "bob-sub", email: "BOB@auth.test", email_verified: true };
      expect((await fresh({ ...bobClaims, email_verified: false })).landing).toBe("/?oidc=no-account");
      const bobSso = request.agent(app);
      expect((await callback(bobSso, await start(bobSso), bobClaims)).session).toBeDefined();
      expect((await bobSso.get("/api/auth/me").expect(200)).body.user.id).toBe(bobId);

      await alice.post(`/api/admin/users/${bobId}/disable`).expect(200);
      expect(await fresh(bobClaims)).toEqual({ landing: "/?oidc=disabled", session: undefined });
      await alice.post(`/api/admin/users/${bobId}/enable`).expect(200);

      // An admin password reset unlinks SSO and forces a password change before SSO works again
      const { temporaryPassword } = (await alice.post(`/api/admin/users/${bobId}/reset-password`).expect(200)).body;
      secrets.push(temporaryPassword);
      expect(sqlite.prepare("SELECT COUNT(*) AS n FROM user_identities WHERE userId = ?").get(bobId)).toEqual({ n: 0 });
      __resetAuthRateLimits();
      expect((await fresh(bobClaims)).landing).toBe("/?oidc=must-change-password");
      await login("bob_auth", temporaryPassword, bob).expect(200);
      await bob.post("/api/auth/change-password").send({ currentPassword: temporaryPassword, newPassword: "bob-final-password-321" }).expect(200);
      bobPassword = "bob-final-password-321";
    } finally {
      await new Promise((resolve) => idp.server.close(resolve));
    }
  });

  it("5. manages accounts, invitations and instance settings with last-admin, self-target and purge guards", async () => {
    __resetAuthRateLimits();
    const created = await alice.post("/api/admin/users").send({ email: "carol@auth.test", username: "carol", role: "member" }).expect(201);
    const carolId = created.body.user.id as string;
    const temporary = created.body.temporaryPassword as string;
    secrets.push(temporary);
    expect(temporary).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(created.body.user).toMatchObject({ mustChangePassword: true, isSelf: false, role: "member" });
    await alice.post("/api/admin/users").send({ email: "CAROL@auth.test", username: "carol2" }).expect(409);

    const carol = request.agent(app);
    await login("carol", temporary, carol).expect(200);
    expect((await carol.get("/api/decks").expect(403)).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    await carol.post("/api/auth/change-password").send({ currentPassword: temporary, newPassword: "carol-strong-password-1" }).expect(200);
    const deck = (await carol.post("/api/decks").send({ name: "Carol Deck" }).expect(201)).body;
    await carol.post(`/api/decks/${deck.id}/cards`).send({ front: "Carol Q", back: "Carol A" }).expect(201);
    expect((await carol.get("/api/admin/users").expect(403)).body.error.code).toBe("ADMIN_REQUIRED");

    expect((await alice.patch(`/api/admin/users/${aliceId}`).send({ role: "member" }).expect(409)).body.error.code).toBe("LAST_ADMIN");
    expect((await alice.post(`/api/admin/users/${aliceId}/reset-password`).expect(400)).body.error.code).toBe("CANNOT_TARGET_SELF");
    await alice.patch(`/api/admin/users/${carolId}`).send({}).expect(400);
    await alice.patch(`/api/admin/users/${carolId}`).send({ role: "admin", displayName: "  Carol C.  " }).expect(200);
    await carol.get("/api/admin/users").expect(200);
    expect((await alice.patch(`/api/admin/users/${carolId}`).send({ role: "member" }).expect(200)).body.user).toMatchObject({ role: "member", displayName: "Carol C." });

    const disabled = (await alice.post(`/api/admin/users/${carolId}/disable`).expect(200)).body.user;
    expect(disabled).toMatchObject({ status: "disabled", sessionCount: 0 });
    await carol.get("/api/decks").expect(401);
    expect((await login("carol", "carol-strong-password-1").expect(403)).body.error.code).toBe("ACCOUNT_DISABLED");
    await alice.post(`/api/admin/users/${carolId}/enable`).expect(200);
    await login("carol", "carol-strong-password-1", carol).expect(200);

    // Invitations: revoked, expired and used links all die with 410; accepted ones cannot be revoked
    const revokedInvite = (await alice.post("/api/admin/invitations").send({ role: "member", expiresInDays: 1 }).expect(201)).body;
    const revokedToken = new URL(revokedInvite.link).searchParams.get("token");
    await alice.delete(`/api/admin/invitations/${revokedInvite.id}`).expect(200);
    expect((await request(app).post("/api/auth/invitations/check").send({ token: revokedToken }).expect(410)).body.error.code).toBe("INVITATION_REVOKED");
    await request(app).post("/api/auth/accept-invitation").send({ token: revokedToken, email: "eve@auth.test", username: "eve", password: "eve-strong-password-1" }).expect(410);
    const staleInvite = (await alice.post("/api/admin/invitations").send({ role: "admin" }).expect(201)).body;
    sqlite.prepare("UPDATE invitations SET expiresAt = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(staleInvite.id);
    expect((await request(app).post("/api/auth/invitations/check").send({ token: new URL(staleInvite.link).searchParams.get("token") }).expect(410)).body.error.code).toBe("INVITATION_EXPIRED");
    const invitations = (await alice.get("/api/admin/invitations").expect(200)).body.invitations as Array<{ id: string; status: string; email: string | null }>;
    const accepted = invitations.find((i) => i.email === "bob@auth.test")!;
    expect(accepted.status).toBe("accepted");
    expect(invitations.find((i) => i.id === staleInvite.id)?.status).toBe("expired");
    expect((await alice.delete(`/api/admin/invitations/${accepted.id}`).expect(409)).body.error.code).toBe("INVITATION_USED");

    // Settings validation and open registration
    await alice.put("/api/admin/settings").send({}).expect(400);
    await alice.put("/api/admin/settings").send({ sessionTtlDays: 0 }).expect(400);
    await alice.put("/api/admin/settings").send({ sessionTtlDays: 366 }).expect(400);
    await alice.put("/api/admin/settings").send({ instanceName: "x".repeat(61) }).expect(400);
    process.env.BACKUP_KEEP = "3";
    try {
      expect((await alice.put("/api/admin/settings").send({ backupKeep: 2 }).expect(409)).body.error.code).toBe("SET_BY_ENVIRONMENT");
      expect((await alice.get("/api/admin/settings").expect(200)).body).toMatchObject({ backupKeep: 3, backupKeepSource: "env" });
    } finally {
      delete process.env.BACKUP_KEEP;
    }
    const newcomer = { email: "frank@auth.test", username: "frank", password: "frank-strong-password-1" };
    expect((await request(app).post("/api/auth/register").send(newcomer).expect(403)).body.error.code).toBe("REGISTRATION_CLOSED");
    const settings = (await alice.put("/api/admin/settings").send({ registrationOpen: true, instanceName: " Study\u0007Lab " }).expect(200)).body;
    expect(settings).toMatchObject({ registrationOpen: true, instanceName: "Study Lab" });
    expect((await request(app).post("/api/auth/register").send(newcomer).expect(201)).body.user.role).toBe("member");
    expect((await request(app).get("/api/auth/status").expect(200)).body).toMatchObject({ instanceName: "Study Lab", registrationOpen: true });

    // Deleting an account needs an explicit purge and removes only that tenant's data
    const aliceDecksBefore = (await alice.get("/api/decks").expect(200)).body.length;
    const refused = await alice.delete(`/api/admin/users/${carolId}`).expect(409);
    expect(refused.body.error).toMatchObject({ code: "USER_HAS_DATA", details: { counts: { decks: 1, flashcards: 1 } } });
    expect((await alice.delete(`/api/admin/users/${aliceId}`).send({ decision: "purge" }).expect(409)).body.error.code).toBe("LAST_ADMIN");
    expect((await alice.delete(`/api/admin/users/${carolId}`).send({ decision: "purge" }).expect(200)).body).toMatchObject({ deleted: true });
    for (const table of ["kits", "decks", "flashcards", "rag_chunks"]) {
      expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ownerId = ?`).get(carolId), table).toEqual({ n: 0 });
    }
    await carol.get("/api/auth/me").expect(401);
    expect((await alice.get("/api/decks").expect(200)).body).toHaveLength(aliceDecksBefore);
    await alice.get(`/api/admin/users/${carolId}`).expect(404);
  });

  it("6. snapshots, rotates and serves verified backups to admins only, and keeps every secret out of the audit log", async () => {
    await bob.get("/api/admin/backups").expect(403);
    await alice.put("/api/admin/settings").send({ backupKeep: 2 }).expect(200);
    for (let i = 0; i < 3; i++) {
      const { backup } = (await alice.post("/api/admin/backups").expect(201)).body;
      expect(backup.verification).toMatchObject({ ok: true, integrity: "ok" });
      expect(backup.verification.rows.users).toBe(backup.verification.liveRows.users);
    }
    const backups = (await alice.get("/api/admin/backups").expect(200)).body.backups as Array<{ filename: string; verification: unknown }>;
    expect(backups).toHaveLength(2);
    expect(backups.every((b) => b.verification !== null)).toBe(true);

    const download = await alice
      .get(`/api/admin/backups/${backups[0]!.filename}`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((download.body as Buffer).subarray(0, 15).toString()).toBe("SQLite format 3");
    expect(download.headers["content-disposition"]).toContain(backups[0]!.filename);
    for (const probe of ["..%2F..%2Fsecret.key", "toolbox-missing.db", `${backups[0]!.filename}.json`]) {
      expect((await alice.get(`/api/admin/backups/${probe}`).expect(404)).body.error.code).toBe("BACKUP_NOT_FOUND");
    }

    await alice.get("/api/admin/audit?action=auth.bogus").expect(400);
    await alice.get("/api/admin/audit?limit=0").expect(400);
    const created = (await alice.get("/api/admin/audit?action=backup.created,backup.downloaded").expect(200)).body.entries as Array<{ action: string; actor: { username: string } }>;
    expect(created.map((e) => e.action).sort()).toEqual(["backup.created", "backup.created", "backup.created", "backup.downloaded"]);
    expect(created.every((e) => e.actor.username === "alice_auth")).toBe(true);

    const entries: unknown[] = [];
    let before: string | null = "";
    while (before !== null) {
      const page: { entries: unknown[]; nextBefore: string | null } = (
        await alice.get(`/api/admin/audit?limit=50${before ? `&before=${encodeURIComponent(before)}` : ""}`).expect(200)
      ).body;
      entries.push(...page.entries);
      before = page.nextBefore;
    }
    expect(new Set(entries.map((e) => (e as { id: string }).id)).size).toBe(entries.length);
    expect(entries.length).toBeGreaterThan(50);
    const serialized = JSON.stringify(entries);
    for (const secret of [...secrets, ALICE_PASSWORD, bobPassword]) {
      expect(serialized).not.toContain(secret);
    }
  });
});
