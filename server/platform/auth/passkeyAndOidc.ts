import crypto from "node:crypto";
import type { Request } from "express";
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type AuthenticatorTransport,
} from "@simplewebauthn/server";
import * as client from "openid-client";
import { ResponseBodyError } from "openid-client";
import {
  describeDevice,
  isAllowedIssuer,
  normalizeIssuer,
  type PasskeySummary,
} from "../../../shared/platform/auth.ts";
import { APP_NAME } from "../../appConfig.ts";
import { auditService } from "../audit/auditService.ts";
import { sqlite } from "../db/connection.ts";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
  getErrorMessage,
  log,
} from "../net/errors.ts";
import { getPasskeyRp, safeFetch } from "../net/originAndFetch.ts";
import {
  getOidcConfig,
  setOidcConfig,
  setUserSetting,
  getUserSetting,
  type OidcConfig,
  type OidcConfigInput,
} from "../settings/settingsService.ts";
import {
  createSession,
  findUserByTrustedEmail,
  getInstanceName,
  getUserById,
  type User,
} from "./authService.ts";

// ============================================================================
// Passkeys (@simplewebauthn/server)
// ============================================================================

interface PasskeyRow {
  id: string;
  userId: string;
  name: string;
  publicKey: Buffer;
  counter: number;
  transports: string | null;
  deviceType: string;
  backedUp: number;
  aaguid: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

function rowToSummary(row: PasskeyRow): PasskeySummary {
  let transports: string[] | null = null;
  if (row.transports) {
    try {
      transports = JSON.parse(row.transports);
    } catch {
      transports = null;
    }
  }
  return {
    id: row.id,
    name: row.name,
    deviceType: row.deviceType,
    backedUp: Boolean(row.backedUp),
    transports,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
  };
}

export async function createRegistrationOptions(
  req: Request,
  user: User,
): Promise<{
  ceremonyId: string;
  options: PublicKeyCredentialCreationOptionsJSON;
}> {
  const { rpID } = getPasskeyRp(req);
  const existingPasskeys = sqlite
    .prepare("SELECT id, transports FROM passkeys WHERE userId = ?")
    .all(user.id) as { id: string; transports: string | null }[];

  const excludeCredentials = existingPasskeys.map((p) => {
    let transports: AuthenticatorTransport[] | undefined;
    if (p.transports) {
      try {
        transports = JSON.parse(p.transports) as AuthenticatorTransport[];
      } catch {
        transports = undefined;
      }
    }
    return { id: p.id, transports };
  });

  const options = await generateRegistrationOptions({
    rpName: getInstanceName() || APP_NAME,
    rpID,
    userID: new Uint8Array(Buffer.from(user.id, "utf8")),
    userName: user.username,
    userDisplayName: user.displayName || user.username,
    attestationType: "none",
    excludeCredentials,
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  const ceremonyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, userId, challenge, expiresAt)
       VALUES (?, 'register', ?, ?, ?)`,
    )
    .run(ceremonyId, user.id, options.challenge, expiresAt);

  return { ceremonyId, options };
}

const PASSKEY_NAME_MAX = 100;

export async function verifyRegistration(
  req: Request,
  user: User,
  ceremonyId: string,
  response: RegistrationResponseJSON,
  name?: unknown,
): Promise<{ passkey: PasskeySummary }> {
  if (!ceremonyId || !response) {
    throw new AppError("Invalid registration payload.", 400, {
      code: "VALIDATION_ERROR",
    });
  }
  if (
    name !== undefined &&
    name !== null &&
    (typeof name !== "string" || name.trim().length > PASSKEY_NAME_MAX)
  ) {
    throw new AppError(
      `Passkey name must be at most ${PASSKEY_NAME_MAX} characters.`,
      400,
      { code: "VALIDATION_ERROR" },
    );
  }

  const challengeRow = sqlite
    .prepare(
      `DELETE FROM auth_challenges
        WHERE id = ? AND kind = 'register' AND userId = ?
        RETURNING id, challenge, expiresAt`,
    )
    .get(ceremonyId, user.id) as
    | { id: string; challenge: string; expiresAt: string }
    | undefined;

  if (!challengeRow || new Date(challengeRow.expiresAt).getTime() <= Date.now()) {
    throw new AppError("Passkey ceremony expired or not found.", 410, {
      code: "CEREMONY_EXPIRED",
    });
  }

  const { rpID, origin } = getPasskeyRp(req);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    });
  } catch (cause) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
      cause,
    });
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
    });
  }

  const { credential, credentialDeviceType, credentialBackedUp, aaguid } =
    verification.registrationInfo;

  const passkeyName =
    (typeof name === "string" ? name.trim() : "") ||
    describeDevice(req.headers["user-agent"] ?? null);
  const rawTransports =
    response.response.transports ?? credential.transports ?? null;
  const transports = rawTransports ? JSON.stringify(rawTransports) : null;

  sqlite
    .prepare(
      `INSERT INTO passkeys (id, userId, name, publicKey, counter, transports, deviceType, backedUp, aaguid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      credential.id,
      user.id,
      passkeyName,
      Buffer.from(credential.publicKey),
      credential.counter,
      transports,
      credentialDeviceType,
      credentialBackedUp ? 1 : 0,
      aaguid || null,
    );

  const inserted = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(credential.id, user.id) as PasskeyRow;

  auditService.record({
    actorUserId: user.id,
    action: "auth.passkey.added",
    targetType: "passkey",
    targetId: credential.id,
    details: { name: passkeyName },
    ip: req.ip ?? null,
  });

  return { passkey: rowToSummary(inserted) };
}

export function listPasskeys(userId: string): PasskeySummary[] {
  const rows = sqlite
    .prepare(
      `SELECT id, userId, name, publicKey, counter, transports, deviceType, backedUp, aaguid, createdAt, lastUsedAt
         FROM passkeys WHERE userId = ? ORDER BY createdAt DESC`,
    )
    .all(userId) as PasskeyRow[];
  return rows.map(rowToSummary);
}

export function renamePasskey(
  req: Request,
  userId: string,
  id: string,
  name: string,
): { passkey: PasskeySummary } {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (!trimmed || trimmed.length > PASSKEY_NAME_MAX) {
    throw new AppError(
      `Passkey name must be between 1 and ${PASSKEY_NAME_MAX} characters.`,
      400,
      { code: "VALIDATION_ERROR" },
    );
  }
  const existing = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(id, userId) as PasskeyRow | undefined;
  if (!existing) {
    throw new AppError("Passkey not found.", 404, { code: "PASSKEY_NOT_FOUND" });
  }
  sqlite
    .prepare("UPDATE passkeys SET name = ? WHERE id = ? AND userId = ?")
    .run(trimmed, id, userId);
  const updated = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(id, userId) as PasskeyRow;
  auditService.record({
    actorUserId: userId,
    action: "auth.passkey.renamed",
    targetType: "passkey",
    targetId: id,
    details: { name: trimmed },
    ip: req.ip ?? null,
  });
  return { passkey: rowToSummary(updated) };
}

export function removePasskey(
  req: Request,
  userId: string,
  id: string,
): { ok: boolean } {
  const existing = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ? AND userId = ?")
    .get(id, userId) as PasskeyRow | undefined;
  if (!existing) {
    throw new AppError("Passkey not found.", 404, { code: "PASSKEY_NOT_FOUND" });
  }
  sqlite
    .prepare("DELETE FROM passkeys WHERE id = ? AND userId = ?")
    .run(id, userId);
  auditService.record({
    actorUserId: userId,
    action: "auth.passkey.removed",
    targetType: "passkey",
    targetId: id,
    details: { name: existing.name },
    ip: req.ip ?? null,
  });
  return { ok: true };
}

export async function createLoginOptions(req: Request): Promise<{
  ceremonyId: string;
  options: PublicKeyCredentialRequestOptionsJSON;
}> {
  const { rpID } = getPasskeyRp(req);
  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials: [],
  });
  const ceremonyId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, userId, challenge, expiresAt)
       VALUES (?, 'login', NULL, ?, ?)`,
    )
    .run(ceremonyId, options.challenge, expiresAt);
  return { ceremonyId, options };
}

export async function verifyLogin(
  req: Request,
  ceremonyId: string,
  response: AuthenticationResponseJSON,
): Promise<{ user: User }> {
  if (!ceremonyId || !response || typeof response !== "object" || !response.id) {
    throw new AppError("Passkey not found.", 404, { code: "PASSKEY_NOT_FOUND" });
  }
  const challengeRow = sqlite
    .prepare(
      `DELETE FROM auth_challenges
        WHERE id = ? AND kind = 'login'
        RETURNING id, challenge, expiresAt`,
    )
    .get(ceremonyId) as
    | { id: string; challenge: string; expiresAt: string }
    | undefined;

  if (!challengeRow || new Date(challengeRow.expiresAt).getTime() <= Date.now()) {
    throw new AppError("Passkey ceremony expired or not found.", 410, {
      code: "CEREMONY_EXPIRED",
    });
  }

  const passkey = sqlite
    .prepare("SELECT * FROM passkeys WHERE id = ?")
    .get(response.id) as PasskeyRow | undefined;
  if (!passkey) {
    throw new AppError("Passkey not found.", 404, { code: "PASSKEY_NOT_FOUND" });
  }
  const user = getUserById(passkey.userId);
  if (!user) {
    throw new AppError("Passkey not found.", 404, { code: "PASSKEY_NOT_FOUND" });
  }

  const { rpID, origin } = getPasskeyRp(req);
  let transports: AuthenticatorTransport[] | undefined;
  if (passkey.transports) {
    try {
      transports = JSON.parse(passkey.transports) as AuthenticatorTransport[];
    } catch {
      transports = undefined;
    }
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      credential: {
        id: passkey.id,
        publicKey: new Uint8Array(passkey.publicKey),
        counter: passkey.counter,
        transports,
      },
      requireUserVerification: false,
    });
  } catch (cause) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
      cause,
    });
  }

  if (!verification.verified) {
    throw new AppError("Passkey verification failed.", 401, {
      code: "PASSKEY_VERIFICATION_FAILED",
    });
  }

  sqlite
    .prepare(
      `UPDATE passkeys SET counter = ?, lastUsedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    )
    .run(verification.authenticationInfo.newCounter, passkey.id);
  if (user.status !== "disabled") {
    sqlite
      .prepare("UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?")
      .run(user.id);
  }
  return { user };
}

export function isPasskeyNudgeDismissed(userId: string): boolean {
  return getUserSetting<string>(userId, "auth.passkeyNudge") === "dismissed";
}

export function dismissPasskeyNudge(userId: string): void {
  setUserSetting(userId, "auth.passkeyNudge", "dismissed");
}

// ============================================================================
// OIDC SSO & Account Identities (openid-client)
// ============================================================================

const FLOW_TTL_SECONDS = 10 * 60;
export const FLOW_COOKIE_SECONDS = 3 * FLOW_TTL_SECONDS;
const OIDC_SCOPE = "openid email profile";
const DISCOVERY_TTL_MS = 60 * 60 * 1000;

export interface OidcClaims {
  issuer: string;
  subject: string;
  email: string | null;
  emailVerified: boolean;
}

interface FlowData {
  codeVerifier: string;
  nonce: string;
  remember: boolean;
  returnTo: string | null;
  binding: string;
}

export interface OidcFlow extends FlowData {
  userId: string | null;
  expired: boolean;
}

export function safeReturnTo(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  return /^\/(?![/\\])[^\\\p{Cc}]*$/u.test(value) ? value : null;
}

const viaSafeFetch: client.CustomFetch = async (url, options) => {
  const { body } = options;
  if (
    body != null &&
    typeof body !== "string" &&
    !(body instanceof URLSearchParams)
  ) {
    throw new AppError("Unsupported OIDC request body", 500);
  }
  const { response } = await safeFetch(url, {
    method: options.method,
    headers: options.headers,
    body: body == null ? undefined : String(body),
    signal: options.signal,
    redirect: options.redirect,
    allowPrivate: true,
    timeoutMs: 10_000,
  });
  return response;
};

let cachedDiscovery: {
  key: string;
  at: number;
  config: client.Configuration;
} | null = null;

export function forgetOidcDiscovery(): void {
  cachedDiscovery = null;
}

function requireOidcConfig(): OidcConfig {
  const config = getOidcConfig();
  if (!config) {
    throw new AppError("Single sign-on is not set up", 404, {
      code: "OIDC_NOT_CONFIGURED",
    });
  }
  return config;
}

async function discover(config: OidcConfigInput): Promise<client.Configuration> {
  const key = `${config.issuer}\n${config.clientId}\n${config.clientSecret}`;
  if (
    cachedDiscovery?.key === key &&
    Date.now() - cachedDiscovery.at < DISCOVERY_TTL_MS
  ) {
    return cachedDiscovery.config;
  }
  if (!isAllowedIssuer(config.issuer)) {
    throw new AppError("The OIDC issuer must use https://", 400, {
      code: "OIDC_INSECURE_ISSUER",
    });
  }
  const insecure = new URL(config.issuer).protocol === "http:";
  const discovered = await client.discovery(
    new URL(config.issuer),
    config.clientId,
    undefined,
    client.ClientSecretBasic(config.clientSecret),
    {
      [client.customFetch]: viaSafeFetch,
      timeout: 10,
      ...(insecure ? { execute: [client.allowInsecureRequests] } : {}),
    },
  );
  client.enableNonRepudiationChecks(discovered);
  cachedDiscovery = { key, at: Date.now(), config: discovered };
  return discovered;
}

export async function saveOidcProvider(
  input:
    | (Omit<OidcConfigInput, "clientSecret"> & { clientSecret?: string })
    | null,
): Promise<void> {
  forgetOidcDiscovery();
  if (!input) {
    setOidcConfig(null);
    return;
  }
  const saved = getOidcConfig();
  const sameProvider =
    saved !== null &&
    normalizeIssuer(saved.issuer) === normalizeIssuer(input.issuer) &&
    saved.clientId === input.clientId;
  const clientSecret =
    input.clientSecret || (sameProvider ? saved.clientSecret : "");
  if (!clientSecret) throw new ValidationError("Client secret is required");
  const config = { ...input, clientSecret };
  const unchanged =
    saved?.issuer === config.issuer &&
    saved.clientId === config.clientId &&
    saved.clientSecret === config.clientSecret;
  if (unchanged) {
    setOidcConfig(config);
    return;
  }
  try {
    await discover(config);
  } catch (err) {
    throw new AppError(
      `The provider did not answer discovery: ${getErrorMessage(err)}`,
      400,
      { code: "OIDC_DISCOVERY_FAILED", cause: err },
    );
  }
  setOidcConfig(config);
}

const sha256 = (value: string) => crypto.hash("sha256", value);

export async function startOidc(input: {
  redirectUri: string;
  linkUserId: string | null;
  remember?: boolean;
  returnTo?: string | null;
}): Promise<{ url: string; state: string; binding: string }> {
  const config = await discover(requireOidcConfig());
  const codeVerifier = client.randomPKCECodeVerifier();
  const nonce = client.randomNonce();
  const state = client.randomState();
  const binding = client.randomState();
  sqlite
    .prepare(
      `INSERT INTO auth_challenges (id, kind, userId, challenge, expiresAt)
       VALUES (?, 'oidc', ?, ?, ?)`,
    )
    .run(
      state,
      input.linkUserId,
      JSON.stringify({
        codeVerifier,
        nonce,
        remember: input.remember !== false,
        returnTo: safeReturnTo(input.returnTo),
        binding: sha256(binding),
      } satisfies FlowData),
      new Date(Date.now() + FLOW_TTL_SECONDS * 1000).toISOString(),
    );
  const url = client
    .buildAuthorizationUrl(config, {
      redirect_uri: input.redirectUri,
      scope: OIDC_SCOPE,
      code_challenge: await client.calculatePKCECodeChallenge(codeVerifier),
      code_challenge_method: "S256",
      state,
      nonce,
    })
    .toString();
  return { url, state, binding };
}

export function takeOidcFlow(state: string, binding: string): OidcFlow | null {
  const row = sqlite
    .prepare(
      `DELETE FROM auth_challenges
        WHERE id = ? AND kind = 'oidc'
          AND json_extract(challenge, '$.binding') = ?
       RETURNING userId, challenge, expiresAt`,
    )
    .get(state, sha256(binding)) as
    | { userId: string | null; challenge: string; expiresAt: string }
    | undefined;
  if (!row) return null;
  return {
    ...(JSON.parse(row.challenge) as FlowData),
    userId: row.userId,
    expired: new Date(row.expiresAt).getTime() <= Date.now(),
  };
}

export async function finishOidc(
  callbackUrl: URL,
  flow: OidcFlow,
): Promise<OidcClaims> {
  const config = await discover(requireOidcConfig());
  const tokens = await client.authorizationCodeGrant(config, callbackUrl, {
    pkceCodeVerifier: flow.codeVerifier,
    expectedState: callbackUrl.searchParams.get("state") ?? "",
    expectedNonce: flow.nonce,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) {
    throw new AppError("The provider sent no ID token", 502, {
      code: "OIDC_NO_ID_TOKEN",
    });
  }
  let email = typeof claims.email === "string" ? claims.email : null;
  let emailVerified = claims.email_verified === true;
  if (
    !email &&
    tokens.access_token &&
    config.serverMetadata().userinfo_endpoint
  ) {
    try {
      const info = await client.fetchUserInfo(
        config,
        tokens.access_token,
        claims.sub,
      );
      email = typeof info.email === "string" ? info.email : null;
      emailVerified = info.email_verified === true;
    } catch (err) {
      log.warn("Auth", "OIDC userinfo failed", {
        error: getErrorMessage(err),
      });
    }
  }
  return {
    issuer: config.serverMetadata().issuer,
    subject: claims.sub,
    email: email?.trim() || null,
    emailVerified,
  };
}

export interface IdentitySummary {
  id: string;
  issuer: string;
  email: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export function findUserIdByIdentity(
  issuer: string,
  subject: string,
): string | null {
  const row = sqlite
    .prepare(
      "SELECT userId FROM user_identities WHERE issuer = ? AND subject = ?",
    )
    .get(issuer, subject) as { userId: string } | undefined;
  return row?.userId ?? null;
}

export function linkIdentity(
  userId: string,
  issuer: string,
  subject: string,
  email: string | null,
): void {
  const holder = findUserIdByIdentity(issuer, subject);
  if (holder && holder !== userId) {
    throw new ConflictError("This sign-in is already linked to another account");
  }
  sqlite
    .prepare(
      `INSERT INTO user_identities (id, userId, issuer, subject, email)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (userId, issuer) DO UPDATE
         SET subject = excluded.subject, email = excluded.email,
             createdAt = CURRENT_TIMESTAMP, lastUsedAt = NULL`,
    )
    .run(crypto.randomUUID(), userId, issuer, subject, email);
}

export function listIdentities(userId: string): IdentitySummary[] {
  return sqlite
    .prepare(
      `SELECT id, issuer, email, createdAt, lastUsedAt FROM user_identities
        WHERE userId = ? ORDER BY createdAt`,
    )
    .all(userId) as IdentitySummary[];
}

function issuerKey(issuer: string): string {
  const value = normalizeIssuer(issuer);
  try {
    return new URL(value).href.replace(/\/$/, "");
  } catch {
    return value;
  }
}

export function accountIdentities(userId: string) {
  const config = getOidcConfig();
  return {
    identities: listIdentities(userId).map((identity) => ({
      ...identity,
      current:
        config !== null &&
        issuerKey(identity.issuer) === issuerKey(config.issuer),
    })),
    matchByEmail:
      config?.matchByEmail === true &&
      sqlite
        .prepare(
          "SELECT 1 FROM users WHERE id = ? AND emailTrustedAt IS NOT NULL",
        )
        .get(userId) !== undefined,
  };
}

export function unlinkIdentity(userId: string, id: string): void {
  const result = sqlite
    .prepare("DELETE FROM user_identities WHERE id = ? AND userId = ?")
    .run(id, userId);
  if (result.changes === 0) {
    throw new NotFoundError("Linked sign-in");
  }
}

function accountForOidc(
  claims: OidcClaims,
): { user: User; matchedByEmail: boolean } | null {
  const linkedId = findUserIdByIdentity(claims.issuer, claims.subject);
  if (linkedId) {
    const user = getUserById(linkedId);
    return user ? { user, matchedByEmail: false } : null;
  }
  if (!getOidcConfig()?.matchByEmail || !claims.emailVerified || !claims.email) {
    return null;
  }
  const match = findUserByTrustedEmail(claims.email);
  if (!match) return null;
  const linkedHere = listIdentities(match.id).some(
    (identity) => identity.issuer === claims.issuer,
  );
  return linkedHere ? null : { user: match, matchedByEmail: true };
}

function oidcLanding(flow: OidcFlow | null, outcome: string | null): string {
  if (flow?.userId) {
    return `/settings?oidc=${outcome ?? "linked"}`;
  }
  return outcome ? `/?oidc=${outcome}` : (flow?.returnTo ?? "/");
}

function safeOAuthErrorCode(value: unknown): string {
  return typeof value === "string" && /^[a-z_]{1,64}$/.test(value)
    ? value
    : "other";
}

export async function finishOidcCallback(
  callbackUrl: URL,
  binding: string | null,
  sessionUserId: string | null,
  info: { ip: string | null; userAgent: string | null },
): Promise<{
  landing: string;
  session?: { secret: string; expiresAt: string; remember: boolean };
}> {
  const state = callbackUrl.searchParams.get("state") ?? "";
  const flow = binding ? takeOidcFlow(state, binding) : null;
  const land = (outcome: string | null) => ({
    landing: oidcLanding(flow, outcome),
  });
  if (!flow) return land("failed");

  const providerError = callbackUrl.searchParams.get("error");
  if (providerError !== null) {
    log.warn("Auth", "OIDC provider returned error", {
      error: safeOAuthErrorCode(providerError),
    });
    return land(providerError === "access_denied" ? "denied" : "failed");
  }
  if (flow.expired) return land("expired");

  let claims: OidcClaims;
  try {
    claims = await finishOidc(callbackUrl, flow);
  } catch (err) {
    log.warn("Auth", "OIDC callback exchange failed", {
      ...(err instanceof ResponseBodyError && {
        oauthError: safeOAuthErrorCode(err.error),
      }),
    });
    return land("failed");
  }

  if (flow.userId) {
    if (sessionUserId !== flow.userId) return land("failed");
    try {
      sqlite.transaction(() => {
        linkIdentity(sessionUserId, claims.issuer, claims.subject, claims.email);
        auditService.record({
          actorUserId: sessionUserId,
          action: "auth.oidc.linked",
          targetType: "user",
          targetId: sessionUserId,
          details: { issuer: claims.issuer },
          ip: info.ip,
        });
      })();
      return land(null);
    } catch (err) {
      if (err instanceof AppError && err.statusCode === 409) return land("taken");
      return land("failed");
    }
  }

  const found = accountForOidc(claims);
  if (!found) {
    auditService.record({
      actorUserId: null,
      action: "auth.login.failed",
      details: { method: "oidc", matched: false },
      ip: info.ip,
    });
    return land("no-account");
  }
  const { user, matchedByEmail } = found;
  const refusal =
    user.status === "disabled"
      ? "disabled"
      : user.mustChangePassword === 1
        ? "must-change-password"
        : null;
  if (refusal) {
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.failed",
      targetType: "user",
      targetId: user.id,
      details: { method: "oidc", reason: refusal },
      ip: info.ip,
    });
    return land(refusal);
  }

  const session = sqlite.transaction(() => {
    if (matchedByEmail) {
      linkIdentity(user.id, claims.issuer, claims.subject, claims.email);
      auditService.record({
        actorUserId: user.id,
        action: "auth.oidc.linked",
        targetType: "user",
        targetId: user.id,
        details: { issuer: claims.issuer, matchedByEmail: true },
        ip: info.ip,
      });
    }
    sqlite
      .prepare(
        `UPDATE user_identities SET lastUsedAt = CURRENT_TIMESTAMP, email = ?
          WHERE issuer = ? AND subject = ?`,
      )
      .run(claims.email, claims.issuer, claims.subject);
    sqlite
      .prepare("UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?")
      .run(user.id);
    const created = createSession(user.id, info.userAgent, {
      method: "oidc",
      remember: flow.remember,
    });
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, method: "oidc" },
      ip: info.ip,
    });
    return created;
  })();

  return {
    ...land(null),
    session: { ...session, remember: flow.remember },
  };
}
