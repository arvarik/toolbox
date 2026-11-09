// @vitest-environment node
import http from "node:http";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Express } from "express";
import type { Scope } from "../platform/tenancy/scope.ts";
import { setupTwoTenants } from "./testHelpers.ts";

const { default: db } = await import("../db.ts");
const { createApp, __resetAppRateLimits } = await import("../app.ts");
const { __resetAuthRateLimits } = await import("../platform/routes/authRoutes.ts");
const { __resetHostGuard, isHostAllowed } = await import("../platform/net/hostGuard.ts");
const { isPrivateAddress, readBodyCapped, readBytesCapped } = await import(
  "../platform/net/originAndFetch.ts"
);
const { AppError } = await import("../platform/net/errors.ts");
const {
  resolveModel,
  runStructured,
  runText,
  __getStructuredModeFor,
  __resetStructuredModeCache,
} = await import("../ai/engine.ts");
const { updateAdminAiSettings, resolveModelDescriptor } = await import(
  "../platform/ai/aiSettingsService.ts"
);
const {
  deleteRagChunksBySource,
  ensureEmbeddingStore,
  hybridSearch,
  reindexMissingEmbeddings,
  upsertRagChunk,
} = await import("../search/hybridSearch.ts");
const { buildStudyTools } = await import("../routes/chat.ts");
const { runWebResearch } = await import("../platform/research/webResearch.ts");
const { isGroundingRedirectUrl, resolveRedirects } = await import(
  "../platform/research/citations.ts"
);
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
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

async function withEnv<T>(vars: Record<string, string>, fn: () => Promise<T> | T): Promise<T> {
  const prev = new Map<string, string | undefined>();
  for (const [k, v] of Object.entries(vars)) {
    prev.set(k, process.env[k]);
    process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of prev.entries()) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

describe("AI Capability Router, Per-User BYOK, Hybrid RAG (FTS5 + sqlite-vec), Structured Ladder & SSRF Research", () => {
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

    const tenants = await setupTwoTenants(app, "rag");
    aliceAgent = tenants.aliceAgent;
    bobAgent = tenants.bobAgent;
    aliceId = tenants.aliceId;
    bobId = tenants.bobId;
    aliceScope = tenants.aliceScope;
    bobScope = tenants.bobScope;

    const aliceDefaultKit = ensureDefaultSystemDesignKit(db, aliceScope);
    aliceKit1Id = aliceDefaultKit.id;

    aliceKit2Id = "kit-alice-ml";
    db.prepare(
      `INSERT INTO kits (id, ownerId, slug, name, description, status, skeleton_json)
       VALUES (?, ?, 'ml-systems', 'ML Systems', 'Alice ML Kit', 'ready', ?)`,
    ).run(aliceKit2Id, aliceId, JSON.stringify(aliceDefaultKit.skeleton));

    bobKitId = ensureDefaultSystemDesignKit(db, bobScope).id;
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
      content: "Monotonically increasing election terms combined with strict majority quorum votes.",
    });
    await upsertRagChunk(db, aliceScope, {
      kitId: aliceKit2Id,
      kind: "source_chunk",
      sourceRefId: "src-flash-attention",
      title: "FlashAttention Tiling Paper",
      content: "IO-aware SRAM tiling avoids materializing the quadratic attention matrix in HBM.",
    });
    await upsertRagChunk(db, bobScope, {
      kitId: bobKitId,
      kind: "guide",
      sourceRefId: "bob-secret-ref",
      title: "Consistent Hashing Virtual Nodes — BOB CONFIDENTIAL",
      content:
        "Consistent hashing places storage nodes and virtual tokens on a hash ring. BOB_TOP_SECRET_MARKER_999",
    });

    const aliceHits = await hybridSearch(db, aliceScope, "consistent hashing ring", { limit: 10 });
    expect(aliceHits.length).toBeGreaterThanOrEqual(1);
    expect(aliceHits[0].sourceRefId).toBe("storage:consistent-hashing:internals");
    expect(aliceHits[0].channels).toEqual(expect.arrayContaining(["fts", "vec"]));
    expect(
      aliceHits.some(
        (h) => h.content.includes("BOB_TOP_SECRET_MARKER_999") || h.sourceRefId === "bob-secret-ref",
      ),
    ).toBe(false);

    const kit2Only = await hybridSearch(db, aliceScope, "SRAM tiling attention matrix", {
      kitId: aliceKit2Id,
      limit: 10,
    });
    expect(kit2Only).toHaveLength(1);
    expect(kit2Only[0]).toMatchObject({ kitId: aliceKit2Id, kind: "source_chunk" });

    const flashcardsOnly = await hybridSearch(db, aliceScope, "quorum split brain raft", {
      kitId: aliceKit1Id,
      kinds: ["flashcard"],
      limit: 10,
    });
    expect(flashcardsOnly).toHaveLength(1);
    expect(flashcardsOnly[0]).toMatchObject({ kind: "flashcard", sourceRefId: "card-raft-term" });

    const bobHttpSearch = await bobAgent
      .get("/api/search")
      .query({ q: "consistent hashing" })
      .expect(200);
    expect(bobHttpSearch.body.chunks).toHaveLength(1);
    expect(bobHttpSearch.body.chunks[0].sourceRefId).toBe("bob-secret-ref");
  });

  it("2. rebuilds rag_chunks_vec cleanly on dimension change (384 -> 768) while FTS5 BM25 serves uninterrupted", async () => {
    const getVecDdl = () =>
      (
        db
          .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'rag_chunks_vec'")
          .get() as { sql: string }
      ).sql;

    expect(getVecDdl()).toContain("FLOAT[384]");

    updateAdminAiSettings({
      embeddings: {
        provider: "local",
        modelId: "Xenova/all-MiniLM-L6-v2",
        dimension: 768,
        endpointId: null,
      },
    });
    expect(ensureEmbeddingStore(db, 768)).toMatchObject({ recreated: true, dimension: 768 });
    expect(getVecDdl()).toContain("FLOAT[768]");

    const nonNullCount = (
      db
        .prepare("SELECT COUNT(*) AS c FROM rag_chunks WHERE ownerId = ? AND embedding_gen IS NOT NULL")
        .get(aliceId) as { c: number }
    ).c;
    expect(nonNullCount).toBe(0);

    const bm25Hits = await hybridSearch(db, aliceScope, "consistent hashing virtual", {
      kitId: aliceKit1Id,
    });
    expect(bm25Hits.length).toBeGreaterThanOrEqual(1);
    expect(bm25Hits[0]).toMatchObject({
      sourceRefId: "storage:consistent-hashing:internals",
      channels: ["fts"],
    });

    expect(await reindexMissingEmbeddings(db)).toBeGreaterThanOrEqual(4);
    const fusedHits = await hybridSearch(db, aliceScope, "consistent hashing virtual", {
      kitId: aliceKit1Id,
    });
    expect(fusedHits[0].channels).toEqual(expect.arrayContaining(["fts", "vec"]));

    updateAdminAiSettings({
      embeddings: {
        provider: "local",
        modelId: "Xenova/all-MiniLM-L6-v2",
        dimension: 384,
        endpointId: null,
      },
    });
    ensureEmbeddingStore(db, 384);
    await reindexMissingEmbeddings(db);
  });

  it("3. seals per-user BYOK keys & endpoints, routes capabilities per user, and locks embeddings to Admin", async () => {
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

    const bobMockServer = await listenLocal((req, res) => {
      if (req.url === "/v1/models") {
        sendJson(res, 200, { data: [{ id: "qwen3-coder-30b", created: 1_760_000_000 }] });
        return;
      }
      res.writeHead(404).end();
    });

    try {
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
      expect(bobUpdate.body.resolvedCapabilities.quick).toMatchObject({
        resolvedModelId: "claude-haiku-4-5",
        source: "user_override",
      });

      const bobEpId = await withEnv({ ALLOW_PRIVATE_BYOK_ENDPOINTS: "true" }, async () => {
        const res = await bobAgent
          .post("/api/ai-settings/endpoints")
          .send({
            name: "Bob Homelab vLLM",
            baseUrl: `${bobMockServer.baseUrl}/v1`,
            apiKey: "bob-vllm-token-secret",
          })
          .expect(201);
        return res.body.id as string;
      });
      expect(bobEpId.startsWith("u_")).toBe(true);

      const rawRow = db
        .prepare("SELECT provider_keys_sealed, custom_endpoints_json FROM user_ai_settings WHERE ownerId = ?")
        .get(bobId) as { provider_keys_sealed: string; custom_endpoints_json: string };
      expect(rawRow.provider_keys_sealed).not.toContain("sk-ant-bob-personal-secret-9876");
      expect(rawRow.custom_endpoints_json).not.toContain("bob-vllm-token-secret");
      expect(
        (JSON.parse(rawRow.provider_keys_sealed) as Record<string, string>).claude.startsWith("v1:"),
      ).toBe(true);

      const bobDeep = resolveModelDescriptor(undefined, { scope: bobScope, capability: "deep" });
      expect(bobDeep).toMatchObject({
        kind: "builtin",
        modelId: "gpt-5.6-sol",
        keySource: "byok",
        apiKey: "sk-proj-bob-personal-openai-5555",
      });
      expect(resolveModelDescriptor(undefined, { scope: aliceScope, capability: "deep" })).toMatchObject(
        { modelId: "gemini-3.1-pro", keySource: "instance" },
      );

      const bobCustomModelId = `custom:${bobEpId}:qwen3-coder-30b`;
      expect(resolveModel(bobCustomModelId, { scope: bobScope }).modelId).toBe(bobCustomModelId);
      expect(() => resolveModel(bobCustomModelId, { scope: aliceScope })).toThrow(
        /Custom endpoint not found/,
      );

      await bobAgent
        .put("/api/ai-settings")
        .send({ embeddings: { provider: "openai", modelId: "text-embedding-3-large" } })
        .expect(403);
      await bobAgent
        .put("/api/ai-settings")
        .send({ capabilities: { embeddings: { mode: "pinned", modelId: "text-embedding-3-large" } } })
        .expect(403);
      await bobAgent.get("/api/admin/ai-settings").expect(403);
    } finally {
      await bobMockServer.close();
    }
  });

  it("4. executes the 3-rung OpenAI-compatible structured-output fallback ladder, detects reasoning exhaustion, and blocks sycophantic interceptor passes", async () => {
    const wireFormatsSeen: Array<string | undefined> = [];
    const maxTokensSeen: number[] = [];
    let mode:
      | "reject_schema_only"
      | "reject_both_formats"
      | "exhaust_once"
      | "exhaust_always"
      | "sycophantic_eval" = "reject_schema_only";

    const cmpl = (model: string | undefined, content: string, finish_reason: "stop" | "length") => ({
      id: "cmpl-test",
      object: "chat.completion",
      created: 1,
      model,
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    });

    const mockLlm = await listenLocal(async (req, res) => {
      if (req.url === "/v1/models") {
        sendJson(res, 200, {
          data: ["ollama-rung2", "lmstudio-rung3", "deepseek-reasoner"].map((id) => ({
            id,
            created: 1_760_000_000,
          })),
        });
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
        maxTokensSeen.push(body.max_completion_tokens ?? body.max_tokens ?? 0);

        if (mode === "reject_schema_only" && rfType === "json_schema") {
          sendJson(res, 400, { error: { message: "response_format json_schema is not supported" } });
          return;
        }
        if (mode === "reject_both_formats" && (rfType === "json_schema" || rfType === "json_object")) {
          sendJson(res, 400, {
            error: { message: "'response_format.type' must be 'json_schema' or 'text'" },
          });
          return;
        }
        if (mode === "exhaust_once") {
          mode = "reject_schema_only";
          sendJson(res, 200, cmpl(body.model, "", "length"));
          return;
        }
        if (mode === "exhaust_always") {
          sendJson(res, 200, cmpl(body.model, "", "length"));
          return;
        }

        const content =
          mode === "sycophantic_eval"
            ? JSON.stringify({
                extractedClaims: ["TCP operates at Layer 7"],
                factualOrLogicalErrors: ["TCP is a Layer 4 transport protocol, not Layer 7."],
                feedback: "Good effort, though TCP is Layer 4.",
                pass: true,
              })
            : mode === "reject_both_formats"
              ? '```json\n{"concept":"Write-Ahead Log","durability":true}\n```'
              : rfType === "json_object"
                ? '{"concept":"Consistent Hashing","durability":true}'
                : "Recovered answer after doubling reasoning budget.";
        sendJson(res, 200, cmpl(body.model, content, "stop"));
        return;
      }
      res.writeHead(404).end();
    });

    try {
      const epId = (
        await aliceAgent
          .post("/api/endpoints")
          .send({ name: "Local Test Engine", baseUrl: `${mockLlm.baseUrl}/v1` })
          .expect(201)
      ).body.id as string;

      const targetSchema = z.object({ concept: z.string(), durability: z.boolean() });

      mode = "reject_schema_only";
      wireFormatsSeen.length = 0;
      expect(
        await runStructured({
          model: `custom:${epId}:ollama-rung2`,
          prompt: "Describe consistent hashing",
          schema: targetSchema,
        }),
      ).toEqual({ concept: "Consistent Hashing", durability: true });
      expect(wireFormatsSeen).toEqual(["json_schema", "json_object"]);
      expect(__getStructuredModeFor(`instance:${epId}`, "ollama-rung2")).toBe("json_object");

      wireFormatsSeen.length = 0;
      await runStructured({ model: `custom:${epId}:ollama-rung2`, prompt: "Again", schema: targetSchema });
      expect(wireFormatsSeen).toEqual(["json_object"]);

      mode = "reject_both_formats";
      wireFormatsSeen.length = 0;
      expect(
        await runStructured({
          model: `custom:${epId}:lmstudio-rung3`,
          prompt: "Describe WAL",
          schema: targetSchema,
        }),
      ).toEqual({ concept: "Write-Ahead Log", durability: true });
      expect(wireFormatsSeen).toEqual(["json_schema", "json_object", undefined]);
      expect(__getStructuredModeFor(`instance:${epId}`, "lmstudio-rung3")).toBe("prompt");

      mode = "exhaust_once";
      maxTokensSeen.length = 0;
      expect(
        await runText({
          model: `custom:${epId}:deepseek-reasoner`,
          prompt: "Prove FLP impossibility",
          maxOutputTokens: 512,
        }),
      ).toBe("Recovered answer after doubling reasoning budget.");
      expect(maxTokensSeen).toEqual([512, 1024]);

      mode = "exhaust_always";
      await expect(
        runText({
          model: `custom:${epId}:deepseek-reasoner`,
          prompt: "Loop forever in thoughts",
          maxOutputTokens: 512,
        }),
      ).rejects.toMatchObject({ code: "AI_REASONING_EXHAUSTED" });

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
      expect(evalRes.body.pass).toBe(false);
    } finally {
      await mockLlm.close();
    }
  });

  it("5. enforces hostGuard DNS-rebinding protection, readBodyCapped/readBytesCapped limits, and SSRF protection on SearXNG result URLs", async () => {
    expect(isHostAllowed("localhost:3100")).toBe(true);
    expect(isHostAllowed("127.0.0.1:3100")).toBe(true);
    expect(isHostAllowed("[::1]:3100")).toBe(true);
    expect(isHostAllowed("attacker.example")).toBe(false);

    const blockedHostRes = await aliceAgent
      .get("/api/config")
      .set("Host", "attacker.example")
      .expect(403);
    expect(blockedHostRes.body.error?.code).toBe("HOST_NOT_ALLOWED");
    await aliceAgent.get("/api/config").set("Host", "127.0.0.1:3100").expect(200);
    await aliceAgent.get("/api/config").set("Host", "localhost:3100").expect(200);

    for (const priv of [
      "198.18.0.1",
      "198.19.255.254",
      "224.0.0.1",
      "240.0.0.1",
      "::ffff:127.0.0.1",
      "64:ff9b::10.0.0.1",
    ]) {
      expect(isPrivateAddress(priv)).toBe(true);
    }
    expect(isPrivateAddress("198.20.0.1")).toBe(false);
    expect(isPrivateAddress("93.184.216.34")).toBe(false);

    const oversizedChunkedResponse = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(1024));
          controller.enqueue(new Uint8Array(1024));
          controller.close();
        },
      }),
    );
    await expect(readBytesCapped(oversizedChunkedResponse, { maxBytes: 1500 })).rejects.toMatchObject({
      code: "RESPONSE_TOO_LARGE",
    });
    await expect(
      readBodyCapped(new Response("x".repeat(4096), { headers: { "Content-Length": "4096" } }), {
        maxBytes: 1024,
      }),
    ).rejects.toBeInstanceOf(AppError);

    let internalSecretHit = false;
    const internalAdminServer = await listenLocal((_req, res) => {
      internalSecretHit = true;
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>INTERNAL_METADATA_SECRET_KEY</body></html>");
    });

    const searxServer = await listenLocal((req, res) => {
      const parsed = new URL(req.url ?? "/", "http://127.0.0.1");
      if (parsed.pathname === "/search" && parsed.searchParams.get("format") === "json") {
        sendJson(res, 200, {
          results: [
            { title: "SSRF Loopback Trap", url: `${internalAdminServer.baseUrl}/internal-secret`, content: "Loopback" },
            { title: "Cloud Metadata Trap", url: "http://169.254.169.254/latest/meta-data/iam", content: "AWS IMDS" },
            { title: "Benchmark Net Trap", url: "http://198.18.10.20/admin", content: "198.18.0.0/15" },
          ],
        });
        return;
      }
      res.writeHead(404).end();
    });

    try {
      const testSearxRes = await aliceAgent
        .post("/api/admin/ai-settings/test-searxng")
        .send({ searxngUrl: searxServer.baseUrl })
        .expect(200);
      expect(testSearxRes.body).toMatchObject({ ok: true, resultCount: 3 });

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

      expect(
        isGroundingRedirectUrl("https://vertexaisearch.cloud.google.com/grounding-api-redirect/AbCdEf"),
      ).toBe(true);
      expect(isGroundingRedirectUrl("https://example.com/article")).toBe(false);
      expect((await resolveRedirects(["https://example.com/docs"])).get("https://example.com/docs")).toBe(
        "https://example.com/docs",
      );
    } finally {
      await searxServer.close();
      await internalAdminServer.close();
    }
  });

  it("6. wires hybrid study tools (search_guide, search_flashcards, search_kit_sources, web_research gating) and clean chunk deletion", async () => {
    const aliceKit = ensureDefaultSystemDesignKit(db, aliceScope);
    expect(Object.keys(buildStudyTools(aliceScope, aliceKit)).sort()).toEqual([
      "search_flashcards",
      "search_guide",
      "search_kit_sources",
    ]);

    const researchTools = buildStudyTools(aliceScope, aliceKit, { enableWebResearch: true });
    expect(Object.keys(researchTools)).toContain("web_research");

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
    expect(sourceHits[0]?.title).toBe("Amazon Dynamo Paper Notes");

    db.prepare("DELETE FROM kit_source_chunks WHERE ownerId = ? AND id = 'sc-dynamo-1'").run(aliceId);
    expect(deleteRagChunksBySource(db, aliceScope, aliceKit.id, "source_chunk", "sc-dynamo-1")).toBe(1);
    expect(
      await hybridSearch(db, aliceScope, "sloppy quorums hinted handoff", {
        kitId: aliceKit.id,
        kinds: ["source_chunk"],
      }),
    ).toHaveLength(0);
  });

  it("7. eliminates RAG ghosting on card/deck/guide/Kit CRUD, scopes /api/search by Kit slug, persists chat persona, and returns JSON 404 on unknown production /api routes", async () => {
    const countRagEverywhere = (chunkId: string) =>
      ["rag_chunks", "rag_chunks_fts", "rag_chunks_vec"].reduce(
        (sum, table) =>
          sum +
          (db.prepare(`SELECT COUNT(*) AS c FROM ${table} WHERE chunk_id = ?`).get(chunkId) as { c: number })
            .c,
        0,
      );

    const deckId = (
      await aliceAgent
        .post("/api/decks")
        .set("X-Toolbox-Kit", "ml-systems")
        .send({ name: "RAG Lifecycle Deck" })
        .expect(201)
    ).body.id as string;

    const cardId = (
      await aliceAgent
        .post(`/api/decks/${deckId}/cards`)
        .set("X-Toolbox-Kit", "ml-systems")
        .send({
          front: "ZeRO Stage 3 Optimizer Partitioning",
          back: "Shards parameters, gradients, and optimizer states across data-parallel ranks.",
        })
        .expect(201)
    ).body.id as string;
    const cardChunkId = `${aliceId}:${aliceKit2Id}:flashcard:${cardId}`;
    expect(countRagEverywhere(cardChunkId)).toBe(3);

    const scopedHit = await aliceAgent
      .get("/api/search")
      .query({ q: "ZeRO Stage 3 Optimizer", kitId: "ml-systems" })
      .expect(200);
    expect(scopedHit.body.flashcards.some((c: { id: string }) => c.id === cardId)).toBe(true);
    expect(scopedHit.body.chunks.some((c: { sourceRefId: string }) => c.sourceRefId === cardId)).toBe(
      true,
    );

    const otherKitMiss = await aliceAgent
      .get("/api/search")
      .query({ q: "ZeRO Stage 3 Optimizer", kitId: "system-design" })
      .expect(200);
    expect(otherKitMiss.body.flashcards).toHaveLength(0);
    expect(otherKitMiss.body.chunks.some((c: { sourceRefId: string }) => c.sourceRefId === cardId)).toBe(
      false,
    );

    await aliceAgent
      .put(`/api/decks/${deckId}/cards/${cardId}`)
      .send({
        front: "Ring AllReduce Bandwidth Optimal",
        back: "Communicates 2(N-1)/N tensor volume independent of worker count.",
      })
      .expect(200);
    expect(
      (
        await hybridSearch(db, aliceScope, "ZeRO Stage Partitioning", {
          kitId: aliceKit2Id,
          skipVec: true,
        })
      ).some((h) => h.sourceRefId === cardId),
    ).toBe(false);
    const updatedHits = await hybridSearch(db, aliceScope, "Ring AllReduce Bandwidth", {
      kitId: aliceKit2Id,
    });
    expect(updatedHits[0]).toMatchObject({
      sourceRefId: cardId,
      title: "Ring AllReduce Bandwidth Optimal",
    });

    await aliceAgent.delete(`/api/decks/${deckId}/cards/${cardId}`).expect(204);
    expect(countRagEverywhere(cardChunkId)).toBe(0);

    const card2Id = (
      await aliceAgent
        .post(`/api/decks/${deckId}/cards`)
        .set("X-Toolbox-Kit", "ml-systems")
        .send({ front: "Pipeline Bubble Fraction", back: "(p - 1) / m" })
        .expect(201)
    ).body.id as string;
    const card2ChunkId = `${aliceId}:${aliceKit2Id}:flashcard:${card2Id}`;
    expect(countRagEverywhere(card2ChunkId)).toBe(3);

    await aliceAgent.delete(`/api/decks/${deckId}`).expect(204);
    expect(countRagEverywhere(card2ChunkId)).toBe(0);

    const skelRow = db
      .prepare("SELECT skeleton_json FROM kits WHERE ownerId = ? LIMIT 1")
      .get(aliceId) as { skeleton_json: string };
    const firstPillar = (
      JSON.parse(skelRow.skeleton_json) as {
        pillars: Array<{ id: string; topics: Array<{ id: string }>; sections: Array<{ id: string }> }>;
      }
    ).pillars[0];
    const slotPath = `/api/guide-content/${firstPillar.id}/${firstPillar.topics[0].id}/${firstPillar.sections[0].id}`;
    const guideChunkId = `${aliceId}:${aliceKit2Id}:guide:${firstPillar.id}:${firstPillar.topics[0].id}:${firstPillar.sections[0].id}`;

    await aliceAgent
      .put(slotPath)
      .set("X-Toolbox-Kit", "ml-systems")
      .send({ content: "Speculative decoding draft verification acceptance rate." })
      .expect(200);
    expect(countRagEverywhere(guideChunkId)).toBe(3);

    await aliceAgent.put(slotPath).set("X-Toolbox-Kit", "ml-systems").send({ content: "" }).expect(200);
    expect(countRagEverywhere(guideChunkId)).toBe(0);

    await upsertRagChunk(db, aliceScope, {
      kitId: aliceKit2Id,
      kind: "guide",
      sourceRefId: "temp-ml-note",
      title: "Temporary ML Note",
      content: "Ephemeral tensor parallelism note.",
    });
    await aliceAgent.delete(`/api/kits/${aliceKit2Id}`).expect(200);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS c FROM rag_chunks_vec WHERE ownerId = ? AND kit_id = ?")
          .get(aliceId, aliceKit2Id) as { c: number }
      ).c,
    ).toBe(0);

    await aliceAgent
      .post("/api/chat/sessions")
      .send({
        session: {
          id: "persona-session-1",
          name: "Strict Review",
          persona: "gordon",
          messages: [{ role: "user", content: "Critique my shard key." }],
        },
      })
      .expect(200);
    expect((await aliceAgent.get("/api/chat/sessions").expect(200)).body["persona-session-1"]?.persona).toBe(
      "gordon",
    );

    await withEnv({ NODE_ENV: "production" }, async () => {
      const prodApp = createApp();
      for (const m of ["get", "post"] as const) {
        const miss = await request(prodApp)[m]("/api/nonexistent-endpoint").expect(404);
        expect(miss.headers["content-type"]).toMatch(/json/);
        expect(miss.body.error?.code).toBe("ROUTE_NOT_FOUND");
      }
      expect([200, 404]).toContain((await request(prodApp).get("/api-typo")).status);
    });

    const { isBackgroundJobsDisabled } = await import("../appConfig.ts");
    const { shouldUseMockEmbedder } = await import("../platform/workers/cpuHost.ts");
    await withEnv({ NODE_ENV: "production", DISABLE_BACKGROUND_JOBS: "true" }, () => {
      expect(isBackgroundJobsDisabled()).toBe(true);
      expect(shouldUseMockEmbedder()).toBe(true);
    });
  });

  it("8. meters every billable AI route through one per-user cost budget without starving other users", async () => {
    __resetAppRateLimits();
    for (let i = 0; i < 30; i++) await bobAgent.post("/api/chat").send({}).expect(400);
    const billable: Array<["get" | "post", string]> = [
      ["post", "/api/chat"],
      ["post", "/api/chat/stream"],
      ["post", "/api/chat/generate-flashcards"],
      ["post", "/api/chat/generate-reverse-cards"],
      ["post", "/api/chat/summarize"],
      ["post", "/api/chat/evaluate-interceptor"],
      ["post", "/api/chat/concept-map"],
      ["post", "/api/chat/commit"],
      ["post", "/api/feynman/evaluate"],
      ["post", "/api/compiler/calibrate"],
      ["post", "/api/compiler/compile"],
      ["post", "/api/compiler/refine"],
      ["post", "/api/compiler/commit"],
      ["post", `/api/compiler/kits/${bobKitId}/expand`],
      ["post", "/api/drills/generate"],
      ["post", "/api/drills/challenge/node-1"],
      ["post", "/api/drills/drill-1/submit"],
      ["post", "/api/boards/board-1/critique"],
      ["post", "/api/calculator/audit"],
    ];
    for (const [method, route] of billable) {
      const res = await bobAgent[method](route).send({});
      expect(res.status, `${method.toUpperCase()} ${route}`).toBe(429);
      expect(res.body.error?.code).toBe("RATE_LIMITED");
    }
    await bobAgent.post("/api/chat/commit/save").send({}).expect((res) => expect(res.status).not.toBe(429));
    await bobAgent.get("/api/chat/starters?pillarId=p&topicId=t").expect((res) => expect(res.status).not.toBe(429));
    await aliceAgent.post("/api/chat").send({}).expect(400);
    __resetAppRateLimits();
  });

  it("9. seals and masks the instance endpoint key, streams tutor replies as SSE frames, and aborts the billable upstream generation when the learner disconnects", async () => {
    const systemPrompts: string[] = [];
    const upstreamAuth: Array<string | undefined> = [];
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((resolve) => (upstreamClosed = resolve));
    const llm = await listenLocal(async (req, res) => {
      if (req.url === "/v1/models") return sendJson(res, 200, { data: [{ id: "slow-tutor", created: 1_760_000_000 }] });
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw) as { model: string; messages: Array<{ role: string; content: string }> };
      upstreamAuth.push(req.headers.authorization);
      systemPrompts.push(body.messages.find((m) => m.role === "system")?.content ?? "");
      const frame = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: "c1", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(frame({ role: "assistant", content: "Quorums overlap. " }));
      if (body.messages.at(-1)?.content === "finish the answer") {
        res.write(frame({ content: "So reads see the latest write." }));
        res.end(`${frame({}, "stop")}data: [DONE]\n\n`);
        return;
      }
      res.on("close", () => upstreamClosed());
    });
    const server = app.listen(0, "127.0.0.1");
    try {
      const apiKey = "sk-instance-tutor-secret-4242";
      const created = (await aliceAgent.post("/api/endpoints").send({ name: "Slow Tutor", baseUrl: `${llm.baseUrl}/v1`, apiKey }).expect(201)).body;
      const epId = created.id as string;
      const model = `custom:${epId}:slow-tutor`;
      const sealedKey = () => (db.prepare("SELECT api_key FROM custom_endpoints WHERE id = ?").get(epId) as { api_key: string }).api_key;
      expect(sealedKey()).toMatch(/^v1:/);
      expect(sealedKey()).not.toContain(apiKey);
      const adminView = (await aliceAgent.get("/api/endpoints").expect(200)).body.find((e: { id: string }) => e.id === epId);
      expect(adminView).toMatchObject({ apiKeyMasked: "••••4242", hasApiKey: true });
      const memberView = JSON.stringify((await bobAgent.get("/api/endpoints").expect(200)).body);
      expect(memberView).toContain('"apiKeyMasked":"••••"');
      expect(memberView).not.toContain("4242");
      // Re-saving the admin form with the masked value keeps the real key
      await aliceAgent.put(`/api/endpoints/${epId}`).send({ name: "Slow Tutor", baseUrl: `${llm.baseUrl}/v1`, apiKey: adminView.apiKeyMasked }).expect(200);
      await withEnv({ DISABLE_BACKGROUND_JOBS: "true" }, async () => {
        __resetAppRateLimits();
        const full = await aliceAgent
          .post("/api/chat/stream")
          .send({ message: "finish the answer", persona: "strict", model })
          .expect(200);
        expect(full.headers["content-type"]).toMatch(/^text\/event-stream/);
        expect(full.text).toBe(
          'data: {"text":"Quorums overlap. "}\n\ndata: {"text":"So reads see the latest write."}\n\ndata: [DONE]\n\n',
        );
        expect(systemPrompts[0]).toContain('Active Study Kit: "System Design"');
        expect(systemPrompts[0]).toContain("Tutor Persona Directive:");
        expect(upstreamAuth[0]).toBe(`Bearer ${apiKey}`);

        const token = (await aliceAgent.post("/api/auth/tokens").send({ name: "stream-client" }).expect(201)).body.token as string;
        const { port } = server.address() as { port: number };
        const req = http.request({
          host: "127.0.0.1",
          port,
          method: "POST",
          path: "/api/chat/stream",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        });
        req.end(JSON.stringify({ message: "keep talking", model }));
        const res = await new Promise<http.IncomingMessage>((resolve) => req.on("response", resolve));
        const firstFrame = await new Promise<string>((resolve) => res.once("data", (c: Buffer) => resolve(c.toString())));
        expect(firstFrame).toContain("Quorums overlap.");
        req.destroy();
        await closed;
      });
    } finally {
      server.closeAllConnections();
      server.close();
      await llm.close();
      __resetAppRateLimits();
    }
  });
});
