import type {
  AdminAiSettingsResponse,
  AdminAiSettingsUpdate,
  ClientCustomEndpoint,
  CustomEndpointInput,
  UserAiSettingsResponse,
  UserByokUpdate,
} from "../../shared/platform/aiSettings.ts";

export type { AdminAiSettingsResponse, UserAiSettingsResponse };

async function aiJsonFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers:
      options.body !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const payload = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: { message?: string };
  } & T;

  if (!res.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.message ||
        `Request failed (${res.status})`,
    );
  }
  return payload as T;
}

export const userAiSettingsApi = {
  get: () => aiJsonFetch<UserAiSettingsResponse>("/ai-settings"),
  update: (patch: UserByokUpdate) =>
    aiJsonFetch<UserAiSettingsResponse>("/ai-settings", {
      method: "PUT",
      body: patch,
    }),
  testAndSaveKey: (provider: string, key: string) =>
    aiJsonFetch<{ valid: boolean; settings: UserAiSettingsResponse }>(
      "/ai-settings/test-key",
      { method: "POST", body: { provider, key } },
    ),
  createEndpoint: (input: CustomEndpointInput) =>
    aiJsonFetch<ClientCustomEndpoint>("/ai-settings/endpoints", {
      method: "POST",
      body: input,
    }),
  deleteEndpoint: (id: string) =>
    aiJsonFetch<{ success: boolean }>(
      `/ai-settings/endpoints/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

export const adminAiSettingsApi = {
  get: () => aiJsonFetch<AdminAiSettingsResponse>("/admin/ai-settings"),
  update: (patch: AdminAiSettingsUpdate) =>
    aiJsonFetch<AdminAiSettingsResponse>("/admin/ai-settings", {
      method: "PUT",
      body: patch,
    }),
  testSearxng: (searxngUrl?: string) =>
    aiJsonFetch<{
      ok: boolean;
      latencyMs: number;
      resultCount: number;
      message?: string;
    }>("/admin/ai-settings/test-searxng", {
      method: "POST",
      body: { searxngUrl },
    }),
  reindexEmbeddings: () =>
    aiJsonFetch<{ ok: boolean; reindexed: number }>(
      "/admin/ai-settings/reindex-embeddings",
      { method: "POST" },
    ),
};
