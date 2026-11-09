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
