// @vitest-environment node
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../app.ts";
import db from "../db.ts";
import { computeGraphHealth } from "../graph/health.ts";
import { exportKitBackupZip } from "../kits/kitExportImport.ts";
import { ensureDefaultSystemDesignKit } from "../kits/kitsSchema.ts";
import { liveCardRetrievability } from "../mcp/toolboxMcpTools.ts";
import { createZipArchive, extractZipArchive } from "../platform/archive/zip.ts";
import { getOwnerDataHooks } from "../platform/db/connection.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import {
  ensureEmbeddingStore,
  hybridSearch,
  upsertRagChunksBatch,
} from "../search/hybridSearch.ts";
import {
  calculateNextSrsState,
  formatRelativeTime,
  getCardPreviews,
  parseDeckSettings,
  parseStepsMinutes,
  parseUtcTimestampMs,
  qualityToFsrsGrade,
} from "../srs/scheduler.ts";
import { makeKitSkeleton, setupTwoTenants, type TwoTenantsContext } from "./testHelpers.ts";

describe("Backend Performance, Stability & API Harmony Suite", () => {
  let app: Express;
  let tenants: TwoTenantsContext;

  beforeAll(async () => {
    __resetAuthRateLimits();
    app = createApp();
    tenants = await setupTwoTenants(app, "perfstab");
  });

  it("1. handles same-day FSRS-6 ISO-8601 due queues, future step exclusion, and UTC SQLite timestamps without TZ skew", async () => {
    const { aliceAgent, aliceScope } = tenants;
    const defaultKit = ensureDefaultSystemDesignKit(db, aliceScope);
    // Repeated calls are race-free and idempotent on (ownerId, slug)
    expect(ensureDefaultSystemDesignKit(db, aliceScope).id).toBe(defaultKit.id);

    const deckRes = await aliceAgent
      .post("/api/decks")
      .set("X-Toolbox-Kit", defaultKit.slug)
      .send({ name: "ISO Due Queue Deck", description: "FSRS intraday verification" })
      .expect(201);
    const deckId = deckRes.body.id as string;

    const createCard = async (front: string) => {
      const res = await aliceAgent
        .post(`/api/decks/${deckId}/cards`)
        .send({ front, back: `Answer for ${front}` })
        .expect(201);
      return res.body.id as string;
    };

    const learningDueIsoId = await createCard("ISO Learning Due (5m ago)");
    const reviewDueIsoId = await createCard("ISO Review Due (2m ago)");
    const relearnFutureIsoId = await createCard("ISO Relearning Future (+45m)");
    const sqliteDueSpaceId = await createCard("SQLite Space Format Due");
    const newCardId = await createCard("Brand New Unseen Card");

    const nowMs = Date.now();
    const fiveMinAgoIso = new Date(nowMs - 5 * 60_000).toISOString();
    const twoMinAgoIso = new Date(nowMs - 2 * 60_000).toISOString();
    const fortyFiveMinAheadIso = new Date(nowMs + 45 * 60_000).toISOString();
    const tenMinAgoSqlite = new Date(nowMs - 10 * 60_000)
      .toISOString()
      .slice(0, 19)
      .replace("T", " ");

    db.prepare(
      "UPDATE flashcards SET state = 1, repetitions = 1, next_review = ?, last_reviewed = ? WHERE ownerId = ? AND id = ?",
    ).run(fiveMinAgoIso, fiveMinAgoIso, aliceScope.ownerId, learningDueIsoId);
    db.prepare(
      "UPDATE flashcards SET state = 2, repetitions = 3, interval = 4, stability = 5.2, difficulty = 4.8, next_review = ?, last_reviewed = ? WHERE ownerId = ? AND id = ?",
    ).run(twoMinAgoIso, tenMinAgoSqlite, aliceScope.ownerId, reviewDueIsoId);
    db.prepare(
      "UPDATE flashcards SET state = 3, repetitions = 2, lapses = 1, next_review = ?, last_reviewed = ? WHERE ownerId = ? AND id = ?",
    ).run(fortyFiveMinAheadIso, twoMinAgoIso, aliceScope.ownerId, relearnFutureIsoId);
    db.prepare(
      "UPDATE flashcards SET state = 2, repetitions = 2, interval = 2, next_review = ?, last_reviewed = ? WHERE ownerId = ? AND id = ?",
    ).run(tenMinAgoSqlite, tenMinAgoSqlite, aliceScope.ownerId, sqliteDueSpaceId);

    // Per-deck due session must include ISO-due learning + review + SQLite-due + new, and exclude +45m future step!
    const deckDueRes = await aliceAgent.get(`/api/decks/${deckId}/cards/due`).expect(200);
    const deckDueIds = (deckDueRes.body as Array<{ id: string }>).map((c) => c.id);
    expect(deckDueIds).toContain(learningDueIsoId);
    expect(deckDueIds).toContain(reviewDueIsoId);
    expect(deckDueIds).toContain(sqliteDueSpaceId);
    expect(deckDueIds).toContain(newCardId);
    expect(deckDueIds).not.toContain(relearnFutureIsoId);

    // Cross-kit /api/decks/all/cards/due & /api/srs/due must match
    const allDueRes = await aliceAgent.get("/api/decks/all/cards/due").expect(200);
    const allDueIds = (allDueRes.body as Array<{ id: string }>).map((c) => c.id);
    expect(allDueIds).toContain(learningDueIsoId);
    expect(allDueIds).toContain(reviewDueIsoId);
    expect(allDueIds).toContain(sqliteDueSpaceId);
    expect(allDueIds).not.toContain(relearnFutureIsoId);

    const srsDueRes = await aliceAgent.get("/api/srs/due").expect(200);
    const srsDueIds = (srsDueRes.body as Array<{ id: string }>).map((c) => c.id);
    expect(srsDueIds).toContain(learningDueIsoId);
    expect(srsDueIds).toContain(reviewDueIsoId);
    expect(srsDueIds).not.toContain(relearnFutureIsoId);

    // Deck list & single deck summary due_count (state=2 due -> 2), learn_count (state IN 1,3 -> 2), new_count (1)
    const decksListRes = await aliceAgent
      .get("/api/decks")
      .set("X-Toolbox-Kit", defaultKit.slug)
      .expect(200);
    const listedDeck = (
      decksListRes.body as Array<{
        id: string;
        due_count: number;
        learn_count: number;
        new_count: number;
      }>
    ).find((d) => d.id === deckId);
    expect(listedDeck).toMatchObject({ due_count: 2, learn_count: 2, new_count: 1 });

    const singleDeckRes = await aliceAgent.get(`/api/decks/${deckId}`).expect(200);
    expect(singleDeckRes.body.due_count).toBe(2);
    expect(singleDeckRes.body.learn_count).toBe(2);
    expect(singleDeckRes.body.new_count).toBe(1);

    const statsRes = await aliceAgent
      .get("/api/decks/stats")
      .set("X-Toolbox-Kit", defaultKit.slug)
      .expect(200);
    expect(statsRes.body.dueCount).toBe(3);
    expect(statsRes.body.reviewedTodayCount).toBeGreaterThanOrEqual(4);

    // UTC timestamp parser & relative formatter invariants
    expect(parseUtcTimestampMs("2026-11-11 08:30:00")).toBe(
      Date.parse("2026-11-11T08:30:00Z"),
    );
    expect(parseUtcTimestampMs("2026-11-11T08:30:00.000Z")).toBe(
      Date.parse("2026-11-11T08:30:00.000Z"),
    );
    expect(Number.isNaN(parseUtcTimestampMs(null))).toBe(true);
    expect(Number.isNaN(parseUtcTimestampMs("not-a-timestamp"))).toBe(true);
    expect(formatRelativeTime("not-a-timestamp")).toBe("Never studied");
    expect(formatRelativeTime(tenMinAgoSqlite)).toBe("Today");

    const targetNodeId = defaultKit.skeleton.graph.nodes[0]!.id;
    const health = computeGraphHealth(
      [
        {
          id: reviewDueIsoId,
          node_id: targetNodeId,
          state: 2,
          stability: 12,
          difficulty: 5,
          interval: 10,
          lapses: 0,
          last_reviewed: tenMinAgoSqlite,
          next_review: twoMinAgoIso,
        },
      ],
      {
        nodes: defaultKit.skeleton.graph.nodes,
        edges: defaultKit.skeleton.graph.edges,
      },
    );
    const nodeSummary = health.byNode.get(targetNodeId)!;
    expect(Number.isFinite(nodeSummary.strength)).toBe(true);
    expect(nodeSummary.strength).toBeGreaterThan(0);
  });

  it("2. enforces strict numeric, JSON & payload bounds across reviews, deck settings, search, guide, boards, profile, and config", async () => {
    const { aliceAgent, aliceScope } = tenants;
    const kit = ensureDefaultSystemDesignKit(db, aliceScope);

    const deckRes = await aliceAgent
      .post("/api/decks")
      .set("X-Toolbox-Kit", kit.slug)
      .send({ name: "Validation Deck" })
      .expect(201);
    const deckId = deckRes.body.id as string;

    const cardRes = await aliceAgent
      .post(`/api/decks/${deckId}/cards`)
      .send({ front: "Strict Q", back: "Strict A" })
      .expect(201);
    const cardId = cardRes.body.id as string;

    // Non-finite quality values must NEVER map to Grade 4 Easy
    expect(qualityToFsrsGrade(Number.NaN)).toBe(1);
    expect(qualityToFsrsGrade(Number.POSITIVE_INFINITY)).toBe(1);
    const nanState = calculateNextSrsState({ state: 0 }, Number.NaN, {
      interval_modifier: Number.NaN,
    });
    expect(Number.isFinite(nanState.stability)).toBe(true);
    expect(nanState.state).toBe(1); // Again -> Learning, never Graduated Easy!

    for (const badBody of [
      {},
      { quality: null },
      { quality: "4" },
      { quality: -1 },
      { quality: 6 },
      { quality: 2.5 },
    ]) {
      await aliceAgent
        .post(`/api/decks/${deckId}/cards/${cardId}/review`)
        .send(badBody)
        .expect(400);
    }

    // Deck settings validation + healing of pre-existing corrupted JSON
    for (const badSettings of [
      { new_limit: -5 },
      { new_limit: "abc" },
      { review_limit: 999999 },
      { desired_retention: 1.5 },
      { steps: "1 -10" },
    ]) {
      await aliceAgent.put(`/api/decks/${deckId}/settings`).send(badSettings).expect(400);
    }

    const healed = parseDeckSettings(
      JSON.stringify({
        new_limit: "not-a-number",
        review_limit: -50,
        easy_bonus: null,
        desired_retention: 99,
        steps: ["bad", -3],
        lapse_steps: [],
      }),
    );
    expect(healed.new_limit).toBe(20);
    expect(healed.review_limit).toBe(0);
    expect(healed.easy_bonus).toBe(1.3);
    expect(healed.desired_retention).toBe(0.97);
    expect(
      parseDeckSettings(JSON.stringify({ desired_retention: null })).desired_retention,
    ).toBe(0.9);
    expect(healed.steps).toBe("1m 10m");
    expect(healed.lapse_steps).toBe("10m");

    // check-duplicates handles non-string elements and rejects >500 items
    const dupCheck = await aliceAgent
      .post(`/api/decks/${deckId}/cards/check-duplicates`)
      .send({ cards: [{ front: "Strict Q", back: "Other" }, { front: 123, back: null }] })
      .expect(200);
    expect(dupCheck.body.results).toHaveLength(2);
    expect(dupCheck.body.results[0].isDuplicate).toBe(true);
    expect(dupCheck.body.results[1].isDuplicate).toBe(false);

    await aliceAgent
      .post(`/api/decks/${deckId}/cards/check-duplicates`)
      .send({ cards: Array.from({ length: 501 }, (_, i) => ({ front: `Q${i}`, back: `A${i}` })) })
      .expect(400);

    // Search limit & query length validation
    await aliceAgent.get("/api/search?q=cache&limit=-1").expect(400);
    await aliceAgent.get("/api/search?q=cache&limit=abc").expect(400);
    await aliceAgent.get(`/api/search?q=${"x".repeat(501)}`).expect(400);

    // Guide content validation
    await aliceAgent
      .put("/api/guide-content/p1/t1/s1")
      .set("X-Toolbox-Kit", kit.slug)
      .send({ content: 12345 })
      .expect(400);
    await aliceAgent
      .put("/api/guide-content/p1/t1/s1")
      .set("X-Toolbox-Kit", kit.slug)
      .send({ content: "a".repeat(200_001) })
      .expect(400);

    // Boards validation & corrupt JSON resilience
    await aliceAgent
      .post("/api/boards")
      .set("X-Toolbox-Kit", kit.slug)
      .send({ name: "Bad Board", data: ["not-an-object"] })
      .expect(400);
    await aliceAgent
      .patch("/api/boards/reorder")
      .set("X-Toolbox-Kit", kit.slug)
      .send({ ids: [123] })
      .expect(400);

    const goodBoard = await aliceAgent
      .post("/api/boards")
      .set("X-Toolbox-Kit", kit.slug)
      .send({ name: "Resilient Board", data: { nodes: [], edges: [] } })
      .expect(201);
    db.prepare("UPDATE boards SET data = '{corrupt-json' WHERE ownerId = ? AND id = ?").run(
      aliceScope.ownerId,
      goodBoard.body.id,
    );
    const fetchedCorruptBoard = await aliceAgent
      .get(`/api/boards/${goodBoard.body.id}`)
      .expect(200);
    expect(fetchedCorruptBoard.body.data).toEqual({});

    // Profile & Admin Config bounds + transactional rollback on bad config entry
    await aliceAgent
      .put("/api/profile")
      .send({ profileText: "p".repeat(50_001) })
      .expect(400);

    await aliceAgent
      .put("/api/config")
      .send({ valid_temp_key: "should_rollback", nested_bad: { a: 1 } })
      .expect(400);
    const leakedCfg = db
      .prepare("SELECT value FROM config WHERE key = 'valid_temp_key'")
      .get();
    expect(leakedCfg).toBeUndefined();
  });

  it("3. escapes FTS5 operators/quotes without syntax errors and escapes SQL LIKE wildcards (% _ \\) in /api/search", async () => {
    const { aliceAgent, aliceScope } = tenants;
    const kit = ensureDefaultSystemDesignKit(db, aliceScope);
    ensureEmbeddingStore(db);

    const firstPillar = kit.skeleton.pillars[0]!;
    const firstTopic = firstPillar.topics[0]!;
    const firstSection = firstPillar.sections[0]!;

    // Board & Deck names with literal %, _, and \ vs distractor rows that would match unescaped wildcards
    const targetBoard = await aliceAgent
      .post("/api/boards")
      .set("X-Toolbox-Kit", kit.slug)
      .send({
        name: "SLA 99.99% p99_tail_latency C:\\var\\wal",
        data: { nodes: [], edges: [] },
      })
      .expect(201);
    await aliceAgent
      .post("/api/boards")
      .set("X-Toolbox-Kit", kit.slug)
      .send({
        name: "SLA 99.995bps p99XtailXlatency C:XvarXwal",
        data: { nodes: [], edges: [] },
      })
      .expect(201);

    // Also store a guide note with colons in section metadata to exercise batched guide resolution
    await aliceAgent
      .put(`/api/guide-content/${firstPillar.id}/${firstTopic.id}/${firstSection.id}`)
      .set("X-Toolbox-Kit", kit.slug)
      .send({
        content:
          "Target SLA is 99.99% availability with p99_tail_latency under 15ms and WAL path C:\\var\\wal.",
      })
      .expect(200);

    const pctSearch = await aliceAgent
      .get(`/api/search?q=${encodeURIComponent("99.99%")}`)
      .set("X-Toolbox-Kit", kit.slug)
      .expect(200);
    const pctBoards = pctSearch.body.boards as Array<{ id: string; name: string }>;
    expect(pctBoards).toHaveLength(1);
    expect(pctBoards[0]!.id).toBe(targetBoard.body.id);

    const underscoreSearch = await aliceAgent
      .get(`/api/search?q=${encodeURIComponent("p99_tail_latency")}`)
      .set("X-Toolbox-Kit", kit.slug)
      .expect(200);
    const underBoards = underscoreSearch.body.boards as Array<{ id: string; name: string }>;
    expect(underBoards).toHaveLength(1);
    expect(underBoards[0]!.id).toBe(targetBoard.body.id);

    const backslashSearch = await aliceAgent
      .get(`/api/search?q=${encodeURIComponent("C:\\var\\wal")}`)
      .set("X-Toolbox-Kit", kit.slug)
      .expect(200);
    const bsBoards = backslashSearch.body.boards as Array<{ id: string; name: string }>;
    expect(bsBoards).toHaveLength(1);
    expect(bsBoards[0]!.id).toBe(targetBoard.body.id);

    // Hostile FTS5 punctuation, unbalanced quotes, boolean operators, NEAR, column filters
    const hostileQueries = [
      '"unclosed quote',
      'AND OR NOT NEAR(foo bar, 5)',
      'title:secret * ^ ( ) { } [ ]',
      "a'b\"c\\d%e_f",
      "??? ::: !!! ---",
      "raft\u0000consensus 🚀",
    ];
    for (const q of hostileQueries) {
      const res = await aliceAgent
        .get(`/api/search?q=${encodeURIComponent(q)}`)
        .set("X-Toolbox-Kit", kit.slug)
        .expect(200);
      expect(Array.isArray(res.body.flashcards)).toBe(true);
      expect(Array.isArray(res.body.guideContent)).toBe(true);
      expect(Array.isArray(res.body.chunks)).toBe(true);

      const ragResults = await hybridSearch(db, aliceScope, q, { kitId: kit.id, limit: 5 });
      expect(Array.isArray(ragResults)).toBe(true);
    }
  });

  it("4. aligns Shared Library metadata contract, notebook highlights/dogears/whitespace invariants, and RAG sync on skeleton update", async () => {
    const { aliceAgent, bobAgent, aliceScope } = tenants;

    // Official shared kit includes full frontend card metadata
    const listOfficial = await aliceAgent.get("/api/shared-kits").expect(200);
    const sysDesignShared = (
      listOfficial.body.kits as Array<Record<string, unknown>>
    ).find((k) => k.slug === "system-design");
    expect(sysDesignShared).toBeDefined();
    expect(sysDesignShared).toMatchObject({
      slug: "system-design",
      isOfficial: true,
      authorId: null,
      pillarCount: 7,
    });
    expect(typeof sysDesignShared!.authorName).toBe("string");
    expect((sysDesignShared!.authorName as string).length).toBeGreaterThan(0);
    expect(sysDesignShared!.topicCount as number).toBeGreaterThan(10);
    expect(sysDesignShared!.nodeCount as number).toBeGreaterThan(40);
    expect(sysDesignShared!.starterCardCount).toBe(15);
    expect(sysDesignShared!.starterDrillCount).toBe(0);

    // Publish a custom kit from Alice and verify community author + counts on both list & detail
    const customSkel = makeKitSkeleton((s) => {
      s.identity.slug = "harmony-published-kit";
      s.identity.name = "Harmony Published Kit";
      s.seeds.starterDeck = {
        name: "Harmony Starter",
        description: "Starter cards",
        cards: [
          { key: "hc-1", front: "Q1", back: "A1", nodeId: "ownership" },
          { key: "hc-2", front: "Q2", back: "A2", nodeId: "ownership" },
        ],
      };
      s.seeds.drills = [
        {
          key: "hd-1",
          nodeId: "ownership",
          difficulty: 1,
          prompt: "Explain ownership transfer.",
          hints: ["Move", "Drop", "Copy"],
          workedSolution: "Values move unless Copy.",
          rubricPoints: ["Mentions Copy vs Move"],
        },
      ];
    });
    const impRes = await aliceAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: customSkel })
      .expect(201);
    const customKitId = impRes.body.kit.id as string;

    await aliceAgent
      .post(`/api/kits/${customKitId}/publish`)
      .send({ changelog: "v1 harmony check" })
      .expect(201);

    const bobSharedList = await bobAgent
      .get("/api/shared-kits?q=Alice")
      .expect(200);
    const publishedEntry = (
      bobSharedList.body.kits as Array<Record<string, unknown>>
    ).find((k) => k.slug === "harmony-published-kit");
    expect(publishedEntry).toMatchObject({
      slug: "harmony-published-kit",
      authorId: tenants.aliceId,
      authorName: "Alice Admin",
      pillarCount: 1,
      topicCount: 1,
      nodeCount: 1,
      starterCardCount: 2,
      starterDrillCount: 1,
    });

    const detailRes = await bobAgent
      .get("/api/shared-kits/harmony-published-kit")
      .expect(200);
    expect(detailRes.body.sharedKit).toMatchObject({
      slug: "harmony-published-kit",
      authorName: "Alice Admin",
      starterCardCount: 2,
    });

    // Whitespace-only guide content is NOT counted as filled in /progress, /kits/:id, or /system/stats
    await aliceAgent
      .put("/api/guide-content/basics/borrowing/mechanics")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .send({ content: "   \n\t  " })
      .expect(200);

    const progEmpty = await aliceAgent
      .get("/api/guide-content/progress")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .expect(200);
    expect(progEmpty.body["basics__borrowing__mechanics"]).toBeUndefined();

    const kitDetailEmpty = await aliceAgent.get(`/api/kits/${customKitId}`).expect(200);
    expect(kitDetailEmpty.body.kit.guideFilledCount).toBe(0);

    // Dogear toggle + Highlight linked to flashcard -> deleting flashcard sets highlight.cardId = NULL cleanly
    const t1 = await aliceAgent
      .post("/api/guide-content/dogears/toggle")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .send({ pillarId: "basics", topicId: "borrowing", sectionId: "mechanics" })
      .expect(200);
    expect(t1.body.dogeared).toBe(true);
    const t2 = await aliceAgent
      .post("/api/guide-content/dogears/toggle")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .send({ pillarId: "basics", topicId: "borrowing", sectionId: "mechanics" })
      .expect(200);
    expect(t2.body.dogeared).toBe(false);

    const kitDecks = await aliceAgent
      .get("/api/decks")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .expect(200);
    const starterDeckId = kitDecks.body[0].id as string;
    const starterDeckDetail = await aliceAgent
      .get(`/api/decks/${starterDeckId}`)
      .expect(200);
    const linkedCardId = starterDeckDetail.body.cards[0].id as string;

    const hlRes = await aliceAgent
      .post("/api/guide-content/highlights")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .send({
        pillarId: "basics",
        topicId: "borrowing",
        sectionId: "mechanics",
        quote: "Single-owner deterministic drop",
        color: "sage",
        cardId: linkedCardId,
      })
      .expect(201);
    expect(hlRes.body.cardId).toBe(linkedCardId);

    await aliceAgent
      .delete(`/api/decks/${starterDeckId}/cards/${linkedCardId}`)
      .expect(204);

    const hlAfterDelete = await aliceAgent
      .get("/api/guide-content/highlights")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .expect(200);
    expect(hlAfterDelete.body[0].cardId).toBeNull();

    // RAG sync when importing updated skeleton via onCollision=update
    await aliceAgent
      .put("/api/guide-content/basics/borrowing/pitfalls")
      .set("X-Toolbox-Kit", "harmony-published-kit")
      .send({ content: "Borrow checker soundness notes." })
      .expect(200);

    const updatedSkel = structuredClone(customSkel);
    updatedSkel.identity.version = 2;
    updatedSkel.seeds.starterDeck!.cards.push({
      key: "hc-v2-rag-unique",
      front: "What is PoloniusAliasRegionAnalysis?",
      back: "Next-generation datalog borrowck formulation.",
      nodeId: "ownership",
    });

    const updImport = await aliceAgent
      .post("/api/kits/import-kit?onCollision=update")
      .send({ skeleton: updatedSkel })
      .expect(200);
    expect(updImport.body.mode).toBe("updated");

    const ragHits = await hybridSearch(db, aliceScope, "PoloniusAliasRegionAnalysis", {
      kitId: customKitId,
      limit: 5,
    });
    expect(ragHits.some((h) => h.title.includes("PoloniusAliasRegionAnalysis"))).toBe(true);
  });

  it("5. rejects duplicate entity IDs atomically, heals duplicate seedKeys on backup restore, batches RAG upserts, and uses composite SQLite indexes", async () => {
    const { aliceAgent, bobAgent, aliceScope, bobScope } = tenants;

    // Create a kit with deck + cards + drills and export its backup ZIP
    const backupSkel = makeKitSkeleton((s) => {
      s.identity.slug = "backup-resilience-kit";
      s.identity.name = "Backup Resilience Kit";
      s.seeds.starterDeck = {
        name: "Resilience Deck",
        description: "Deck",
        cards: [
          { key: "bk-card-1", front: "Card 1", back: "Back 1", nodeId: "ownership" },
          { key: "bk-card-2", front: "Card 2", back: "Back 2", nodeId: "ownership" },
        ],
      };
      s.seeds.drills = [
        {
          key: "bk-drill-1",
          nodeId: "ownership",
          difficulty: 2,
          prompt: "Explain Pin<&mut T>.",
          hints: ["Unpin trait", "Self-referential struct", "Address stability"],
          workedSolution: "Pin prevents moving pointee.",
          rubricPoints: ["Mentions self-referential futures"],
        },
      ];
    });

    const created = await aliceAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: backupSkel })
      .expect(201);
    const sourceKitId = created.body.kit.id as string;

    const { buffer: validZip } = await exportKitBackupZip(db, aliceScope, sourceKitId);
    const extracted = await extractZipArchive(validZip);
    const kitJsonBuf = extracted.get("kit.json")!;
    const baseUserdata = JSON.parse(extracted.get("userdata.json")!.toString("utf8")) as {
      decks: Array<Record<string, unknown>>;
      flashcards: Array<Record<string, unknown>>;
      drills: Array<Record<string, unknown>>;
    };

    // 5a. Crafted archive with duplicate flashcard IDs -> 400 ValidationError & zero partial rows
    const dupIdUserdata = structuredClone(baseUserdata);
    dupIdUserdata.flashcards.push({ ...dupIdUserdata.flashcards[0]! });
    const dupIdZip = await createZipArchive([
      { name: "kit.json", data: kitJsonBuf, compress: true },
      {
        name: "userdata.json",
        data: Buffer.from(JSON.stringify(dupIdUserdata), "utf8"),
        compress: true,
      },
    ]);

    const bobKitsBefore = (
      db.prepare("SELECT COUNT(*) as c FROM kits WHERE ownerId = ?").get(bobScope.ownerId) as {
        c: number;
      }
    ).c;
    await bobAgent
      .post("/api/kits/import-backup")
      .attach("file", dupIdZip, "dup-id.toolbox-backup.zip")
      .expect(400);
    const bobKitsAfterFail = (
      db.prepare("SELECT COUNT(*) as c FROM kits WHERE ownerId = ?").get(bobScope.ownerId) as {
        c: number;
      }
    ).c;
    expect(bobKitsAfterFail).toBe(bobKitsBefore);

    // 5b. Crafted archive with distinct IDs but duplicate seedKeys -> 201 clean import (no 500 UNIQUE crash!)
    const dupSeedUserdata = structuredClone(baseUserdata);
    dupSeedUserdata.flashcards.push({
      ...dupSeedUserdata.flashcards[0]!,
      id: "distinct-card-dup-seed",
      front: "Cloned Seed Card",
    });
    dupSeedUserdata.drills.push({
      ...dupSeedUserdata.drills[0]!,
      id: "distinct-drill-dup-seed",
      prompt: "Cloned Seed Drill",
    });
    const dupSeedZip = await createZipArchive([
      { name: "kit.json", data: kitJsonBuf, compress: true },
      {
        name: "userdata.json",
        data: Buffer.from(JSON.stringify(dupSeedUserdata), "utf8"),
        compress: true,
      },
    ]);

    const restoredRes = await bobAgent
      .post("/api/kits/import-backup")
      .attach("file", dupSeedZip, "dup-seed.toolbox-backup.zip")
      .expect(201);
    expect(restoredRes.body.kit.cardCount).toBe(3);
    expect(restoredRes.body.kit.drillCount).toBe(2);

    // 5c. Batch RAG upsert skips unchanged content hashes in a single pass and updates modified chunks
    const batchInputs = Array.from({ length: 12 }, (_, idx) => ({
      kitId: sourceKitId,
      kind: "source_chunk" as const,
      sourceRefId: `perf-batch-${idx}`,
      title: `Batch Chunk ${idx}`,
      content: `Deterministic batch content payload #${idx} for hybrid search verification.`,
    }));
    const firstUpsert = await upsertRagChunksBatch(db, aliceScope, batchInputs);
    expect(firstUpsert).toBe(12);
    const secondUpsertUnchanged = await upsertRagChunksBatch(db, aliceScope, batchInputs);
    expect(secondUpsertUnchanged).toBe(0);

    batchInputs[3] = {
      ...batchInputs[3]!,
      content: "Updated deterministic batch content payload #3 with fresh token.",
    };
    const thirdUpsertOneChanged = await upsertRagChunksBatch(db, aliceScope, batchInputs);
    expect(thirdUpsertOneChanged).toBe(1);

    // 5d. Verify SQLite EXPLAIN QUERY PLAN uses composite indexes on hot paths (zero full table scans)
    const explainDetails = (sql: string, ...params: unknown[]): string => {
      const planRows = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as Array<{
        detail: string;
      }>;
      return planRows.map((r) => r.detail).join(" | ");
    };

    expect(
      explainDetails(
        `SELECT * FROM flashcards
         WHERE ownerId = ? AND deck_id = ? AND state IN (1, 2, 3)
           AND (next_review IS NULL OR (next_review <= ? AND datetime(next_review) <= datetime(?)))`,
        aliceScope.ownerId,
        "deck-1",
        "2026-11-11T99:99:99Z",
        "2026-11-11T12:00:00Z",
      ),
    ).toContain("idx_flashcards_owner_deck_due");

    expect(
      explainDetails(
        `SELECT card_id FROM remediation_queue
         WHERE ownerId = ? AND kit_id = ? AND resolved_at IS NULL`,
        aliceScope.ownerId,
        sourceKitId,
      ),
    ).toContain("idx_remediation_owner_kit_open");

    expect(
      explainDetails(
        `SELECT id, name FROM chat_sessions
         WHERE ownerId = ? AND kit_id = ?
         ORDER BY updated_at DESC`,
        aliceScope.ownerId,
        sourceKitId,
      ),
    ).toContain("idx_chat_sessions_owner_kit_updated");

    expect(
      explainDetails(
        `SELECT * FROM drills
         WHERE ownerId = ? AND kit_id = ? AND node_id = ? AND difficulty <= ?`,
        aliceScope.ownerId,
        sourceKitId,
        "ownership",
        3,
      ),
    ).toContain("idx_drills_owner_kit_node_diff");
  });

  it("6. honors s/m/h/d FSRS step units, UTC-safe MCP retrievability, TZ-offset due bounds, and whitespace guide predicates", async () => {
    const { bobAgent, bobScope } = tenants;

    // 6a. Sub-minute ("s"), hour ("h"/"H"), day ("d"/"D") & comma-separated FSRS step parsing + scheduling
    expect(parseStepsMinutes("30s, 2H 1D", [1, 10])).toEqual([0.5, 120, 1440]);
    expect(parseStepsMinutes("15S 45s", [1, 10])).toEqual([0.25, 0.75]);
    expect(parseStepsMinutes("   ", [1, 10])).toEqual([1, 10]);

    const fixedNow = new Date("2026-11-11T12:00:00.000Z");
    const fixedNowMs = fixedNow.getTime();

    const againSubMin = calculateNextSrsState(
      { state: 0 },
      1,
      { steps: "30s 10m" },
      "medium",
      fixedNow,
    );
    expect(againSubMin.state).toBe(1);
    expect(Date.parse(againSubMin.next_review)).toBe(fixedNowMs + 30_000);

    const againSubMinHighConf = calculateNextSrsState(
      { state: 0 },
      1,
      { steps: "30s 10m" },
      "high",
      fixedNow,
    );
    expect(Date.parse(againSubMinHighConf.next_review)).toBe(fixedNowMs + 15_000);

    const hardMidpoint = calculateNextSrsState(
      { state: 0 },
      3,
      { steps: "30s 2H" },
      "medium",
      fixedNow,
    );
    expect(hardMidpoint.state).toBe(1);
    expect(Date.parse(hardMidpoint.next_review)).toBe(fixedNowMs + 60.25 * 60_000);

    const goodTwoHours = calculateNextSrsState(
      { state: 0 },
      4,
      { steps: "30s 2H" },
      "medium",
      fixedNow,
    );
    expect(goodTwoHours.state).toBe(1);
    expect(Date.parse(goodTwoHours.next_review)).toBe(fixedNowMs + 120 * 60_000);

    const againOneDay = calculateNextSrsState(
      { state: 0 },
      1,
      { steps: "1D" },
      "medium",
      fixedNow,
    );
    expect(againOneDay.state).toBe(1);
    expect(Date.parse(againOneDay.next_review)).toBe(fixedNowMs + 1440 * 60_000);

    const subMinPreviews = getCardPreviews({ state: 0 }, { steps: "30s 2H" }, fixedNow);
    expect(subMinPreviews.again).toBe("30s");
    expect(subMinPreviews.good).toBe("2h");

    // Default >=1m steps preserve exact minute intervals
    const defaultPreviews = getCardPreviews({ state: 0 }, { steps: "1m 10m" }, fixedNow);
    expect(defaultPreviews.again).toBe("1m");
    expect(defaultPreviews.good).toBe("10m");

    // 6b. MCP liveCardRetrievability UTC parity & corrupt-timestamp NaN guard
    const twoDaysAgoMs = Date.now() - 2 * 86_400_000;
    const twoDaysAgoIso = new Date(twoDaysAgoMs).toISOString().slice(0, 19) + "Z";
    const twoDaysAgoSqlite = twoDaysAgoIso.slice(0, 19).replace("T", " ");

    const rFromIso = liveCardRetrievability({
      state: 2,
      stability: 6.5,
      last_reviewed: twoDaysAgoIso,
    });
    const rFromSqlite = liveCardRetrievability({
      state: 2,
      stability: 6.5,
      last_reviewed: twoDaysAgoSqlite,
    });
    expect(Number.isFinite(rFromIso)).toBe(true);
    expect(rFromSqlite).toBe(rFromIso);

    const rCorrupt = liveCardRetrievability({
      state: 2,
      stability: 5.0,
      last_reviewed: "corrupt-last-reviewed",
      next_review: "corrupt-next-review",
    });
    expect(Number.isFinite(rCorrupt)).toBe(true);
    expect(rCorrupt).toBe(0.5);
    expect(liveCardRetrievability({ state: 0, stability: 5.0 })).toBe(0);

    // 6c. Due-queue B-tree upper bound handles second-precision "...Z" & positive/negative TZ offsets
    const tzSkel = makeKitSkeleton((s) => {
      s.identity.slug = "tz-whitespace-probe-kit";
      s.identity.name = "TZ & Whitespace Probe Kit";
    });
    const tzKitRes = await bobAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: tzSkel })
      .expect(201);
    const tzKitSlug = tzKitRes.body.kit.slug as string;

    const tzDeckRes = await bobAgent
      .post("/api/decks")
      .set("X-Toolbox-Kit", tzKitSlug)
      .send({ name: "TZ Offset Due Deck" })
      .expect(201);
    const tzDeckId = tzDeckRes.body.id as string;

    const makeBobCard = async (front: string) => {
      const r = await bobAgent
        .post(`/api/decks/${tzDeckId}/cards`)
        .send({ front, back: `Back: ${front}` })
        .expect(201);
      return r.body.id as string;
    };

    const formatWithOffset = (utcMs: number, offsetMinutes: number): string => {
      const shifted = new Date(utcMs + offsetMinutes * 60_000).toISOString().slice(0, 19);
      const sign = offsetMinutes >= 0 ? "+" : "-";
      const abs = Math.abs(offsetMinutes);
      const hh = String(Math.floor(abs / 60)).padStart(2, "0");
      const mm = String(abs % 60).padStart(2, "0");
      return `${shifted}${sign}${hh}:${mm}`;
    };

    const secPrecisionDueId = await makeBobCard("Second-Precision Z Overdue");
    const posOffset2hDueId = await makeBobCard("UTC+02:00 Overdue 15m Ago");
    const posOffset14hDueId = await makeBobCard("UTC+14:00 Overdue 5m Ago");
    const negOffsetFutureId = await makeBobCard("UTC-05:00 Future +30m");
    const posOffsetFutureId = await makeBobCard("UTC+02:00 Future +30m");

    const refNow = Date.now();
    const secPrecisionZ = new Date(refNow - 2_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const overduePlus2 = formatWithOffset(refNow - 15 * 60_000, 120);
    const overduePlus14 = formatWithOffset(refNow - 5 * 60_000, 14 * 60);
    const futureMinus5 = formatWithOffset(refNow + 30 * 60_000, -300);
    const futurePlus2 = formatWithOffset(refNow + 30 * 60_000, 120);

    for (const [cid, nextRev] of [
      [secPrecisionDueId, secPrecisionZ],
      [posOffset2hDueId, overduePlus2],
      [posOffset14hDueId, overduePlus14],
      [negOffsetFutureId, futureMinus5],
      [posOffsetFutureId, futurePlus2],
    ] as const) {
      db.prepare(
        "UPDATE flashcards SET state = 2, repetitions = 2, interval = 2, next_review = ? WHERE ownerId = ? AND id = ?",
      ).run(nextRev, bobScope.ownerId, cid);
    }

    for (const url of [
      `/api/decks/${tzDeckId}/cards/due`,
      `/api/decks/all/cards/due?kit=${encodeURIComponent(tzKitSlug)}`,
      `/api/srs/due?kit=${encodeURIComponent(tzKitSlug)}`,
    ]) {
      const dueRes = await bobAgent.get(url).expect(200);
      const ids = (dueRes.body as Array<{ id: string }>).map((c) => c.id);
      expect(ids).toContain(secPrecisionDueId);
      expect(ids).toContain(posOffset2hDueId);
      expect(ids).toContain(posOffset14hDueId);
      expect(ids).not.toContain(negOffsetFutureId);
      expect(ids).not.toContain(posOffsetFutureId);
    }

    // 6d. Multi-whitespace guide content ("\n\t\r") treated as empty across ownedCounts, search & graph
    const hooks = getOwnerDataHooks();
    const countsBefore = hooks.ownedCounts(bobScope.ownerId).guideSections;
    const totalItemsBefore = hooks.countItemsByOwner().get(bobScope.ownerId) ?? 0;

    await bobAgent
      .put("/api/guide-content/basics/borrowing/mechanics")
      .set("X-Toolbox-Kit", tzKitSlug)
      .send({ content: "   \n\t\r   " })
      .expect(200);

    expect(hooks.ownedCounts(bobScope.ownerId).guideSections).toBe(countsBefore);
    expect(hooks.countItemsByOwner().get(bobScope.ownerId) ?? 0).toBe(totalItemsBefore);

    const searchWsRes = await bobAgent
      .get("/api/search?q=borrowing")
      .set("X-Toolbox-Kit", tzKitSlug)
      .expect(200);
    expect(searchWsRes.body.guideContent).toEqual([]);

    const graphWsRes = await bobAgent
      .get("/api/graph")
      .set("X-Toolbox-Kit", tzKitSlug)
      .expect(200);
    const borrowingNode = (
      graphWsRes.body.nodes as Array<{ id: string; filledSections: number }>
    ).find((n) => n.id === "ownership");
    expect(borrowingNode?.filledSections ?? 0).toBe(0);
  });
});
