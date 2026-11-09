// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import type Database from "better-sqlite3";
import express, { type Express } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import { BACKUPS_DIR } from "../appConfig.ts";
import { createApp } from "../app.ts";
import {
  ORPHANED_JOB_RESTART_ERROR,
  recoverOrphanedRunningJobs,
} from "../compiler/seedHydrator.ts";
import { recoverOrphanedRunningJobs as recoverFromLivingExpand } from "../compiler/livingExpand.ts";
import db from "../db.ts";
import {
  createHttpServer,
  HEADERS_TIMEOUT_MS,
  isLoopbackHost,
  KEEP_ALIVE_TIMEOUT_MS,
  shutdownServer,
} from "../index.ts";
import { listOwnedKits } from "../kits/kitService.ts";
import { initKitsSchema, kitTokFor, ownerTokFor } from "../kits/kitsSchema.ts";
import {
  listBackups,
  runBackup,
  runScheduledBackup,
  startBackupScheduler,
} from "../platform/auth/adminAndBackup.ts";
import { openDatabase, sqlite } from "../platform/db/connection.ts";
import { initPlatformSchema } from "../platform/db/platformSchema.ts";
import { gzipCompression } from "../platform/net/compression.ts";
import { __resetHostGuard } from "../platform/net/hostGuard.ts";
import { createRateLimiter, MAX_BUCKETS } from "../platform/net/rateLimit.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import { scopeForOwnerId, type Scope } from "../platform/tenancy/scope.ts";
import {
  ensureEmbeddingStore,
  hybridSearch,
  kindTokFor,
} from "../search/hybridSearch.ts";
import { deterministicHashEmbed } from "../platform/workers/cpuHost.ts";

function buildScaleSkeleton(idx: number): KitSkeletonV1 {
  const slug = `perf-kit-${idx}`;
  const nodes = Array.from({ length: 6 }, (_, n) => ({
    id: `k${idx}-n${n}`,
    name: `Kit ${idx} Concept ${n}`,
    pillarId: n < 3 ? `k${idx}-p1` : `k${idx}-p2`,
    topicId: n < 3 ? `k${idx}-t1` : `k${idx}-t2`,
    summary: `Concept ${n} in performance kit ${idx}.`,
    keywords: [`kit${idx}`, `concept${n}`],
    components: [],
  }));
  const edges = Array.from({ length: 5 }, (_, e) => ({
    from: `k${idx}-n${e}`,
    to: `k${idx}-n${e + 1}`,
  }));

  return {
    format: "toolbox-kit",
    schemaVersion: 1,
    exportedAt: "2026-09-01T00:00:00.000Z",
    identity: {
      slug,
      name: `Performance Kit ${idx}`,
      description: `Bulk scale benchmark kit #${idx}`,
      icon: "⚡",
      color: "#0891b2",
      version: 1,
      tags: ["perf", `kit-${idx}`],
    },
    capabilities: {
      canvas: "concept",
      calculator: false,
      webResearchDefault: false,
      enableSvgDiagrams: false,
    },
    tutor: {
      rolePrompt: "You are a rigorous distributed systems tutor.",
      personas: {
        socratic: { label: "Socratic", prompt: "Ask probing questions." },
        eli5: { label: "ELI5", prompt: "Explain with intuition." },
        strict: { label: "Strict", prompt: "Demand precision." },
        devil: { label: "Devil's Advocate", prompt: "Challenge assumptions." },
      },
      starterPrompts: [],
      cardExamples: [],
    },
    pillars: [
      {
        id: `k${idx}-p1`,
        number: 1,
        name: "Foundations",
        shortName: "Foundations",
        color: "#0891b2",
        sections: [
          {
            id: "core",
            name: "Core Model",
            icon: "book-open",
            promptHint: "Core principles",
            ownershipRule: "Core concepts",
          },
          {
            id: "tradeoffs",
            name: "Tradeoffs",
            icon: "scale",
            promptHint: "Key tradeoffs",
            ownershipRule: "Tradeoff analysis",
          },
        ],
        topics: [{ id: `k${idx}-t1`, name: "Foundational Primitives" }],
      },
      {
        id: `k${idx}-p2`,
        number: 2,
        name: "Advanced Systems",
        shortName: "Systems",
        color: "#7c3aed",
        sections: [
          {
            id: "core",
            name: "Core Model",
            icon: "book-open",
            promptHint: "Core principles",
            ownershipRule: "Core concepts",
          },
          {
            id: "tradeoffs",
            name: "Tradeoffs",
            icon: "scale",
            promptHint: "Key tradeoffs",
            ownershipRule: "Tradeoff analysis",
          },
        ],
        topics: [{ id: `k${idx}-t2`, name: "Distributed Coordination" }],
      },
    ],
    graph: {
      nodes,
      edges,
      tracks: [
        {
          id: `k${idx}-track`,
          name: "Core Track",
          emoji: "🚀",
          description: "End-to-end track",
          targets: [`k${idx}-n5`],
        },
      ],
    },
    bibliography: [],
    seeds: {
      drills: [],
      baselineGuideNotes: [],
    },
  };
}

function rawHttpGet(
  port: number,
  path: string,
  headers: Record<string, string>,
): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
  chunkCount: number;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method: "GET",
        headers,
      },
      (res) => {
        const parts: Buffer[] = [];
        let chunkCount = 0;
        res.on("data", (chunk: Buffer) => {
          chunkCount += 1;
          parts.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(parts),
            chunkCount,
          });
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

async function withEnv<T>(name: string, value: string, fn: () => Promise<T>): Promise<T> {
  const previous = process.env[name];
  process.env[name] = value;
  try {
    return await fn();
  } finally {
    if (previous === undefined) delete process.env[name];
    else process.env[name] = previous;
  }
}

/** One SHA-256 per ordinary table (FTS5 and vec0 shadow tables included), order-independent. */
function tableDigests(handle: Database.Database): Record<string, string> {
  const tables = handle
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND sql NOT LIKE 'CREATE VIRTUAL TABLE%'",
    )
    .pluck()
    .all() as string[];
  return Object.fromEntries(
    tables.map((name) => {
      const rows = handle
        .prepare(`SELECT * FROM "${name}"`)
        .raw()
        .all()
        .map((row) => JSON.stringify(row))
        .sort();
      return [name, crypto.createHash("sha256").update(rows.join("\n")).digest("hex")];
    }),
  );
}

describe("Performance, Concurrency & Graceful Shutdown Suite", () => {
  let app: Express;
  let agent: ReturnType<typeof request.agent>;
  let ownerId = "";
  let scope: Scope;

  beforeAll(async () => {
    __resetAuthRateLimits();
    __resetHostGuard();
    app = createApp();

    agent = request.agent(app);
    const setupRes = await agent
      .post("/api/auth/setup")
      .send({
        email: "perf@toolbox.test",
        username: "perfadmin",
        displayName: "Perf Admin",
        password: "correct-horse-battery-staple-perf",
      })
      .expect(201);
    ownerId = setupRes.body.user.id as string;
    scope = scopeForOwnerId(ownerId);
  });

  it("1. applies SQLite performance pragmas, sets 65s/66s reverse-proxy timeouts, and shuts down cleanly without double-signal hangs", async () => {
    expect(sqlite.pragma("cache_size", { simple: true })).toBe(-32000);
    expect(sqlite.pragma("temp_store", { simple: true })).toBe(2); // MEMORY
    expect(sqlite.pragma("journal_size_limit", { simple: true })).toBe(
      67108864,
    );
    expect(
      Number(sqlite.pragma("mmap_size", { simple: true })),
    ).toBeGreaterThanOrEqual(0);

    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);

    const miniApp = express();
    let releaseInFlight!: () => void;
    const inFlightStarted = new Promise<void>((resolve) => {
      miniApp.get("/slow", (_req, res) => {
        resolve();
        new Promise<void>((r) => {
          releaseInFlight = r;
        }).then(() => {
          res.json({ drained: true });
        });
      });
    });
    miniApp.get("/fast", (_req, res) => {
      res.json({ ok: true });
    });

    const server = createHttpServer(miniApp);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);

    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const port = (server.address() as { port: number }).port;
    const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 4 });

    try {
      // Warm an idle keep-alive socket first so closeIdleConnections() is exercised
      await new Promise<void>((resolve, reject) => {
        http
          .get(
            { hostname: "127.0.0.1", port, path: "/fast", agent: keepAliveAgent },
            (res) => {
              res.resume();
              res.on("end", () => resolve());
            },
          )
          .on("error", reject);
      });

      // Start an in-flight request before triggering SIGTERM
      const slowRespPromise = new Promise<string>((resolve, reject) => {
        http
          .get(
            { hostname: "127.0.0.1", port, path: "/slow", agent: keepAliveAgent },
            (res) => {
              const chunks: Buffer[] = [];
              res.on("data", (c: Buffer) => chunks.push(c));
              res.on("end", () =>
                resolve(Buffer.concat(chunks).toString("utf8")),
              );
            },
          )
          .on("error", reject);
      });

      await inFlightStarted;

      const ops: string[] = [];
      const exitCodes: number[] = [];
      const mockDb = {
        open: true,
        pragma: (stmt: string) => {
          ops.push(`pragma:${stmt}`);
        },
        close: () => {
          ops.push("db:close");
          mockDb.open = false;
        },
      };

      const firstShutdown = shutdownServer(server, {
        signal: "SIGTERM",
        db: mockDb,
        stopTimers: () => ops.push("timers:stop"),
        stopWorker: async () => {
          ops.push("worker:stop");
        },
        exit: (code) => exitCodes.push(code),
      });

      // Second signal while draining must immediately exit(1) without hanging
      const secondExitCodes: number[] = [];
      await shutdownServer(server, {
        signal: "SIGINT",
        db: mockDb,
        exit: (code) => secondExitCodes.push(code),
      });
      expect(secondExitCodes).toEqual([1]);

      releaseInFlight();
      const slowBody = await slowRespPromise;
      expect(JSON.parse(slowBody)).toEqual({ drained: true });

      await firstShutdown;
      expect(server.listening).toBe(false);
      expect(exitCodes).toEqual([0]);
      expect(ops).toEqual([
        "timers:stop",
        "worker:stop",
        "pragma:optimize",
        "pragma:wal_checkpoint(PASSIVE)",
        "db:close",
      ]);
    } finally {
      keepAliveAgent.destroy();
      if (server.listening) server.close();
    }
  });

  it("2. handles 20 Kits + 3,000 flashcards + DAG prerequisite edges within <500ms bounds across Kits, Decks, cross-Kit SRS due, FSRS-6 + FIRe review, and FTS5 hybrid search", async () => {
    const TOTAL_KITS = 20;
    const CARDS_PER_KIT = 150; // 20 * 150 = 3,000 flashcards
    const { dimension, embeddingGen } = ensureEmbeddingStore(db);
    const sharedVec = deterministicHashEmbed(
      ["distributed consensus systems flashcard benchmark"],
      dimension,
    )[0];
    const needleVec = deterministicHashEmbed(
      ["ByzantineQuorumAnchor17 linearizable quorum intersection"],
      dimension,
    )[0];

    const ownerTok = ownerTokFor(ownerId);
    const kindTok = kindTokFor("flashcard");
    const twentyFourDaysAgoIso = new Date(
      Date.now() - 32 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const pastDueIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    let targetKitSlug = "";
    let targetKitId = "";
    let targetDeckId = "";
    let targetReviewCardId = "";
    let hop1PrereqCardId = "";
    let hop2PrereqCardId = "";

    const insertKit = db.prepare(`
      INSERT INTO kits (
        id, ownerId, slug, name, description, icon, color, status, skeleton_json,
        created_at, updated_at, last_opened_at
      ) VALUES (?, ?, ?, ?, ?, '⚡', '#0891b2', 'ready', ?, datetime('now'), datetime('now'), datetime('now'))
    `);
    const insertDeck = db.prepare(`
      INSERT INTO decks (
        id, ownerId, kit_id, name, description, color_index, tags, settings, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'Benchmark deck', 0, 'perf', '{"new_limit":25,"review_limit":200}', datetime('now'), datetime('now'))
    `);
    const insertCard = db.prepare(`
      INSERT INTO flashcards (
        id, ownerId, deck_id, node_id, front, back, position,
        ease_factor, interval, repetitions, next_review, last_reviewed,
        state, learning_step, stability, difficulty, lapses, prerequisite_id,
        source_pillar_id, source_topic_id, source_section_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?, ?, ?, 'core')
    `);
    const insertRagChunk = db.prepare(`
      INSERT INTO rag_chunks (
        chunk_id, ownerId, kit_id, kind, source_ref_id, node_id,
        title, content, content_hash, embedding_gen, updated_at
      ) VALUES (?, ?, ?, 'flashcard', ?, ?, ?, ?, ?, ?, datetime('now'))
    `);
    const insertRagFts = db.prepare(`
      INSERT INTO rag_chunks_fts (chunk_id, ownerTok, kitTok, kindTok, title, content)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertRagVec = db.prepare(`
      INSERT INTO rag_chunks_vec (chunk_id, ownerId, kit_id, kind, embedding)
      VALUES (?, ?, ?, 'flashcard', ?)
    `);

    const bulkInsertTx = db.transaction(() => {
      for (let k = 0; k < TOTAL_KITS; k++) {
        const skeleton = buildScaleSkeleton(k);
        const kitId = crypto.randomUUID();
        const deckId = crypto.randomUUID();
        const kitTok = kitTokFor(kitId);

        insertKit.run(
          kitId,
          ownerId,
          skeleton.identity.slug,
          skeleton.identity.name,
          skeleton.identity.description,
          JSON.stringify(skeleton),
        );
        insertDeck.run(deckId, ownerId, kitId, `Deck ${k}`);

        if (k === 17) {
          targetKitId = kitId;
          targetKitSlug = skeleton.identity.slug;
          targetDeckId = deckId;
        }

        let prevCardId: string | null = null;
        for (let c = 0; c < CARDS_PER_KIT; c++) {
          const cardId = crypto.randomUUID();
          const nodeIdx = c % 6;
          const nodeId = `k${k}-n${nodeIdx}`;
          const pillarId = nodeIdx < 3 ? `k${k}-p1` : `k${k}-p2`;
          const topicId = nodeIdx < 3 ? `k${k}-t1` : `k${k}-t2`;
          const isNeedle = k === 17 && c === 42;

          const front = isNeedle
            ? "What guarantees ByzantineQuorumAnchor17 linearizable safety across partitions?"
            : `Kit ${k} Card ${c}: Explain invariant ${nodeId}`;
          const back = isNeedle
            ? "ByzantineQuorumAnchor17 intersects any two quorums on at least one honest replica."
            : `Detailed systems explanation for ${nodeId} card ${c}.`;

          // Cards 0..2 on each kit are graduated (state=2) foundations on n0, n1, n2
          // so FIRe upward credit propagation & due-queue queries have realistic graduated + new + gated cards.
          const isGraduatedFoundation = c < 3;
          const prereqCardId = c >= 3 && c % 5 === 0 ? prevCardId : null;

          insertCard.run(
            cardId,
            ownerId,
            deckId,
            nodeId,
            front,
            back,
            c,
            2.6,
            isGraduatedFoundation ? 8 : 0,
            isGraduatedFoundation ? 3 : 0,
            isGraduatedFoundation ? pastDueIso : null,
            isGraduatedFoundation ? twentyFourDaysAgoIso : null,
            isGraduatedFoundation ? 2 : 0,
            isGraduatedFoundation ? 8.0 : null,
            isGraduatedFoundation ? 5.0 : null,
            prereqCardId,
            pillarId,
            topicId,
          );

          if (k === 17) {
            if (c === 0) hop2PrereqCardId = cardId; // node k17-n0 (2-hop prereq of k17-n2)
            if (c === 1) hop1PrereqCardId = cardId; // node k17-n1 (1-hop prereq of k17-n2)
            if (c === 2) targetReviewCardId = cardId; // node k17-n2 (encompasses n1 & n0)
          }

          const chunkId = `${ownerId}:${kitId}:flashcard:${cardId}`;
          const content = `${front}\n${back}`;
          insertRagChunk.run(
            chunkId,
            ownerId,
            kitId,
            cardId,
            nodeId,
            front,
            content,
            `bench-hash-${k}-${c}`,
            embeddingGen,
          );
          insertRagFts.run(chunkId, ownerTok, kitTok, kindTok, front, content);
          insertRagVec.run(
            chunkId,
            ownerId,
            kitId,
            isNeedle ? needleVec : sharedVec,
          );

          prevCardId = cardId;
        }
      }
    });

    bulkInsertTx();

    // 2a. listOwnedKits latency & accuracy across 20+ Kits and 3,000+ flashcards
    const tKits = performance.now();
    const kits = listOwnedKits(db, scope);
    const kitsMs = performance.now() - tKits;
    expect(kitsMs).toBeLessThan(500);
    expect(kits.length).toBeGreaterThanOrEqual(TOTAL_KITS);
    const targetKitSummary = kits.find((k) => k.id === targetKitId);
    expect(targetKitSummary?.cardCount).toBe(CARDS_PER_KIT);

    // 2b. GET /api/decks latency & accuracy
    const tDecks = performance.now();
    const decksRes = await agent
      .get("/api/decks")
      .set("X-Toolbox-Kit", targetKitSlug)
      .expect(200);
    const decksMs = performance.now() - tDecks;
    expect(decksMs).toBeLessThan(500);
    expect(decksRes.body).toHaveLength(1);
    expect(decksRes.body[0].card_count).toBe(CARDS_PER_KIT);

    // 2c. Cross-Kit GET /api/srs/due latency & prerequisite gate enforcement
    const tDue = performance.now();
    const dueRes = await agent.get("/api/srs/due").expect(200);
    const dueMs = performance.now() - tDue;
    expect(dueMs).toBeLessThan(500);
    expect(Array.isArray(dueRes.body)).toBe(true);
    expect(dueRes.body.length).toBeGreaterThanOrEqual(TOTAL_KITS * 3);
    const distinctDueKits = new Set(
      (dueRes.body as Array<{ kit_id: string }>).map((c) => c.kit_id),
    );
    expect(distinctDueKits.size).toBeGreaterThanOrEqual(TOTAL_KITS);

    // 2d. FSRS-6 + FIRe upward implicit prerequisite credit propagation latency
    const beforeHop1 = db
      .prepare("SELECT stability FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(ownerId, hop1PrereqCardId) as { stability: number };
    const beforeHop2 = db
      .prepare("SELECT stability FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(ownerId, hop2PrereqCardId) as { stability: number };

    const tReview = performance.now();
    const reviewRes = await agent
      .post(`/api/decks/${targetDeckId}/cards/${targetReviewCardId}/review`)
      .set("X-Toolbox-Kit", targetKitSlug)
      .send({ quality: 4, confidence: "high" })
      .expect(200);
    const reviewMs = performance.now() - tReview;
    expect(reviewMs).toBeLessThan(500);
    expect(reviewRes.body.implicit_credit_count).toBeGreaterThanOrEqual(2);
    expect(reviewRes.body.stability).toBeGreaterThan(8.0);

    const afterHop1 = db
      .prepare("SELECT stability FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(ownerId, hop1PrereqCardId) as { stability: number };
    const afterHop2 = db
      .prepare("SELECT stability FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(ownerId, hop2PrereqCardId) as { stability: number };
    expect(afterHop1.stability).toBeGreaterThan(beforeHop1.stability);
    expect(afterHop2.stability).toBeGreaterThan(beforeHop2.stability);

    // 2e. FTS5 + sqlite-vec Hybrid Search over 3,000+ indexed chunks
    const tSearch = performance.now();
    const hits = await hybridSearch(db, scope, "ByzantineQuorumAnchor17", {
      limit: 10,
    });
    const searchMs = performance.now() - tSearch;
    expect(searchMs).toBeLessThan(500);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].kitId).toBe(targetKitId);
    expect(hits[0].content).toContain("ByzantineQuorumAnchor17");
    expect(hits[0].channels).toContain("fts");
  });

  it("3. gzips >=1KB JSON with Vary: Accept-Encoding while leaving <1KB JSON and text/event-stream SSE unbuffered and uncompressed", async () => {
    const testApp = express();
    testApp.use(gzipCompression);

    const largePayload = {
      items: Array.from({ length: 60 }, (_, i) => ({
        id: `item-${i}`,
        summary: `Detailed distributed systems study note #${i} with compressible prose.`,
      })),
    };
    const smallPayload = { ok: true, msg: "tiny" };

    testApp.get("/large", (_req, res) => {
      res.json(largePayload);
    });
    testApp.get("/small", (_req, res) => {
      res.json(smallPayload);
    });
    testApp.get("/sse", (_req, res) => {
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache");
      for (let i = 0; i < 6; i++) {
        res.write(
          `data: ${JSON.stringify({ seq: i, padding: "x".repeat(300) })}\n\n`,
        );
      }
      res.end("data: [DONE]\n\n");
    });

    const server = http.createServer(testApp);
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const port = (server.address() as { port: number }).port;

    try {
      const rawLargeBytes = Buffer.byteLength(
        JSON.stringify(largePayload),
        "utf8",
      );
      expect(rawLargeBytes).toBeGreaterThan(1024);

      const largeRes = await rawHttpGet(port, "/large", {
        "Accept-Encoding": "gzip",
      });
      expect(largeRes.statusCode).toBe(200);
      expect(largeRes.headers["content-encoding"]).toBe("gzip");
      expect(String(largeRes.headers.vary)).toContain("Accept-Encoding");
      expect(largeRes.body.byteLength).toBeLessThan(rawLargeBytes);
      const gunzipped = JSON.parse(
        zlib.gunzipSync(largeRes.body).toString("utf8"),
      );
      expect(gunzipped).toEqual(largePayload);

      const smallRes = await rawHttpGet(port, "/small", {
        "Accept-Encoding": "gzip",
      });
      expect(smallRes.statusCode).toBe(200);
      expect(smallRes.headers["content-encoding"]).toBeUndefined();
      expect(String(smallRes.headers.vary)).toContain("Accept-Encoding");
      expect(JSON.parse(smallRes.body.toString("utf8"))).toEqual(smallPayload);

      const sseRes = await rawHttpGet(port, "/sse", {
        "Accept-Encoding": "gzip",
      });
      expect(sseRes.statusCode).toBe(200);
      expect(sseRes.headers["content-encoding"]).toBeUndefined();
      const sseText = sseRes.body.toString("utf8");
      expect(sseText.length).toBeGreaterThan(1024);
      expect(sseText).toContain('data: {"seq":0');
      expect(sseText).toContain("data: [DONE]");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("4. enforces MAX_BUCKETS hard cap under a 12,000-key spoofed IP flood without unbounded heap growth", () => {
    expect(MAX_BUCKETS).toBe(10_000);
    const limiter = createRateLimiter({
      windowMs: 60_000,
      max: 2,
      name: "flood-check",
    });

    const fakeRes = {} as express.Response;
    let passedCount = 0;

    for (let i = 0; i < 12_000; i++) {
      const octet2 = Math.floor(i / 65536) & 255;
      const octet3 = Math.floor(i / 256) & 255;
      const octet4 = i & 255;
      const fakeReq = {
        ip: `10.${octet2}.${octet3}.${octet4}`,
      } as express.Request;

      limiter(fakeReq, fakeRes, (err?: unknown) => {
        if (!err) passedCount += 1;
      });
      expect(limiter.size()).toBeLessThanOrEqual(MAX_BUCKETS);
    }

    expect(passedCount).toBe(12_000);
    expect(limiter.size()).toBe(MAX_BUCKETS);

    // Active latest bucket still enforces `max` rate limit accurately
    const hotReq = { ip: "10.0.46.223" } as express.Request; // i = 11999
    let blockedErr: unknown = null;
    limiter(hotReq, fakeRes, (err?: unknown) => {
      if (err) blockedErr = err;
    });
    expect(blockedErr).toBeNull(); // count = 2 (<= max)
    limiter(hotReq, fakeRes, (err?: unknown) => {
      if (err) blockedErr = err;
    });
    expect(blockedErr).toBeTruthy(); // count = 3 (> max -> RateLimitedError)
  });

  it("5. recovers orphaned running jobs to failed on startup while leaving queued and completed jobs untouched", () => {
    expect(recoverFromLivingExpand).toBe(recoverOrphanedRunningJobs);

    const wedgedKitId = crypto.randomUUID();
    const skeleton = buildScaleSkeleton(999);
    db.prepare(
      `INSERT INTO kits (
         id, ownerId, slug, name, description, icon, color,
         status, status_detail, skeleton_json, created_at, updated_at
       ) VALUES (?, ?, 'wedged-restart-kit', 'Wedged Kit', '', '⚡', '#0891b2', 'seeding', 'Seeding Pillar 1/2…', ?, datetime('now'), datetime('now'))`,
    ).run(wedgedKitId, ownerId, JSON.stringify(skeleton));

    const runningJobId = crypto.randomUUID();
    const queuedJobId = crypto.randomUUID();
    const doneJobId = crypto.randomUUID();
    const completedJobId = crypto.randomUUID();

    const insertJob = db.prepare(
      `INSERT INTO jobs (id, kind, ownerId, payload, status, attempts, lastError, startedAt, finishedAt)
       VALUES (?, 'seed_kit_pillars', ?, ?, ?, 1, NULL, ?, ?)`,
    );
    insertJob.run(
      runningJobId,
      ownerId,
      JSON.stringify({ kitId: wedgedKitId, targetPillarIds: ["k999-p1"] }),
      "running",
      "2026-09-01T00:00:00Z",
      null,
    );
    insertJob.run(
      queuedJobId,
      ownerId,
      JSON.stringify({ kitId: wedgedKitId, targetPillarIds: ["k999-p2"] }),
      "queued",
      null,
      null,
    );
    insertJob.run(
      doneJobId,
      ownerId,
      JSON.stringify({ kitId: wedgedKitId }),
      "done",
      "2026-09-01T00:00:00Z",
      "2026-09-01T00:01:00Z",
    );
    insertJob.run(
      completedJobId,
      ownerId,
      JSON.stringify({ kitId: wedgedKitId }),
      "completed",
      "2026-09-01T00:00:00Z",
      "2026-09-01T00:01:00Z",
    );

    const firstRecovery = recoverOrphanedRunningJobs(db);
    expect(firstRecovery.recoveredCount).toBe(1);
    expect(firstRecovery.recoveredJobIds).toEqual([runningJobId]);

    // Idempotent on subsequent invocations
    const secondRecovery = recoverOrphanedRunningJobs(db);
    expect(secondRecovery.recoveredCount).toBe(0);

    const readJob = db.prepare(
      "SELECT status, lastError, finishedAt FROM jobs WHERE id = ?",
    );
    const recoveredRow = readJob.get(runningJobId) as {
      status: string;
      lastError: string | null;
      finishedAt: string | null;
    };
    expect(recoveredRow.status).toBe("failed");
    expect(recoveredRow.lastError).toBe(ORPHANED_JOB_RESTART_ERROR);
    expect(recoveredRow.finishedAt).toBeTruthy();

    const queuedRow = readJob.get(queuedJobId) as {
      status: string;
      lastError: string | null;
    };
    expect(queuedRow.status).toBe("queued");
    expect(queuedRow.lastError).toBeNull();

    const doneRow = readJob.get(doneJobId) as { status: string };
    expect(doneRow.status).toBe("done");

    const completedRow = readJob.get(completedJobId) as { status: string };
    expect(completedRow.status).toBe("completed");

    const kitRow = db
      .prepare("SELECT status, status_detail FROM kits WHERE ownerId = ? AND id = ?")
      .get(ownerId, wedgedKitId) as {
      status: string;
      status_detail: string | null;
    };
    expect(kitRow.status).toBe("ready");
    expect(kitRow.status_detail).toBe(ORPHANED_JOB_RESTART_ERROR);
  });

  it("6. refuses a corrupt database file or a DATA_DIR that is a file with an error naming the path, and leaves the file untouched", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "toolbox-open-"));
    try {
      const corrupt = path.join(dir, "toolbox.db");
      const garbage = Buffer.alloc(8192, 0x41);
      fs.writeFileSync(corrupt, garbage);
      expect(() => openDatabase(corrupt)).toThrow(
        `Cannot open the database at ${corrupt}: file is not a database (SQLITE_NOTADB)`,
      );
      expect(fs.readFileSync(corrupt).equals(garbage)).toBe(true);

      const fileNotDir = path.join(dir, "data-is-a-file");
      fs.writeFileSync(fileNotDir, "");
      expect(() => openDatabase(path.join(fileNotDir, "toolbox.db"))).toThrow(
        `Cannot open the database at ${path.join(fileNotDir, "toolbox.db")}`,
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("7. schedules online backups (logs and retries a failed check, joins an in-flight run during concurrent writes, skips while fresh or disabled, rotates to BACKUP_KEEP, stops on demand) and restores to an identical database", async () => {
    fs.rmSync(BACKUPS_DIR, { recursive: true, force: true });
    fs.writeFileSync(BACKUPS_DIR, "not a directory");
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    try {
      const stop = startBackupScheduler(60_000);
      expect(vi.getTimerCount()).toBe(1);

      // Check 1 fails (BACKUPS_DIR is a file): logged, no unhandled rejection, timer keeps running.
      vi.advanceTimersByTime(60_000);
      await new Promise((resolve) => setImmediate(resolve));
      expect(vi.getTimerCount()).toBe(1);
      fs.rmSync(BACKUPS_DIR);

      // Check 2 finds no snapshot and starts one; runBackup() joins it instead of overlapping.
      const writes = Array.from({ length: 30 }, (_, i) =>
        agent
          .put(`/api/guide-content/backup-p/backup-t/s${i}`)
          .set("X-Toolbox-Kit", "system-design")
          .send({ content: `Note ${i} written while the backup runs.` })
          .expect(200),
      );
      vi.advanceTimersByTime(60_000);
      const [scheduled] = await Promise.all([runBackup(), ...writes]);
      expect(scheduled.verification?.ok).toBe(true);
      expect(listBackups().map((b) => b.filename)).toEqual([scheduled.filename]);

      expect(await runScheduledBackup()).toBeNull();
      const stale = Date.now() + 48 * 3_600_000;
      expect(await withEnv("BACKUP_INTERVAL_HOURS", "0", () => runScheduledBackup(stale))).toBeNull();

      stop();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    const quiet = await withEnv("BACKUP_KEEP", "1", () => runBackup());
    expect(listBackups().map((b) => b.filename)).toEqual([quiet.filename]);
    const restoreDir = fs.mkdtempSync(path.join(os.tmpdir(), "toolbox-restore-"));
    const restoredPath = path.join(restoreDir, "toolbox.db");
    fs.copyFileSync(path.join(BACKUPS_DIR, quiet.filename), restoredPath);
    const restored = openDatabase(restoredPath);
    try {
      initPlatformSchema(restored);
      initKitsSchema(restored);
      expect(tableDigests(restored)).toEqual(tableDigests(sqlite));
    } finally {
      restored.close();
      initKitsSchema(sqlite);
      fs.rmSync(restoreDir, { recursive: true, force: true });
    }
  });
});
