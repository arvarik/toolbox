// @vitest-environment node
import { describe, expect, it } from "vitest";
import db from "../db.ts";
import { resolveModel } from "../ai/engine.ts";
import {
  customModelId,
  DEFAULT_MODEL_ID,
  parseCustomModelId,
} from "../providers/defs.ts";
import { inferProviderId } from "../platform/ai/aiSettingsService.ts";
import {
  applyCatalogGuardrails,
  baseAliasOf,
  dedupeAliases,
  extractGeneration,
  inferModelFamily,
  isChatModel,
  isPreviewVariant,
  isWithinRecencyWindow,
  keepLatestPerFamily,
  prettyModelName,
  RECENCY_WINDOW_MS,
} from "../providers/model_filter.ts";
import { isMaskedValue, maskSecret } from "../utils/mask.ts";

const NOW = Date.parse("2026-08-16T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

describe("Model Catalog Guardrails, Provider Resolution & Secret Masking", () => {
  it("enforces modality guardrails (isChatModel) across chat, audio, image, moderation, and specialized systems", () => {
    for (const id of [
      "gpt-5.1",
      "gpt-5.1-mini",
      "o4-mini",
      "chatgpt-4o-latest",
      "claude-sonnet-4-6",
      "claude-opus-4-8",
      "gemini-3.5-flash",
      "gemini-3.1-flash-lite",
      "llama3.2:3b",
      "qwen2.5-coder",
    ]) {
      expect(isChatModel(id), id).toBe(true);
    }

    for (const nonChat of [
      "text-embedding-3-large",
      "gemini-embedding-001",
      "nomic-embed-text",
      "whisper-1",
      "gpt-4o-transcribe",
      "gpt-4o-mini-tts",
      "gpt-4o-audio-preview",
      "gpt-4o-realtime-preview",
      "gemini-2.5-flash-preview-tts",
      "dall-e-3",
      "gpt-image-1",
      "imagen-4.0-generate-001",
      "veo-3.1-generate-preview",
      "omni-moderation-latest",
      "text-moderation-007",
      "babbage-002",
      "davinci-002",
      "gpt-3.5-turbo-instruct",
      "lyria-3-clip-preview",
      "gemini-robotics-er-2-preview",
      "gemini-2.5-computer-use-preview-10-2025",
      "deep-research-pro-preview-12-2025",
      "antigravity-preview-05-2026",
      "nano-banana-pro-preview",
      "",
    ]) {
      expect(isChatModel(nonChat), nonChat).toBe(false);
    }
    expect(isChatModel(undefined)).toBe(false);
  });

  it("enforces recency window, snapshot alias dedupe, and combined applyCatalogGuardrails", () => {
    expect(isWithinRecencyWindow(NOW - 30 * DAY, NOW)).toBe(true);
    expect(isWithinRecencyWindow(NOW - 364 * DAY, NOW)).toBe(true);
    expect(isWithinRecencyWindow(NOW - RECENCY_WINDOW_MS, NOW)).toBe(true);
    expect(isWithinRecencyWindow(NOW - 366 * DAY, NOW)).toBe(false);
    expect(isWithinRecencyWindow(NOW - 3 * 365 * DAY, NOW)).toBe(false);
    expect(isWithinRecencyWindow(null, NOW)).toBe(true);
    expect(isWithinRecencyWindow(undefined, NOW)).toBe(true);

    expect(baseAliasOf("gpt-4o-2024-08-06")).toBe("gpt-4o");
    expect(baseAliasOf("claude-3-5-haiku-20241022")).toBe("claude-3-5-haiku");
    expect(baseAliasOf("gpt-4-0613")).toBe("gpt-4");
    expect(baseAliasOf("gpt-5.1")).toBe("gpt-5.1");

    expect(
      dedupeAliases([
        { id: "gpt-4o" },
        { id: "gpt-4o-2024-08-06" },
        { id: "gpt-4o-2024-11-20" },
        { id: "o4-mini" },
      ]).map((m) => m.id),
    ).toEqual(["gpt-4o", "o4-mini"]);
    expect(dedupeAliases([{ id: "claude-sonnet-4-6-20251001" }]).map((m) => m.id)).toEqual([
      "claude-sonnet-4-6-20251001",
    ]);
    expect(dedupeAliases([{ id: "gpt-5.1" }, { id: "gpt-5.1" }])).toHaveLength(1);

    const guarded = applyCatalogGuardrails(
      [
        { id: "gpt-5.1", releasedAt: NOW - 10 * DAY },
        { id: "gpt-5.1-2026-08-01", releasedAt: NOW - 15 * DAY },
        { id: "gpt-4-0613", releasedAt: NOW - 3 * 365 * DAY },
        { id: "text-embedding-3-large", releasedAt: NOW - 5 * DAY },
        { id: "whisper-1", releasedAt: NOW - 5 * DAY },
        { id: "gemini-3.5-flash", releasedAt: null },
      ],
      NOW,
    );
    expect(guarded.map((m) => m.id)).toEqual(["gpt-5.1", "gemini-3.5-flash"]);
  });

  it("infers families, generations, preview variants, pretty names, and latest-per-family winners", () => {
    const familyCases: Array<[string, string, string | null]> = [
      ["gemini", "gemini-3.5-flash", "Flash"],
      ["gemini", "gemini-3.1-pro", "Pro"],
      ["gemini", "gemini-3.1-flash-lite", "Flash-Lite"],
      ["gemini", "gemma-4-31b-it", "Gemma"],
      ["gemini", "deep-research-pro-preview-12-2025", null],
      ["claude", "claude-sonnet-4-6", "Sonnet"],
      ["claude", "claude-haiku-4-5", "Haiku"],
      ["claude", "claude-opus-4-8", "Opus"],
      ["claude", "claude-fable-5", "Fable"],
      ["openai", "gpt-5.6-sol", "Flagship"],
      ["openai", "gpt-5.6-terra", "Balanced"],
      ["openai", "gpt-5.6-luna", "Fast"],
      ["openai", "gpt-5.2", "Flagship"],
      ["openai", "gpt-5.2-mini", "Mini"],
      ["openai", "gpt-5.2-nano", "Nano"],
      ["openai", "o3", "Reasoning"],
      ["custom", "llama3.2:3b", null],
    ];
    for (const [provider, id, expected] of familyCases) {
      expect(inferModelFamily(provider, id), `${provider}:${id}`).toBe(expected);
    }

    for (const [id, gen] of [
      ["gemini-3.6-flash", 3.6],
      ["gpt-5.6-sol", 5.6],
      ["claude-opus-4-8", 4.8],
      ["claude-opus-5", 5],
      ["claude-haiku-4-5", 4.5],
      ["o4-mini", 4],
      ["claude-opus-4-5-20251101", 4.5],
      ["gemini-flash-latest", null],
      ["", null],
    ] as const) {
      expect(extractGeneration(id), id).toBe(gen);
    }

    for (const p of ["gemini-3.6-flash-preview-06-17", "gemini-exp-1206", "gemini-flash-latest", "chatgpt-4o-latest"]) {
      expect(isPreviewVariant(p), p).toBe(true);
    }
    for (const s of ["gemini-3.6-flash", "claude-opus-5", "gpt-5.6-sol"]) {
      expect(isPreviewVariant(s), s).toBe(false);
    }

    expect(
      keepLatestPerFamily("gemini", [
        { id: "gemini-2.5-flash" },
        { id: "gemini-3.5-flash" },
        { id: "gemini-3.6-flash" },
        { id: "gemini-flash-latest" },
        { id: "gemini-2.5-pro" },
        { id: "gemini-3.1-pro" },
        { id: "gemini-pro-latest" },
        { id: "gemini-2.5-flash-lite" },
        { id: "gemini-3.5-flash-lite" },
        { id: "gemini-flash-lite-latest" },
      ]).map((m) => m.id),
    ).toEqual(["gemini-3.1-pro", "gemini-3.6-flash", "gemini-3.5-flash-lite"]);

    expect(
      keepLatestPerFamily("claude", [
        { id: "claude-opus-5" },
        { id: "claude-sonnet-5" },
        { id: "claude-fable-5" },
        { id: "claude-opus-4-8" },
        { id: "claude-opus-4-7" },
        { id: "claude-sonnet-4-6" },
        { id: "claude-opus-4-5-20251101" },
        { id: "claude-haiku-4-5" },
      ]).map((m) => m.id),
    ).toEqual(["claude-fable-5", "claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]);

    expect(
      keepLatestPerFamily("openai", [
        { id: "gpt-5.6-sol" },
        { id: "gpt-5.6-terra" },
        { id: "gpt-5.6-luna" },
        { id: "gpt-5.2" },
        { id: "gpt-5.1" },
        { id: "gpt-5.2-mini" },
        { id: "gpt-5.2-nano" },
        { id: "o4-mini" },
      ]).map((m) => m.id),
    ).toEqual(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.2-mini", "gpt-5.2-nano"]);

    expect(
      keepLatestPerFamily("gemini", [
        { id: "gemini-3.6-flash" },
        { id: "gemini-3.6-flash-preview-06-17" },
      ]).map((m) => m.id),
    ).toEqual(["gemini-3.6-flash"]);
    expect(keepLatestPerFamily("gemini", [{ id: "gemini-pro-latest" }]).map((m) => m.id)).toEqual(["gemini-pro-latest"]);
    expect(keepLatestPerFamily("gemini", [{ id: "mystery-1" }, { id: "mystery-2" }]).map((m) => m.id)).toEqual(["mystery-1", "mystery-2"]);
    expect(
      keepLatestPerFamily("gemini", [
        { id: "gemini-3.1-pro-preview" },
        { id: "gemini-3.1-pro-preview-customtools" },
      ]).map((m) => m.id),
    ).toEqual(["gemini-3.1-pro-preview"]);

    expect(prettyModelName("llama3.2:3b")).toBe("Llama3.2 3b");
    expect(prettyModelName("gpt-4o")).toBe("GPT 4o");
    expect(prettyModelName("models/gemini-3.5-flash")).toBe("Gemini 3.5 Flash");
  });

  it("masks API secrets safely and prevents masked values from being re-saved", () => {
    expect(maskSecret("sk-ant-api03-abcdef1234")).toBe("••••1234");
    expect(maskSecret("AIzaSyD-9876")).toBe("••••9876");
    expect(maskSecret("abcd")).toBe("••••");
    expect(maskSecret("ab")).toBe("••••");
    expect(maskSecret("")).toBe("");
    expect(maskSecret(null)).toBe("");
    expect(maskSecret(undefined)).toBe("");
    expect(isMaskedValue("••••1234")).toBe(true);
    expect(isMaskedValue("sk-real-key")).toBe(false);
  });

  it("resolves custom model namespaces, provider inference, and engine resolveModel instances/errors", () => {
    const cid = customModelId("ep-1", "llama3:8b");
    expect(cid).toBe("custom:ep-1:llama3:8b");
    expect(parseCustomModelId(cid)).toEqual({ endpointId: "ep-1", upstreamModelId: "llama3:8b" });
    expect(parseCustomModelId("gemini-3.5-flash")).toBeNull();
    expect(parseCustomModelId("custom:only-endpoint")).toBeNull();
    expect(parseCustomModelId(null)).toBeNull();

    for (const [id, prov] of [
      ["gemini-3.5-flash", "gemini"],
      ["gemini-99-ultra", "gemini"],
      ["gemma-3-27b", "gemini"],
      ["claude-sonnet-4-6", "claude"],
      ["claude-future-9", "claude"],
      ["gpt-5.6-sol", "openai"],
      ["gpt-99", "openai"],
      ["o4-mini", "openai"],
      ["llama3:8b", null],
      ["totally-unknown", null],
    ] as const) {
      expect(inferProviderId(id), id).toBe(prov);
    }

    expect(() => resolveModel("clade-typo-1")).toThrow(/Unknown model "clade-typo-1"/);
    db.prepare("DELETE FROM config WHERE key = 'claude_api_key'").run();
    expect(() => resolveModel("claude-sonnet-4-6")).toThrow(/API key not configured/);
    expect(() => resolveModel("custom:gone-endpoint:llama3")).toThrow(/Custom endpoint not found/);

    db.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('claude_api_key', 'sk-test', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    const claudeResolved = resolveModel("claude-sonnet-4-6");
    expect(claudeResolved.modelId).toBe("claude-sonnet-4-6");
    expect((claudeResolved.model as { modelId?: string }).modelId).toBe("claude-sonnet-4-6");

    db.prepare(
      `INSERT INTO custom_endpoints (id, name, base_url, api_key) VALUES ('ep-1', 'Local Ollama', 'http://localhost:11434/v1', '')`,
    ).run();
    const customResolved = resolveModel("custom:ep-1:llama3:8b");
    expect(customResolved.modelId).toBe("custom:ep-1:llama3:8b");
    expect((customResolved.model as { modelId?: string }).modelId).toBe("llama3:8b");

    db.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('gemini_api_key', 'test-key', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    expect(resolveModel(undefined).modelId).toBe(DEFAULT_MODEL_ID);
  });
});
