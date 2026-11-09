import { isAllowedIssuer } from "../../../shared/platform/auth.ts";
import { sqlite } from "../db/connection.ts";
import { seal, open } from "../crypto/secretBox.ts";
import { getErrorMessage, log } from "../net/errors.ts";

interface SettingRow {
  value: string;
}

const cache = new Map<string, unknown>();

export function getSetting<T>(key: string): T | null {
  if (cache.has(key)) return (cache.get(key) as T) ?? null;
  try {
    const row = sqlite
      .prepare("SELECT value FROM app_settings WHERE key = ?")
      .get(key) as SettingRow | undefined;
    const parsed = row?.value ? (JSON.parse(row.value) as T) : null;
    cache.set(key, parsed);
    return parsed;
  } catch (err) {
    log.warn("Settings", `Failed to read "${key}": ${getErrorMessage(err)}`);
    return null;
  }
}

export function setSetting(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  sqlite
    .prepare(
      `INSERT INTO app_settings (key, value, updatedAt) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt`,
    )
    .run(key, json, new Date().toISOString());
  cache.set(key, value);
}

export function deleteSetting(key: string): void {
  sqlite.prepare("DELETE FROM app_settings WHERE key = ?").run(key);
  cache.delete(key);
}

export function clearSettingsCache(): void {
  cache.clear();
}

export function getUserSetting<T>(userId: string, key: string): T | null {
  const row = sqlite
    .prepare("SELECT value FROM user_settings WHERE userId = ? AND key = ?")
    .get(userId, key) as SettingRow | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return (row.value as unknown as T) ?? null;
  }
}

export function setUserSetting(userId: string, key: string, value: unknown): void {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  sqlite
    .prepare(
      `INSERT INTO user_settings (userId, key, value, updatedAt)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (userId, key) DO UPDATE SET
         value = excluded.value,
         updatedAt = CURRENT_TIMESTAMP`,
    )
    .run(userId, key, serialized);
}

export function deleteUserSetting(userId: string, key: string): void {
  sqlite
    .prepare("DELETE FROM user_settings WHERE userId = ? AND key = ?")
    .run(userId, key);
}

export const SETTING_KEYS = {
  aiCapabilities: "ai.capabilities",
  aiProviderKeys: "ai.providerKeys",
  aiCustomEndpoints: "ai.customEndpoints",
  aiModelCache: "ai.modelCache",
  aiSearxng: "ai.searxng",
  aiWebSearch: "ai.webSearch",
  embeddingsState: "ai.embeddingsState",
  aiInstanceOff: "ai.instanceOff",
  backupIntervalHours: "backup.intervalHours",
  backupKeep: "backup.keep",
  oidc: "auth.oidc",
} as const;

export type IntegrationSource = "setting" | "env" | "none";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  name: string;
  matchByEmail: boolean;
  source: "setting" | "env";
}

export type OidcConfigInput = Omit<OidcConfig, "source">;

export interface OidcIntegrationStatus {
  configured: boolean;
  source: IntegrationSource;
  issuer: string | null;
  clientId: string | null;
  clientSecretPreview: string | null;
  name: string | null;
  matchByEmail: boolean;
  envIssuerInvalid: boolean;
}

const DEFAULT_OIDC_NAME = "OpenID Connect";

function redactPreview(secret: string | null | undefined): string | null {
  if (!secret) return null;
  return secret.length <= 4 ? "••••" : `••••${secret.slice(-4)}`;
}

export function isOidcEnvSet(): boolean {
  return Boolean(
    process.env.OIDC_ISSUER?.trim() &&
      process.env.OIDC_CLIENT_ID?.trim() &&
      process.env.OIDC_CLIENT_SECRET?.trim(),
  );
}

let warnedIssuer: string | null = null;

export function getOidcConfig(): OidcConfig | null {
  if (isOidcEnvSet()) {
    const issuer = process.env.OIDC_ISSUER!.trim();
    if (!isAllowedIssuer(issuer)) {
      if (warnedIssuer !== issuer) {
        warnedIssuer = issuer;
        log.warn(
          "Integrations",
          `OIDC_ISSUER must use https:// (http only for localhost). Single sign-on stays off: ${issuer}`,
        );
      }
      return null;
    }
    return {
      issuer,
      clientId: process.env.OIDC_CLIENT_ID!.trim(),
      clientSecret: process.env.OIDC_CLIENT_SECRET!.trim(),
      name: process.env.OIDC_NAME?.trim() || DEFAULT_OIDC_NAME,
      matchByEmail: process.env.OIDC_MATCH_BY_EMAIL?.trim() === "true",
      source: "env",
    };
  }
  const sealed = getSetting<string>(SETTING_KEYS.oidc);
  if (typeof sealed === "string" && sealed.startsWith("v1:")) {
    try {
      const parsed = JSON.parse(open(sealed)) as Partial<OidcConfigInput>;
      if (parsed.issuer && parsed.clientId && parsed.clientSecret) {
        return {
          issuer: parsed.issuer,
          clientId: parsed.clientId,
          clientSecret: parsed.clientSecret,
          name: parsed.name || DEFAULT_OIDC_NAME,
          matchByEmail: parsed.matchByEmail === true,
          source: "setting",
        };
      }
    } catch (err) {
      log.warn(
        "Integrations",
        `Failed to unseal OIDC provider: ${getErrorMessage(err)}`,
      );
    }
  }
  return null;
}

export function setOidcConfig(config: OidcConfigInput | null): void {
  if (!config) {
    deleteSetting(SETTING_KEYS.oidc);
    return;
  }
  setSetting(
    SETTING_KEYS.oidc,
    seal(
      JSON.stringify({
        issuer: config.issuer.trim(),
        clientId: config.clientId.trim(),
        clientSecret: config.clientSecret.trim(),
        name: config.name.trim() || DEFAULT_OIDC_NAME,
        matchByEmail: config.matchByEmail,
      }),
    ),
  );
}

export function getOidcIntegrationStatus(): OidcIntegrationStatus {
  const oidc = getOidcConfig();
  const refusedEnv = !oidc && isOidcEnvSet();
  return {
    configured: oidc !== null,
    source: oidc?.source ?? (refusedEnv ? "env" : "none"),
    issuer: oidc?.issuer ?? null,
    clientId: oidc?.clientId ?? null,
    clientSecretPreview: redactPreview(oidc?.clientSecret),
    name: oidc?.name ?? null,
    matchByEmail: oidc?.matchByEmail ?? false,
    envIssuerInvalid: refusedEnv,
  };
}
