// @vitest-environment node
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Express } from "express";
import { scopeForOwnerId, type Scope } from "../platform/tenancy/scope.ts";

const tempDir = mkdtempSync(path.join(tmpdir(), "toolbox-wave1b-"));
process.env.DATA_DIR = tempDir;
process.env.DB_PATH = path.join(tempDir, "wave1b.db");

const { default: db } = await import("../db.ts");
const { createApp } = await import("../app.ts");
const { __resetAuthRateLimits } = await import(
  "../platform/routes/authRoutes.ts"
);
const {
  __resetHostGuard,
  isHostAllowed,
} = await import("../platform/net/hostGuard.ts");
const {
  isPrivateAddress,
  readBodyCapped,
  readBytesCapped,
} = await import("../platform/net/originAndFetch.ts");
const { AppError } = await import("../platform/net/errors.ts");
const {
  resolveModel,
  runStructured,
  runText,
  __getStructuredModeFor,
  __resetStructuredModeCache,
} = await import("../ai/engine.ts");
const {
  setEmbeddingsConfig,
  resolveModelDescriptor,
} = await import("../platform/ai/aiSettingsService.ts");
const {
  deleteRagChunksBySource,
  ensureEmbeddingStore,
  hybridSearch,
  reindexMissingEmbeddings,
  upsertRagChunk,
} = await import("../search/hybridSearch.ts");
const { buildStudyTools } = await import("../routes/chat.ts");
const { runWebResearch } = await import("../platform/research/webResearch.ts");
const {
  isGroundingRedirectUrl,
  resolveRedirects,
} = await import("../platform/research/citations.ts");
const { ensureDefaultSystemDesignKit } = await import("../kits/kitsSchema.ts");

function listenLocal(
  handler: http.RequestListener,
): Promise<{ server: http.Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

describe("Wave 1B: AI Capability Router, Per-User BYOK, Hybrid RAG (FTS5 + sqlite-vec), Structured Ladder & SSRF Research", () => {
  let app: Express;
  let aliceAgent: ReturnType<typeof request.agent>;
  let bobAgent: ReturnType<typeof request.agent>;
  let aliceId = "";
  let bobId = "";
  let aliceScope: Scope;
  let bobScope: Scope;
  let aliceKit1Id = "";
  let aliceKit2Id = "";
  let bobKitId = "";

  beforeAll(async () => {
    __resetAuthRateLimits();
    __resetHostGuard();
    __resetStructuredModeCache();
    app = createApp();

    // Bootstrap Admin Alice via /api/auth/setup
    aliceAgent = request.agent(app);
    const aliceSetup = await aliceAgent
      .post("/api/auth/setup")
      .send({
        email: "alice@toolbox.test",
        username: "alice",
        displayName: "Alice Admin",
        password: "correct-horse-battery-staple",
      })
      .expect(201);
    aliceId = aliceSetup.body.user.id as string;

    // Invite Member Bob
    const invRes = await aliceAgent
      .post("/api/admin/invitations")
      .send({ email: "bob@toolbox.test", role: "member" })
      .expect(201);
    const invToken = new URL(invRes.body.link as string).searchParams.get(
      "token",
    )!;

    bobAgent = request.agent(app);
    const bobAccept = await bobAgent
      .post("/api/auth/accept-invitation")
      .send({
        token: invToken,
        email: "bob@toolbox.test",
        username: "bob",
        displayName: "Bob Learner",
        password: "correct-horse-battery-staple-bob",
      })
      .expect(201);
    bobId = bobAccept.body.user.id as string;
    aliceScope = scopeForOwnerId(aliceId);
    bobScope = scopeForOwnerId(bobId);

    // Provision Kits for Alice (Kit 1 & Kit 2) and Bob (Kit 3)
    const aliceDefaultKit = ensureDefaultSystemDesignKit(db, aliceScope);
    aliceKit1Id = aliceDefaultKit.id;

    aliceKit2Id = "kit-alice-ml";
    db.prepare(
      `INSERT INTO kits (id, ownerId, slug, name, description, status, skeleton_json)
       VALUES (?, ?, 'ml-systems', 'ML Systems', 'Alice ML Kit', 'ready', ?)`,
    ).run(aliceKit2Id, aliceId, JSON.stringify(aliceDefaultKit.skeleton));

    const bobDefaultKit = ensureDefaultSystemDesignKit(db, bobScope);
    bobKitId = bobDefaultKit.id;
  });

  afterAll(() => {
    __resetHostGuard();
  });

  it("1. indexes multi-kind chunks into sqlite-vec + FTS5, fuses RRF results, filters by kit_id/kind, and enforces zero cross-tenant leakage", async () => {
    await upsertRagChunk(db, aliceScope, {
      kitId: aliceKit1Id,
      kind: "guide",
      sourceRefId: "storage:consistent-hashing:internals",
      title: "Consistent Hashing Virtual Nodes",
      content:
        "Consistent hashing places storage nodes and virtual tokens on a hash ring to minimize key remapping when servers join or leave.",
    });

    await upsertRagChunk(db, aliceScope, {
      kitId: aliceKit1Id,
      kind: "flashcard",
      sourceRefId: "card-raft-term",
      nodeId: "consensus",
      title: "What prevents split-brain elections in Raft?",
      content:
        "Monotonically increasing election terms combined with strict majority quorum votes.",
    });

    await upsertRagChunk(db, aliceScope, {
      kitId: aliceKit2Id,
      kind: "source_chunk",
      sourceRefId: "src-flash-attention",
      title: "FlashAttention Tiling Paper",
      content:
        "IO-aware SRAM tiling avoids materializing the quadratic attention matrix in HBM.",
    });

    // Bob indexes a secret chunk containing the EXACT same keywords ("consistent hashing virtual nodes")
    await upsertRagChunk(db, bobScope, {
      kitId: bobKitId,
      kind: "guide",
      sourceRefId: "bob-secret-ref",
      title: "Consistent Hashing Virtual Nodes — BOB CONFIDENTIAL",
      content:
        "Consistent hashing places storage nodes and virtual tokens on a hash ring. BOB_TOP_SECRET_MARKER_999",
    });

    // Alice searches across all her kits for "consistent hashing ring"
    const aliceHits = await hybridSearch(
      db,
      aliceScope,
      "consistent hashing ring",
      { limit: 10 },
    );
    expect(aliceHits.length).toBeGreaterThanOrEqual(1);
    expect(aliceHits[0].sourceRefId).toBe(
      "storage:consistent-hashing:internals",
    );
    expect(aliceHits[0].channels).toContain("fts");
    expect(aliceHits[0].channels).toContain("vec");

    // ZERO hits from Bob may ever appear in Alice's results
    expect(
      aliceHits.some(
        (h) =>
          h.content.includes("BOB_TOP_SECRET_MARKER_999") ||
          h.sourceRefId === "bob-secret-ref",
      ),
    ).toBe(false);

    // Filter by kitId: querying Kit 2 only returns ML Systems chunks
    const kit2Only = await hybridSearch(
      db,
      aliceScope,
      "SRAM tiling attention matrix",
      { kitId: aliceKit2Id, limit: 10 },
    );
    expect(kit2Only.length).toBe(1);
    expect(kit2Only[0].kitId).toBe(aliceKit2Id);
    expect(kit2Only[0].kind).toBe("source_chunk");

    // Filter by kind: querying kinds=["flashcard"] excludes guide & source_chunk
    const flashcardsOnly = await hybridSearch(
      db,
      aliceScope,
      "quorum split brain raft",
      { kitId: aliceKit1Id, kinds: ["flashcard"], limit: 10 },
    );
    expect(flashcardsOnly.length).toBe(1);
    expect(flashcardsOnly[0].kind).toBe("flashcard");
    expect(flashcardsOnly[0].sourceRefId).toBe("card-raft-term");

    // HTTP /api/search route also enforces tenant isolation and returns hybrid chunks
    const bobHttpSearch = await bobAgent
      .get("/api/search")
      .query({ q: "consistent hashing" })
      .expect(200);
    expect(Array.isArray(bobHttpSearch.body.chunks)).toBe(true);
    expect(bobHttpSearch.body.chunks.length).toBe(1);
    expect(bobHttpSearch.body.chunks[0].sourceRefId).toBe("bob-secret-ref");
  });

  it("2. rebuilds rag_chunks_vec cleanly on dimension change (384 -> 768) while FTS5 BM25 serves uninterrupted", async () => {
    // Verify initial vec0 table is FLOAT[384]
    const initialSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rag_chunks_vec'",
      )
      .get() as { sql: string };
    expect(initialSql.sql).toContain("FLOAT[384]");

    // Switch instance embeddings config to 768 dimensions and run ensureEmbeddingStore(db, 768)
    setEmbeddingsConfig({
      provider: "local",
      modelId: "Xenova/all-MiniLM-L6-v2",
      dimension: 768,
      endpointId: null,
    });
    const rebuild = ensureEmbeddingStore(db, 768);
    expect(rebuild.recreated).toBe(true);
    expect(rebuild.dimension).toBe(768);

    // Verify rag_chunks_vec DDL is now FLOAT[768]
    const updatedSql = db
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rag_chunks_vec'",
      )
      .get() as { sql: string };
    expect(updatedSql.sql).toContain("FLOAT[768]");

    // Verify all rag_chunks.embedding_gen were reset to NULL
    const nonNullCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM rag_chunks WHERE ownerId = ? AND embedding_gen IS NOT NULL",
        )
        .get(aliceId) as { c: number }
    ).c;
    expect(nonNullCount).toBe(0);

    // Immediately query BEFORE re-embedding: FTS5 BM25 serves uninterrupted!
    const bm25Hits = await hybridSearch(
      db,
      aliceScope,
      "consistent hashing virtual",
      { kitId: aliceKit1Id },
    );
    expect(bm25Hits.length).toBeGreaterThanOrEqual(1);
    expect(bm25Hits[0].sourceRefId).toBe(
      "storage:consistent-hashing:internals",
    );
    expect(bm25Hits[0].channels).toEqual(["fts"]);

    // Now reindex missing embeddings at 768d and confirm both fts + vec channels fire
    const reindexed = await reindexMissingEmbeddings(db);
    expect(reindexed).toBeGreaterThanOrEqual(4);

    const fusedHits = await hybridSearch(
      db,
      aliceScope,
      "consistent hashing virtual",
      { kitId: aliceKit1Id },
    );
    expect(fusedHits[0].channels).toContain("fts");
    expect(fusedHits[0].channels).toContain("vec");

    // Restore standard 384d local embeddings for subsequent tests
    setEmbeddingsConfig({
      provider: "local",
      modelId: "Xenova/all-MiniLM-L6-v2",
      dimension: 384,
      endpointId: null,
    });
    ensureEmbeddingStore(db, 384);
    await reindexMissingEmbeddings(db);
  });

  it("3. seals per-user BYOK keys & endpoints, routes capabilities per user, and locks embeddings to Admin", async () => {
    // Seed an instance Gemini key via Admin AI settings
    await aliceAgent
      .put("/api/admin/ai-settings")
      .send({
        providerKeys: { gemini: "AIza-instance-default-key-1234" },
        capabilities: {
          quick: { mode: "auto", modelId: null },
          deep: { mode: "pinned", modelId: "gemini-3.1-pro" },
        },
      })
      .expect(200);

    // Stand up a mock OpenAI-compatible /v1/models endpoint for Bob's personal BYOK server
    const bobMockServer = await listenLocal((req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [{ id: "qwen3-coder-30b", created: 1_760_000_000 }],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    try {
      // Bob saves personal Claude + OpenAI BYOK keys and overrides quick & deep capabilities
      const bobUpdate = await bobAgent
        .put("/api/ai-settings")
        .send({
          providerKeys: {
            claude: "sk-ant-bob-personal-secret-9876",
            openai: "sk-proj-bob-personal-openai-5555",
          },
          capabilities: {
            quick: { mode: "pinned", modelId: "claude-haiku-4-5" },
            deep: { mode: "pinned", modelId: "gpt-5.6-sol" },
          },
          webSearchEngine: "combined",
        })
        .expect(200);

      expect(bobUpdate.body.providerKeysConfigured.claude).toBe(true);
      expect(bobUpdate.body.resolvedCapabilities.quick.resolvedModelId).toBe(
        "claude-haiku-4-5",
      );
      expect(bobUpdate.body.resolvedCapabilities.quick.source).toBe(
        "user_override",
      );

      // Bob adds a personal custom endpoint
      const bobEpRes = await bobAgent
        .post("/api/ai-settings/endpoints")
        .send({
          name: "Bob Homelab vLLM",
          baseUrl: `${bobMockServer.baseUrl}/v1`,
          apiKey: "bob-vllm-token-secret",
        })
        .expect(201);
      const bobEpId = bobEpRes.body.id as string;
      expect(bobEpId.startsWith("u_")).toBe(true);

      // Inspect raw SQLite row: ZERO plaintext secrets in user_ai_settings!
      const rawRow = db
        .prepare(
          "SELECT provider_keys_sealed, custom_endpoints_json FROM user_ai_settings WHERE ownerId = ?",
        )
        .get(bobId) as {
        provider_keys_sealed: string;
        custom_endpoints_json: string;
      };
      expect(rawRow.provider_keys_sealed).not.toContain(
        "sk-ant-bob-personal-secret-9876",
      );
      expect(rawRow.custom_endpoints_json).not.toContain(
        "bob-vllm-token-secret",
      );
      const parsedSealedKeys = JSON.parse(
        rawRow.provider_keys_sealed,
      ) as Record<string, string>;
      expect(parsedSealedKeys.claude.startsWith("v1:")).toBe(true);

      // Verify resolveModelDescriptor resolves Bob's BYOK credentials FIRST, while Alice uses instance defaults!
      const bobDeep = resolveModelDescriptor(undefined, {
        scope: bobScope,
        capability: "deep",
      });
      expect(bobDeep.kind).toBe("builtin");
      if (bobDeep.kind === "builtin") {
        expect(bobDeep.modelId).toBe("gpt-5.6-sol");
        expect(bobDeep.keySource).toBe("byok");
        expect(bobDeep.apiKey).toBe("sk-proj-bob-personal-openai-5555");
      }

      const aliceDeep = resolveModelDescriptor(undefined, {
        scope: aliceScope,
        capability: "deep",
      });
      expect(aliceDeep.modelId).toBe("gemini-3.1-pro");
      expect(aliceDeep.keySource).toBe("instance");

      // Bob can resolve his personal custom endpoint; Alice CANNOT resolve Bob's personal endpoint!
      const bobCustomModelId = `custom:${bobEpId}:qwen3-coder-30b`;
      const resolvedBobCustom = resolveModel(bobCustomModelId, {
        scope: bobScope,
      });
      expect(resolvedBobCustom.modelId).toBe(bobCustomModelId);
      expect(() =>
        resolveModel(bobCustomModelId, { scope: aliceScope }),
      ).toThrow(/Custom endpoint not found/);

      // Bob CANNOT override `embeddings` via `/api/ai-settings` or access `/api/admin/ai-settings`
      await bobAgent
        .put("/api/ai-settings")
        .send({
          embeddings: { provider: "openai", modelId: "text-embedding-3-large" },
        })
        .expect(403);

      await bobAgent
        .put("/api/ai-settings")
        .send({
          capabilities: {
            embeddings: { mode: "pinned", modelId: "text-embedding-3-large" },
          },
        })
        .expect(403);

      await bobAgent.get("/api/admin/ai-settings").expect(403);
    } finally {
      await bobMockServer.close();
    }
  });

  it("4. executes the 3-rung OpenAI-compatible structured-output fallback ladder, detects reasoning exhaustion, and blocks sycophantic interceptor passes", async () => {
    const wireFormatsSeen: Array<string | undefined> = [];
    const maxTokensSeen: number[] = [];
    let mode: "reject_schema_only" | "reject_both_formats" | "exhaust_once" | "exhaust_always" | "sycophantic_eval" =
      "reject_schema_only";

    const mockLlm = await listenLocal(async (req, res) => {
      if (req.url === "/v1/models") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            data: [
              { id: "ollama-rung2", created: 1_760_000_000 },
              { id: "lmstudio-rung3", created: 1_760_000_000 },
              { id: "deepseek-reasoner", created: 1_760_000_000 },
            ],
          }),
        );
        return;
      }

      if (req.url === "/v1/chat/completions" && req.method === "POST") {
        let raw = "";
        for await (const chunk of req) raw += chunk;
        const body = JSON.parse(raw) as {
          model?: string;
          max_tokens?: number;
          max_completion_tokens?: number;
          response_format?: { type?: string };
        };
        const rfType = body.response_format?.type;
        wireFormatsSeen.push(rfType);
        maxTokensSeen.push(
          body.max_completion_tokens ?? body.max_tokens ?? 0,
        );

        if (mode === "reject_schema_only" && rfType === "json_schema") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: { message: "response_format json_schema is not supported" },
            }),
          );
          return;
        }

        if (
          mode === "reject_both_formats" &&
          (rfType === "json_schema" || rfType === "json_object")
        ) {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: {
                message:
                  "'response_format.type' must be 'json_schema' or 'text'",
              },
            }),
          );
          return;
        }

        if (mode === "exhaust_once") {
          mode = "reject_schema_only"; // succeed on retry
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: "cmpl-exhaust-1",
              object: "chat.completion",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "" },
                  finish_reason: "length",
                },
              ],
              usage: {
                prompt_tokens: 12,
                completion_tokens: 512,
                total_tokens: 524,
              },
            }),
          );
          return;
        }

        if (mode === "exhaust_always") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              id: "cmpl-exhaust-always",
              object: "chat.completion",
              created: 1,
              model: body.model,
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "" },
                  finish_reason: "length",
                },
              ],
              usage: {
                prompt_tokens: 12,
                completion_tokens: 1024,
                total_tokens: 1036,
              },
            }),
          );
          return;
        }

        const content =
          mode === "sycophantic_eval"
            ? JSON.stringify({
                extractedClaims: ["TCP operates at Layer 7"],
                factualOrLogicalErrors: [
                  "TCP is a Layer 4 transport protocol, not Layer 7.",
                ],
                feedback: "Good effort, though TCP is Layer 4.",
                pass: true, // Sycophantic model tries to pass despite listing an error!
              })
            : mode === "reject_both_formats"
              ? '```json\n{"concept":"Write-Ahead Log","durability":true}\n```'
              : rfType === "json_object"
                ? '{"concept":"Consistent Hashing","durability":true}'
                : "Recovered answer after doubling reasoning budget.";

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            id: "cmpl-ok",
            object: "chat.completion",
            created: 1,
            model: body.model,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          }),
        );
        return;
      }

      res.writeHead(404).end();
    });

    try {
      // Register as an instance custom endpoint via /api/endpoints
      const epCreate = await aliceAgent
        .post("/api/endpoints")
        .send({
          name: "Local Test Engine",
          baseUrl: `${mockLlm.baseUrl}/v1`,
        })
        .expect(201);
      const epId = epCreate.body.id as string;

      const targetSchema = z.object({
        concept: z.string(),
        durability: z.boolean(),
      });

      // Case A: Rung 1 (json_schema -> 400) automatically downgrades to Rung 2 (json_object -> 200) and caches it!
      mode = "reject_schema_only";
      wireFormatsSeen.length = 0;
      const rung2Out = await runStructured<{
        concept: string;
        durability: boolean;
      }>({
        model: `custom:${epId}:ollama-rung2`,
        prompt: "Describe consistent hashing",
        schema: targetSchema,
      });
      expect(rung2Out).toEqual({
        concept: "Consistent Hashing",
        durability: true,
      });
      expect(wireFormatsSeen).toEqual(["json_schema", "json_object"]);
      expect(__getStructuredModeFor(`instance:${epId}`, "ollama-rung2")).toBe(
        "json_object",
      );

      // Second call to the same model skips Rung 1 immediately!
      wireFormatsSeen.length = 0;
      await runStructured({
        model: `custom:${epId}:ollama-rung2`,
        prompt: "Again",
        schema: targetSchema,
      });
      expect(wireFormatsSeen).toEqual(["json_object"]);

      // Case B: Rung 1 (400) -> Rung 2 (400) -> Rung 3 (plain prompt JSON with markdown fences -> 200)
      mode = "reject_both_formats";
      wireFormatsSeen.length = 0;
      const rung3Out = await runStructured<{
        concept: string;
        durability: boolean;
      }>({
        model: `custom:${epId}:lmstudio-rung3`,
        prompt: "Describe WAL",
        schema: targetSchema,
      });
      expect(rung3Out).toEqual({
        concept: "Write-Ahead Log",
        durability: true,
      });
      expect(wireFormatsSeen).toEqual(["json_schema", "json_object", undefined]);
      expect(
        __getStructuredModeFor(`instance:${epId}`, "lmstudio-rung3"),
      ).toBe("prompt");

      // Case C: Reasoning exhaustion retries with 2x maxOutputTokens, and throws AI_REASONING_EXHAUSTED if still empty
      mode = "exhaust_once";
      maxTokensSeen.length = 0;
      const recovered = await runText({
        model: `custom:${epId}:deepseek-reasoner`,
        prompt: "Prove FLP impossibility",
        maxOutputTokens: 512,
      });
      expect(recovered).toBe(
        "Recovered answer after doubling reasoning budget.",
      );
      expect(maxTokensSeen).toEqual([512, 1024]);

      mode = "exhaust_always";
      await expect(
        runText({
          model: `custom:${epId}:deepseek-reasoner`,
          prompt: "Loop forever in thoughts",
          maxOutputTokens: 512,
        }),
      ).rejects.toMatchObject({
        code: "AI_REASONING_EXHAUSTED",
      });

      // Case D: Anti-sycophancy falsification-first POST /api/chat/evaluate-interceptor
      __resetStructuredModeCache();
      mode = "sycophantic_eval";
      const evalRes = await aliceAgent
        .post("/api/chat/evaluate-interceptor")
        .send({
          front: "At which OSI layer does TCP operate?",
          back: "Layer 4 (Transport Layer).",
          explanation: "TCP operates at Layer 7 because HTTP uses it.",
          model: `custom:${epId}:ollama-rung2`,
        })
        .expect(200);

      expect(evalRes.body.factualOrLogicalErrors).toEqual([
        "TCP is a Layer 4 transport protocol, not Layer 7.",
      ]);
      // Even though the LLM emitted `pass: true`, non-empty `factualOrLogicalErrors` forces `pass: false`!
      expect(evalRes.body.pass).toBe(false);
    } finally {
      await mockLlm.close();
    }
  });

  it("5. enforces hostGuard DNS-rebinding protection, readBodyCapped/readBytesCapped limits, and SSRF protection on SearXNG result URLs", async () => {
    // 5a. hostGuard blocks forged Host headers while allowing localhost / 127.0.0.1 / PUBLIC_ORIGIN
    expect(isHostAllowed("localhost:3100")).toBe(true);
    expect(isHostAllowed("127.0.0.1:3100")).toBe(true);
    expect(isHostAllowed("[::1]:3100")).toBe(true);
    expect(isHostAllowed("attacker.example")).toBe(false);

    const blockedHostRes = await aliceAgent
      .get("/api/config")
      .set("Host", "attacker.example")
      .expect(403);
    expect(blockedHostRes.body.error?.code).toBe("HOST_NOT_ALLOWED");

    await aliceAgent
      .get("/api/config")
      .set("Host", "127.0.0.1:3100")
      .expect(200);
    await aliceAgent
      .get("/api/config")
      .set("Host", "localhost:3100")
      .expect(200);

    // 5b. isPrivateAddress covers 198.18.0.0/15, multicast/reserved >= 224/4, and IPv4-mapped/NAT64 IPv6
    expect(isPrivateAddress("198.18.0.1")).toBe(true);
    expect(isPrivateAddress("198.19.255.254")).toBe(true);
    expect(isPrivateAddress("198.20.0.1")).toBe(false);
    expect(isPrivateAddress("224.0.0.1")).toBe(true);
    expect(isPrivateAddress("240.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("64:ff9b::10.0.0.1")).toBe(true);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);

    // 5c. readBodyCapped & readBytesCapped enforce byte caps with RESPONSE_TOO_LARGE
    const oversizedChunkedResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024));
          controller.enqueue(new Uint8Array(1024));
          controller.close();
        },
      }),
    );
    await expect(
      readBytesCapped(oversizedChunkedResponse, { maxBytes: 1500 }),
    ).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });

    const oversizedTextResponse = new Response("x".repeat(4096), {
      headers: { "Content-Length": "4096" },
    });
    await expect(
      readBodyCapped(oversizedTextResponse, { maxBytes: 1024 }),
    ).rejects.toBeInstanceOf(AppError);

    // 5d. SSRF protection on SearXNG web research:
    // Local SearXNG instance IS allowed (`allowPrivate: true`), while private-IP result URLs
    // returned by SearXNG are strictly rejected (`allowPrivate: false`) and never fetched!
    let internalSecretHit = false;
    const internalAdminServer = await listenLocal((_req, res) => {
      internalSecretHit = true;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>INTERNAL_METADATA_SECRET_KEY</body></html>");
    });

    const searxServer = await listenLocal((req, res) => {
      const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
      if (parsed.pathname === "/search" && parsed.searchParams.get("format") === "json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            results: [
              {
                title: "SSRF Loopback Trap",
                url: `${internalAdminServer.baseUrl}/internal-secret`,
                content: "Attempt to trick Toolbox into reading loopback service",
              },
              {
                title: "Cloud Metadata Trap",
                url: "http://169.254.169.254/latest/meta-data/iam",
                content: "Attempt to read AWS IMDS",
              },
              {
                title: "Benchmark Net Trap",
                url: "http://198.18.10.20/admin",
                content: "Attempt to read 198.18.0.0/15",
              },
            ],
          }),
        );
        return;
      }
      res.writeHead(404).end();
    });

    try {
      // Admin Test SearXNG endpoint succeeds against localhost SearXNG
      const testSearxRes = await aliceAgent
        .post("/api/admin/ai-settings/test-searxng")
        .send({ searxngUrl: searxServer.baseUrl })
        .expect(200);
      expect(testSearxRes.body.ok).toBe(true);
      expect(testSearxRes.body.resultCount).toBe(3);

      // Running full web research queries SearXNG on localhost, then blocks ALL private result URLs!
      const research = await runWebResearch({
        scope: aliceScope,
        query: "distributed consensus",
        engine: "searxng",
        searxngUrlOverride: searxServer.baseUrl,
      });

      expect(internalSecretHit).toBe(false);
      expect(research.pages).toHaveLength(0);
      expect(research.citations).toHaveLength(0);
      expect(research.blockedUrls).toHaveLength(3);
      expect(research.summary).not.toContain("INTERNAL_METADATA_SECRET_KEY");

      // Grounding redirect helper check
      expect(
        isGroundingRedirectUrl(
          "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf",
        ),
      ).toBe(true);
      expect(isGroundingRedirectUrl("https://example.com/article")).toBe(false);
      const passthrough = await resolveRedirects(["https://example.com/docs"]);
      expect(passthrough.get("https://example.com/docs")).toBe(
        "https://example.com/docs",
      );
    } finally {
      await searxServer.close();
      await internalAdminServer.close();
    }
  });

  it("6. wires hybrid study tools (search_guide, search_flashcards, search_kit_sources, web_research gating) and clean chunk deletion", async () => {
    const aliceKit = ensureDefaultSystemDesignKit(db, aliceScope);

    // Without enableWebResearch, web_research tool is omitted
    const baseTools = buildStudyTools(aliceScope, aliceKit);
    expect(Object.keys(baseTools).sort()).toEqual([
      "search_flashcards",
      "search_guide",
      "search_kit_sources",
    ]);

    // With enableWebResearch: true, web_research is exposed
    const researchTools = buildStudyTools(aliceScope, aliceKit, {
      enableWebResearch: true,
    });
    expect(Object.keys(researchTools)).toContain("web_research");

    // Seed a Kit source + chunk in SQLite and execute search_kit_sources tool
    db.prepare(
      `INSERT INTO kit_sources (id, ownerId, kit_id, kind, title)
       VALUES ('src-dynamo', ?, ?, 'note', 'Amazon Dynamo Paper Notes')`,
    ).run(aliceId, aliceKit.id);
    db.prepare(
      `INSERT INTO kit_source_chunks (id, ownerId, kit_id, source_id, chunk_index, text)
       VALUES ('sc-dynamo-1', ?, ?, 'src-dynamo', 0, 'Sloppy quorums and hinted handoff preserve write availability during network partitions.')`,
    ).run(aliceId, aliceKit.id);

    const execSourceTool = researchTools.search_kit_sources.execute as unknown as (
      input: { query: string },
      options: { toolCallId: string; messages: never[] },
    ) => Promise<Array<{ title: string }>>;
    const sourceHits = await execSourceTool(
      { query: "sloppy quorums hinted handoff" },
      { toolCallId: "tc-1", messages: [] },
    );
    expect(Array.isArray(sourceHits)).toBe(true);
    expect(sourceHits[0].title).toBe("Amazon Dynamo Paper Notes");

    // Delete source chunk from RAG store and verify removal across rag_chunks, FTS5, and vec0
    db.prepare(
      "DELETE FROM kit_source_chunks WHERE ownerId = ? AND id = 'sc-dynamo-1'",
    ).run(aliceId);
    const deleted = deleteRagChunksBySource(
      db,
      aliceScope,
      aliceKit.id,
      "source_chunk",
      "sc-dynamo-1",
    );
    expect(deleted).toBe(1);

    const afterDelete = await hybridSearch(
      db,
      aliceScope,
      "sloppy quorums hinted handoff",
      { kitId: aliceKit.id, kinds: ["source_chunk"] },
    );
    expect(afterDelete).toHaveLength(0);
  });
});
