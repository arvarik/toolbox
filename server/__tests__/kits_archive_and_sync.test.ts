// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { createApp } from "../app.ts";
import db from "../db.ts";
import { kitUploadsDir } from "../kits/kitService.ts";
import {
  BadRequestError,
  createZipArchive,
  extractZipArchive,
} from "../platform/archive/zip.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";

/**
 * Helper to craft a raw single-entry or multi-entry ZIP buffer with arbitrary
 * Central Directory / Local File Header mutations for adversarial security tests.
 */
function craftRawZip(opts: {
  entries: Array<{
    name: string;
    payload: Buffer;
    method?: number;
    flags?: number;
    crc?: number;
    compSizeOverride?: number;
    uncompSizeOverride?: number;
    externalAttrs?: number;
    localOffsetOverride?: number;
  }>;
  eocdTotalOverride?: number;
  eocdCdOffsetOverride?: number;
}): Buffer {
  const localParts: Buffer[] = [];
  const cdParts: Buffer[] = [];
  let offset = 0;

  for (const e of opts.entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const method = e.method ?? 0;
    const flags = e.flags ?? 0x0800;
    const crc = e.crc ?? zlib.crc32(e.payload) >>> 0;
    const compSize = e.compSizeOverride ?? e.payload.byteLength;
    const uncompSize = e.uncompSizeOverride ?? e.payload.byteLength;
    const localOffset = e.localOffsetOverride ?? offset;

    if (e.localOffsetOverride === undefined) {
      const lfh = Buffer.alloc(30);
      lfh.writeUInt32LE(0x04034b50, 0);
      lfh.writeUInt16LE(20, 4);
      lfh.writeUInt16LE(flags, 6);
      lfh.writeUInt16LE(method, 8);
      lfh.writeUInt16LE(0, 10);
      lfh.writeUInt16LE(0x0021, 12);
      lfh.writeUInt32LE(crc, 14);
      lfh.writeUInt32LE(compSize, 18);
      lfh.writeUInt32LE(uncompSize, 22);
      lfh.writeUInt16LE(nameBuf.byteLength, 26);
      lfh.writeUInt16LE(0, 28);
      localParts.push(lfh, nameBuf, e.payload);
      offset += 30 + nameBuf.byteLength + e.payload.byteLength;
    }

    const cdfh = Buffer.alloc(46);
    cdfh.writeUInt32LE(0x02014b50, 0);
    cdfh.writeUInt16LE(0x0314, 4);
    cdfh.writeUInt16LE(20, 6);
    cdfh.writeUInt16LE(flags, 8);
    cdfh.writeUInt16LE(method, 10);
    cdfh.writeUInt16LE(0, 12);
    cdfh.writeUInt16LE(0x0021, 14);
    cdfh.writeUInt32LE(crc, 16);
    cdfh.writeUInt32LE(compSize, 20);
    cdfh.writeUInt32LE(uncompSize, 24);
    cdfh.writeUInt16LE(nameBuf.byteLength, 28);
    cdfh.writeUInt16LE(0, 30);
    cdfh.writeUInt16LE(0, 32);
    cdfh.writeUInt16LE(0, 34);
    cdfh.writeUInt16LE(0, 36);
    cdfh.writeUInt32LE((e.externalAttrs ?? (0o100644 << 16)) >>> 0, 38);
    cdfh.writeUInt32LE(localOffset, 42);
    cdParts.push(cdfh, nameBuf);
  }

  const cdBuf = Buffer.concat(cdParts);
  const totalCount = opts.eocdTotalOverride ?? opts.entries.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(totalCount, 8);
  eocd.writeUInt16LE(totalCount, 10);
  eocd.writeUInt32LE(cdBuf.byteLength, 12);
  eocd.writeUInt32LE(opts.eocdCdOffsetOverride ?? offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

function buildRustKitV1(): KitSkeletonV1 {
  return {
    format: "toolbox-kit",
    schemaVersion: 1,
    exportedAt: "2026-04-08T12:00:00.000Z",
    identity: {
      slug: "distributed-rust",
      name: "Distributed Rust",
      description: "Systems programming and async consensus in Rust.",
      icon: "🦀",
      color: "#f97316",
      version: 1,
      tags: ["rust", "systems", "consensus"],
    },
    capabilities: {
      canvas: "concept",
      calculator: false,
      webResearchDefault: false,
      enableSvgDiagrams: true,
    },
    pillars: [
      {
        id: "basics",
        number: 1,
        name: "Ownership & Borrowing",
        shortName: "Ownership",
        color: "#f97316",
        topics: [
          { id: "borrowing", name: "Borrow Checker" },
          { id: "old-topic-id", name: "Legacy Lifetimes" },
        ],
        sections: [
          {
            id: "mechanics",
            name: "Core Mechanics",
            icon: "cpu",
            promptHint: "Compiler rules and memory model",
            ownershipRule: "Ownership and borrow mechanics",
          },
          {
            id: "pitfalls",
            name: "Common Pitfalls",
            icon: "alert-triangle",
            promptHint: "Aliasing and lifetime traps",
            ownershipRule: "Edge cases and soundness hazards",
          },
        ],
      },
      {
        id: "legacy-pillar",
        number: 2,
        name: "Deprecated Async",
        shortName: "Legacy",
        color: "#64748b",
        topics: [{ id: "deprecated-topic", name: "Old Futures 0.1" }],
        sections: [
          {
            id: "overview",
            name: "Overview",
            icon: "box",
            promptHint: "Legacy overview",
            ownershipRule: "Overview",
          },
          {
            id: "notes",
            name: "Notes",
            icon: "layers",
            promptHint: "Legacy notes",
            ownershipRule: "Notes",
          },
        ],
      },
    ],
    graph: {
      nodes: [
        {
          id: "ownership",
          name: "Move Semantics",
          pillarId: "basics",
          topicId: "borrowing",
          summary: "Single-owner deterministic drop",
          keywords: ["move", "drop"],
          components: [],
        },
        {
          id: "lifetimes",
          name: "Lifetimes",
          pillarId: "basics",
          topicId: "old-topic-id",
          summary: "Borrow region constraints",
          keywords: ["lifetime", "borrow"],
          components: [],
        },
        {
          id: "ephemeral-node",
          name: "Temporary Node",
          pillarId: "legacy-pillar",
          topicId: "deprecated-topic",
          summary: "Will be removed in v2 without alias",
          keywords: ["legacy"],
          components: [],
        },
      ],
      edges: [{ from: "ownership", to: "lifetimes" }],
      tracks: [
        {
          id: "core-rust",
          name: "Core Rust Track",
          emoji: "🦀",
          description: "Master ownership and lifetimes",
          targets: ["ownership", "lifetimes"],
        },
      ],
    },
    tutor: {
      rolePrompt: "You are a principal Rust compiler engineer.",
      personas: {
        socratic: {
          label: "Socratic Tutor",
          prompt: "Guide with borrow-checker thought experiments.",
        },
        eli5: {
          label: "Explain Like I'm 5",
          prompt: "Explain ownership like lending physical books.",
        },
        strict: {
          label: "Strict",
          prompt: "Reject any hand-waving around unsafe blocks.",
        },
        devil: {
          label: "Devil's Advocate",
          prompt: "Challenge zero-cost claims with Pin and variance edge cases.",
        },
      },
      starterPrompts: ["Why does Pin<Box<T>> exist in async Rust?"],
      cardExamples: [],
    },
    seeds: {
      starterDeck: {
        name: "Rust Core Deck",
        description: "Foundational Rust cards",
        cards: [
          {
            key: "rust-card-1",
            front: "What happens on assignment of a non-Copy value in Rust?",
            back: "Ownership moves and the source binding becomes uninitialized.",
            nodeId: "ownership",
            pillarId: "basics",
            topicId: "borrowing",
            sectionId: "mechanics",
          },
          {
            key: "rust-card-2",
            front: "How many mutable references (&mut T) can coexist?",
            back: "Exactly one active &mut T with no aliasing &T.",
            nodeId: "lifetimes",
            prerequisiteKey: "rust-card-1",
            pillarId: "basics",
            topicId: "borrowing",
            sectionId: "mechanics",
          },
        ],
      },
      drills: [
        {
          key: "rust-drill-1",
          nodeId: "ownership",
          difficulty: 2,
          prompt: "Refactor a self-referential struct into arena indices.",
          hints: [
            "Store usize indices instead of raw borrows.",
            "Keep nodes in a contiguous Vec<Node>.",
            "Add generation counters to prevent ABA bugs.",
          ],
          workedSolution: "Use Vec<Node> + index handles.",
          rubricPoints: ["Avoids soundness bugs", "Explains drop order"],
        },
      ],
      baselineGuideNotes: [],
    },
    bibliography: [],
  };
}

describe("Pure node:zlib ZIP Archive Codec & All 8 Security Invariants", () => {
  it("round-trips stored (.pdf) and DEFLATE-compressed (.json) entries cleanly", async () => {
    const jsonBytes = Buffer.from(
      JSON.stringify({ hello: "world", repeat: "abc".repeat(400) }),
      "utf8",
    );
    const pdfBytes = crypto.randomBytes(512);

    const archive = await createZipArchive([
      { name: "kit.json", data: jsonBytes },
      { name: "sources/paper.pdf", data: pdfBytes },
    ]);

    const extracted = await extractZipArchive(archive);
    expect(extracted.size).toBe(2);
    expect(extracted.get("kit.json")?.equals(jsonBytes)).toBe(true);
    expect(extracted.get("sources/paper.pdf")?.equals(pdfBytes)).toBe(true);
  });

  it("1. rejects overlapping Local File Header byte ranges (shared-offset zip bomb)", async () => {
    const payload = Buffer.from("shared-payload-bytes", "utf8");
    // Fifield-style overlapping range: entry 0's declared compressed data spans across entry 1's LFH!
    const bomb = craftRawZip({
      entries: [
        {
          name: "kit1.txt",
          payload,
          compSizeOverride: payload.byteLength + 38,
        },
        {
          name: "kit2.txt",
          payload,
        },
      ],
    });

    await expect(extractZipArchive(bomb)).rejects.toThrow(/overlap/i);
  });

  it("2. rejects Unix symbolic link entries (mode 0o120000)", async () => {
    const symlinkZip = craftRawZip({
      entries: [
        {
          name: "sources/evil-link",
          payload: Buffer.from("/etc/passwd", "utf8"),
          externalAttrs: (0o120777 << 16) >>> 0,
        },
      ],
    });

    await expect(extractZipArchive(symlinkZip)).rejects.toThrow(/symbolic link/i);
  });

  it("3. rejects path traversal (../), leading slashes, and backslashes", async () => {
    for (const badName of [
      "../secret.txt",
      "sources/../../etc/passwd",
      "/absolute.json",
      "sources\\win.pdf",
      "sources/dir/",
    ]) {
      const z = craftRawZip({
        entries: [{ name: badName, payload: Buffer.from("x") }],
      });
      await expect(extractZipArchive(z)).rejects.toThrow(BadRequestError);
    }
  });

  it("4. enforces strict path allowlist predicate", async () => {
    const archive = await createZipArchive([
      { name: "kit.json", data: Buffer.from("{}") },
      { name: "unexpected/malware.sh", data: Buffer.from("echo nope") },
    ]);

    await expect(
      extractZipArchive(archive, {
        allowedPath: (p) =>
          p === "kit.json" ||
          p === "userdata.json" ||
          /^sources\/[^/]+$/.test(p),
      }),
    ).rejects.toThrow(/disallowed/i);
  });

  it("5. rejects duplicate canonical entry paths in Central Directory", async () => {
    const p1 = Buffer.from("one");
    const p2 = Buffer.from("two");
    const dupZip = craftRawZip({
      entries: [
        { name: "kit.json", payload: p1 },
        { name: "kit.json", payload: p2 },
      ],
    });

    await expect(extractZipArchive(dupZip)).rejects.toThrow(/duplicate/i);
  });

  it("6. rejects corrupted payload bytes via CRC-32 verification", async () => {
    const valid = await createZipArchive([
      { name: "kit.json", data: Buffer.from("integrity-checked-data"), compress: false },
    ]);
    const tampered = Buffer.from(valid);
    // Flip a byte inside the stored payload right after 30-byte LFH + 8-byte filename
    tampered[30 + 8 + 2] ^= 0xff;

    await expect(extractZipArchive(tampered)).rejects.toThrow(/crc-32/i);
  });

  it("7. aborts decompression bombs exceeding maxTotalUncompressedBytes or maxEntryBytes", async () => {
    const zeroes = Buffer.alloc(64 * 1024, 0);
    const compressed = zlib.deflateRawSync(zeroes);
    const bomb = craftRawZip({
      entries: [
        {
          name: "kit.json",
          payload: compressed,
          method: 8,
          crc: zlib.crc32(zeroes) >>> 0,
          compSizeOverride: compressed.byteLength,
          uncompSizeOverride: zeroes.byteLength,
        },
      ],
    });

    await expect(
      extractZipArchive(bomb, { maxTotalUncompressedBytes: 4096 }),
    ).rejects.toThrow(/exceeds|limit/i);

    // Even if attacker lies in header (`uncompSizeOverride: 100`), zlib maxOutputLength aborts!
    const lyingBomb = craftRawZip({
      entries: [
        {
          name: "kit.json",
          payload: compressed,
          method: 8,
          crc: zlib.crc32(zeroes) >>> 0,
          compSizeOverride: compressed.byteLength,
          uncompSizeOverride: 100,
        },
      ],
    });
    await expect(
      extractZipArchive(lyingBomb, { maxTotalUncompressedBytes: 4096 }),
    ).rejects.toThrow();
  });

  it("8. rejects ZIP64 sentinel headers and encrypted ZIP bit flags", async () => {
    const zip64Eocd = craftRawZip({
      entries: [{ name: "kit.json", payload: Buffer.from("{}") }],
      eocdTotalOverride: 0xffff,
    });
    await expect(extractZipArchive(zip64Eocd)).rejects.toThrow(/zip64/i);

    const zip64Entry = craftRawZip({
      entries: [
        {
          name: "kit.json",
          payload: Buffer.from("{}"),
          uncompSizeOverride: 0xffffffff,
        },
      ],
    });
    await expect(extractZipArchive(zip64Entry)).rejects.toThrow(/zip64/i);

    const encryptedEntry = craftRawZip({
      entries: [
        {
          name: "kit.json",
          payload: Buffer.from("{}"),
          flags: 0x0800 | 0x0001,
        },
      ],
    });
    await expect(extractZipArchive(encryptedEntry)).rejects.toThrow(/encrypt/i);
  });
});

describe("Personal Kits, Shared Library Fork/Sync, Mode 1 & Mode 2 Archive Round-Trips", () => {
  let app: Express;

  beforeAll(() => {
    __resetAuthRateLimits();
    app = createApp();
  });

  it("executes multi-tenant Kits CRUD, Shared Library publish/fork, zero-data-loss v2 sync, Mode 1 collisions, and Mode 2 two-tenant UUID remapping + binary source downloads", async () => {
    // 1. Setup multi-tenant users: Admin Alice + Member Bob
    const aliceAgent = request.agent(app);
    const setupRes = await aliceAgent
      .post("/api/auth/setup")
      .send({
        email: "alice@kits.test",
        username: "alice",
        displayName: "Alice Architect",
        password: "alice-strong-password-123",
      })
      .expect(201);
    const aliceId = setupRes.body.user.id as string;

    const inviteRes = await aliceAgent
      .post("/api/admin/invitations")
      .send({ email: "bob@kits.test", role: "member" })
      .expect(201);
    const inviteToken = new URL(inviteRes.body.link as string).searchParams.get(
      "token",
    )!;

    const bobAgent = request.agent(app);
    const bobJoinRes = await bobAgent
      .post("/api/auth/accept-invitation")
      .send({
        token: inviteToken,
        email: "bob@kits.test",
        username: "bob",
        displayName: "Bob Builder",
        password: "bob-strong-password-123",
      })
      .expect(201);
    const bobId = bobJoinRes.body.user.id as string;

    // 2. Shared Library initially exposes Official System Design Kit
    const initialShared = await aliceAgent.get("/api/shared-kits").expect(200);
    expect(
      initialShared.body.kits.some(
        (k: { slug: string; isOfficial: boolean }) =>
          k.slug === "system-design" && k.isOfficial === true,
      ),
    ).toBe(true);

    // 3. Alice imports Distributed Rust v1 (Mode 1 JSON)
    const v1Skeleton = buildRustKitV1();
    const importV1Res = await aliceAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: v1Skeleton })
      .expect(201);
    const aliceKitId = importV1Res.body.kit.id as string;
    expect(importV1Res.body.kit.slug).toBe("distributed-rust");
    expect(importV1Res.body.kit.cardCount).toBe(2);
    expect(importV1Res.body.kit.drillCount).toBe(1);

    // Verify PATCH metadata works cleanly
    const patchRes = await aliceAgent
      .patch(`/api/kits/${aliceKitId}`)
      .send({ description: "Updated Rust distributed systems kit." })
      .expect(200);
    expect(patchRes.body.kit.description).toBe(
      "Updated Rust distributed systems kit.",
    );

    // 4. Alice publishes v1 to Shared Library
    const pubV1Res = await aliceAgent
      .post(`/api/kits/${aliceKitId}/publish`)
      .send({ changelog: "v1.0 initial curriculum" })
      .expect(201);
    expect(pubV1Res.body.sharedKit.slug).toBe("distributed-rust");
    expect(pubV1Res.body.sharedKit.latestVersion).toBe(1);

    // 5. Bob forks `distributed-rust` from Shared Library
    const bobForkRes = await bobAgent
      .post("/api/shared-kits/distributed-rust/fork")
      .send({})
      .expect(201);
    const bobKitId = bobForkRes.body.kit.id as string;
    expect(bobForkRes.body.kit.forkedVersion).toBe(1);
    expect(bobForkRes.body.kit.cardCount).toBe(2);
    expect(bobForkRes.body.kit.drillCount).toBe(1);

    // Downloads counter incremented
    const sharedDetailV1 = await bobAgent
      .get("/api/shared-kits/distributed-rust")
      .expect(200);
    expect(sharedDetailV1.body.sharedKit.downloadsCount).toBe(1);

    // Verify prerequisiteKey ("rust-card-1") resolved to real SQLite prerequisite_id in Bob's deck
    const bobCardsV1 = db
      .prepare(
        `SELECT id, seed_key, prerequisite_id, node_id
         FROM flashcards
         WHERE ownerId = ?`,
      )
      .all(bobId) as Array<{
      id: string;
      seed_key: string | null;
      prerequisite_id: string | null;
      node_id: string | null;
    }>;
    const bobCard1 = bobCardsV1.find((c) => c.seed_key === "rust-card-1")!;
    const bobCard2 = bobCardsV1.find((c) => c.seed_key === "rust-card-2")!;
    expect(bobCard1).toBeTruthy();
    expect(bobCard2.prerequisite_id).toBe(bobCard1.id);

    // 6. Non-owner publish guard: Bob cannot overwrite Alice's `distributed-rust` slug!
    const bobBlockedPub = await bobAgent
      .post(`/api/kits/${bobKitId}/publish`)
      .send({ changelog: "Hijack attempt" })
      .expect(403);
    expect(bobBlockedPub.body.error.code).toBe("SHARED_KIT_NOT_OWNER");
    expect(bobBlockedPub.body.error.details.suggestedSlug).toBe(
      "distributed-rust-bob",
    );

    // Bob CAN publish under his own suggested fork slug
    const bobForkPub = await bobAgent
      .post(`/api/kits/${bobKitId}/publish`)
      .send({
        slug: bobBlockedPub.body.error.details.suggestedSlug,
        changelog: "Bob's community edition",
      })
      .expect(201);
    expect(bobForkPub.body.sharedKit.slug).toBe("distributed-rust-bob");

    // Re-link Bob's kit back to Alice's upstream `distributed-rust` to test upstream v2 sync!
    const aliceSharedId = pubV1Res.body.sharedKit.id as string;
    db.prepare(
      "UPDATE kits SET forked_from_shared_id = ?, forked_version = 1 WHERE ownerId = ? AND id = ?",
    ).run(aliceSharedId, bobId, bobKitId);

    // 7. Bob studies & customizes his forked Kit before v2 lands:
    const bobDecksRes = await bobAgent
      .get("/api/decks")
      .set("X-Toolbox-Kit", "distributed-rust")
      .expect(200);
    const bobDeckId = bobDecksRes.body[0].id as string;

    // Review card 1 & customize its back text
    await bobAgent
      .put(`/api/decks/${bobDeckId}/cards/${bobCard1.id}/review`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ quality: 5 })
      .expect(200);
    await bobAgent
      .put(`/api/decks/${bobDeckId}/cards/${bobCard1.id}`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({
        front: "What happens on assignment of a non-Copy value in Rust?",
        back: "Bob's custom annotated move-semantics answer!",
      })
      .expect(200);

    // Bob creates two custom cards: one on `lifetimes` (to be aliased) and one on `ephemeral-node` (to be deleted)
    const bobCustomAliasCard = await bobAgent
      .post(`/api/decks/${bobDeckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({
        front: "Bob custom lifetime question",
        back: "Variance rules",
        node_id: "lifetimes",
      })
      .expect(201);
    const bobCustomOrphanCard = await bobAgent
      .post(`/api/decks/${bobDeckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({
        front: "Bob custom ephemeral question",
        back: "Old futures",
        node_id: "ephemeral-node",
      })
      .expect(201);

    // Bob writes Guide notes on:
    // (a) kept topic `basics/borrowing/mechanics`
    // (b) renamed topic `basics/old-topic-id/mechanics`
    // (c) deprecated topic `legacy-pillar/deprecated-topic/overview`
    await bobAgent
      .put("/api/guide-content/basics/borrowing/mechanics")
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ content: "Bob borrowing mechanics note" })
      .expect(200);
    await bobAgent
      .put("/api/guide-content/basics/old-topic-id/mechanics")
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ content: "Bob note on old-topic-id that should migrate" })
      .expect(200);
    await bobAgent
      .put("/api/guide-content/legacy-pillar/deprecated-topic/overview")
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ content: "Bob precious note on retired Futures 0.1 topic" })
      .expect(200);

    // Bob submits a drill attempt on `rust-drill-1`
    const bobDrill1 = db
      .prepare(
        "SELECT id FROM drills WHERE ownerId = ? AND kit_id = ? AND seed_key = ?",
      )
      .get(bobId, bobKitId, "rust-drill-1") as { id: string };
    const bobAttemptId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO drill_attempts (id, ownerId, drill_id, submission, score, feedback_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      bobAttemptId,
      bobId,
      bobDrill1.id,
      "Used generational arena indices",
      95,
      JSON.stringify({ strengths: ["Soundness"] }),
    );

    // 8. Alice upgrades `distributed-rust` to v2 and publishes!
    const v2Skeleton: KitSkeletonV1 = {
      ...v1Skeleton,
      identity: {
        ...v1Skeleton.identity,
        version: 2,
      },
      pillars: [
        {
          ...v1Skeleton.pillars[0],
          topics: [
            { id: "borrowing", name: "Borrow Checker" },
            { id: "new-topic-id", name: "Region Lifetimes & NLL" },
          ],
        },
      ],
      graph: {
        nodes: [
          v1Skeleton.graph.nodes[0],
          {
            id: "region-lifetimes",
            name: "Non-Lexical Lifetimes",
            pillarId: "basics",
            topicId: "new-topic-id",
            summary: "CFG-based borrow regions",
            keywords: ["nll", "mir"],
            components: [],
          },
        ],
        edges: [{ from: "ownership", to: "region-lifetimes" }],
        tracks: [
          {
            id: "core-rust",
            name: "Core Rust Track",
            emoji: "🦀",
            description: "Master ownership and NLL",
            targets: ["ownership", "region-lifetimes"],
          },
        ],
      },
      migrations: {
        nodeAliases: {
          lifetimes: "region-lifetimes",
        },
        topicAliases: {
          "old-topic-id": "new-topic-id",
        },
      },
      seeds: {
        starterDeck: {
          name: "Rust Core Deck",
          description: "Foundational Rust cards v2",
          cards: [
            {
              // Author changed upstream text of rust-card-1 — Bob's edited card MUST NOT be overwritten!
              key: "rust-card-1",
              front: "UPSTREAM V2 CHANGED FRONT",
              back: "UPSTREAM V2 CHANGED BACK",
              nodeId: "ownership",
            },
            {
              ...v1Skeleton.seeds.starterDeck!.cards[1],
              nodeId: "region-lifetimes",
            },
            {
              key: "rust-card-3",
              front: "What is Non-Lexical Lifetimes (NLL)?",
              back: "Borrows end at last use in the MIR control-flow graph.",
              nodeId: "region-lifetimes",
              prerequisiteKey: "rust-card-1",
            },
          ],
        },
        drills: [
          v1Skeleton.seeds.drills[0],
          {
            key: "rust-drill-2",
            nodeId: "region-lifetimes",
            difficulty: 3,
            prompt: "Prove why &'a mut T is invariant over T.",
            hints: [
              "Consider swapping a short-lived reference into T.",
              "Write a helper fn overwrite<'a, T>(x: &'a mut T, val: T).",
              "Observe what happens when T = &'static str vs &'short str.",
            ],
            workedSolution: "Variance prevents dangling pointer writes.",
            rubricPoints: ["Demonstrates dangling reference"],
          },
        ],
        baselineGuideNotes: [],
      },
    };

    await aliceAgent
      .post(`/api/kits/${aliceKitId}/sync`)
      .send({ skeleton: v2Skeleton })
      .expect(200);
    const pubV2Res = await aliceAgent
      .post(`/api/kits/${aliceKitId}/publish`)
      .send({ changelog: "v2.0 NLL migration and new drill" })
      .expect(201);
    expect(pubV2Res.body.sharedKit.latestVersion).toBe(2);

    // 9. Bob sees `hasUpstreamUpdate: true` and pulls v2 with zero data loss!
    const bobListBeforeSync = await bobAgent.get("/api/kits").expect(200);
    const bobSummaryBefore = bobListBeforeSync.body.kits.find(
      (k: { id: string }) => k.id === bobKitId,
    );
    expect(bobSummaryBefore.hasUpstreamUpdate).toBe(true);
    expect(bobSummaryBefore.upstreamLatestVersion).toBe(2);

    const syncRes = await bobAgent
      .post(`/api/kits/${bobKitId}/sync-upstream`)
      .expect(200);
    expect(syncRes.body.addedCards).toBe(1); // Only rust-card-3 added!
    expect(syncRes.body.addedDrills).toBe(1); // Only rust-drill-2 added!
    expect(syncRes.body.remappedCards).toBeGreaterThanOrEqual(1);
    expect(syncRes.body.clearedOrphanNodeCards).toBe(1);
    expect(syncRes.body.remappedGuideNotes).toBe(1);
    expect(syncRes.body.archivedNotesCount).toBe(1);

    // Verify Bob's card 1 preserved BOTH his custom back text AND his review state!
    const bobCard1After = db
      .prepare(
        "SELECT back, repetitions, interval FROM flashcards WHERE ownerId = ? AND id = ?",
      )
      .get(bobId, bobCard1.id) as {
      back: string;
      repetitions: number;
      interval: number;
    };
    expect(bobCard1After.back).toBe(
      "Bob's custom annotated move-semantics answer!",
    );
    expect(bobCard1After.repetitions).toBeGreaterThanOrEqual(1);
    expect(bobCard1After.interval).toBeGreaterThanOrEqual(1);

    // Verify nodeAliases remapped `lifetimes` -> `region-lifetimes` and cleared `ephemeral-node` -> NULL
    const aliasedRow = db
      .prepare("SELECT node_id FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(bobId, bobCustomAliasCard.body.id) as { node_id: string | null };
    expect(aliasedRow.node_id).toBe("region-lifetimes");

    const orphanRow = db
      .prepare("SELECT node_id FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(bobId, bobCustomOrphanCard.body.id) as { node_id: string | null };
    expect(orphanRow.node_id).toBeNull();

    // Verify Bob's drill_attempts survived 100% intact
    const attemptAfter = db
      .prepare("SELECT score FROM drill_attempts WHERE ownerId = ? AND id = ?")
      .get(bobId, bobAttemptId) as { score: number } | undefined;
    expect(attemptAfter?.score).toBe(95);

    // Verify topicAliases migrated `basics/old-topic-id/mechanics` -> `basics/new-topic-id/mechanics`
    const migratedNote = await bobAgent
      .get("/api/guide-content/basics/new-topic-id")
      .set("X-Toolbox-Kit", "distributed-rust")
      .expect(200);
    expect(migratedNote.body.mechanics.content).toBe(
      "Bob note on old-topic-id that should migrate",
    );

    // Verify deprecated topic note is preserved in Archived Notes, then re-filed!
    const archivedRes = await bobAgent
      .get(`/api/kits/${bobKitId}/archived-notes`)
      .expect(200);
    expect(archivedRes.body.notes).toHaveLength(1);
    expect(archivedRes.body.notes[0].content).toBe(
      "Bob precious note on retired Futures 0.1 topic",
    );

    await bobAgent
      .post(`/api/kits/${bobKitId}/archived-notes/refile`)
      .send({
        fromPillarId: "legacy-pillar",
        fromTopicId: "deprecated-topic",
        fromSectionId: "overview",
        toPillarId: "basics",
        toTopicId: "borrowing",
        toSectionId: "pitfalls",
      })
      .expect(200);

    const archivedAfterRefile = await bobAgent
      .get(`/api/kits/${bobKitId}/archived-notes`)
      .expect(200);
    expect(archivedAfterRefile.body.notes).toHaveLength(0);

    const refiledTarget = await bobAgent
      .get("/api/guide-content/basics/borrowing")
      .set("X-Toolbox-Kit", "distributed-rust")
      .expect(200);
    expect(refiledTarget.body.pitfalls.content).toContain(
      "Bob precious note on retired Futures 0.1 topic",
    );

    // 10. Mode 1 `.toolbox-kit.json` Export (`includeGuideNotes=false` vs `true`) + 4 Collision Policies
    const expCleanRes = await bobAgent
      .get(`/api/kits/${bobKitId}/export?mode=kit&includeGuideNotes=false`)
      .expect(200);
    const exportedCleanJson = JSON.parse(expCleanRes.text) as KitSkeletonV1;
    expect(exportedCleanJson.seeds.baselineGuideNotes).toHaveLength(0);

    const expWithNotesRes = await bobAgent
      .get(`/api/kits/${bobKitId}/export?mode=kit&includeGuideNotes=true`)
      .expect(200);
    const exportedWithNotesJson = JSON.parse(
      expWithNotesRes.text,
    ) as KitSkeletonV1;
    expect(exportedWithNotesJson.seeds.baselineGuideNotes.length).toBeGreaterThanOrEqual(
      3,
    );

    // Collision `error` -> 409 KIT_SLUG_CONFLICT
    const conflictRes = await bobAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: exportedCleanJson, onCollision: "error" })
      .expect(409);
    expect(conflictRes.body.error.code).toBe("KIT_SLUG_CONFLICT");

    // Collision `copy` -> 201 with `<slug>-2`
    const copyRes = await bobAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: exportedWithNotesJson, onCollision: "copy" })
      .expect(201);
    expect(copyRes.body.mode).toBe("copied");
    expect(copyRes.body.kit.slug).toBe("distributed-rust-2");
    expect(copyRes.body.kit.guideFilledCount).toBeGreaterThanOrEqual(3);

    // Collision `update` -> 200 preserving existing kit id
    const updateModeRes = await bobAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: exportedCleanJson, onCollision: "update" })
      .expect(200);
    expect(updateModeRes.body.mode).toBe("updated");
    expect(updateModeRes.body.kit.id).toBe(bobKitId);

    // Collision `replace` on `distributed-rust-2` -> 200 clean replacement
    const copySkeletonForReplace = {
      ...exportedCleanJson,
      identity: { ...exportedCleanJson.identity, slug: "distributed-rust-2" },
    };
    const replaceModeRes = await bobAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: copySkeletonForReplace, onCollision: "replace" })
      .expect(200);
    expect(replaceModeRes.body.mode).toBe("replaced");
    expect(replaceModeRes.body.kit.id).not.toBe(copyRes.body.kit.id);

    // 11. Mode 2 `.toolbox-backup.zip`: Full personal snapshot + Two-Tenant (Alice -> Bob) UUID Remapping + Binary Sources
    const aliceDeckRow = db
      .prepare("SELECT id FROM decks WHERE ownerId = ? AND kit_id = ?")
      .get(aliceId, aliceKitId) as { id: string };
    const aliceCards = db
      .prepare(
        "SELECT id, seed_key FROM flashcards WHERE ownerId = ? AND deck_id = ?",
      )
      .all(aliceId, aliceDeckRow.id) as Array<{
      id: string;
      seed_key: string | null;
    }>;
    const alicePrereqCardId = aliceCards.find(
      (c) => c.seed_key === "rust-card-1",
    )!.id;
    const aliceDepCardId = aliceCards.find(
      (c) => c.seed_key === "rust-card-2",
    )!.id;

    // Enrich Alice's cards with FSRS fields (`stability`, `difficulty`, `lapses`) + reverse card + remediation_queue
    db.prepare(
      `UPDATE flashcards
       SET stability = 18.75, difficulty = 3.85, repetitions = 7, lapses = 2, state = 2, learning_step = 1
       WHERE ownerId = ? AND id = ?`,
    ).run(aliceId, alicePrereqCardId);

    const aliceReverseCardId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO flashcards (id, ownerId, deck_id, node_id, front, back, is_reverse, reverse_of_id, stability, difficulty)
       VALUES (?, ?, ?, 'ownership', 'Reverse front', 'Reverse back', 1, ?, 9.25, 4.5)`,
    ).run(aliceReverseCardId, aliceId, aliceDeckRow.id, alicePrereqCardId);

    db.prepare(
      `INSERT INTO remediation_queue (ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason)
       VALUES (?, ?, ?, ?, 'ownership', 'Move Semantics', 'Failed dependent borrow card')`,
    ).run(aliceId, aliceKitId, alicePrereqCardId, aliceDepCardId);

    // Add drill attempt, board, chat session, episodic memory, and binary PDF source file to Alice's kit
    const aliceDrillRow = db
      .prepare("SELECT id FROM drills WHERE ownerId = ? AND kit_id = ? LIMIT 1")
      .get(aliceId, aliceKitId) as { id: string };
    const aliceAttemptId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO drill_attempts (id, ownerId, drill_id, submission, score, feedback_json)
       VALUES (?, ?, ?, 'Alice arena proof', 99, '{"grade":"A+"}')`,
    ).run(aliceAttemptId, aliceId, aliceDrillRow.id);

    await aliceAgent
      .post("/api/boards")
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ name: "Alice Borrow Graph", data: { nodes: [{ id: "n1" }], edges: [] } })
      .expect(201);

    await aliceAgent
      .post("/api/chat/sessions")
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({
        session: {
          id: "alice-rust-session-1",
          name: "Pin & Unpin Deep Dive",
          messages: [{ role: "user", content: "Explain structural pinning" }],
        },
      })
      .expect(200);

    db.prepare(
      `INSERT INTO episodic_memory (ownerId, kit_id, memory_text, importance_score)
       VALUES (?, ?, 'Prefers formal type-system derivations', 8)`,
    ).run(aliceId, aliceKitId);

    const aliceSourceId = crypto.randomUUID();
    const binaryPdfContent = Buffer.concat([
      Buffer.from("%PDF-1.7\n", "utf8"),
      crypto.randomBytes(1024),
    ]);
    const aliceUploadRoot = kitUploadsDir(aliceId, aliceKitId);
    fs.mkdirSync(aliceUploadRoot, { recursive: true });
    const relSourceFile = `${aliceSourceId}-rustonomicon.pdf`;
    fs.writeFileSync(path.join(aliceUploadRoot, relSourceFile), binaryPdfContent);

    db.prepare(
      `INSERT INTO kit_sources (id, ownerId, kit_id, kind, title, file_path, mime_type, size_bytes)
       VALUES (?, ?, ?, 'pdf', 'The Rustonomicon', ?, 'application/pdf', ?)`,
    ).run(
      aliceSourceId,
      aliceId,
      aliceKitId,
      relSourceFile,
      binaryPdfContent.byteLength,
    );

    const aliceChunkId = crypto.randomUUID();
    db.prepare(
      `INSERT INTO kit_source_chunks (id, ownerId, kit_id, source_id, chunk_index, text)
       VALUES (?, ?, ?, ?, 0, 'Subtyping and Variance in Rust')`,
    ).run(aliceChunkId, aliceId, aliceKitId, aliceSourceId);

    // Verify binary source download headers + cross-tenant 404 isolation
    const aliceDlRes = await aliceAgent
      .get(`/api/kits/${aliceKitId}/sources/${aliceSourceId}/file`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(aliceDlRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(aliceDlRes.headers["content-disposition"]).toMatch(/^attachment;/);
    expect((aliceDlRes.body as Buffer).equals(binaryPdfContent)).toBe(true);

    // Bob CANNOT download Alice's source file!
    await bobAgent
      .get(`/api/kits/${aliceKitId}/sources/${aliceSourceId}/file`)
      .expect(404);

    // Export Alice's Mode 2 `.toolbox-backup.zip`
    const zipExportRes = await aliceAgent
      .get(`/api/kits/${aliceKitId}/export?mode=backup`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(zipExportRes.headers["content-type"]).toMatch(/application\/zip/);
    expect(zipExportRes.headers["x-content-type-options"]).toBe("nosniff");
    const zipBuffer = zipExportRes.body as Buffer;
    expect(zipBuffer.byteLength).toBeGreaterThan(200);

    // Bob imports Alice's `.toolbox-backup.zip` on the SAME SQLite database (`onCollision=copy` since Bob has distributed-rust)
    const bobZipImportRes = await bobAgent
      .post("/api/kits/import-backup")
      .field("onCollision", "copy")
      .attach("file", zipBuffer, "distributed-rust.toolbox-backup.zip")
      .expect(201);

    const bobRestoredKitId = bobZipImportRes.body.kit.id as string;
    expect(bobRestoredKitId).not.toBe(aliceKitId);
    expect(bobZipImportRes.body.kit.slug).toBe("distributed-rust-3");

    // Verify 100% UUID remapping + relational integrity in Bob's restored backup!
    const bobRestoredDeck = db
      .prepare("SELECT id FROM decks WHERE ownerId = ? AND kit_id = ?")
      .get(bobId, bobRestoredKitId) as { id: string };
    expect(bobRestoredDeck.id).not.toBe(aliceDeckRow.id);

    const bobRestoredCards = db
      .prepare(
        `SELECT id, seed_key, prerequisite_id, is_reverse, reverse_of_id, stability, difficulty, repetitions, lapses
         FROM flashcards
         WHERE ownerId = ? AND deck_id = ?`,
      )
      .all(bobId, bobRestoredDeck.id) as Array<{
      id: string;
      seed_key: string | null;
      prerequisite_id: string | null;
      is_reverse: number;
      reverse_of_id: string | null;
      stability: number | null;
      difficulty: number | null;
      repetitions: number;
      lapses: number;
    }>;
    expect(bobRestoredCards.length).toBe(4); // 3 starter + 1 reverse card
    for (const c of bobRestoredCards) {
      expect(c.id).not.toBe(alicePrereqCardId);
      expect(c.id).not.toBe(aliceDepCardId);
      expect(c.id).not.toBe(aliceReverseCardId);
    }

    const bobRestoredCard1 = bobRestoredCards.find(
      (c) => c.seed_key === "rust-card-1",
    )!;
    const bobRestoredCard2 = bobRestoredCards.find(
      (c) => c.seed_key === "rust-card-2",
    )!;
    const bobRestoredRev = bobRestoredCards.find((c) => c.is_reverse === 1)!;

    // FSRS parameters preserved 100%!
    expect(bobRestoredCard1.stability).toBeCloseTo(18.75, 5);
    expect(bobRestoredCard1.difficulty).toBeCloseTo(3.85, 5);
    expect(bobRestoredCard1.repetitions).toBe(7);
    expect(bobRestoredCard1.lapses).toBe(2);

    // Self-referential FK edges remapped to Bob's new card UUIDs!
    expect(bobRestoredCard2.prerequisite_id).toBe(bobRestoredCard1.id);
    expect(bobRestoredRev.reverse_of_id).toBe(bobRestoredCard1.id);

    // Remediation queue remapped to Bob's new card UUIDs!
    const bobRemRow = db
      .prepare(
        "SELECT card_id, source_card_id FROM remediation_queue WHERE ownerId = ? AND kit_id = ?",
      )
      .get(bobId, bobRestoredKitId) as {
      card_id: string;
      source_card_id: string;
    };
    expect(bobRemRow.card_id).toBe(bobRestoredCard1.id);
    expect(bobRemRow.source_card_id).toBe(bobRestoredCard2.id);

    // Drills & drill_attempts remapped to Bob's new drill UUIDs!
    const bobRestoredAttempts = db
      .prepare(
        `SELECT da.id, da.drill_id, da.score
         FROM drill_attempts da
         JOIN drills d ON d.id = da.drill_id AND d.ownerId = da.ownerId
         WHERE da.ownerId = ? AND d.kit_id = ?`,
      )
      .all(bobId, bobRestoredKitId) as Array<{
      id: string;
      drill_id: string;
      score: number;
    }>;
    expect(bobRestoredAttempts).toHaveLength(1);
    expect(bobRestoredAttempts[0].id).not.toBe(aliceAttemptId);
    expect(bobRestoredAttempts[0].drill_id).not.toBe(aliceDrillRow.id);
    expect(bobRestoredAttempts[0].score).toBe(99);

    // Binary source & chunks remapped to Bob's isolated upload directory and downloadable!
    const bobRestoredSource = db
      .prepare(
        "SELECT id, title FROM kit_sources WHERE ownerId = ? AND kit_id = ?",
      )
      .get(bobId, bobRestoredKitId) as { id: string; title: string };
    expect(bobRestoredSource.id).not.toBe(aliceSourceId);
    expect(bobRestoredSource.title).toBe("The Rustonomicon");

    const bobRestoredChunk = db
      .prepare(
        "SELECT id, source_id, text FROM kit_source_chunks WHERE ownerId = ? AND kit_id = ?",
      )
      .get(bobId, bobRestoredKitId) as {
      id: string;
      source_id: string;
      text: string;
    };
    expect(bobRestoredChunk.id).not.toBe(aliceChunkId);
    expect(bobRestoredChunk.source_id).toBe(bobRestoredSource.id);

    const bobDlRes = await bobAgent
      .get(`/api/kits/${bobRestoredKitId}/sources/${bobRestoredSource.id}/file`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(bobDlRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(bobDlRes.headers["content-disposition"]).toMatch(/^attachment;/);
    expect((bobDlRes.body as Buffer).equals(binaryPdfContent)).toBe(true);

    // Delete Bob's copied kit and verify its on-disk upload directory is cleaned up!
    const bobRestoredUploadDir = kitUploadsDir(bobId, bobRestoredKitId);
    expect(fs.existsSync(bobRestoredUploadDir)).toBe(true);
    await bobAgent.delete(`/api/kits/${bobRestoredKitId}`).expect(200);
    expect(fs.existsSync(bobRestoredUploadDir)).toBe(false);
  });
});
