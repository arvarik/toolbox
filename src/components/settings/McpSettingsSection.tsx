import React, { useState } from "react";
import {
  BookOpen,
  Check,
  Copy,
  KeyRound,
  PlugZap,
  Shield,
  Sparkles,
  Terminal,
} from "lucide-react";
import { MCP_TOOLS, type McpToolEffect } from "../../../shared/mcpTools.ts";
import useAppStore from "../../stores/appStore";
import { authApi } from "../../utils/authApi.ts";
import { useAuth } from "../auth/AuthGate.tsx";

const TOKEN_PLACEHOLDER = "<YOUR_TBK_TOKEN>";

const MCP_RESOURCES = [
  {
    uri: "toolbox://library/overview",
    description: "Kits summary, due card counts, study streak, and 30-day review heatmap.",
  },
  {
    uri: "toolbox://kits/{slug}/skeleton",
    description: "Curriculum pillars, topics, sections, concept DAG, and live FSRS-6 node health.",
  },
  {
    uri: "toolbox://kits/{slug}/guide",
    description: "Committed Markdown study guide notes across all slots in a Kit.",
  },
  {
    uri: "toolbox://kits/{slug}/due-cards",
    description: "Prioritized queue of flashcards currently due for FSRS-6 review.",
  },
] as const;

const MCP_PROMPTS = [
  {
    name: "study_briefing",
    args: "kit",
    description: "Daily briefing of due cards, decayed graph nodes, remediation items, and next Mastery Path targets.",
  },
  {
    name: "socratic_drill",
    args: "kit, topic",
    description: "Interactive one-question-at-a-time Socratic drill grounded in the Kit persona and your Guide notes.",
  },
] as const;

function effectBadgeClasses(effect: McpToolEffect): string {
  if (effect === "read") {
    return "bg-info/10 text-info";
  }
  if (effect === "add") {
    return "bg-success/10 text-success";
  }
  return "bg-warning/10 text-warning";
}

function effectLabel(effect: McpToolEffect): string {
  if (effect === "read") return "Read";
  if (effect === "add") return "Add";
  return "Change";
}

function CopySnippetButton({
  text,
  label,
  toastMessage,
}: {
  text: string;
  label: string;
  toastMessage: string;
}) {
  const addToast = useAppStore((s) => s.addToast);
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      addToast({ type: "success", message: toastMessage });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      addToast({
        type: "error",
        message: "Clipboard access was blocked by the browser",
      });
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleCopy()}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high border border-outline-variant px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-highest transition-colors cursor-pointer shrink-0"
    >
      {copied ? (
        <Check size={13} className="text-success" aria-hidden="true" />
      ) : (
        <Copy size={13} aria-hidden="true" />
      )}
      <span>{copied ? "Copied" : "Copy"}</span>
    </button>
  );
}

export function McpSettingsSection() {
  const { user, authRequired, status } = useAuth();
  const addToast = useAppStore((s) => s.addToast);

  const [tokenName, setTokenName] = useState("MCP Study Assistant");
  const [readOnly, setReadOnly] = useState(false);
  const [minting, setMinting] = useState(false);
  const [mintedToken, setMintedToken] = useState<string | null>(null);
  const [mintedReadOnly, setMintedReadOnly] = useState<boolean | null>(null);

  if (authRequired && !user) return null;

  const baseOrigin =
    status?.publicUrl ||
    (typeof window !== "undefined"
      ? window.location.origin
      : "http://localhost:3001");
  const endpointUrl = `${baseOrigin.replace(/\/+$/, "")}/api/mcp`;
  const activeTokenText = mintedToken ?? TOKEN_PLACEHOLDER;

  const claudeCodeSnippet = `claude mcp add --transport http toolbox "${endpointUrl}" --header "Authorization: Bearer ${activeTokenText}"`;

  const jsonClientSnippet = JSON.stringify(
    {
      mcpServers: {
        toolbox: {
          url: endpointUrl,
          headers: {
            Authorization: `Bearer ${activeTokenText}`,
          },
        },
      },
    },
    null,
    2,
  );

  const handleGenerateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = tokenName.trim() || "MCP Study Assistant";
    setMinting(true);
    try {
      const created = await authApi.createToken({
        name: cleanName,
        readOnly,
      });
      setMintedToken(created.token);
      setMintedReadOnly(created.readOnly);
      addToast({
        type: "success",
        message: created.readOnly
          ? "Read-only MCP token generated"
          : "MCP token generated and inserted into snippets",
      });
    } catch (err) {
      addToast({
        type: "error",
        message:
          err instanceof Error ? err.message : "Could not generate MCP token",
      });
    } finally {
      setMinting(false);
    }
  };

  return (
    <>
      <div className="settings-section" id="mcp-settings-section">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
          <h2 className="settings-section-title flex items-center gap-2 m-0">
            <PlugZap size={18} className="text-primary" aria-hidden="true" />
            <span>Model Context Protocol (MCP) Server</span>
          </h2>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 text-success px-2.5 py-0.5 text-xs font-medium">
            Stateless Streamable HTTP
          </span>
        </div>

        <p className="settings-section-desc">
          Connect Claude Code, Cursor, Antigravity, or Claude Desktop directly to your
          personal Kits, Mastery Paths, FSRS-6 review queue, and Study Guides over
          stateless HTTP with scoped <code className="font-mono">tbk_</code> Bearer tokens.
        </p>

        <div className="rounded-xl bg-surface-container border border-outline-variant p-4 space-y-4">
          {/* Step 1: Endpoint URL */}
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2.5">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant">
                MCP Endpoint URL
              </div>
              <code
                data-testid="mcp-endpoint-url"
                className="font-mono text-xs text-on-surface break-all"
              >
                {endpointUrl}
              </code>
            </div>
            <CopySnippetButton
              text={endpointUrl}
              label="Copy MCP endpoint URL"
              toastMessage="MCP endpoint URL copied"
            />
          </div>

          {/* Step 2: 1-Click Token Generator */}
          <form
            onSubmit={(e) => void handleGenerateToken(e)}
            className="rounded-lg bg-surface-container-lowest border border-outline-variant p-3.5 space-y-3"
          >
            <div className="flex items-center gap-2 text-xs font-semibold text-on-surface">
              <KeyRound size={14} className="text-primary" aria-hidden="true" />
              <span>1-Click Personal MCP Token</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2.5 items-center">
              <input
                type="text"
                aria-label="MCP token name"
                placeholder="Token label (e.g. Claude Code Laptop)"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                maxLength={80}
                className="rounded-lg bg-surface-container border border-outline-variant px-3 py-1.5 text-xs text-on-surface"
              />
              <button
                type="submit"
                disabled={minting}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary text-on-primary px-3.5 py-1.5 text-xs font-semibold hover:opacity-95 disabled:opacity-60 transition-opacity cursor-pointer"
              >
                <KeyRound size={13} aria-hidden="true" />
                <span>{minting ? "Generating..." : "Generate MCP Token"}</span>
              </button>
            </div>

            <label className="flex items-start gap-2.5 text-xs text-on-surface cursor-pointer select-none">
              <input
                type="checkbox"
                checked={readOnly}
                onChange={(e) => setReadOnly(e.target.checked)}
                className="mt-0.5 accent-primary"
              />
              <span>
                <span className="font-medium">Read-Only Token</span>
                <span className="block text-[11px] text-on-surface-variant">
                  Exposes only the 4 read tools (<code className="font-mono">list_kits</code>,{" "}
                  <code className="font-mono">get_kit_path</code>,{" "}
                  <code className="font-mono">search_kit</code>,{" "}
                  <code className="font-mono">get_due_cards</code>) and blocks all writes.
                </span>
              </span>
            </label>

            {mintedToken && (
              <div
                role="status"
                className="rounded-lg bg-surface-container border border-outline-variant p-2.5 flex items-center justify-between gap-2 flex-wrap"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-success">
                    <Shield size={12} aria-hidden="true" />
                    <span>
                      New {mintedReadOnly ? "read-only" : "read & write"} token minted — shown once, inserted into snippets below:
                    </span>
                  </div>
                  <code
                    data-testid="mcp-minted-token"
                    className="block font-mono text-xs text-on-surface break-all"
                  >
                    {mintedToken}
                  </code>
                </div>
                <CopySnippetButton
                  text={mintedToken}
                  label="Copy minted MCP token"
                  toastMessage="MCP token copied"
                />
              </div>
            )}
          </form>

          {/* Step 3: Copyable Client Snippets */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant p-3 space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface">
                    <Terminal size={13} className="text-primary" aria-hidden="true" />
                    <span>Claude Code (CLI)</span>
                  </span>
                  <CopySnippetButton
                    text={claudeCodeSnippet}
                    label="Copy Claude Code command"
                    toastMessage="Claude Code MCP command copied"
                  />
                </div>
                <pre
                  data-testid="mcp-snippet-claude-code"
                  className="rounded-lg bg-surface-container-highest p-2.5 font-mono text-[11px] text-on-surface whitespace-pre-wrap break-all m-0"
                >
                  {claudeCodeSnippet}
                </pre>
              </div>
            </div>

            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant p-3 space-y-2 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface">
                    <Sparkles size={13} className="text-ai" aria-hidden="true" />
                    <span>Cursor / Antigravity / Claude Desktop</span>
                  </span>
                  <CopySnippetButton
                    text={jsonClientSnippet}
                    label="Copy MCP JSON config"
                    toastMessage="MCP JSON config copied"
                  />
                </div>
                <pre
                  data-testid="mcp-snippet-json"
                  className="rounded-lg bg-surface-container-highest p-2.5 font-mono text-[11px] text-on-surface whitespace-pre-wrap break-all m-0"
                >
                  {jsonClientSnippet}
                </pre>
              </div>
            </div>
          </div>

          {/* Step 4: Live 7-Tool Capability Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-on-surface-variant m-0">
                Available MCP Tools ({MCP_TOOLS.length})
              </h3>
              <span className="text-[11px] text-on-surface-variant">
                Shared catalog (<code className="font-mono">shared/mcpTools.ts</code>)
              </span>
            </div>

            <div className="overflow-x-auto rounded-lg border border-outline-variant bg-surface-container-lowest">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-outline-variant bg-surface-container-low text-on-surface-variant">
                    <th className="py-2 px-3 font-semibold">Tool</th>
                    <th className="py-2 px-3 font-semibold">Effect</th>
                    <th className="py-2 px-3 font-semibold">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {MCP_TOOLS.map((tool) => {
                    const omittedInReadOnly =
                      (mintedReadOnly ?? readOnly) && tool.effect !== "read";
                    return (
                      <tr
                        key={tool.name}
                        className={`border-b last:border-b-0 border-outline-variant ${
                          omittedInReadOnly ? "opacity-55" : ""
                        }`}
                      >
                        <td className="py-2 px-3 align-top whitespace-nowrap">
                          <code className="font-mono font-semibold text-on-surface">
                            {tool.name}
                          </code>
                          <div className="text-[11px] text-on-surface-variant">
                            {tool.title}
                          </div>
                        </td>
                        <td className="py-2 px-3 align-top whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${effectBadgeClasses(
                              tool.effect,
                            )}`}
                          >
                            {effectLabel(tool.effect)}
                          </span>
                        </td>
                        <td className="py-2 px-3 align-top text-on-surface-variant">
                          {tool.description}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Step 5: Resources & Prompts Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-on-surface">
                <BookOpen size={13} className="text-primary" aria-hidden="true" />
                <span>Resources ({MCP_RESOURCES.length})</span>
              </div>
              <ul className="space-y-1.5 m-0 p-0 list-none text-xs">
                {MCP_RESOURCES.map((res) => (
                  <li key={res.uri}>
                    <code className="font-mono text-[11px] text-on-surface">
                      {res.uri}
                    </code>
                    <div className="text-[11px] text-on-surface-variant">
                      {res.description}
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg bg-surface-container-lowest border border-outline-variant p-3 space-y-2">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-on-surface">
                <Sparkles size={13} className="text-ai" aria-hidden="true" />
                <span>Prompts ({MCP_PROMPTS.length})</span>
              </div>
              <ul className="space-y-1.5 m-0 p-0 list-none text-xs">
                {MCP_PROMPTS.map((prompt) => (
                  <li key={prompt.name}>
                    <code className="font-mono text-[11px] text-on-surface">
                      /{prompt.name}({prompt.args})
                    </code>
                    <div className="text-[11px] text-on-surface-variant">
                      {prompt.description}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="divider-h" style={{ margin: "var(--space-6) 0" }} />
    </>
  );
}
