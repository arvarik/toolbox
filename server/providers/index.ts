import db from "../db.ts";
import { openCredential, sealCredential } from "../platform/crypto/secretBox.ts";
import {
  PROVIDER_DEFS,
  fetchEndpointModels,
  CUSTOM_ENDPOINT_COLOR,
  type ProviderDef,
} from "./defs.ts";
import {
  saveCatalog,
  loadCatalog,
  clearCatalog,
  buildProviderCatalogEntries,
  buildEndpointCatalogEntries,
  listCustomEndpoints,
  type CatalogModelEntry,
} from "./catalog.ts";
import logger from "../utils/logger.ts";

const PROVIDERS: Record<string, ProviderDef> = Object.fromEntries(
  PROVIDER_DEFS.map((p) => [p.id, p]),
);

export function getApiKeyForProvider(providerId: string): string | null {
  const def = PROVIDERS[providerId];
  if (!def) return null;
  const row = db
    .prepare("SELECT value FROM config WHERE key = ?")
    .get(def.configKey) as { value: string } | undefined;
  const opened = openCredential(row?.value);
  return opened || null;
}

export async function testProviderKey(
  providerId: string,
  apiKey: string,
): Promise<true> {
  const def = PROVIDERS[providerId];
  if (!def) {
    throw new Error(`Unknown provider: "${providerId}"`);
  }
  await def.fetchModels(apiKey);
  return true;
}

export async function refreshProviderCatalog(
  providerId: string,
  apiKeyOverride?: string,
): Promise<CatalogModelEntry[]> {
  const def = PROVIDERS[providerId];
  if (!def) {
    throw new Error(`Unknown provider: "${providerId}"`);
  }
  const apiKey = apiKeyOverride || getApiKeyForProvider(providerId);
  if (!apiKey) {
    throw new Error(`${def.name} API key not configured.`);
  }

  const rawModels = await def.fetchModels(apiKey);
  const entries = buildProviderCatalogEntries(providerId, rawModels);
  saveCatalog(providerId, entries);
  logger.info(`[providers] Discovered ${entries.length} ${def.name} models`);
  return entries;
}

export async function refreshEndpointCatalog(endpoint: {
  id: string;
  name: string;
  base_url: string;
  api_key?: string;
}): Promise<CatalogModelEntry[]> {
  const rawModels = await fetchEndpointModels(
    endpoint.api_key || "",
    endpoint.base_url,
    { allowPrivate: true },
  );
  const entries = buildEndpointCatalogEntries(endpoint, rawModels);
  saveCatalog(`custom:${endpoint.id}`, entries);
  logger.info(
    `[providers] Discovered ${entries.length} models on custom endpoint "${endpoint.name}"`,
  );
  return entries;
}

export async function refreshAllCatalogs(): Promise<{
  refreshed: string[];
  errors: Record<string, string>;
}> {
  const refreshed: string[] = [];
  const errors: Record<string, string> = {};

  for (const def of PROVIDER_DEFS) {
    if (!getApiKeyForProvider(def.id)) continue;
    try {
      await refreshProviderCatalog(def.id);
      refreshed.push(def.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors[def.id] = msg;
      logger.warn(
        `[providers] Catalog refresh failed for ${def.id}: ${msg}`,
      );
    }
  }

  for (const endpoint of listCustomEndpoints()) {
    const catalogId = `custom:${endpoint.id}`;
    try {
      await refreshEndpointCatalog(endpoint);
      refreshed.push(catalogId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors[catalogId] = msg;
      logger.warn(
        `[providers] Catalog refresh failed for endpoint "${endpoint.name}": ${msg}`,
      );
    }
  }

  return { refreshed, errors };
}

export function handleProviderKeyRemoved(providerId: string): void {
  clearCatalog(providerId);
}

export function handleEndpointRemoved(endpointId: string): void {
  clearCatalog(`custom:${endpointId}`);
}

interface ProviderModels {
  provider: { id: string; name: string; color: string; isCustom?: boolean };
  models: Array<Record<string, unknown>>;
}

export function getAvailableModels(): ProviderModels[] {
  const result: ProviderModels[] = [];

  for (const def of PROVIDER_DEFS) {
    const apiKey = getApiKeyForProvider(def.id);
    if (!apiKey) continue;

    const cached = loadCatalog(def.id);
    const models = cached?.models?.length ? cached.models : def.models;

    result.push({
      provider: { id: def.id, name: def.name, color: def.color },
      models: models.map((m) => ({
        ...m,
        providerId: def.id,
        providerName: def.name,
      })),
    });
  }

  for (const endpoint of listCustomEndpoints()) {
    const cached = loadCatalog(`custom:${endpoint.id}`);
    result.push({
      provider: {
        id: `custom:${endpoint.id}`,
        name: endpoint.name,
        color: CUSTOM_ENDPOINT_COLOR,
        isCustom: true,
      },
      models: (cached?.models || []).map((m) => ({
        ...m,
        providerId: `custom:${endpoint.id}`,
        providerName: endpoint.name,
      })),
    });
  }

  return result;
}

export function getApiKeyStatus(): Record<string, boolean> {
  const status: Record<string, boolean> = {};
  for (const def of PROVIDER_DEFS) {
    status[def.id] = Boolean(getApiKeyForProvider(def.id));
  }
  return status;
}

export function getProviderDefinitions() {
  return PROVIDER_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    shortName: def.shortName,
    configKey: def.configKey,
    color: def.color,
    keyPlaceholder: def.keyPlaceholder,
    keyHelpUrl: def.keyHelpUrl,
    keyHelpLabel: def.keyHelpLabel,
    capabilities: def.capabilities,
  }));
}

export function getApiKeyFields(): string[] {
  return PROVIDER_DEFS.map((def) => def.configKey);
}

export function getProviderIdForConfigKey(configKey: string): string | null {
  const def = PROVIDER_DEFS.find((p) => p.configKey === configKey);
  return def ? def.id : null;
}

export function seedApiKeysFromEnv(): void {
  for (const def of PROVIDER_DEFS) {
    const envValue = process.env[def.envKey];
    if (envValue) {
      const existing = db
        .prepare("SELECT value FROM config WHERE key = ?")
        .get(def.configKey) as { value: string } | undefined;
      if (!openCredential(existing?.value)) {
        db.prepare(
          `INSERT INTO config (key, value, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        ).run(def.configKey, sealCredential(envValue));
        logger.info(`[db] Seeded ${def.name} API key from environment`);
      }
    }
  }
}
