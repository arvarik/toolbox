import React, { useCallback, useEffect, useState } from "react";
import { Cpu, Globe, RefreshCw, Sparkles } from "lucide-react";
import type {
  CapabilitiesConfig,
  EmbeddingsConfig,
  EmbeddingsProvider,
  GenerationCapability,
  WebSearchConfig,
  WebSearchEngine,
} from "../../../shared/platform/aiSettings.ts";
import useAppStore from "../../stores/appStore";
import {
  adminAiSettingsApi,
  type AdminAiSettingsResponse,
} from "../../utils/aiSettingsApi.ts";
import { useAuth } from "../auth/AuthGate.tsx";

const CAPABILITY_META: Array<{
  key: GenerationCapability;
  label: string;
  hint: string;
}> = [
  {
    key: "quick",
    label: "Quick Generation",
    hint: "Flashcard drafting, Feynman interceptor checks, episodic memory, and starter prompts.",
  },
  {
    key: "deep",
    label: "Deep Reasoning",
    hint: "Socratic tutoring streams, study guide synthesis, and multi-step architecture reviews.",
  },
  {
    key: "research",
    label: "Web Grounding",
    hint: "Grounded web search synthesis and primary-source verification.",
  },
];

export function AiSettingsSection() {
  const { isResolved, authRequired, isAdmin } = useAuth();
  const addToast = useAppStore((s) => s.addToast);
  const canManage = !isResolved || !authRequired || isAdmin;

  const [data, setData] = useState<AdminAiSettingsResponse | null>(null);
  const [capabilities, setCapabilities] = useState<CapabilitiesConfig | null>(
    null,
  );
  const [embeddings, setEmbeddings] = useState<EmbeddingsConfig>({
    provider: "local",
    modelId: "Xenova/all-MiniLM-L6-v2",
    dimension: 384,
    endpointId: null,
  });
  const [webSearch, setWebSearch] = useState<WebSearchConfig>({
    engine: "provider",
    searxngUrl: "",
  });
  const [savingCaps, setSavingCaps] = useState(false);
  const [savingEmbeddings, setSavingEmbeddings] = useState(false);
  const [reindexing, setReindexing] = useState(false);
  const [savingWeb, setSavingWeb] = useState(false);
  const [testingSearxng, setTestingSearxng] = useState(false);

  const loadSettings = useCallback(async () => {
    if (!canManage) return;
    try {
      const res = await adminAiSettingsApi.get();
      setData(res);
      setCapabilities(res.capabilities);
      setEmbeddings(res.embeddings);
      setWebSearch(res.webSearch);
    } catch {
      // Offline or unmocked unit test environment — render gracefully without noise.
    }
  }, [canManage]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  if (!canManage || !data || !capabilities) return null;

  const runBusy = async (
    setBusy: React.Dispatch<React.SetStateAction<boolean>>,
    fallback: string,
    fn: () => Promise<void>,
  ) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : fallback,
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSaveCapabilities = () =>
    runBusy(setSavingCaps, "Failed to save routing", async () => {
      const updated = await adminAiSettingsApi.update({ capabilities });
      setData(updated);
      setCapabilities(updated.capabilities);
      addToast({ type: "success", message: "Capability routing updated" });
    });

  const handleProviderChange = (provider: EmbeddingsProvider) => {
    const presets: Record<EmbeddingsProvider, EmbeddingsConfig> = {
      local: {
        provider: "local",
        modelId: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
        endpointId: null,
      },
      gemini: {
        provider: "gemini",
        modelId: "gemini-embedding-001",
        dimension: 768,
        endpointId: null,
      },
      openai: {
        provider: "openai",
        modelId: "text-embedding-3-small",
        dimension: 1536,
        endpointId: null,
      },
      custom: {
        provider: "custom",
        modelId: "nomic-embed-text",
        dimension: 768,
        endpointId: data.endpoints[0]?.id ?? null,
      },
    };
    setEmbeddings(presets[provider]);
  };

  const handleSaveEmbeddings = () =>
    runBusy(setSavingEmbeddings, "Failed to update embeddings", async () => {
      const updated = await adminAiSettingsApi.update({ embeddings });
      setData(updated);
      setEmbeddings(updated.embeddings);
      addToast({
        type: "success",
        message: `Embeddings set to ${updated.embeddings.provider} (${updated.embeddings.dimension}-dim)`,
      });
    });

  const handleReindex = () =>
    runBusy(setReindexing, "Reindex failed", async () => {
      const res = await adminAiSettingsApi.reindexEmbeddings();
      await loadSettings();
      addToast({
        type: "success",
        message: `Re-embedded ${res.reindexed} RAG chunk${res.reindexed === 1 ? "" : "s"}`,
      });
    });

  const handleTestSearxng = () =>
    runBusy(setTestingSearxng, "SearXNG connection failed", async () => {
      const res = await adminAiSettingsApi.testSearxng(webSearch.searxngUrl);
      addToast({
        type: "success",
        message: `SearXNG reachable (${res.latencyMs}ms · ${res.resultCount} sample results)`,
      });
    });

  const handleSaveWebSearch = () =>
    runBusy(setSavingWeb, "Failed to save web research", async () => {
      const updated = await adminAiSettingsApi.update({ webSearch });
      setData(updated);
      setWebSearch(updated.webSearch);
      addToast({ type: "success", message: "Web research settings saved" });
    });

  return (
    <>
      <div className="settings-section space-y-5" id="instance-ai-router-section">
        <div className="flex items-center gap-2">
          <Sparkles size={18} className="text-primary" />
          <h2 className="settings-section-title" style={{ marginBottom: 0 }}>
            Capability Routing, Embeddings & Web Research
          </h2>
        </div>
        <p className="settings-section-desc">
          Route study workloads across fast, deep, and grounded models, manage
          the instance-wide hybrid RAG vector index, and configure SSRF-safe web
          research.
        </p>

        {/* Capability Router */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="text-sm font-medium text-on-surface">
            Generation Capability Router
          </div>
          <div className="space-y-3">
            {CAPABILITY_META.map(({ key, label, hint }) => {
              const current = capabilities[key];
              const resolved = data.resolvedCapabilities[key];
              return (
                <div
                  key={key}
                  className="rounded-lg bg-surface-container-lowest p-3 border border-outline-variant space-y-2"
                >
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>
                      <span className="text-xs font-semibold text-on-surface">
                        {label}
                      </span>
                      <span className="ml-2 rounded bg-ai/12 px-1.5 py-0.5 font-mono text-[11px] text-on-ai-wash">
                        {resolved ?? "unconfigured"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        aria-label={`${label} routing mode`}
                        value={current.mode}
                        onChange={(e) => {
                          const mode = e.target.value as "auto" | "pinned";
                          setCapabilities((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  [key]: {
                                    mode,
                                    modelId:
                                      mode === "pinned"
                                        ? current.modelId ||
                                          data.availableModels[0]?.id ||
                                          null
                                        : null,
                                  },
                                }
                              : prev,
                          );
                        }}
                        className="rounded-lg bg-surface-container border border-outline-variant px-2.5 py-1.5 text-xs text-on-surface"
                      >
                        <option value="auto">Auto</option>
                        <option value="pinned">Pinned Model</option>
                      </select>

                      {current.mode === "pinned" && (
                        <select
                          aria-label={`${label} pinned model`}
                          value={current.modelId ?? ""}
                          onChange={(e) =>
                            setCapabilities((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    [key]: {
                                      mode: "pinned",
                                      modelId: e.target.value || null,
                                    },
                                  }
                                : prev,
                            )
                          }
                          className="rounded-lg bg-surface-container border border-outline-variant px-2.5 py-1.5 font-mono text-xs text-on-surface max-w-60"
                        >
                          {data.availableModels.length === 0 ? (
                            <option value="">No models configured</option>
                          ) : (
                            data.availableModels.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name} ({m.providerName})
                              </option>
                            ))
                          )}
                        </select>
                      )}
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant">{hint}</p>
                </div>
              );
            })}
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSaveCapabilities()}
              disabled={savingCaps}
            >
              {savingCaps ? "Saving..." : "Save Routing"}
            </button>
          </div>
        </div>

        {/* Instance Embeddings (Hybrid RAG) */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
              <Cpu size={15} className="text-primary" />
              Hybrid RAG Embeddings (Instance-Wide)
            </div>
            <span className="rounded bg-surface-container-lowest px-2 py-0.5 font-mono text-[11px] text-on-surface-variant border border-outline-variant">
              {data.embeddingGen} · {data.embeddings.dimension}d
            </span>
          </div>
          <p className="text-xs text-on-surface-variant">
            Defaults to local zero-key ONNX (
            <code className="font-mono">Xenova/all-MiniLM-L6-v2</code>, 384-dim{" "}
            <code className="font-mono">q8</code>). Changing dimension recreates{" "}
            <code className="font-mono">rag_chunks_vec</code> while FTS5 BM25
            continues serving uninterrupted.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <select
              aria-label="Embeddings provider"
              value={embeddings.provider}
              onChange={(e) =>
                handleProviderChange(e.target.value as EmbeddingsProvider)
              }
              className="rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-xs text-on-surface"
            >
              <option value="local">Local ONNX (384d, zero API key)</option>
              <option value="gemini">Google Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="custom">Custom OpenAI-Compatible</option>
            </select>

            <input
              aria-label="Embeddings model ID"
              className="input font-mono text-xs"
              value={embeddings.modelId}
              disabled={embeddings.provider === "local"}
              onChange={(e) =>
                setEmbeddings((prev) => ({ ...prev, modelId: e.target.value }))
              }
              placeholder="Embedding model ID"
            />

            <input
              type="number"
              min={32}
              max={4096}
              aria-label="Embeddings dimension"
              className="input font-mono text-xs"
              value={embeddings.dimension}
              disabled={embeddings.provider === "local"}
              onChange={(e) =>
                setEmbeddings((prev) => ({
                  ...prev,
                  dimension: Number(e.target.value) || 384,
                }))
              }
            />
          </div>

          {embeddings.provider === "custom" && (
            <select
              aria-label="Custom embeddings endpoint"
              value={embeddings.endpointId ?? ""}
              onChange={(e) =>
                setEmbeddings((prev) => ({
                  ...prev,
                  endpointId: e.target.value || null,
                }))
              }
              className="rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-xs text-on-surface w-full"
            >
              <option value="">Select instance custom endpoint...</option>
              {data.endpoints.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.name} ({ep.baseUrl})
                </option>
              ))}
            </select>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleReindex()}
              disabled={reindexing}
            >
              <RefreshCw
                size={13}
                className={reindexing ? "spin" : undefined}
              />
              {reindexing ? "Rebuilding..." : "Rebuild Vector Index"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSaveEmbeddings()}
              disabled={savingEmbeddings}
            >
              {savingEmbeddings ? "Applying..." : "Save Embeddings"}
            </button>
          </div>
        </div>

        {/* Web Research & SearXNG */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
            <Globe size={15} className="text-primary" />
            Web Research & Grounding
          </div>
          <p className="text-xs text-on-surface-variant">
            Powers the study tutor&apos;s <code className="font-mono">web_research</code>{" "}
            tool with provider-native grounding, self-hosted SearXNG, or both.
            Result pages are fetched with strict private-IP SSRF protection.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <select
              aria-label="Web research engine"
              value={webSearch.engine}
              onChange={(e) =>
                setWebSearch((prev) => ({
                  ...prev,
                  engine: e.target.value as WebSearchEngine,
                }))
              }
              className="rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-xs text-on-surface"
            >
              <option value="provider">Provider Grounding (Gemini / OpenAI / Claude)</option>
              <option value="searxng">Self-Hosted SearXNG + Page Reader</option>
              <option value="combined">Combined (SearXNG + Provider Grounding)</option>
            </select>

            <input
              aria-label="SearXNG Base URL"
              className="input font-mono text-xs"
              placeholder="SearXNG URL (e.g. http://localhost:8080)"
              value={webSearch.searxngUrl}
              onChange={(e) =>
                setWebSearch((prev) => ({
                  ...prev,
                  searxngUrl: e.target.value,
                }))
              }
            />
          </div>

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleTestSearxng()}
              disabled={!webSearch.searxngUrl.trim() || testingSearxng}
            >
              {testingSearxng ? "Testing..." : "Test SearXNG"}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleSaveWebSearch()}
              disabled={savingWeb}
            >
              {savingWeb ? "Saving..." : "Save Web Research"}
            </button>
          </div>
        </div>
      </div>

      <div className="divider-h" style={{ margin: "var(--space-6) 0" }} />
    </>
  );
}
