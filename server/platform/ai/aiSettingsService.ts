import { randomUUID } from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import {
  CapabilitiesConfigSchema,
  DEFAULT_CAPABILITY_ASSIGNMENT,
  DEFAULT_EMBEDDINGS_CONFIG,
  EmbeddingsConfigSchema,
  GENERATION_CAPABILITIES,
  WebSearchConfigSchema,
  type AdminAiSettingsResponse,
  type AdminAiSettingsUpdate,
  type CapabilitiesConfig,
  type CapabilityAssignment,
  type ClientCustomEndpoint,
  type CustomEndpointInput,
  type EmbeddingsConfig,
  type GenerationCapability,
  type ModelOptionSummary,
  type ResolvedCapabilitySummary,
  type UserAiSettingsResponse,
  type UserByokUpdate,
  type WebSearchConfig,
  type WebSearchEngine,
} from "../../../shared/platform/aiSettings.ts";
import { sqlite } from "../db/connection.ts";
import { openCredential, sealCredential } from "../crypto/secretBox.ts";
import { getSetting, setSetting } from "../settings/settingsService.ts";
import { getContext, type Scope } from "../tenancy/scope.ts";
import {
  AppError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../net/errors.ts";
import {
  isAlwaysBlockedAddress,
  isPrivateAddress,
} from "../net/originAndFetch.ts";
import {
  DEFAULT_MODEL_ID,
  PROVIDER_DEFS,
  customModelId,
  fetchEndpointModels,
  parseCustomModelId,
} from "../../providers/defs.ts";
import {
  applyCatalogGuardrails,
  prettyModelName,
} from "../../providers/model_filter.ts";
import { isMaskedValue, maskSecret } from "../../utils/mask.ts";

export const AI_SETTINGS_APP_KEY = "ai_settings";

interface StoredAiSettingsBlob {
  capabilities?: Partial<CapabilitiesConfig>;
  embeddings?: Partial<EmbeddingsConfig>;
  webSearch?: Partial<WebSearchConfig>;
  embeddingGen?: string;
}

interface StoredUserCustomEndpoint {
  id: string;
  name: string;
  baseUrl: string;
  apiKeySealed: string;
  models: Array<{ id: string; upstreamId: string; name: string }>;
  createdAt: string;
}

interface UserAiSettingsRow {
  ownerId: string;
  provider_keys_sealed: string;
  custom_endpoints_json: string;
  capabilities_json: string;
  web_search_engine: string | null;
}

export type ResolvedModelDescriptor =
  | {
      kind: "builtin";
      providerId: "gemini" | "claude" | "openai";
      apiKey: string;
      modelId: string;
      keySource: "byok" | "instance";
    }
  | {
      kind: "openai-compatible";
      endpointKey: string;
      name: string;
      baseUrl: string;
      apiKey: string;
      upstreamModelId: string;
      modelId: string;
      keySource: "byok" | "instance";
      allowPrivate: boolean;
    };

function openSecret(stored: string | null | undefined): string {
  try {
    return openCredential(stored);
  } catch {
    return "";
  }
}

const ALWAYS_BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "instance-data.ec2.internal",
]);

const MAX_ENDPOINT_URL_LENGTH = 2048;

export function canUsePrivateEndpoint(opts?: {
  isAdmin?: boolean;
  scope?: Scope;
}): boolean {
  if (process.env.ALLOW_PRIVATE_BYOK_ENDPOINTS === "true") return true;
  if (opts?.isAdmin !== undefined) return opts.isAdmin;
  const ctxRole = getContext()?.principal?.user.role;
  if (ctxRole) return ctxRole === "admin";
  if (opts?.scope) {
    try {
      const row = sqlite
        .prepare("SELECT role FROM users WHERE id = ?")
        .get(opts.scope.ownerId) as { role?: string } | undefined;
      return row?.role === "admin";
    } catch {
      return false;
    }
  }
  return false;
}

export function normalizeEndpointBaseUrl(
  raw: unknown,
  opts?: { allowPrivate?: boolean },
): string {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new ValidationError("A valid http(s) Base URL is required");
  }
  // The trailing-slash and trailing-dot regexes below are O(n^2); the cap keeps them fast.
  if (raw.length > MAX_ENDPOINT_URL_LENGTH) {
    throw new ValidationError("Base URL is too long");
  }
  const trimmed = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("A valid http(s) Base URL is required");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("Only http(s) Base URLs are allowed");
  }
  if (parsed.username || parsed.password) {
    throw new ValidationError("Credentials in endpoint Base URL are not allowed");
  }

  const bareHost = parsed.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/, "");
  if (!bareHost) {
    throw new ValidationError("A valid http(s) Base URL is required");
  }

  if (
    ALWAYS_BLOCKED_HOSTS.has(bareHost) ||
    bareHost.endsWith(".metadata.google.internal") ||
    bareHost.endsWith(".metadata.goog")
  ) {
    throw new ValidationError("Endpoint URL resolves to a blocked address");
  }

  const allowPrivate = opts?.allowPrivate ?? true;

  if (net.isIP(bareHost)) {
    if (isAlwaysBlockedAddress(bareHost)) {
      throw new ValidationError("Endpoint URL resolves to a blocked address");
    }
    if (!allowPrivate && isPrivateAddress(bareHost)) {
      throw new ValidationError("Endpoint URL resolves to a private address");
    }
    return parsed.toString().replace(/\/+$/, "");
  }

  if (
    !allowPrivate &&
    (bareHost === "localhost" ||
      bareHost.endsWith(".localhost") ||
      bareHost.endsWith(".local") ||
      bareHost.endsWith(".internal"))
  ) {
    throw new ValidationError("Endpoint URL resolves to a private address");
  }

  return parsed.toString().replace(/\/+$/, "");
}

export async function validateEndpointBaseUrl(
  raw: unknown,
  opts?: { allowPrivate?: boolean },
): Promise<string> {
  const allowPrivate = opts?.allowPrivate ?? false;
  const normalized = normalizeEndpointBaseUrl(raw, { allowPrivate });
  const bareHost = new URL(normalized).hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/, "");

  if (net.isIP(bareHost)) {
    return normalized;
  }

  if (!allowPrivate) {
    let records: Array<{ address: string }>;
    try {
      records = await dns.lookup(bareHost, { all: true, verbatim: true });
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new ValidationError("Could not resolve endpoint hostname");
    }
    if (
      records.length === 0 ||
      records.some(
        (r) => isAlwaysBlockedAddress(r.address) || isPrivateAddress(r.address),
      )
    ) {
      throw new ValidationError("Endpoint URL resolves to a private address");
    }
    return normalized;
  }

  if (bareHost !== "localhost" && !bareHost.endsWith(".localhost")) {
    try {
      const records = await dns.lookup(bareHost, { all: true, verbatim: true });
      if (records.some((r) => isAlwaysBlockedAddress(r.address))) {
        throw new ValidationError("Endpoint URL resolves to a blocked address");
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
    }
  }

  return normalized;
}

function readStoredBlob(): StoredAiSettingsBlob {
  return getSetting<StoredAiSettingsBlob>(AI_SETTINGS_APP_KEY) ?? {};
}

function writeStoredBlob(next: StoredAiSettingsBlob): void {
  setSetting(AI_SETTINGS_APP_KEY, next);
}

export function getInstanceCapabilities(): CapabilitiesConfig {
  const blob = readStoredBlob();
  const parsed = CapabilitiesConfigSchema.safeParse(blob.capabilities ?? {});
  return parsed.success
    ? parsed.data
    : {
        quick: { ...DEFAULT_CAPABILITY_ASSIGNMENT },
        deep: { ...DEFAULT_CAPABILITY_ASSIGNMENT },
        research: { ...DEFAULT_CAPABILITY_ASSIGNMENT },
      };
}

export function getEmbeddingsConfig(): EmbeddingsConfig {
  const blob = readStoredBlob();
  const parsed = EmbeddingsConfigSchema.safeParse(blob.embeddings ?? {});
  return parsed.success ? parsed.data : { ...DEFAULT_EMBEDDINGS_CONFIG };
}

export function getEmbeddingGen(): string {
  const blob = readStoredBlob();
  return blob.embeddingGen || "gen_1";
}

export function bumpEmbeddingGen(): string {
  const blob = readStoredBlob();
  const current = blob.embeddingGen || "gen_1";
  const num = Number(current.replace(/^gen_/, ""));
  const next = `gen_${Number.isFinite(num) && num >= 1 ? num + 1 : Date.now()}`;
  writeStoredBlob({ ...blob, embeddingGen: next });
  return next;
}

export function getInstanceWebSearchConfig(): WebSearchConfig {
  const blob = readStoredBlob();
  const parsed = WebSearchConfigSchema.safeParse(blob.webSearch ?? {});
  const base = parsed.success
    ? parsed.data
    : { engine: "provider" as const, searxngUrl: "" };
  const effectiveUrl =
    base.searxngUrl.trim() || (process.env.SEARXNG_URL ?? "").trim();
  return {
    engine: base.engine,
    searxngUrl: effectiveUrl,
  };
}

function getInstanceApiKey(providerId: string): string | null {
  const def = PROVIDER_DEFS.find((d) => d.id === providerId);
  if (!def) return null;
  try {
    const row = sqlite
      .prepare("SELECT value FROM config WHERE key = ?")
      .get(def.configKey) as { value: string } | undefined;
    const opened = openSecret(row?.value);
    return opened || null;
  } catch {
    return null;
  }
}

function setInstanceApiKey(providerId: string, plainKey: string): void {
  const def = PROVIDER_DEFS.find((d) => d.id === providerId);
  if (!def) throw new ValidationError(`Unknown provider: "${providerId}"`);
  if (isMaskedValue(plainKey)) return;
  const trimmed = plainKey.trim();
  sqlite
    .prepare(
      `INSERT INTO config (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(def.configKey, trimmed ? sealCredential(trimmed) : "");
  if (!trimmed) {
    try {
      sqlite
        .prepare("DELETE FROM model_catalog WHERE catalog_id = ?")
        .run(def.id);
    } catch {
      // model_catalog may not exist in bare platform DB tests
    }
  }
}

interface InstanceCustomEndpointRow {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
}

function listInstanceEndpointsRaw(): InstanceCustomEndpointRow[] {
  try {
    return sqlite
      .prepare(
        "SELECT id, name, base_url, api_key FROM custom_endpoints ORDER BY created_at ASC",
      )
      .all() as InstanceCustomEndpointRow[];
  } catch {
    return [];
  }
}

function getInstanceEndpointRaw(
  id: string,
): InstanceCustomEndpointRow | undefined {
  try {
    return sqlite
      .prepare(
        "SELECT id, name, base_url, api_key FROM custom_endpoints WHERE id = ?",
      )
      .get(id) as InstanceCustomEndpointRow | undefined;
  } catch {
    return undefined;
  }
}

function loadCatalogModels(
  catalogId: string,
): Array<{ id: string; upstreamId?: string; name: string }> {
  try {
    const row = sqlite
      .prepare("SELECT models FROM model_catalog WHERE catalog_id = ?")
      .get(catalogId) as { models: string } | undefined;
    if (!row?.models) return [];
    const parsed = JSON.parse(row.models) as Array<{
      id: string;
      upstreamId?: string;
      name: string;
    }>;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface ParsedUserByok {
  providerKeys: Record<string, string>;
  endpoints: StoredUserCustomEndpoint[];
  capabilities: Partial<Record<GenerationCapability, CapabilityAssignment>>;
  webSearchEngine: WebSearchEngine | null;
}

function readUserByok(scope: Scope): ParsedUserByok {
  let row: UserAiSettingsRow | undefined;
  try {
    row = sqlite
      .prepare(
        `SELECT ownerId, provider_keys_sealed, custom_endpoints_json, capabilities_json, web_search_engine
         FROM user_ai_settings WHERE ownerId = ?`,
      )
      .get(scope.ownerId) as UserAiSettingsRow | undefined;
  } catch {
    row = undefined;
  }

  if (!row) {
    return {
      providerKeys: {},
      endpoints: [],
      capabilities: {},
      webSearchEngine: null,
    };
  }

  let rawKeys: Record<string, string> = {};
  try {
    rawKeys = JSON.parse(row.provider_keys_sealed || "{}") as Record<
      string,
      string
    >;
  } catch {
    rawKeys = {};
  }
  const providerKeys: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawKeys)) {
    const opened = openSecret(v);
    if (opened) providerKeys[k] = opened;
  }

  let endpoints: StoredUserCustomEndpoint[] = [];
  try {
    const parsed = JSON.parse(row.custom_endpoints_json || "[]");
    if (Array.isArray(parsed)) endpoints = parsed as StoredUserCustomEndpoint[];
  } catch {
    endpoints = [];
  }

  let capabilities: Partial<
    Record<GenerationCapability, CapabilityAssignment>
  > = {};
  try {
    const parsed = JSON.parse(row.capabilities_json || "{}") as Record<
      string,
      unknown
    >;
    for (const cap of GENERATION_CAPABILITIES) {
      if (parsed[cap]) {
        const check = CapabilitiesConfigSchema.shape[cap].safeParse(
          parsed[cap],
        );
        if (check.success) capabilities[cap] = check.data;
      }
    }
  } catch {
    capabilities = {};
  }

  const wsCheck = WebSearchConfigSchema.shape.engine.safeParse(
    row.web_search_engine,
  );
  return {
    providerKeys,
    endpoints,
    capabilities,
    webSearchEngine: wsCheck.success ? wsCheck.data : null,
  };
}

function writeUserByok(scope: Scope, state: ParsedUserByok): void {
  const sealedKeys: Record<string, string> = {};
  for (const [providerId, plain] of Object.entries(state.providerKeys)) {
    if (plain && plain.trim()) {
      sealedKeys[providerId] = sealCredential(plain.trim());
    }
  }
  const sealedEndpoints: StoredUserCustomEndpoint[] = state.endpoints.map(
    (ep) => ({
      ...ep,
      apiKeySealed: ep.apiKeySealed ? sealCredential(openSecret(ep.apiKeySealed)) : "",
    }),
  );

  sqlite
    .prepare(
      `INSERT INTO user_ai_settings (
         ownerId, provider_keys_sealed, custom_endpoints_json, capabilities_json, web_search_engine, updated_at
       ) VALUES (?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId) DO UPDATE SET
         provider_keys_sealed = excluded.provider_keys_sealed,
         custom_endpoints_json = excluded.custom_endpoints_json,
         capabilities_json = excluded.capabilities_json,
         web_search_engine = excluded.web_search_engine,
         updated_at = datetime('now')`,
    )
    .run(
      scope.ownerId,
      JSON.stringify(sealedKeys),
      JSON.stringify(sealedEndpoints),
      JSON.stringify(state.capabilities),
      state.webSearchEngine,
    );
}

/** Built-in model list first, then each provider's discovered catalog, then the provider's id pattern. */
export function inferProviderId(modelId: string): "gemini" | "claude" | "openai" | null {
  const def =
    PROVIDER_DEFS.find((d) => d.models.some((m) => m.id === modelId)) ??
    PROVIDER_DEFS.find((d) => loadCatalogModels(d.id).some((m) => m.id === modelId)) ??
    PROVIDER_DEFS.find((d) => d.ownsModelId(modelId));
  return (def?.id as "gemini" | "claude" | "openai" | undefined) ?? null;
}

const AUTO_CANDIDATES: Record<GenerationCapability, Record<string, string[]>> = {
  quick: {
    gemini: ["gemini-3.5-flash", "gemini-3.1-flash-lite"],
    claude: ["claude-haiku-4-5", "claude-sonnet-4-6"],
    openai: ["gpt-5.6-luna", "gpt-5.6-terra"],
  },
  deep: {
    gemini: ["gemini-3.1-pro", "gemini-3.5-flash"],
    claude: ["claude-sonnet-4-6", "claude-opus-4-8"],
    openai: ["gpt-5.6-sol", "gpt-5.6-terra"],
  },
  research: {
    gemini: ["gemini-3.5-flash", "gemini-3.1-pro"],
    openai: ["gpt-5.6-terra", "gpt-5.6-sol"],
    claude: ["claude-sonnet-4-6", "claude-haiku-4-5"],
  },
};

function canResolveModelId(modelId: string, scope?: Scope): boolean {
  const custom = parseCustomModelId(modelId);
  if (custom) {
    if (scope) {
      const byok = readUserByok(scope);
      if (byok.endpoints.some((e) => e.id === custom.endpointId)) return true;
    }
    return Boolean(getInstanceEndpointRaw(custom.endpointId));
  }
  const providerId = inferProviderId(modelId);
  if (!providerId) return false;
  if (scope) {
    const byok = readUserByok(scope);
    if (byok.providerKeys[providerId]) return true;
  }
  return Boolean(getInstanceApiKey(providerId));
}

function autoPickModelForCapability(
  scope: Scope | undefined,
  capability: GenerationCapability,
): string | null {
  const providerOrder =
    capability === "research"
      ? (["gemini", "openai", "claude"] as const)
      : (["gemini", "claude", "openai"] as const);

  if (scope) {
    const byok = readUserByok(scope);
    for (const pid of providerOrder) {
      if (byok.providerKeys[pid]) {
        return AUTO_CANDIDATES[capability][pid][0];
      }
    }
    for (const ep of byok.endpoints) {
      if (ep.models.length > 0) return ep.models[0].id;
    }
  }

  for (const pid of providerOrder) {
    if (getInstanceApiKey(pid)) {
      return AUTO_CANDIDATES[capability][pid][0];
    }
  }
  for (const ep of listInstanceEndpointsRaw()) {
    const models = loadCatalogModels(`custom:${ep.id}`);
    if (models.length > 0) return models[0].id;
  }
  return null;
}

export function resolveEffectiveCapability(
  scope: Scope | undefined,
  capability: GenerationCapability,
): ResolvedCapabilitySummary {
  const instanceCaps = getInstanceCapabilities();
  const userOverride = scope
    ? readUserByok(scope).capabilities[capability]
    : undefined;

  const assignment = userOverride ?? instanceCaps[capability];
  const source: "user_override" | "instance" = userOverride
    ? "user_override"
    : "instance";

  if (assignment.mode === "pinned" && assignment.modelId) {
    if (canResolveModelId(assignment.modelId, scope)) {
      return {
        capability,
        mode: "pinned",
        pinnedModelId: assignment.modelId,
        resolvedModelId: assignment.modelId,
        source,
      };
    }
  }

  const autoModel = autoPickModelForCapability(scope, capability);
  return {
    capability,
    mode: assignment.mode,
    pinnedModelId: assignment.modelId ?? null,
    resolvedModelId: autoModel,
    source,
  };
}

export function resolveModelDescriptor(
  modelId?: string,
  opts?: { scope?: Scope; capability?: GenerationCapability },
): ResolvedModelDescriptor {
  const scope = opts?.scope;
  let targetId = modelId?.trim() || "";

  if (!targetId) {
    if (opts?.capability) {
      const resolved = resolveEffectiveCapability(scope, opts.capability);
      targetId = resolved.resolvedModelId || DEFAULT_MODEL_ID;
    } else if (scope) {
      const userByok = readUserByok(scope);
      if (userByok.capabilities.deep) {
        const resolved = resolveEffectiveCapability(scope, "deep");
        targetId = resolved.resolvedModelId || DEFAULT_MODEL_ID;
      } else if (canResolveModelId(DEFAULT_MODEL_ID, scope)) {
        targetId = DEFAULT_MODEL_ID;
      } else {
        targetId =
          autoPickModelForCapability(scope, "deep") || DEFAULT_MODEL_ID;
      }
    } else {
      targetId = DEFAULT_MODEL_ID;
    }
  }

  const custom = parseCustomModelId(targetId);
  if (custom) {
    if (scope) {
      const byok = readUserByok(scope);
      const userEp = byok.endpoints.find((ep) => ep.id === custom.endpointId);
      if (userEp) {
        return {
          kind: "openai-compatible",
          endpointKey: `user:${scope.ownerId}:${userEp.id}`,
          name: userEp.name,
          baseUrl: userEp.baseUrl,
          apiKey: openSecret(userEp.apiKeySealed),
          upstreamModelId: custom.upstreamModelId,
          modelId: targetId,
          keySource: "byok",
          allowPrivate: canUsePrivateEndpoint({ scope }),
        };
      }
    }
    const instEp = getInstanceEndpointRaw(custom.endpointId);
    if (!instEp) {
      throw new Error(
        "Custom endpoint not found. It may have been removed — pick another model in Settings.",
      );
    }
    return {
      kind: "openai-compatible",
      endpointKey: `instance:${instEp.id}`,
      name: instEp.name,
      baseUrl: instEp.base_url,
      apiKey: openSecret(instEp.api_key),
      upstreamModelId: custom.upstreamModelId,
      modelId: targetId,
      keySource: "instance",
      allowPrivate: true,
    };
  }

  const providerId = inferProviderId(targetId);
  if (!providerId) {
    throw new Error(`Unknown model "${targetId}". Pick a model in Settings.`);
  }

  if (scope) {
    const byokKey = readUserByok(scope).providerKeys[providerId];
    if (byokKey) {
      return {
        kind: "builtin",
        providerId,
        apiKey: byokKey,
        modelId: targetId,
        keySource: "byok",
      };
    }
  }

  const instKey = getInstanceApiKey(providerId);
  if (!instKey) {
    const def = PROVIDER_DEFS.find((d) => d.id === providerId);
    throw new Error(
      `${def?.name || providerId} API key not configured. Please add your key in Settings.`,
    );
  }

  return {
    kind: "builtin",
    providerId,
    apiKey: instKey,
    modelId: targetId,
    keySource: "instance",
  };
}

export function getEffectiveWebSearchConfig(scope?: Scope): WebSearchConfig {
  const inst = getInstanceWebSearchConfig();
  if (!scope) return inst;
  const userEngine = readUserByok(scope).webSearchEngine;
  return {
    engine: userEngine ?? inst.engine,
    searxngUrl: inst.searxngUrl,
  };
}

export function listAvailableModelsForScope(scope?: Scope): ModelOptionSummary[] {
  const seen = new Set<string>();
  const out: ModelOptionSummary[] = [];
  const add = (
    models: ReadonlyArray<{ id: string; name: string }>,
    providerId: string,
    providerName: string,
    source: ModelOptionSummary["source"],
  ) => {
    for (const m of models) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      out.push({ id: m.id, name: m.name, providerId, providerName, source });
    }
  };
  const providerModels = (def: (typeof PROVIDER_DEFS)[number]) => {
    const cached = loadCatalogModels(def.id);
    return cached.length > 0 ? cached : def.models;
  };

  if (scope) {
    const byok = readUserByok(scope);
    for (const def of PROVIDER_DEFS) {
      if (byok.providerKeys[def.id]) add(providerModels(def), def.id, `${def.name} (Personal)`, "byok");
    }
    for (const ep of byok.endpoints) {
      add(ep.models, `custom:${ep.id}`, `${ep.name} (Personal)`, "byok");
    }
  }
  for (const def of PROVIDER_DEFS) {
    if (getInstanceApiKey(def.id)) add(providerModels(def), def.id, def.name, "instance");
  }
  for (const ep of listInstanceEndpointsRaw()) {
    add(loadCatalogModels(`custom:${ep.id}`), `custom:${ep.id}`, ep.name, "instance");
  }
  return out;
}

export function updateAdminAiSettings(patch: AdminAiSettingsUpdate): {
  embeddingsChanged: boolean;
  embeddings: EmbeddingsConfig;
} {
  const blob = readStoredBlob();
  const prevEmbeddings = getEmbeddingsConfig();
  let nextCapabilities = getInstanceCapabilities();
  if (patch.capabilities) {
    nextCapabilities = CapabilitiesConfigSchema.parse({
      ...nextCapabilities,
      ...patch.capabilities,
    });
  }

  let nextEmbeddings = prevEmbeddings;
  if (patch.embeddings) {
    nextEmbeddings = EmbeddingsConfigSchema.parse({
      ...prevEmbeddings,
      ...patch.embeddings,
      ...(patch.embeddings.provider === "local" && !patch.embeddings.modelId
        ? {
            modelId: DEFAULT_EMBEDDINGS_CONFIG.modelId,
            dimension:
              patch.embeddings.dimension ?? DEFAULT_EMBEDDINGS_CONFIG.dimension,
            endpointId: null,
          }
        : {}),
    });
  }

  let nextWebSearch = getInstanceWebSearchConfig();
  if (patch.webSearch) {
    nextWebSearch = WebSearchConfigSchema.parse({
      ...nextWebSearch,
      ...patch.webSearch,
    });
    if (nextWebSearch.searxngUrl.trim()) {
      nextWebSearch.searxngUrl = normalizeEndpointBaseUrl(
        nextWebSearch.searxngUrl,
        { allowPrivate: true },
      );
    }
  }

  if (patch.providerKeys) {
    for (const [providerId, val] of Object.entries(patch.providerKeys)) {
      setInstanceApiKey(providerId, val);
    }
  }

  const embeddingsChanged =
    prevEmbeddings.provider !== nextEmbeddings.provider ||
    prevEmbeddings.modelId !== nextEmbeddings.modelId ||
    prevEmbeddings.dimension !== nextEmbeddings.dimension ||
    prevEmbeddings.endpointId !== nextEmbeddings.endpointId;

  writeStoredBlob({
    ...blob,
    capabilities: nextCapabilities,
    embeddings: nextEmbeddings,
    webSearch: nextWebSearch,
  });

  return { embeddingsChanged, embeddings: nextEmbeddings };
}

export function getAdminAiSettingsView(): AdminAiSettingsResponse {
  const capabilities = getInstanceCapabilities();
  const embeddings = getEmbeddingsConfig();
  const webSearch = getInstanceWebSearchConfig();
  const providerKeysConfigured: Record<string, boolean> = {};
  const providerKeysMasked: Record<string, string> = {};
  for (const def of PROVIDER_DEFS) {
    const key = getInstanceApiKey(def.id);
    providerKeysConfigured[def.id] = Boolean(key);
    providerKeysMasked[def.id] = key ? maskSecret(key) : "";
  }

  const endpoints: ClientCustomEndpoint[] = listInstanceEndpointsRaw().map(
    (ep) => {
      const opened = openSecret(ep.api_key);
      return {
        id: ep.id,
        name: ep.name,
        baseUrl: ep.base_url,
        apiKeyMasked: opened ? maskSecret(opened) : "",
        hasApiKey: Boolean(opened),
        models: loadCatalogModels(`custom:${ep.id}`),
        scope: "instance",
      };
    },
  );

  return {
    capabilities,
    resolvedCapabilities: {
      quick: resolveEffectiveCapability(undefined, "quick").resolvedModelId,
      deep: resolveEffectiveCapability(undefined, "deep").resolvedModelId,
      research: resolveEffectiveCapability(undefined, "research")
        .resolvedModelId,
    },
    embeddings,
    embeddingGen: getEmbeddingGen(),
    webSearch,
    providerKeysConfigured,
    providerKeysMasked,
    endpoints,
    availableModels: listAvailableModelsForScope(undefined),
  };
}

export function assertNoUserEmbeddingsOverride(rawBody: unknown): void {
  if (!rawBody || typeof rawBody !== "object") return;
  const obj = rawBody as Record<string, unknown>;
  if ("embeddings" in obj) {
    throw new ForbiddenError(
      "Embeddings configuration is instance-wide and can only be modified by an administrator.",
    );
  }
  if (
    obj.capabilities &&
    typeof obj.capabilities === "object" &&
    "embeddings" in (obj.capabilities as Record<string, unknown>)
  ) {
    throw new ForbiddenError(
      "Embeddings capability is instance-wide and cannot be overridden per user.",
    );
  }
}

export function updateUserByokSettings(
  scope: Scope,
  patch: UserByokUpdate,
): UserAiSettingsResponse {
  const current = readUserByok(scope);

  if (patch.providerKeys) {
    for (const [providerId, rawKey] of Object.entries(patch.providerKeys)) {
      const def = PROVIDER_DEFS.find((d) => d.id === providerId);
      if (!def) {
        throw new ValidationError(`Unknown AI provider "${providerId}"`);
      }
      if (isMaskedValue(rawKey)) continue;
      const trimmed = rawKey.trim();
      if (!trimmed) {
        delete current.providerKeys[providerId];
      } else {
        current.providerKeys[providerId] = trimmed;
      }
    }
  }

  if (patch.capabilities) {
    for (const cap of GENERATION_CAPABILITIES) {
      if (!(cap in patch.capabilities)) continue;
      const val = patch.capabilities[cap];
      if (val === null) {
        delete current.capabilities[cap];
      } else if (val !== undefined) {
        current.capabilities[cap] = val;
      }
    }
  }

  if (patch.webSearchEngine !== undefined) {
    current.webSearchEngine = patch.webSearchEngine;
  }

  writeUserByok(scope, current);
  return getUserAiSettingsView(scope);
}

export async function upsertUserCustomEndpoint(
  scope: Scope,
  input: CustomEndpointInput,
  existingId?: string,
  opts?: { skipProbe?: boolean; allowPrivate?: boolean },
): Promise<ClientCustomEndpoint> {
  const allowPrivate =
    opts?.allowPrivate ?? canUsePrivateEndpoint({ scope });
  const baseUrl = await validateEndpointBaseUrl(input.baseUrl, {
    allowPrivate,
  });
  const current = readUserByok(scope);
  const existingIdx = existingId
    ? current.endpoints.findIndex((e) => e.id === existingId)
    : -1;
  if (existingId && existingIdx === -1) {
    throw new NotFoundError("Custom endpoint", existingId);
  }

  const prev = existingIdx >= 0 ? current.endpoints[existingIdx] : undefined;
  let plainKey = prev ? openSecret(prev.apiKeySealed) : "";
  if (input.apiKey !== undefined && !isMaskedValue(input.apiKey)) {
    plainKey = input.apiKey.trim();
  }

  const id = prev?.id ?? `u_${randomUUID()}`;
  const name = input.name.trim();

  let discoveredModels = prev?.models ?? [];
  if (!opts?.skipProbe) {
    try {
      const raw = await fetchEndpointModels(plainKey, baseUrl, { allowPrivate });
      const filtered = applyCatalogGuardrails(raw);
      discoveredModels = filtered.map((m) => ({
        id: customModelId(id, m.id),
        upstreamId: m.id,
        name: prettyModelName(m.id),
      }));
    } catch (err) {
      throw new ValidationError(
        err instanceof Error ? err.message : "Could not reach custom endpoint",
      );
    }
  }

  const stored: StoredUserCustomEndpoint = {
    id,
    name,
    baseUrl,
    apiKeySealed: plainKey ? sealCredential(plainKey) : "",
    models: discoveredModels,
    createdAt: prev?.createdAt ?? new Date().toISOString(),
  };

  if (existingIdx >= 0) {
    current.endpoints[existingIdx] = stored;
  } else {
    current.endpoints.push(stored);
  }
  writeUserByok(scope, current);

  return {
    id: stored.id,
    name: stored.name,
    baseUrl: stored.baseUrl,
    apiKeyMasked: plainKey ? maskSecret(plainKey) : "",
    hasApiKey: Boolean(plainKey),
    models: stored.models,
    scope: "user",
  };
}

export function deleteUserCustomEndpoint(
  scope: Scope,
  endpointId: string,
): void {
  const current = readUserByok(scope);
  const idx = current.endpoints.findIndex((e) => e.id === endpointId);
  if (idx === -1) {
    throw new NotFoundError("Custom endpoint", endpointId);
  }
  current.endpoints.splice(idx, 1);
  writeUserByok(scope, current);
}

export function getUserAiSettingsView(scope: Scope): UserAiSettingsResponse {
  const byok = readUserByok(scope);
  const instanceCapabilities = getInstanceCapabilities();
  const instWeb = getInstanceWebSearchConfig();
  const embeddings = getEmbeddingsConfig();

  const providerKeysConfigured: Record<string, boolean> = {};
  const providerKeysMasked: Record<string, string> = {};
  for (const def of PROVIDER_DEFS) {
    const key = byok.providerKeys[def.id];
    providerKeysConfigured[def.id] = Boolean(key);
    providerKeysMasked[def.id] = key ? maskSecret(key) : "";
  }

  const customEndpoints: ClientCustomEndpoint[] = byok.endpoints.map((ep) => {
    const plain = openSecret(ep.apiKeySealed);
    return {
      id: ep.id,
      name: ep.name,
      baseUrl: ep.baseUrl,
      apiKeyMasked: plain ? maskSecret(plain) : "",
      hasApiKey: Boolean(plain),
      models: ep.models,
      scope: "user",
    };
  });

  return {
    providerKeysConfigured,
    providerKeysMasked,
    customEndpoints,
    capabilities: {
      quick: byok.capabilities.quick ?? null,
      deep: byok.capabilities.deep ?? null,
      research: byok.capabilities.research ?? null,
    },
    instanceCapabilities,
    resolvedCapabilities: {
      quick: resolveEffectiveCapability(scope, "quick"),
      deep: resolveEffectiveCapability(scope, "deep"),
      research: resolveEffectiveCapability(scope, "research"),
    },
    webSearchEngine: byok.webSearchEngine,
    effectiveWebSearchEngine: byok.webSearchEngine ?? instWeb.engine,
    instanceWebSearch: {
      engine: instWeb.engine,
      searxngConfigured: Boolean(instWeb.searxngUrl),
    },
    embeddings: {
      provider: embeddings.provider,
      modelId: embeddings.modelId,
      dimension: embeddings.dimension,
      lockedByInstance: true,
    },
    availableModels: listAvailableModelsForScope(scope),
  };
}

export function resolveEmbeddingsEndpointCredentials(
  endpointId: string | null | undefined,
): { name: string; baseUrl: string; apiKey: string } {
  if (!endpointId) {
    throw new ValidationError(
      "Custom embeddings provider requires an instance endpointId",
    );
  }
  const ep = getInstanceEndpointRaw(endpointId);
  if (!ep) {
    throw new ValidationError(
      `Embeddings custom endpoint "${endpointId}" not found`,
    );
  }
  return {
    name: ep.name,
    baseUrl: ep.base_url,
    apiKey: openSecret(ep.api_key),
  };
}

export function resolveInstanceProviderKeyForEmbeddings(
  providerId: "gemini" | "openai",
): string {
  const key = getInstanceApiKey(providerId);
  if (!key) {
    throw new ValidationError(
      `Instance ${providerId} API key is required for ${providerId} embeddings`,
    );
  }
  return key;
}
