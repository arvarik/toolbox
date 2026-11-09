import zlib from "node:zlib";
import type { Express } from "express";
import request from "supertest";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import { scopeForOwnerId, type Scope } from "../platform/tenancy/scope.ts";

export interface TwoTenantsContext {
  aliceAgent: ReturnType<typeof request.agent>;
  bobAgent: ReturnType<typeof request.agent>;
  aliceId: string;
  bobId: string;
  aliceScope: Scope;
  bobScope: Scope;
}

export async function setupTwoTenants(
  app: Express,
  prefix = "test",
): Promise<TwoTenantsContext> {
  const aliceAgent = request.agent(app);
  const setupRes = await aliceAgent
    .post("/api/auth/setup")
    .send({
      email: `alice@${prefix}.test`,
      username: `alice_${prefix}`,
      displayName: "Alice Admin",
      password: "alice-strong-password-123",
    })
    .expect(201);
  const aliceId = setupRes.body.user.id as string;

  const invRes = await aliceAgent
    .post("/api/admin/invitations")
    .send({ email: `bob@${prefix}.test`, role: "member" })
    .expect(201);
  const token = new URL(invRes.body.link as string).searchParams.get("token")!;

  const bobAgent = request.agent(app);
  const bobRes = await bobAgent
    .post("/api/auth/accept-invitation")
    .send({
      token,
      email: `bob@${prefix}.test`,
      username: `bob_${prefix}`,
      displayName: "Bob Member",
      password: "bob-strong-password-123",
    })
    .expect(201);
  const bobId = bobRes.body.user.id as string;

  return {
    aliceAgent,
    bobAgent,
    aliceId,
    bobId,
    aliceScope: scopeForOwnerId(aliceId),
    bobScope: scopeForOwnerId(bobId),
  };
}

/** Builds a ZIP by hand, so a test can write header values that createZipArchive refuses to write. */
export function craftRawZip(opts: {
  entries: Array<{
    name: string;
    payload: Buffer;
    method?: number;
    flags?: number;
    crc?: number;
    compSizeOverride?: number;
    uncompSizeOverride?: number;
    externalAttrs?: number;
  }>;
  eocdTotalOverride?: number;
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

    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(flags, 6);
    lfh.writeUInt16LE(method, 8);
    lfh.writeUInt16LE(0x0021, 12);
    lfh.writeUInt32LE(crc, 14);
    lfh.writeUInt32LE(compSize, 18);
    lfh.writeUInt32LE(uncompSize, 22);
    lfh.writeUInt16LE(nameBuf.byteLength, 26);
    localParts.push(lfh, nameBuf, e.payload);

    const cdfh = Buffer.alloc(46);
    cdfh.writeUInt32LE(0x02014b50, 0);
    cdfh.writeUInt16LE(0x0314, 4);
    cdfh.writeUInt16LE(20, 6);
    cdfh.writeUInt16LE(flags, 8);
    cdfh.writeUInt16LE(method, 10);
    cdfh.writeUInt16LE(0x0021, 14);
    cdfh.writeUInt32LE(crc, 16);
    cdfh.writeUInt32LE(compSize, 20);
    cdfh.writeUInt32LE(uncompSize, 24);
    cdfh.writeUInt16LE(nameBuf.byteLength, 28);
    cdfh.writeUInt32LE((e.externalAttrs ?? (0o100644 << 16)) >>> 0, 38);
    cdfh.writeUInt32LE(offset, 42);
    cdParts.push(cdfh, nameBuf);
    offset += 30 + nameBuf.byteLength + e.payload.byteLength;
  }

  const cdBuf = Buffer.concat(cdParts);
  const totalCount = opts.eocdTotalOverride ?? opts.entries.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(totalCount, 8);
  eocd.writeUInt16LE(totalCount, 10);
  eocd.writeUInt32LE(cdBuf.byteLength, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, cdBuf, eocd]);
}

export function makeDefaultTutor(rolePrompt = "You are a Socratic domain tutor."): KitSkeletonV1["tutor"] {
  return {
    rolePrompt,
    personas: {
      socratic: { label: "Socratic", prompt: "Guide with probing questions." },
      eli5: { label: "ELI5", prompt: "Explain with simple physical analogies." },
      strict: { label: "Strict", prompt: "Demand exact invariants." },
      devil: { label: "Devil's Advocate", prompt: "Challenge edge cases." },
    },
    starterPrompts: ["Explain the core invariant."],
    cardExamples: [],
  };
}

export function makeKitSkeleton(
  mutate?: (skeleton: KitSkeletonV1) => void,
): KitSkeletonV1 {
  const skeleton: KitSkeletonV1 = {
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
      tags: ["rust", "systems"],
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
        topics: [{ id: "borrowing", name: "Borrow Checker" }],
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
      ],
      edges: [],
      tracks: [
        {
          id: "core-rust",
          name: "Core Rust Track",
          emoji: "🦀",
          description: "Master ownership",
          targets: ["ownership"],
        },
      ],
    },
    tutor: makeDefaultTutor("You are a principal Rust compiler engineer."),
    seeds: {
      drills: [],
      baselineGuideNotes: [],
    },
    bibliography: [],
  };
  mutate?.(skeleton);
  return skeleton;
}
