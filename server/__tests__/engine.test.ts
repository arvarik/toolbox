import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tempDir = mkdtempSync(path.join(tmpdir(), "toolbox-test-"));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, "test.db");

const { customModelId, parseCustomModelId, DEFAULT_MODEL_ID } = await import(
  "../providers/defs.ts"
);
const { resolveModel } = await import("../ai/engine.ts");
const { getProviderIdForModel } = await import("../providers/index.ts");
const { default: db } = await import("../db.ts");

describe("custom model ID namespace", () => {
  it("round-trips endpoint and model IDs", () => {
    const id = customModelId("ep-1", "llama3:8b");
    expect(id).toBe("custom:ep-1:llama3:8b");
    expect(parseCustomModelId(id)).toEqual({
      endpointId: "ep-1",
      upstreamModelId: "llama3:8b",
    });
  });

  it("rejects non-custom and malformed IDs", () => {
    expect(parseCustomModelId("gemini-3.5-flash")).toBeNull();
    expect(parseCustomModelId("custom:only-endpoint")).toBeNull();
    expect(parseCustomModelId(null)).toBeNull();
  });
});

describe("getProviderIdForModel", () => {
  it("matches static catalog entries exactly", () => {
    expect(getProviderIdForModel("gemini-3.5-flash")).toBe("gemini");
    expect(getProviderIdForModel("claude-sonnet-4-6")).toBe("claude");
    expect(getProviderIdForModel("gpt-5.6-sol")).toBe("openai");
  });

  it("infers the provider from the model ID namespace", () => {
    expect(getProviderIdForModel("gemini-99-ultra")).toBe("gemini");
    expect(getProviderIdForModel("gemma-3-27b")).toBe("gemini");
    expect(getProviderIdForModel("claude-future-9")).toBe("claude");
    expect(getProviderIdForModel("gpt-99")).toBe("openai");
    expect(getProviderIdForModel("o4-mini")).toBe("openai");
  });

  it("returns null for unknown models instead of guessing", () => {
    expect(getProviderIdForModel("llama3:8b")).toBeNull();
    expect(getProviderIdForModel("totally-unknown")).toBeNull();
  });
});

describe("resolveModel", () => {
  it("throws a clear error for unknown models", () => {
    expect(() => resolveModel("clade-typo-1")).toThrow(
      /Unknown model "clade-typo-1"/,
    );
  });

  it("throws a clear error when the provider key is missing", () => {
    db.prepare("DELETE FROM config WHERE key = 'claude_api_key'").run();
    expect(() => resolveModel("claude-sonnet-4-6")).toThrow(
      /API key not configured/,
    );
  });

  it("throws a clear error when a custom endpoint was removed", () => {
    expect(() => resolveModel("custom:gone-endpoint:llama3")).toThrow(
      /Custom endpoint not found/,
    );
  });

  it("builds a model instance when a key is configured", () => {
    db.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('claude_api_key', 'sk-test', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    const { model, modelId } = resolveModel("claude-sonnet-4-6");
    expect(modelId).toBe("claude-sonnet-4-6");
    expect((model as { modelId?: string }).modelId).toBe("claude-sonnet-4-6");
  });

  it("builds a custom-endpoint model from a stored endpoint row", () => {
    db.prepare(
      `INSERT INTO custom_endpoints (id, name, base_url, api_key) VALUES ('ep-1', 'Local Ollama', 'http://localhost:11434/v1', '')`,
    ).run();
    const { model, modelId } = resolveModel("custom:ep-1:llama3:8b");
    expect(modelId).toBe("custom:ep-1:llama3:8b");
    expect((model as { modelId?: string }).modelId).toBe("llama3:8b");
  });

  it("falls back to the default model when none is given", () => {
    db.prepare(
      `INSERT INTO config (key, value, updated_at) VALUES ('gemini_api_key', 'test-key', datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run();
    const { modelId } = resolveModel(undefined);
    expect(modelId).toBe(DEFAULT_MODEL_ID);
  });
});
