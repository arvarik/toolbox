import { safeFetch } from "../platform/net/originAndFetch.ts";

const LIST_TIMEOUT_MS = 15_000;

export const CUSTOM_ENDPOINT_COLOR = "#8B5CF6";

export interface RawDiscoveredModel {
  id: string;
  name?: string;
  description?: string;
  releasedAt: number | null;
}

export interface ProviderModelMeta {
  id: string;
  name: string;
  description: string;
  family: string | null;
}

export interface ProviderCapabilities {
  streaming: boolean;
  toolCalling: boolean;
  jsonMode: boolean;
  embeddings: boolean;
}

export interface ProviderDef {
  id: string;
  name: string;
  shortName: string;
  color: string;
  configKey: string;
  envKey: string;
  keyPlaceholder: string;
  keyHelpUrl: string;
  keyHelpLabel: string;
  capabilities: ProviderCapabilities;
  models: ProviderModelMeta[];
  ownsModelId: (modelId: string) => boolean;
  fetchModels: (apiKey: string) => Promise<RawDiscoveredModel[]>;
}

export function customModelId(endpointId: string, upstreamModelId: string): string {
  return `custom:${endpointId}:${upstreamModelId}`;
}

export function parseCustomModelId(
  modelId: unknown,
): { endpointId: string; upstreamModelId: string } | null {
  if (typeof modelId !== "string" || !modelId.startsWith("custom:")) return null;
  const parts = modelId.split(":");
  if (parts.length < 3) return null;
  return { endpointId: parts[1], upstreamModelId: parts.slice(2).join(":") };
}

async function extractErrorMessage(res: Response): Promise<string> {
  let detail = "";
  try {
    const body = (await res.json()) as {
      error?: { message?: string };
      message?: string;
    };
    detail = body?.error?.message || body?.message || "";
  } catch {
    // Non-JSON error body
  }
  return detail || `Request failed with status ${res.status}`;
}

async function fetchGeminiModels(apiKey: string): Promise<RawDiscoveredModel[]> {
  const models: RawDiscoveredModel[] = [];
  let pageToken = "";
  do {
    const url = new URL(
      "https://generativelanguage.googleapis.com/v1beta/models",
    );
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "200");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const res = await fetch(url, {
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(await extractErrorMessage(res));

    const data = (await res.json()) as {
      models?: Array<{
        name?: string;
        displayName?: string;
        description?: string;
        supportedGenerationMethods?: string[];
      }>;
      nextPageToken?: string;
    };
    for (const m of data.models || []) {
      const methods = m.supportedGenerationMethods || [];
      if (!methods.includes("generateContent")) continue;
      models.push({
        id: (m.name || "").replace(/^models\//, ""),
        name: m.displayName || (m.name || "").replace(/^models\//, ""),
        description: (m.description || "").slice(0, 140),
        releasedAt: null,
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);

  return models;
}

async function fetchClaudeModels(apiKey: string): Promise<RawDiscoveredModel[]> {
  const models: RawDiscoveredModel[] = [];
  let afterId = "";
  let pages = 0;
  do {
    const url = new URL("https://api.anthropic.com/v1/models");
    url.searchParams.set("limit", "100");
    if (afterId) url.searchParams.set("after_id", afterId);

    const res = await fetch(url, {
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(await extractErrorMessage(res));

    const data = (await res.json()) as {
      data?: Array<{
        id: string;
        display_name?: string;
        created_at?: string;
      }>;
      has_more?: boolean;
      last_id?: string;
    };
    for (const m of data.data || []) {
      const releasedAt = m.created_at ? Date.parse(m.created_at) : null;
      models.push({
        id: m.id,
        name: m.display_name || m.id,
        description: "",
        releasedAt:
          releasedAt !== null && !Number.isNaN(releasedAt) ? releasedAt : null,
      });
    }
    afterId = data.has_more && data.last_id ? data.last_id : "";
    pages += 1;
  } while (afterId && pages < 10);

  return models;
}

/**
 * Lists models on an OpenAI-compatible endpoint. `allowPrivate` is true only for
 * admin-configured endpoints; every connection and redirect is re-checked by `safeFetch`.
 */
export async function fetchEndpointModels(
  apiKey: string,
  baseUrl: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<RawDiscoveredModel[]> {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  let res: Response;
  try {
    ({ response: res } = await safeFetch(`${base}/models`, {
      headers,
      allowPrivate: opts.allowPrivate ?? false,
      timeoutMs: LIST_TIMEOUT_MS,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not reach ${base} — ${msg}`, { cause: err });
  }
  if (!res.ok) throw new Error(await extractErrorMessage(res));

  const data = (await res.json()) as
    | { data?: Array<{ id?: string; name?: string; created?: number }> }
    | Array<{ id?: string; name?: string; created?: number }>;
  const rawModels = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : [];
  return rawModels
    .filter((m) => m && (m.id || m.name))
    .map((m) => ({
      id: (m.id || m.name)!,
      releasedAt: typeof m.created === "number" ? m.created * 1000 : null,
    }));
}

export const PROVIDER_DEFS: ProviderDef[] = [
  {
    id: "gemini",
    name: "Google Gemini",
    shortName: "Gemini",
    color: "#4285F4",
    configKey: "gemini_api_key",
    envKey: "GEMINI_API_KEY",
    keyPlaceholder: "AIza...",
    keyHelpUrl: "https://aistudio.google.com/apikey",
    keyHelpLabel: "Google AI Studio",
    capabilities: {
      streaming: true,
      toolCalling: true,
      jsonMode: true,
      embeddings: true,
    },
    models: [
      {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash",
        description: "Fast and efficient — best for most tasks",
        family: "Flash",
      },
      {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro",
        description: "Advanced reasoning, stable and reliable",
        family: "Pro",
      },
      {
        id: "gemini-3.1-flash-lite",
        name: "Gemini 3.1 Flash Lite",
        description: "Budget-friendly, high-speed for simple tasks",
        family: "Flash-Lite",
      },
    ],
    ownsModelId: (modelId) => /^(gemini|gemma)/i.test(modelId || ""),
    fetchModels: fetchGeminiModels,
  },
  {
    id: "claude",
    name: "Anthropic Claude",
    shortName: "Claude",
    color: "#D97757",
    configKey: "claude_api_key",
    envKey: "CLAUDE_API_KEY",
    keyPlaceholder: "sk-ant-...",
    keyHelpUrl: "https://console.anthropic.com/settings/keys",
    keyHelpLabel: "Anthropic Console",
    capabilities: {
      streaming: true,
      toolCalling: true,
      jsonMode: true,
      embeddings: false,
    },
    models: [
      {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        description: "Best balance of speed and intelligence",
        family: "Sonnet",
      },
      {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        description: "Fastest, most cost-effective",
        family: "Haiku",
      },
      {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        description: "Most capable, complex reasoning",
        family: "Opus",
      },
    ],
    ownsModelId: (modelId) => /^claude/i.test(modelId || ""),
    fetchModels: fetchClaudeModels,
  },
  {
    id: "openai",
    name: "OpenAI",
    shortName: "OpenAI",
    color: "#10A37F",
    configKey: "openai_api_key",
    envKey: "OPENAI_API_KEY",
    keyPlaceholder: "sk-...",
    keyHelpUrl: "https://platform.openai.com/api-keys",
    keyHelpLabel: "OpenAI Platform",
    capabilities: {
      streaming: true,
      toolCalling: true,
      jsonMode: true,
      embeddings: false,
    },
    models: [
      {
        id: "gpt-5.6-sol",
        name: "GPT-5.6 Sol",
        description: "Flagship — hardest coding, agents, and research",
        family: "Flagship",
      },
      {
        id: "gpt-5.6-terra",
        name: "GPT-5.6 Terra",
        description: "Balanced quality and cost for most tasks",
        family: "Balanced",
      },
      {
        id: "gpt-5.6-luna",
        name: "GPT-5.6 Luna",
        description: "Fastest and most cost-effective",
        family: "Fast",
      },
    ],
    ownsModelId: (modelId) => /^(gpt|o\d|chatgpt|codex)/i.test(modelId || ""),
    fetchModels: (apiKey) =>
      fetchEndpointModels(apiKey, "https://api.openai.com/v1"),
  },
];

export const DEFAULT_MODEL_ID = PROVIDER_DEFS[0].models[0].id;
