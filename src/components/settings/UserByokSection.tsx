import React, { useCallback, useEffect, useState } from "react";
import { KeyRound, Lock, Plus, Server, Trash2 } from "lucide-react";
import type {
  CapabilityAssignment,
  GenerationCapability,
  WebSearchEngine,
} from "../../../shared/platform/aiSettings.ts";
import useAppStore from "../../stores/appStore";
import {
  userAiSettingsApi,
  type UserAiSettingsResponse,
} from "../../utils/aiSettingsApi.ts";
import { useAuth } from "../auth/AuthGate.tsx";

const PROVIDERS = [
  { id: "gemini", label: "Google Gemini" },
  { id: "claude", label: "Anthropic Claude" },
  { id: "openai", label: "OpenAI" },
] as const;

const CAPABILITY_LABELS: Array<{ key: GenerationCapability; label: string }> = [
  { key: "quick", label: "Quick Generation" },
  { key: "deep", label: "Deep Reasoning" },
  { key: "research", label: "Web Grounding" },
];

export function UserByokSection() {
  const { user, authRequired, isResolved } = useAuth();
  const addToast = useAppStore((s) => s.addToast);

  const [settings, setSettings] = useState<UserAiSettingsResponse | null>(null);
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [testingProvider, setTestingProvider] = useState<string | null>(null);

  const [epName, setEpName] = useState("");
  const [epUrl, setEpUrl] = useState("");
  const [epKey, setEpKey] = useState("");
  const [addingEndpoint, setAddingEndpoint] = useState(false);

  const loadByok = useCallback(async () => {
    if (!isResolved || !authRequired || !user) return;
    try {
      const res = await userAiSettingsApi.get();
      setSettings(res);
    } catch {
      // Offline or unmocked test environment
    }
  }, [isResolved, authRequired, user]);

  useEffect(() => {
    void loadByok();
  }, [loadByok]);

  if (!isResolved || !authRequired || !user || !settings) return null;

  const handleSavePersonalKey = async (providerId: string, label: string) => {
    const raw = (keyInputs[providerId] ?? "").trim();
    if (!raw) return;
    setTestingProvider(providerId);
    try {
      const res = await userAiSettingsApi.testAndSaveKey(providerId, raw);
      setSettings(res.settings);
      setKeyInputs((prev) => ({ ...prev, [providerId]: "" }));
      addToast({
        type: "success",
        message: `Personal ${label} key verified and encrypted`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : `Invalid ${label} API key`,
      });
    } finally {
      setTestingProvider(null);
    }
  };

  const handleClearPersonalKey = async (providerId: string, label: string) => {
    try {
      const updated = await userAiSettingsApi.update({
        providerKeys: { [providerId]: "" },
      });
      setSettings(updated);
      addToast({
        type: "info",
        message: `Personal ${label} key cleared`,
      });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not clear key",
      });
    }
  };

  const handleAddEndpoint = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!epName.trim() || !epUrl.trim()) return;
    setAddingEndpoint(true);
    try {
      await userAiSettingsApi.createEndpoint({
        name: epName.trim(),
        baseUrl: epUrl.trim(),
        apiKey: epKey.trim() || undefined,
      });
      setEpName("");
      setEpUrl("");
      setEpKey("");
      await loadByok();
      addToast({ type: "success", message: "Personal endpoint added" });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not add endpoint",
      });
    } finally {
      setAddingEndpoint(false);
    }
  };

  const handleRemoveEndpoint = async (id: string) => {
    try {
      await userAiSettingsApi.deleteEndpoint(id);
      await loadByok();
      addToast({ type: "info", message: "Personal endpoint removed" });
    } catch (err) {
      addToast({
        type: "error",
        message: err instanceof Error ? err.message : "Could not remove endpoint",
      });
    }
  };

  const handleCapabilityChange = async (
    cap: GenerationCapability,
    next: CapabilityAssignment | null,
  ) => {
    try {
      const updated = await userAiSettingsApi.update({
        capabilities: { [cap]: next },
      });
      setSettings(updated);
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not update override",
      });
    }
  };

  const handleWebSearchChange = async (val: string) => {
    try {
      const updated = await userAiSettingsApi.update({
        webSearchEngine: val === "inherit" ? null : (val as WebSearchEngine),
      });
      setSettings(updated);
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not update web search",
      });
    }
  };

  return (
    <>
      <div className="settings-section space-y-5" id="user-byok-section">
        <div className="flex items-center gap-2">
          <KeyRound size={18} className="text-primary" />
          <h2 className="settings-section-title" style={{ marginBottom: 0 }}>
            Personal AI Keys & Routing Overrides (BYOK)
          </h2>
        </div>
        <p className="settings-section-desc">
          Bring your own provider keys or OpenAI-compatible endpoints. Personal
          keys are AES-256-GCM sealed to your account and take priority over
          instance defaults on your study calls.
        </p>

        {/* Personal Provider Keys */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="text-sm font-medium text-on-surface">
            Personal Provider Keys
          </div>
          <div className="space-y-2.5">
            {PROVIDERS.map(({ id, label }) => {
              const configured = settings.providerKeysConfigured[id];
              const masked = settings.providerKeysMasked[id];
              const val = keyInputs[id] ?? "";
              return (
                <div
                  key={id}
                  className="rounded-lg bg-surface-container-lowest p-3 border border-outline-variant space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-on-surface">
                      {label}
                    </span>
                    <span
                      className={`rounded px-2 py-0.5 text-[11px] font-medium ${
                        configured
                          ? "bg-ai/12 text-on-ai-wash"
                          : "bg-surface-container text-on-surface-variant"
                      }`}
                    >
                      {configured
                        ? `Personal key (${masked || "active"})`
                        : "Using instance default"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id={`byok-${id}-key-input`}
                      type="password"
                      className="input text-xs flex-1"
                      placeholder={`Personal ${label} API key`}
                      value={val}
                      onChange={(e) =>
                        setKeyInputs((prev) => ({
                          ...prev,
                          [id]: e.target.value,
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={!val.trim() || testingProvider === id}
                      onClick={() => void handleSavePersonalKey(id, label)}
                    >
                      {testingProvider === id ? "Checking..." : "Verify & Save Key"}
                    </button>
                    {configured && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => void handleClearPersonalKey(id, label)}
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Personal OpenAI-Compatible Endpoints */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
            <Server size={15} className="text-primary" />
            Personal Custom Endpoints
          </div>

          {settings.customEndpoints.length > 0 && (
            <div className="space-y-1.5">
              {settings.customEndpoints.map((ep) => (
                <div
                  key={ep.id}
                  className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-xs border border-outline-variant gap-2"
                >
                  <div className="truncate">
                    <span className="font-medium text-on-surface">
                      {ep.name}
                    </span>{" "}
                    <code className="font-mono text-on-surface-variant">
                      {ep.baseUrl}
                    </code>{" "}
                    <span className="text-on-surface-variant">
                      · {ep.models.length} models
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRemoveEndpoint(ep.id)}
                    className="text-danger hover:underline inline-flex items-center gap-1 shrink-0"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <form
            onSubmit={handleAddEndpoint}
            className="grid grid-cols-1 sm:grid-cols-3 gap-2"
          >
            <input
              className="input text-xs"
              placeholder="Endpoint name (e.g. My Ollama)"
              value={epName}
              onChange={(e) => setEpName(e.target.value)}
            />
            <input
              className="input font-mono text-xs"
              placeholder="http://localhost:11434/v1"
              value={epUrl}
              onChange={(e) => setEpUrl(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <input
                type="password"
                className="input text-xs flex-1"
                placeholder="API key (optional)"
                value={epKey}
                onChange={(e) => setEpKey(e.target.value)}
              />
              <button
                type="submit"
                className="btn btn-secondary shrink-0"
                disabled={!epName.trim() || !epUrl.trim() || addingEndpoint}
              >
                <Plus size={14} />
                {addingEndpoint ? "Adding..." : "Add"}
              </button>
            </div>
          </form>
        </div>

        {/* Personal Capability Overrides */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="text-sm font-medium text-on-surface">
            Personal Capability Overrides
          </div>
          <div className="space-y-2">
            {CAPABILITY_LABELS.map(({ key, label }) => {
              const override = settings.capabilities[key];
              const resolved = settings.resolvedCapabilities[key];
              const selectValue = !override
                ? "inherit"
                : override.mode === "auto"
                  ? "auto"
                  : `pin:${override.modelId ?? ""}`;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2.5 border border-outline-variant gap-2 flex-wrap"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-on-surface">
                      {label}
                    </span>
                    {override && (
                      <span className="rounded bg-ai/12 px-1.5 py-0.5 text-[11px] text-on-ai-wash">
                        Overriding instance
                      </span>
                    )}
                    <code className="font-mono text-[11px] text-on-surface-variant">
                      → {resolved.resolvedModelId ?? "auto"}
                    </code>
                  </div>

                  <select
                    aria-label={`Personal ${label} routing`}
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "inherit") {
                        void handleCapabilityChange(key, null);
                      } else if (v === "auto") {
                        void handleCapabilityChange(key, {
                          mode: "auto",
                          modelId: null,
                        });
                      } else if (v.startsWith("pin:")) {
                        void handleCapabilityChange(key, {
                          mode: "pinned",
                          modelId: v.slice(4),
                        });
                      }
                    }}
                    className="rounded-lg bg-surface-container border border-outline-variant px-2.5 py-1.5 text-xs text-on-surface max-w-64"
                  >
                    <option value="inherit">Inherit Instance Default</option>
                    <option value="auto">Auto (Prefer Personal Keys)</option>
                    {settings.availableModels.map((m) => (
                      <option key={m.id} value={`pin:${m.id}`}>
                        Pin: {m.name} ({m.providerName})
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 border border-outline-variant text-xs gap-2 flex-wrap">
            <span className="text-on-surface font-medium">
              Web Search Preference
            </span>
            <select
              aria-label="Personal web search engine"
              value={settings.webSearchEngine ?? "inherit"}
              onChange={(e) => void handleWebSearchChange(e.target.value)}
              className="rounded-lg bg-surface-container border border-outline-variant px-2.5 py-1.5 text-xs text-on-surface"
            >
              <option value="inherit">
                Inherit Instance ({settings.instanceWebSearch.engine})
              </option>
              <option value="provider">Provider Grounding</option>
              <option value="searxng">SearXNG</option>
              <option value="combined">Combined</option>
            </select>
          </div>

          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant pt-1">
            <Lock size={12} />
            <span>
              Embeddings (<code className="font-mono">{settings.embeddings.provider}</code> ·{" "}
              <code className="font-mono">{settings.embeddings.dimension}d</code>) are
              locked instance-wide so Hybrid RAG shares one unified vector space.
            </span>
          </div>
        </div>
      </div>

      <div className="divider-h" style={{ margin: "var(--space-6) 0" }} />
    </>
  );
}
