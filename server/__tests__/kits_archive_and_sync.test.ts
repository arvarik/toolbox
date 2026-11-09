// @vitest-environment node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { Express } from "express";
import { beforeAll, describe, expect, it } from "vitest";
import {
  verifyKitSkeleton,
  type KitSkeletonV1,
} from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import { createApp } from "../app.ts";
import db from "../db.ts";
import { kitUploadsDir } from "../kits/kitService.ts";
import {
  BadRequestError,
  createZipArchive,
  extractZipArchive,
} from "../platform/archive/zip.ts";
import { __resetAuthRateLimits } from "../platform/routes/authRoutes.ts";
import { craftRawZip, makeKitSkeleton, setupTwoTenants } from "./testHelpers.ts";

function buildRustKitV1(): KitSkeletonV1 {
  return makeKitSkeleton((s) => {
    s.pillars[0].topics.push({ id: "old-topic-id", name: "Legacy Lifetimes" });
    s.pillars.push({
      id: "legacy-pillar",
      number: 2,
      name: "Deprecated Async",
      shortName: "Legacy",
      color: "#64748b",
      topics: [{ id: "deprecated-topic", name: "Old Futures 0.1" }],
      sections: [
        { id: "overview", name: "Overview", icon: "box", promptHint: "Legacy", ownershipRule: "Overview" },
        { id: "notes", name: "Notes", icon: "layers", promptHint: "Notes", ownershipRule: "Notes" },
      ],
    });
    s.graph = {
      nodes: [
        s.graph.nodes[0],
        { id: "lifetimes", name: "Lifetimes", pillarId: "basics", topicId: "old-topic-id", summary: "Borrow regions", keywords: ["lifetime"], components: [] },
        { id: "ephemeral-node", name: "Temporary Node", pillarId: "legacy-pillar", topicId: "deprecated-topic", summary: "Removed in v2", keywords: ["legacy"], components: [] },
      ],
      edges: [{ from: "ownership", to: "lifetimes" }],
      tracks: [{ id: "core-rust", name: "Core Rust Track", emoji: "🦀", description: "Master ownership and lifetimes", targets: ["ownership", "lifetimes"] }],
    };
    s.seeds = {
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
          hints: ["Store usize indices.", "Keep nodes in Vec<Node>.", "Add generation counters."],
          workedSolution: "Use Vec<Node> + index handles.",
          rubricPoints: ["Avoids soundness bugs", "Explains drop order"],
        },
      ],
      baselineGuideNotes: [],
    };
  });
}

describe("KitSkeletonV1Schema & Pure node:zlib ZIP Archive Security Invariants", () => {
  it("verifies System Design Starter Kit and rejects cycles, self-loops, and dangling references", () => {
    const verified = verifyKitSkeleton(SYSTEM_DESIGN_KIT_SKELETON);
    expect(verified.identity.slug).toBe("system-design");
    expect(verified.pillars).toHaveLength(7);
    expect(verified.graph.nodes.length).toBeGreaterThanOrEqual(55);
    expect(verified.graph.tracks).toHaveLength(6);
    expect(verified.seeds.starterDeck?.cards).toHaveLength(15);

    const selfLoop = structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
    const firstId = selfLoop.graph.nodes[0]!.id;
    selfLoop.graph.edges.push({ from: firstId, to: firstId });
    expect(() => verifyKitSkeleton(selfLoop)).toThrow(/Self-loop/);

    const cyclic = structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
    const e0 = cyclic.graph.edges[0]!;
    cyclic.graph.edges.push({ from: e0.to, to: e0.from });
    expect(() => verifyKitSkeleton(cyclic)).toThrow(/Cycle detected/);

    const badNodeTopic = structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
    badNodeTopic.graph.nodes[0]!.topicId = "non-existent-topic";
    expect(() => verifyKitSkeleton(badNodeTopic)).toThrow(/unknown topic/);

    const badCardNode = structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
    badCardNode.seeds.starterDeck!.cards[0]!.nodeId = "ghost-node";
    expect(() => verifyKitSkeleton(badCardNode)).toThrow(/unknown node/);

    const badPrereqKey = structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
    badPrereqKey.seeds.starterDeck!.cards[0]!.prerequisiteKey = "missing-card";
    expect(() => verifyKitSkeleton(badPrereqKey)).toThrow(/unknown prerequisiteKey/);
  });

  it("round-trips stored/DEFLATE ZIP entries and enforces all 8 archive security invariants", async () => {
    const jsonBytes = Buffer.from(JSON.stringify({ hello: "world", repeat: "abc".repeat(400) }), "utf8");
    const pdfBytes = crypto.randomBytes(512);
    const archive = await createZipArchive([
      { name: "kit.json", data: jsonBytes },
      { name: "sources/paper.pdf", data: pdfBytes },
    ]);
    const extracted = await extractZipArchive(archive);
    expect(extracted.size).toBe(2);
    expect(extracted.get("kit.json")?.equals(jsonBytes)).toBe(true);
    expect(extracted.get("sources/paper.pdf")?.equals(pdfBytes)).toBe(true);

    // 1. Overlapping LFH byte ranges (Fifield shared-offset zip bomb)
    const payload = Buffer.from("shared-payload-bytes", "utf8");
    await expect(
      extractZipArchive(
        craftRawZip({
          entries: [
            { name: "kit1.txt", payload, compSizeOverride: payload.byteLength + 38 },
            { name: "kit2.txt", payload },
          ],
        }),
      ),
    ).rejects.toThrow(/overlap/i);

    // 2. Unix symbolic link entries (mode 0o120000)
    await expect(
      extractZipArchive(
        craftRawZip({
          entries: [{ name: "sources/evil-link", payload: Buffer.from("/etc/passwd"), externalAttrs: (0o120777 << 16) >>> 0 }],
        }),
      ),
    ).rejects.toThrow(/symbolic link/i);

    // 3. Path traversal, leading slashes, backslashes, directory entries
    for (const badName of ["../secret.txt", "sources/../../etc/passwd", "/absolute.json", "sources\\win.pdf", "sources/dir/"]) {
      await expect(extractZipArchive(craftRawZip({ entries: [{ name: badName, payload: Buffer.from("x") }] }))).rejects.toThrow(BadRequestError);
    }

    // 4. Strict path allowlist predicate
    const disallowed = await createZipArchive([
      { name: "kit.json", data: Buffer.from("{}") },
      { name: "unexpected/malware.sh", data: Buffer.from("echo nope") },
    ]);
    await expect(
      extractZipArchive(disallowed, {
        allowedPath: (p) => p === "kit.json" || p === "userdata.json" || /^sources\/[^/]+$/.test(p),
      }),
    ).rejects.toThrow(/disallowed/i);

    // 5. Duplicate canonical entry paths
    await expect(
      extractZipArchive(
        craftRawZip({
          entries: [
            { name: "kit.json", payload: Buffer.from("one") },
            { name: "kit.json", payload: Buffer.from("two") },
          ],
        }),
      ),
    ).rejects.toThrow(/duplicate/i);

    // 6. CRC-32 corruption check
    const validStored = await createZipArchive([{ name: "kit.json", data: Buffer.from("integrity-checked-data"), compress: false }]);
    const tampered = Buffer.from(validStored);
    tampered[30 + 8 + 2] ^= 0xff;
    await expect(extractZipArchive(tampered)).rejects.toThrow(/crc-32/i);

    // 7. Decompression bombs (honest header + lying header)
    const zeroes = Buffer.alloc(64 * 1024, 0);
    const compressed = zlib.deflateRawSync(zeroes);
    for (const uncompSizeOverride of [zeroes.byteLength, 100]) {
      const bomb = craftRawZip({
        entries: [
          {
            name: "kit.json",
            payload: compressed,
            method: 8,
            crc: zlib.crc32(zeroes) >>> 0,
            compSizeOverride: compressed.byteLength,
            uncompSizeOverride,
          },
        ],
      });
      await expect(extractZipArchive(bomb, { maxTotalUncompressedBytes: 4096 })).rejects.toThrow();
    }

    // 8. ZIP64 sentinels and encrypted bit flags
    await expect(
      extractZipArchive(craftRawZip({ entries: [{ name: "kit.json", payload: Buffer.from("{}") }], eocdTotalOverride: 0xffff })),
    ).rejects.toThrow(/zip64/i);
    await expect(
      extractZipArchive(craftRawZip({ entries: [{ name: "kit.json", payload: Buffer.from("{}"), uncompSizeOverride: 0xffffffff }] })),
    ).rejects.toThrow(/zip64/i);
    await expect(
      extractZipArchive(craftRawZip({ entries: [{ name: "kit.json", payload: Buffer.from("{}"), flags: 0x0800 | 0x0001 }] })),
    ).rejects.toThrow(/encrypt/i);
  });
});

describe("Personal Kits, Shared Library Fork/Sync, Mode 1 & Mode 2 Archive Round-Trips", () => {
  let app: Express;

  beforeAll(() => {
    __resetAuthRateLimits();
    app = createApp();
  });

  it("executes multi-tenant Kits CRUD, Shared Library publish/fork, zero-data-loss v2 sync, Mode 1 collisions, and Mode 2 two-tenant UUID remapping + binary source downloads", async () => {
    const { aliceAgent, bobAgent, aliceId, bobId } = await setupTwoTenants(app, "kits");

    const initialShared = await aliceAgent.get("/api/shared-kits").expect(200);
    expect(
      initialShared.body.kits.some((k: { slug: string; isOfficial: boolean }) => k.slug === "system-design" && k.isOfficial === true),
    ).toBe(true);

    const v1Skeleton = buildRustKitV1();
    const importV1Res = await aliceAgent.post("/api/kits/import-kit").send({ skeleton: v1Skeleton }).expect(201);
    const aliceKitId = importV1Res.body.kit.id as string;
    expect(importV1Res.body.kit).toMatchObject({ slug: "distributed-rust", cardCount: 2, drillCount: 1 });

    const patchRes = await aliceAgent
      .patch(`/api/kits/${aliceKitId}`)
      .send({ description: "Updated Rust distributed systems kit." })
      .expect(200);
    expect(patchRes.body.kit.description).toBe("Updated Rust distributed systems kit.");

    const pubV1Res = await aliceAgent.post(`/api/kits/${aliceKitId}/publish`).send({ changelog: "v1.0 initial curriculum" }).expect(201);
    expect(pubV1Res.body.sharedKit).toMatchObject({ slug: "distributed-rust", latestVersion: 1 });

    const bobForkRes = await bobAgent.post("/api/shared-kits/distributed-rust/fork").send({}).expect(201);
    const bobKitId = bobForkRes.body.kit.id as string;
    expect(bobForkRes.body.kit).toMatchObject({ forkedVersion: 1, cardCount: 2, drillCount: 1 });

    const sharedDetailV1 = await bobAgent.get("/api/shared-kits/distributed-rust").expect(200);
    expect(sharedDetailV1.body.sharedKit.downloadsCount).toBe(1);

    const bobCardsV1 = db
      .prepare("SELECT id, seed_key, prerequisite_id, node_id FROM flashcards WHERE ownerId = ?")
      .all(bobId) as Array<{ id: string; seed_key: string | null; prerequisite_id: string | null; node_id: string | null }>;
    const bobCard1 = bobCardsV1.find((c) => c.seed_key === "rust-card-1")!;
    const bobCard2 = bobCardsV1.find((c) => c.seed_key === "rust-card-2")!;
    expect(bobCard1).toBeTruthy();
    expect(bobCard2.prerequisite_id).toBe(bobCard1.id);

    // Non-owner publish guard + suggested fork slug
    const bobBlockedPub = await bobAgent.post(`/api/kits/${bobKitId}/publish`).send({ changelog: "Hijack attempt" }).expect(403);
    expect(bobBlockedPub.body.error.code).toBe("SHARED_KIT_NOT_OWNER");
    expect(bobBlockedPub.body.error.details.suggestedSlug).toBe("distributed-rust-bob-kits");

    const bobForkPub = await bobAgent
      .post(`/api/kits/${bobKitId}/publish`)
      .send({ slug: bobBlockedPub.body.error.details.suggestedSlug, changelog: "Bob community edition" })
      .expect(201);
    expect(bobForkPub.body.sharedKit.slug).toBe(bobBlockedPub.body.error.details.suggestedSlug);

    // Re-link Bob's kit back to Alice's upstream to test upstream v2 sync
    db.prepare("UPDATE kits SET forked_from_shared_id = ?, forked_version = 1 WHERE ownerId = ? AND id = ?").run(
      pubV1Res.body.sharedKit.id,
      bobId,
      bobKitId,
    );

    const bobDecksRes = await bobAgent.get("/api/decks").set("X-Toolbox-Kit", "distributed-rust").expect(200);
    const bobDeckId = bobDecksRes.body[0].id as string;

    await bobAgent.put(`/api/decks/${bobDeckId}/cards/${bobCard1.id}/review`).set("X-Toolbox-Kit", "distributed-rust").send({ quality: 5 }).expect(200);
    await bobAgent
      .put(`/api/decks/${bobDeckId}/cards/${bobCard1.id}`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ front: "What happens on assignment of a non-Copy value in Rust?", back: "Bob's custom annotated move-semantics answer!" })
      .expect(200);

    const bobCustomAliasCard = await bobAgent
      .post(`/api/decks/${bobDeckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ front: "Bob custom lifetime question", back: "Variance rules", node_id: "lifetimes" })
      .expect(201);
    const bobCustomOrphanCard = await bobAgent
      .post(`/api/decks/${bobDeckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ front: "Bob custom ephemeral question", back: "Old futures", node_id: "ephemeral-node" })
      .expect(201);

    for (const [pathKey, content] of [
      ["basics/borrowing/mechanics", "Bob borrowing mechanics note"],
      ["basics/old-topic-id/mechanics", "Bob note on old-topic-id that should migrate"],
      ["legacy-pillar/deprecated-topic/overview", "Bob precious note on retired Futures 0.1 topic"],
    ] as const) {
      await bobAgent.put(`/api/guide-content/${pathKey}`).set("X-Toolbox-Kit", "distributed-rust").send({ content }).expect(200);
    }

    const bobDrill1 = db
      .prepare("SELECT id FROM drills WHERE ownerId = ? AND kit_id = ? AND seed_key = ?")
      .get(bobId, bobKitId, "rust-drill-1") as { id: string };
    const bobAttemptId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO drill_attempts (id, ownerId, drill_id, submission, score, feedback_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(bobAttemptId, bobId, bobDrill1.id, "Used generational arena indices", 95, '{"strengths":["Soundness"]}');

    // Alice upgrades distributed-rust to v2 and publishes
    const v2Skeleton: KitSkeletonV1 = {
      ...v1Skeleton,
      identity: { ...v1Skeleton.identity, version: 2 },
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
          { id: "region-lifetimes", name: "Non-Lexical Lifetimes", pillarId: "basics", topicId: "new-topic-id", summary: "CFG borrow regions", keywords: ["nll"], components: [] },
        ],
        edges: [{ from: "ownership", to: "region-lifetimes" }],
        tracks: [{ id: "core-rust", name: "Core Rust Track", emoji: "🦀", description: "Master ownership and NLL", targets: ["ownership", "region-lifetimes"] }],
      },
      migrations: {
        nodeAliases: { lifetimes: "region-lifetimes" },
        topicAliases: { "old-topic-id": "new-topic-id" },
      },
      seeds: {
        starterDeck: {
          name: "Rust Core Deck",
          description: "Foundational Rust cards v2",
          cards: [
            { key: "rust-card-1", front: "UPSTREAM V2 CHANGED FRONT", back: "UPSTREAM V2 CHANGED BACK", nodeId: "ownership" },
            { ...v1Skeleton.seeds.starterDeck!.cards[1], nodeId: "region-lifetimes" },
            { key: "rust-card-3", front: "What is NLL?", back: "Borrows end at last use in MIR CFG.", nodeId: "region-lifetimes", prerequisiteKey: "rust-card-1" },
          ],
        },
        drills: [
          v1Skeleton.seeds.drills[0],
          {
            key: "rust-drill-2",
            nodeId: "region-lifetimes",
            difficulty: 3,
            prompt: "Prove why &'a mut T is invariant over T.",
            hints: ["Swap short-lived reference.", "Helper fn overwrite.", "Observe &'static vs &'short."],
            workedSolution: "Variance prevents dangling pointer writes.",
            rubricPoints: ["Demonstrates dangling reference"],
          },
        ],
        baselineGuideNotes: [],
      },
    };

    await aliceAgent.post(`/api/kits/${aliceKitId}/sync`).send({ skeleton: v2Skeleton }).expect(200);
    const pubV2Res = await aliceAgent.post(`/api/kits/${aliceKitId}/publish`).send({ changelog: "v2.0 NLL migration" }).expect(201);
    expect(pubV2Res.body.sharedKit.latestVersion).toBe(2);

    const bobListBeforeSync = await bobAgent.get("/api/kits").expect(200);
    expect(bobListBeforeSync.body.kits.find((k: { id: string }) => k.id === bobKitId)).toMatchObject({
      hasUpstreamUpdate: true,
      upstreamLatestVersion: 2,
    });

    const syncRes = await bobAgent.post(`/api/kits/${bobKitId}/sync-upstream`).expect(200);
    expect(syncRes.body).toMatchObject({
      addedCards: 1,
      addedDrills: 1,
      clearedOrphanNodeCards: 1,
      remappedGuideNotes: 1,
      archivedNotesCount: 1,
    });
    expect(syncRes.body.remappedCards).toBeGreaterThanOrEqual(1);

    const bobCard1After = db
      .prepare("SELECT back, repetitions, interval FROM flashcards WHERE ownerId = ? AND id = ?")
      .get(bobId, bobCard1.id) as { back: string; repetitions: number; interval: number };
    expect(bobCard1After.back).toBe("Bob's custom annotated move-semantics answer!");
    expect(bobCard1After.repetitions).toBeGreaterThanOrEqual(1);
    expect(bobCard1After.interval).toBeGreaterThanOrEqual(1);

    expect(
      (db.prepare("SELECT node_id FROM flashcards WHERE ownerId = ? AND id = ?").get(bobId, bobCustomAliasCard.body.id) as { node_id: string | null }).node_id,
    ).toBe("region-lifetimes");
    expect(
      (db.prepare("SELECT node_id FROM flashcards WHERE ownerId = ? AND id = ?").get(bobId, bobCustomOrphanCard.body.id) as { node_id: string | null }).node_id,
    ).toBeNull();
    expect(
      (db.prepare("SELECT score FROM drill_attempts WHERE ownerId = ? AND id = ?").get(bobId, bobAttemptId) as { score: number } | undefined)?.score,
    ).toBe(95);

    const migratedNote = await bobAgent.get("/api/guide-content/basics/new-topic-id").set("X-Toolbox-Kit", "distributed-rust").expect(200);
    expect(migratedNote.body.mechanics.content).toBe("Bob note on old-topic-id that should migrate");

    const archivedRes = await bobAgent.get(`/api/kits/${bobKitId}/archived-notes`).expect(200);
    expect(archivedRes.body.notes).toHaveLength(1);
    expect(archivedRes.body.notes[0].content).toBe("Bob precious note on retired Futures 0.1 topic");

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
    expect((await bobAgent.get(`/api/kits/${bobKitId}/archived-notes`).expect(200)).body.notes).toHaveLength(0);
    expect(
      (await bobAgent.get("/api/guide-content/basics/borrowing").set("X-Toolbox-Kit", "distributed-rust").expect(200)).body.pitfalls.content,
    ).toContain("Bob precious note on retired Futures 0.1 topic");

    // Mode 1 export + 4 collision policies
    const exportedCleanJson = JSON.parse(
      (await bobAgent.get(`/api/kits/${bobKitId}/export?mode=kit&includeGuideNotes=false`).expect(200)).text,
    ) as KitSkeletonV1;
    expect(exportedCleanJson.seeds.baselineGuideNotes).toHaveLength(0);

    const exportedWithNotesJson = JSON.parse(
      (await bobAgent.get(`/api/kits/${bobKitId}/export?mode=kit&includeGuideNotes=true`).expect(200)).text,
    ) as KitSkeletonV1;
    expect(exportedWithNotesJson.seeds.baselineGuideNotes.length).toBeGreaterThanOrEqual(3);

    const conflictRes = await bobAgent.post("/api/kits/import-kit").send({ skeleton: exportedCleanJson, onCollision: "error" }).expect(409);
    expect(conflictRes.body.error.code).toBe("KIT_SLUG_CONFLICT");

    const copyRes = await bobAgent.post("/api/kits/import-kit").send({ skeleton: exportedWithNotesJson, onCollision: "copy" }).expect(201);
    expect(copyRes.body).toMatchObject({ mode: "copied", kit: { slug: "distributed-rust-2" } });
    expect(copyRes.body.kit.guideFilledCount).toBeGreaterThanOrEqual(3);

    const updateModeRes = await bobAgent.post("/api/kits/import-kit").send({ skeleton: exportedCleanJson, onCollision: "update" }).expect(200);
    expect(updateModeRes.body).toMatchObject({ mode: "updated", kit: { id: bobKitId } });

    const replaceModeRes = await bobAgent
      .post("/api/kits/import-kit")
      .send({ skeleton: { ...exportedCleanJson, identity: { ...exportedCleanJson.identity, slug: "distributed-rust-2" } }, onCollision: "replace" })
      .expect(200);
    expect(replaceModeRes.body.mode).toBe("replaced");
    expect(replaceModeRes.body.kit.id).not.toBe(copyRes.body.kit.id);

    // Mode 2 `.toolbox-backup.zip` + Two-Tenant (Alice -> Bob) UUID Remapping + Binary Sources
    const aliceDeckRow = db.prepare("SELECT id FROM decks WHERE ownerId = ? AND kit_id = ?").get(aliceId, aliceKitId) as { id: string };
    const aliceCards = db
      .prepare("SELECT id, seed_key FROM flashcards WHERE ownerId = ? AND deck_id = ?")
      .all(aliceId, aliceDeckRow.id) as Array<{ id: string; seed_key: string | null }>;
    const alicePrereqCardId = aliceCards.find((c) => c.seed_key === "rust-card-1")!.id;
    const aliceDepCardId = aliceCards.find((c) => c.seed_key === "rust-card-2")!.id;

    db.prepare(
      "UPDATE flashcards SET stability = 18.75, difficulty = 3.85, repetitions = 7, lapses = 2, state = 2, learning_step = 1 WHERE ownerId = ? AND id = ?",
    ).run(aliceId, alicePrereqCardId);

    const aliceReverseCardId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO flashcards (id, ownerId, deck_id, node_id, front, back, is_reverse, reverse_of_id, stability, difficulty) VALUES (?, ?, ?, 'ownership', 'Reverse front', 'Reverse back', 1, ?, 9.25, 4.5)",
    ).run(aliceReverseCardId, aliceId, aliceDeckRow.id, alicePrereqCardId);

    db.prepare(
      "INSERT INTO remediation_queue (ownerId, kit_id, card_id, source_card_id, node_id, node_name, reason) VALUES (?, ?, ?, ?, 'ownership', 'Move Semantics', 'Failed dependent borrow card')",
    ).run(aliceId, aliceKitId, alicePrereqCardId, aliceDepCardId);

    const aliceDrillRow = db.prepare("SELECT id FROM drills WHERE ownerId = ? AND kit_id = ? LIMIT 1").get(aliceId, aliceKitId) as { id: string };
    const aliceAttemptId = crypto.randomUUID();
    db.prepare(
      "INSERT INTO drill_attempts (id, ownerId, drill_id, submission, score, feedback_json) VALUES (?, ?, ?, 'Alice arena proof', 99, '{\"grade\":\"A+\"}')",
    ).run(aliceAttemptId, aliceId, aliceDrillRow.id);

    await aliceAgent.post("/api/boards").set("X-Toolbox-Kit", "distributed-rust").send({ name: "Alice Borrow Graph", data: { nodes: [{ id: "n1" }], edges: [] } }).expect(201);
    await aliceAgent
      .post("/api/chat/sessions")
      .set("X-Toolbox-Kit", "distributed-rust")
      .send({ session: { id: "alice-rust-session-1", name: "Pin & Unpin", messages: [{ role: "user", content: "Structural pinning" }] } })
      .expect(200);
    db.prepare("INSERT INTO episodic_memory (ownerId, kit_id, memory_text, importance_score) VALUES (?, ?, 'Prefers formal type derivations', 8)").run(aliceId, aliceKitId);

    const aliceSourceId = crypto.randomUUID();
    const binaryPdfContent = Buffer.concat([Buffer.from("%PDF-1.7\n", "utf8"), crypto.randomBytes(1024)]);
    const aliceUploadRoot = kitUploadsDir(aliceId, aliceKitId);
    fs.mkdirSync(aliceUploadRoot, { recursive: true });
    const relSourceFile = `${aliceSourceId}-rustonomicon.pdf`;
    fs.writeFileSync(path.join(aliceUploadRoot, relSourceFile), binaryPdfContent);

    db.prepare(
      "INSERT INTO kit_sources (id, ownerId, kit_id, kind, title, file_path, mime_type, size_bytes) VALUES (?, ?, ?, 'pdf', 'The Rustonomicon', ?, 'application/pdf', ?)",
    ).run(aliceSourceId, aliceId, aliceKitId, relSourceFile, binaryPdfContent.byteLength);

    const aliceChunkId = crypto.randomUUID();
    db.prepare("INSERT INTO kit_source_chunks (id, ownerId, kit_id, source_id, chunk_index, text) VALUES (?, ?, ?, ?, 0, 'Subtyping and Variance')").run(
      aliceChunkId,
      aliceId,
      aliceKitId,
      aliceSourceId,
    );

    const aliceDlRes = await aliceAgent.get(`/api/kits/${aliceKitId}/sources/${aliceSourceId}/file`).responseType("blob").expect(200);
    expect(aliceDlRes.headers["x-content-type-options"]).toBe("nosniff");
    expect(aliceDlRes.headers["content-disposition"]).toMatch(/^attachment;/);
    expect((aliceDlRes.body as Buffer).equals(binaryPdfContent)).toBe(true);

    await bobAgent.get(`/api/kits/${aliceKitId}/sources/${aliceSourceId}/file`).expect(404);

    const zipExportRes = await aliceAgent.get(`/api/kits/${aliceKitId}/export?mode=backup`).responseType("blob").expect(200);
    expect(zipExportRes.headers["content-type"]).toMatch(/application\/zip/);
    expect(zipExportRes.headers["x-content-type-options"]).toBe("nosniff");
    const zipBuffer = zipExportRes.body as Buffer;

    const bobZipImportRes = await bobAgent
      .post("/api/kits/import-backup")
      .field("onCollision", "copy")
      .attach("file", zipBuffer, "distributed-rust.toolbox-backup.zip")
      .expect(201);

    const bobRestoredKitId = bobZipImportRes.body.kit.id as string;
    expect(bobRestoredKitId).not.toBe(aliceKitId);
    expect(bobZipImportRes.body.kit.slug).toBe("distributed-rust-3");

    const bobRestoredDeck = db.prepare("SELECT id FROM decks WHERE ownerId = ? AND kit_id = ?").get(bobId, bobRestoredKitId) as { id: string };
    expect(bobRestoredDeck.id).not.toBe(aliceDeckRow.id);

    const bobRestoredCards = db
      .prepare("SELECT id, seed_key, prerequisite_id, is_reverse, reverse_of_id, stability, difficulty, repetitions, lapses FROM flashcards WHERE ownerId = ? AND deck_id = ?")
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
    expect(bobRestoredCards).toHaveLength(4);
    for (const c of bobRestoredCards) {
      expect([alicePrereqCardId, aliceDepCardId, aliceReverseCardId]).not.toContain(c.id);
    }

    const bobRestoredCard1 = bobRestoredCards.find((c) => c.seed_key === "rust-card-1")!;
    const bobRestoredCard2 = bobRestoredCards.find((c) => c.seed_key === "rust-card-2")!;
    const bobRestoredRev = bobRestoredCards.find((c) => c.is_reverse === 1)!;

    expect(bobRestoredCard1.stability).toBeCloseTo(18.75, 5);
    expect(bobRestoredCard1.difficulty).toBeCloseTo(3.85, 5);
    expect(bobRestoredCard1).toMatchObject({ repetitions: 7, lapses: 2 });
    expect(bobRestoredCard2.prerequisite_id).toBe(bobRestoredCard1.id);
    expect(bobRestoredRev.reverse_of_id).toBe(bobRestoredCard1.id);

    expect(
      db.prepare("SELECT card_id, source_card_id FROM remediation_queue WHERE ownerId = ? AND kit_id = ?").get(bobId, bobRestoredKitId),
    ).toEqual({ card_id: bobRestoredCard1.id, source_card_id: bobRestoredCard2.id });

    const bobRestoredAttempts = db
      .prepare(
        `SELECT da.id, da.drill_id, da.score
         FROM drill_attempts da
         JOIN drills d ON d.id = da.drill_id AND d.ownerId = da.ownerId
         WHERE da.ownerId = ? AND d.kit_id = ?`,
      )
      .all(bobId, bobRestoredKitId) as Array<{ id: string; drill_id: string; score: number }>;
    expect(bobRestoredAttempts).toHaveLength(1);
    expect(bobRestoredAttempts[0].id).not.toBe(aliceAttemptId);
    expect(bobRestoredAttempts[0].drill_id).not.toBe(aliceDrillRow.id);
    expect(bobRestoredAttempts[0].score).toBe(99);

    const bobRestoredSource = db
      .prepare("SELECT id, title FROM kit_sources WHERE ownerId = ? AND kit_id = ?")
      .get(bobId, bobRestoredKitId) as { id: string; title: string };
    expect(bobRestoredSource.id).not.toBe(aliceSourceId);
    expect(bobRestoredSource.title).toBe("The Rustonomicon");

    const bobRestoredChunk = db
      .prepare("SELECT id, source_id, text FROM kit_source_chunks WHERE ownerId = ? AND kit_id = ?")
      .get(bobId, bobRestoredKitId) as { id: string; source_id: string; text: string };
    expect(bobRestoredChunk.id).not.toBe(aliceChunkId);
    expect(bobRestoredChunk.source_id).toBe(bobRestoredSource.id);

    const bobDlRes = await bobAgent.get(`/api/kits/${bobRestoredKitId}/sources/${bobRestoredSource.id}/file`).responseType("blob").expect(200);
    expect(bobDlRes.headers["x-content-type-options"]).toBe("nosniff");
    expect((bobDlRes.body as Buffer).equals(binaryPdfContent)).toBe(true);

    const bobRestoredUploadDir = kitUploadsDir(bobId, bobRestoredKitId);
    expect(fs.existsSync(bobRestoredUploadDir)).toBe(true);
    await bobAgent.delete(`/api/kits/${bobRestoredKitId}`).expect(200);
    expect(fs.existsSync(bobRestoredUploadDir)).toBe(false);
  });
});
