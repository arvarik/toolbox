// @vitest-environment node
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Express } from "express";

const mockRunStructured = vi.fn();

vi.mock("../ai/engine.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ai/engine.ts")>();
  return {
    ...actual,
    runStructured: (...args: unknown[]) => mockRunStructured(...args),
  };
});

const {
  FSRS6_DEFAULT_WEIGHTS,
  bootstrapSm2Card,
  calculateNextSrsState,
  clampDesiredRetention,
  getCardPreviews,
  nextForgetStability,
  nextIntervalDays,
  retrievability,
} = await import("../srs/scheduler.ts");
const {
  EvaluationResultLlmSchema,
  enforceAntiSycophancy,
} = await import("../srs/antiSycophancy.ts");
const { cardStrength, computeGraphHealth } = await import("../graph/health.ts");
const { applyImplicitPrerequisiteCredit } = await import(
  "../graph/encompassing.ts"
);
const { default: db } = await import("../db.ts");
const { createApp } = await import("../app.ts");
const { __resetAuthRateLimits } = await import(
  "../platform/routes/authRoutes.ts"
);
const { scopeForOwnerId } = await import("../platform/tenancy/scope.ts");
const { ensureLocalOwner } = await import("../platform/db/connection.ts");
const { SYSTEM_DESIGN_KIT_SKELETON } = await import(
  "../../shared/kits/systemDesignKit.ts"
);

const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_MS = 60 * 1000;

describe("FSRS-6 Pure Math, Lazy SM-2 Bootstrap & State Transitions", () => {
  const NOW = new Date("2026-09-01T12:00:00.000Z");

  it("ships official 21-parameter FSRS-6 default weights and satisfies R(S, S) = 0.90 & I(S, 0.90) = round(S)", () => {
    expect(FSRS6_DEFAULT_WEIGHTS).toHaveLength(21);
    expect(FSRS6_DEFAULT_WEIGHTS[0]).toBe(0.212);
    expect(FSRS6_DEFAULT_WEIGHTS[20]).toBe(0.1542);

    for (const s of [1, 2.3065, 10, 21, 90, 180]) {
      expect(retrievability(s, s)).toBeCloseTo(0.9, 6);
    }
    expect(retrievability(0, 15)).toBe(1);

    for (const s of [2.3, 8.2956, 10, 21.4, 45.6]) {
      expect(nextIntervalDays(s, 0.9)).toBe(Math.round(s));
    }

    // Higher desired retention schedules shorter intervals; lower schedules longer
    expect(nextIntervalDays(20, 0.95)).toBeLessThan(nextIntervalDays(20, 0.9));
    expect(nextIntervalDays(20, 0.82)).toBeGreaterThan(
      nextIntervalDays(20, 0.9),
    );
    expect(clampDesiredRetention(0.5)).toBe(0.75);
    expect(clampDesiredRetention(0.999)).toBe(0.97);
  });

  it("maintains strict Easy > Good > Hard > Again ordering across New, Learning, Review, and Relearning states", () => {
    const sampleCards = [
      { state: 0, learning_step: 0 },
      { state: 1, learning_step: 0, stability: 2.3, difficulty: 5.0 },
      { state: 1, learning_step: 1, stability: 2.3, difficulty: 5.0 },
      {
        state: 2,
        stability: 12,
        difficulty: 5.0,
        interval: 12,
        repetitions: 3,
        last_reviewed: new Date(NOW.getTime() - 12 * DAY_MS).toISOString(),
      },
      {
        state: 3,
        learning_step: 0,
        stability: 3.5,
        difficulty: 6.5,
        lapses: 1,
      },
    ];

    for (const sample of sampleCards) {
      const again = calculateNextSrsState(sample, 1, null, "medium", NOW);
      const hard = calculateNextSrsState(sample, 3, null, "medium", NOW);
      const good = calculateNextSrsState(sample, 4, null, "medium", NOW);
      const easy = calculateNextSrsState(sample, 5, null, "medium", NOW);

      const tAgain = Date.parse(again.next_review);
      const tHard = Date.parse(hard.next_review);
      const tGood = Date.parse(good.next_review);
      const tEasy = Date.parse(easy.next_review);

      expect(tHard).toBeGreaterThan(tAgain);
      expect(tGood).toBeGreaterThan(tHard);
      expect(tEasy).toBeGreaterThan(tGood);
    }

    const previews = getCardPreviews({ state: 0 }, null, NOW);
    expect(previews.again).toBe("1m");
    expect(previews.good).toBe("10m");
    expect(previews.easy).toMatch(/d$/);
  });

  it("lazily bootstraps v1 SM-2 cards (stability=null, interval=10, ease_factor=2.5) and downgrades guessed confidence", () => {
    const legacySm2 = {
      state: 2,
      stability: null,
      difficulty: null,
      interval: 10,
      ease_factor: 2.5,
      repetitions: 4,
      lapses: 0,
      last_reviewed: new Date(NOW.getTime() - 10 * DAY_MS).toISOString(),
    };

    const bootstrapped = bootstrapSm2Card(legacySm2);
    expect(bootstrapped.stability).toBe(10);
    expect(bootstrapped.difficulty).toBeCloseTo(4.75, 5);

    const goodNext = calculateNextSrsState(legacySm2, 4, null, "medium", NOW);
    expect(goodNext.state).toBe(2);
    expect(goodNext.stability).toBeGreaterThan(10);
    expect(goodNext.interval).toBeGreaterThan(10);
    expect(goodNext.lapses).toBe(0);

    // Guessed confidence on Good downgrades to Hard
    const guessedNext = calculateNextSrsState(
      legacySm2,
      4,
      null,
      "guessed",
      NOW,
    );
    expect(guessedNext.stability).toBeLessThan(goodNext.stability);

    // Lapse on Again increments lapses and reduces post-lapse stability
    const lapsed = calculateNextSrsState(goodNext, 1, null, "medium", NOW);
    expect(lapsed.state).toBe(3);
    expect(lapsed.lapses).toBe(1);
    expect(lapsed.stability).toBeLessThan(goodNext.stability);
    expect(
      nextForgetStability(goodNext.difficulty, goodNext.stability, 0.9),
    ).toBeLessThan(goodNext.stability);
  });
});

describe("Continuous Retrievability in computeGraphHealth", () => {
  const NOW = new Date("2026-09-01T12:00:00.000Z");
  const nodes = [
    {
      id: "raft",
      name: "Raft Consensus",
      pillarId: "distributed",
      topicId: null,
      keywords: ["raft"],
      components: [],
      summary: "Leader election and log replication.",
    },
  ];

  it("decays node strength smoothly and continuously as elapsedDays increases", () => {
    const makeCardAtElapsed = (elapsedDays: number) => ({
      id: "c-raft",
      node_id: "raft",
      front: "Raft leader election",
      back: "Term + majority vote",
      state: 2,
      stability: 20,
      difficulty: 4.5,
      ease_factor: 2.6,
      interval: 20,
      last_reviewed: new Date(NOW.getTime() - elapsedDays * DAY_MS).toISOString(),
      next_review: new Date(
        NOW.getTime() + (20 - elapsedDays) * DAY_MS,
      ).toISOString(),
    });

    const h0 = computeGraphHealth([makeCardAtElapsed(0)], {
      now: NOW,
      nodes,
      edges: [],
    }).byNode.get("raft")!;
    const h10 = computeGraphHealth([makeCardAtElapsed(10)], {
      now: NOW,
      nodes,
      edges: [],
    }).byNode.get("raft")!;
    const h20 = computeGraphHealth([makeCardAtElapsed(20)], {
      now: NOW,
      nodes,
      edges: [],
    }).byNode.get("raft")!;
    const h60 = computeGraphHealth([makeCardAtElapsed(60)], {
      now: NOW,
      nodes,
      edges: [],
    }).byNode.get("raft")!;

    expect(h0.strength).toBeCloseTo(1.0, 5);
    expect(h10.strength).toBeLessThan(h0.strength);
    expect(h10.strength).toBeGreaterThan(0.9);
    expect(h20.strength).toBeCloseTo(0.9, 5);
    expect(h60.strength).toBeLessThan(h20.strength);
    expect(h60.strength).toBeGreaterThan(0.7);

    // Fallback when last_reviewed is absent derives elapsedDays from (interval - daysUntilDue)
    const withoutLastReviewed = {
      ...makeCardAtElapsed(20),
      last_reviewed: null,
    };
    expect(cardStrength(withoutLastReviewed, NOW.getTime())).toBeCloseTo(
      0.9,
      5,
    );
  });
});

describe("Strict Zod v4 Schema & Anti-Sycophancy Invariants", () => {
  it("puts 100% of EvaluationResultLlmSchema properties into JSON Schema required[] for OpenAI strict mode", () => {
    const jsonSchema = z.toJSONSchema(EvaluationResultLlmSchema, {
      io: "input",
    }) as {
      properties?: Record<string, unknown>;
      required?: string[];
    };
    const propKeys = Object.keys(jsonSchema.properties ?? {});
    expect(propKeys).toEqual([
      "extractedClaims",
      "factualOrLogicalErrors",
      "unexplainedJargon",
      "rubricChecks",
      "socraticFollowUp",
      "constructiveFeedback",
      "score",
      "pass",
    ]);
    expect(jsonSchema.required?.sort()).toEqual([...propKeys].sort());
  });

  it("overrides sycophantic pass=true when factualOrLogicalErrors is non-empty and enforces hint caps", () => {
    const sycophanticRaw = {
      extractedClaims: ["Raft commits entries as soon as term increments"],
      factualOrLogicalErrors: ["Confused Raft term with commit index"],
      unexplainedJargon: [],
      rubricChecks: [
        {
          point: "Distinguishes term from commit index",
          met: false,
          evidenceOrGap: "Conflated term election counter with committed log prefix",
        },
      ],
      socraticFollowUp: "Can a leader in a new term overwrite uncommitted entries?",
      constructiveFeedback: "Good structure, but check how commitIndex advances.",
      score: 0.92,
      pass: true,
    };

    const enforced = enforceAntiSycophancy(sycophanticRaw);
    expect(enforced.pass).toBe(false);
    expect(enforced.masteryEligible).toBe(false);
    expect(enforced.score).toBeLessThanOrEqual(0.59);

    // Hint 2 caps score at 0.80 while remaining unassisted
    const cleanRaw = {
      ...sycophanticRaw,
      factualOrLogicalErrors: [],
      score: 0.96,
      pass: true,
    };
    const hint2 = enforceAntiSycophancy(cleanRaw, { hintsUsed: 2 });
    expect(hint2.score).toBe(0.8);
    expect(hint2.assisted).toBe(false);
    expect(hint2.pass).toBe(true);
    expect(hint2.masteryEligible).toBe(true);

    // Hint 3 or viewing workedSolution marks assisted=true and masteryEligible=false
    const hint3 = enforceAntiSycophancy(cleanRaw, { hintsUsed: 3 });
    expect(hint3.assisted).toBe(true);
    expect(hint3.masteryEligible).toBe(false);

    const peeked = enforceAntiSycophancy(cleanRaw, {
      hintsUsed: 0,
      viewedWorkedSolution: true,
    });
    expect(peeked.assisted).toBe(true);
    expect(peeked.masteryEligible).toBe(false);
  });
});

describe("FIRe-Lite Prerequisite Credit, Drills API, Challenge Fast-Track, Feynman & Due Badges", () => {
  let app: Express;
  let localOwnerId: string;
  let customKitId: string;

  const customSkeleton = {
    ...SYSTEM_DESIGN_KIT_SKELETON,
    identity: {
      ...SYSTEM_DESIGN_KIT_SKELETON.identity,
      slug: "distributed-lab",
      name: "Distributed Lab",
      icon: "⚡",
      color: "#0ea5e9",
    },
    pillars: [
      {
        id: "consensus-pillar",
        number: 1,
        name: "Consensus Foundations",
        shortName: "Consensus",
        color: "#0ea5e9",
        sections: [
          {
            id: "mental-model",
            name: "Mental Model",
            icon: "book-open",
            promptHint: "Explain core intuition and state invariants.",
            ownershipRule: "Core mechanism",
          },
          {
            id: "failure-modes",
            name: "Failure Modes",
            icon: "alert-triangle",
            promptHint: "Analyze split-brain, network partitions, and recovery.",
            ownershipRule: "Edge cases",
          },
        ],
        topics: [
          {
            id: "raft-topic",
            name: "Raft Replication",
            summary: "Leader election, log matching, and quorum commit rules.",
          },
        ],
      },
    ],
    graph: {
      nodes: [
        {
          id: "node-a",
          name: "Quorum Math",
          pillarId: "consensus-pillar",
          topicId: "raft-topic",
          summary: "Majority intersection R + W > N.",
          keywords: ["quorum math"],
          components: [],
        },
        {
          id: "node-b",
          name: "Leader Election",
          pillarId: "consensus-pillar",
          topicId: "raft-topic",
          summary: "Monotonic terms and up-to-date log voting.",
          keywords: ["leader election"],
          components: [],
        },
        {
          id: "node-c",
          name: "Log Replication",
          pillarId: "consensus-pillar",
          topicId: "raft-topic",
          summary: "AppendEntries consistency check and commitIndex safety.",
          keywords: ["log replication"],
          components: [],
        },
      ],
      edges: [
        { from: "node-a", to: "node-b" },
        { from: "node-b", to: "node-c" },
      ],
      tracks: [],
    },
    seeds: {
      drills: [],
      baselineGuideNotes: [],
    },
  };

  beforeAll(() => {
    __resetAuthRateLimits();
    localOwnerId = ensureLocalOwner();
    app = createApp();

    customKitId = "kit-distributed-lab";
    db.prepare(
      `INSERT INTO kits (
         id, ownerId, slug, name, description, icon, color, status, skeleton_json
       ) VALUES (?, ?, 'distributed-lab', 'Distributed Lab', 'Test kit', '⚡', '#0ea5e9', 'ready', ?)`,
    ).run(customKitId, localOwnerId, JSON.stringify(customSkeleton));
  });

  beforeEach(() => {
    mockRunStructured.mockReset();
  });

  it("propagates FIRe upward credit to overdue 1-hop (0.5) & 2-hop (0.25) cards while skipping freshly reviewed cards (R ~ 1)", async () => {
    const now = new Date();
    const deckRes = await request(app)
      .post("/api/decks")
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({ name: "Consensus Deck" })
      .expect(201);
    const deckId = deckRes.body.id as string;

    const insertGraduatedCard = (
      id: string,
      nodeId: string,
      front: string,
      stability: number,
      elapsedDaysAgo: number,
    ) => {
      const lastRev = new Date(
        now.getTime() - elapsedDaysAgo * DAY_MS,
      ).toISOString();
      const nextRev = new Date(
        now.getTime() + (stability - elapsedDaysAgo) * DAY_MS,
      ).toISOString();
      db.prepare(
        `INSERT INTO flashcards (
           id, ownerId, deck_id, node_id, front, back, state, stability, difficulty,
           ease_factor, interval, repetitions, last_reviewed, next_review
         ) VALUES (?, ?, ?, ?, ?, 'Answer', 2, ?, 5.0, 2.4, ?, 3, ?, ?)`,
      ).run(
        id,
        localOwnerId,
        deckId,
        nodeId,
        front,
        stability,
        Math.round(stability),
        lastRev,
        nextRev,
      );
    };

    // Overdue 2-hop card on node-a (elapsed 25d on S=5 -> R ~ 0.76, delta = 0.25 * 0.24 = 0.06 >= 0.05)
    insertGraduatedCard("card-a-overdue", "node-a", "Quorum Math Q1", 5, 25);
    // Overdue 1-hop card on node-b (elapsed 15d on S=5 -> R ~ 0.81, delta = 0.5 * 0.19 = 0.095 >= 0.05)
    insertGraduatedCard("card-b-overdue", "node-b", "Leader Election Q1", 5, 15);
    // Freshly reviewed 1 minute ago on node-b (R ~ 0.99999 -> delta << 0.05 -> ZERO inflation!)
    const oneMinAgo = new Date(now.getTime() - MIN_MS).toISOString();
    const freshNextRev = new Date(now.getTime() + 10 * DAY_MS).toISOString();
    db.prepare(
      `INSERT INTO flashcards (
         id, ownerId, deck_id, node_id, front, back, state, stability, difficulty,
         ease_factor, interval, repetitions, last_reviewed, next_review
       ) VALUES ('card-b-fresh', ?, ?, 'node-b', 'Fresh Election Q2', 'Answer', 2, 10, 5.0, 2.4, 10, 3, ?, ?)`,
    ).run(localOwnerId, deckId, oneMinAgo, freshNextRev);

    // Downstream card on node-c
    insertGraduatedCard("card-c-main", "node-c", "Log Replication Q1", 8, 8);

    // Review downstream card-c-main with Good (quality = 4) via decks route
    const reviewRes = await request(app)
      .post(`/api/decks/${deckId}/cards/card-c-main/review`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({ quality: 4 })
      .expect(200);

    expect(reviewRes.body.implicit_credit_count).toBe(2);
    expect(reviewRes.body.stability).toBeGreaterThan(8);

    const cardA = db
      .prepare("SELECT stability, interval, next_review FROM flashcards WHERE ownerId = ? AND id = 'card-a-overdue'")
      .get(localOwnerId) as {
      stability: number;
      interval: number;
      next_review: string;
    };
    const cardB = db
      .prepare("SELECT stability, interval, next_review FROM flashcards WHERE ownerId = ? AND id = 'card-b-overdue'")
      .get(localOwnerId) as {
      stability: number;
      interval: number;
      next_review: string;
    };
    const cardBFresh = db
      .prepare("SELECT stability, interval, next_review FROM flashcards WHERE ownerId = ? AND id = 'card-b-fresh'")
      .get(localOwnerId) as {
      stability: number;
      interval: number;
      next_review: string;
    };

    expect(cardB.stability).toBeGreaterThan(5);
    expect(cardA.stability).toBeGreaterThan(5);
    expect(Date.parse(cardB.next_review)).toBeGreaterThan(now.getTime());
    expect(Date.parse(cardA.next_review)).toBeGreaterThan(now.getTime());

    // Freshly reviewed card (1 min ago) MUST have zero stability inflation!
    expect(cardBFresh.stability).toBe(10);
    expect(cardBFresh.next_review).toBe(freshNextRev);

    // Also verify direct helper idempotence on same-minute repeat
    const secondCredit = applyImplicitPrerequisiteCredit(
      db,
      scopeForOwnerId(localOwnerId),
      { id: customKitId, skeleton: customSkeleton },
      { nodeId: "node-c", now },
    );
    expect(secondCredit.updatedCardIds).toEqual([]);
  });

  it("handles drill generation, anti-sycophancy grading, hint-3 assistance guard, failure remediation, and Feynman evaluation", async () => {
    mockRunStructured.mockResolvedValueOnce({
      prompt: "A 5-node Raft cluster loses 2 followers and the leader partitions. Walk through election safety.",
      hints: ["Consider quorum size.", "Compare lastLogTerm and lastLogIndex."],
      rubricPoints: [
        "Requires 3-of-5 majority quorum",
        "Checks candidate log completeness before granting vote",
      ],
      workedSolution: "Majority side (3 nodes) elects a new leader whose log is at least as up-to-date.",
    });

    const genRes = await request(app)
      .post("/api/drills/generate")
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({ nodeId: "node-c", difficulty: 2 })
      .expect(201);

    const drillId = genRes.body.id as string;
    // Hints are normalized to 3 progressive hints [Nudge, Setup, Key Step]
    expect(genRes.body.hints).toHaveLength(3);
    expect(genRes.body.mastered).toBe(false);

    // Add a shaky prerequisite card on node-b so failing node-c's drill queues it in remediation_queue
    const decks = await request(app)
      .get("/api/decks")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    const deckId = decks.body[0].id as string;

    const shakyRes = await request(app)
      .post(`/api/decks/${deckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        front: "What prevents split-vote livelock in Leader Election?",
        back: "Randomized election timeouts",
        node_id: "node-b",
      })
      .expect(201);
    const shakyCardId = shakyRes.body.id as string;

    // 1. Sycophantic LLM returns pass=true, score=0.92 WITH a factual error -> overridden to pass=false, score=0.59 (< 0.6 -> triggers remediation!)
    mockRunStructured.mockResolvedValueOnce({
      extractedClaims: ["Raft commits entries as soon as term increments"],
      factualOrLogicalErrors: ["Confused Raft term with commit index"],
      unexplainedJargon: [],
      rubricChecks: [
        {
          point: "Requires 3-of-5 majority quorum",
          met: false,
          evidenceOrGap: "Did not mention majority quorum",
        },
      ],
      socraticFollowUp: "How many nodes must acknowledge before commitIndex moves?",
      constructiveFeedback: "Review election vs commit rules.",
      score: 0.92,
      pass: true,
    });

    const sycSubmit = await request(app)
      .post(`/api/drills/${drillId}/submit`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({ submission: "The leader increments term to commit immediately." })
      .expect(200);

    expect(sycSubmit.body.pass).toBe(false);
    expect(sycSubmit.body.score).toBe(0.59);
    expect(sycSubmit.body.masteryEligible).toBe(false);
    expect(
      sycSubmit.body.remediation.some(
        (r: { cardId: string }) => r.cardId === shakyCardId,
      ),
    ).toBe(true);

    // Also test an explicit low-score failure (score = 0.35)
    mockRunStructured.mockResolvedValueOnce({
      extractedClaims: ["Not sure"],
      factualOrLogicalErrors: ["Incorrectly claimed 2 of 5 nodes form a quorum"],
      unexplainedJargon: [],
      rubricChecks: [],
      socraticFollowUp: "What is floor(5/2) + 1?",
      constructiveFeedback: "Revisit quorum intersection.",
      score: 0.35,
      pass: false,
    });
    const lowSubmit = await request(app)
      .post(`/api/drills/${drillId}/submit`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({ submission: "Any 2 nodes can elect a leader." })
      .expect(200);
    expect(lowSubmit.body.score).toBe(0.35);

    const openRemCount = (
      db
        .prepare(
          "SELECT COUNT(*) AS c FROM remediation_queue WHERE ownerId = ? AND card_id = ? AND resolved_at IS NULL",
        )
        .get(localOwnerId, shakyCardId) as { c: number }
    ).c;
    expect(openRemCount).toBe(1);

    // 2. Submitting with hintsUsed: 3 marks assisted=true and masteryEligible=false even with high score
    mockRunStructured.mockResolvedValueOnce({
      extractedClaims: ["3 of 5 majority elects leader with up-to-date log"],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [
        {
          point: "Requires 3-of-5 majority quorum",
          met: true,
          evidenceOrGap: "Explicitly stated 3 of 5",
        },
      ],
      socraticFollowUp: "Now try a variant without hints!",
      constructiveFeedback: "Accurate mechanism.",
      score: 0.94,
      pass: true,
    });

    const assistedSubmit = await request(app)
      .post(`/api/drills/${drillId}/submit`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        submission: "3 of 5 nodes form a quorum and check lastLogTerm/Index.",
        hintsUsed: 3,
      })
      .expect(200);

    expect(assistedSubmit.body.pass).toBe(true);
    expect(assistedSubmit.body.assisted).toBe(true);
    expect(assistedSubmit.body.masteryEligible).toBe(false);

    const listAfterAssisted = await request(app)
      .get("/api/drills?nodeId=node-c")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    expect(listAfterAssisted.body[0].attemptCount).toBe(3);
    expect(listAfterAssisted.body[0].mastered).toBe(false);

    // 3. Server-grounded POST /api/feynman/evaluate enforces anti-sycophancy
    mockRunStructured.mockResolvedValueOnce({
      extractedClaims: ["Raft uses Paxos proposers without a leader"],
      factualOrLogicalErrors: ["Raft uses a strong single leader per term, not leaderless proposers"],
      unexplainedJargon: ["linearizability"],
      rubricChecks: [],
      socraticFollowUp: "Who is allowed to append client log entries in Raft?",
      constructiveFeedback: "Clarify the role of the single leader.",
      score: 0.88,
      pass: true,
    });

    const feynmanRes = await request(app)
      .post("/api/feynman/evaluate")
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        nodeId: "node-c",
        explanation: "Raft is leaderless and guarantees linearizability automatically.",
      })
      .expect(200);

    expect(feynmanRes.body.pass).toBe(false);
    expect(feynmanRes.body.score).toBe(0.59);
    expect(feynmanRes.body.conceptName).toBe("Log Replication");
  });

  it("fast-tracks via Challenge Node: graduates node cards to state=2, stability=21, commits guide note, and credits prerequisites", async () => {
    const decks = await request(app)
      .get("/api/decks")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    const deckId = decks.body[0].id as string;

    // Create an ungraduated (state=0) card on node-c and an overdue graduated card on prerequisite node-b
    const newNodeCCardRes = await request(app)
      .post(`/api/decks/${deckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        front: "When is a Raft log entry considered committed?",
        back: "Once replicated on a majority of servers in the leader's current term.",
        node_id: "node-c",
      })
      .expect(201);
    const nodeCCardId = newNodeCCardRes.body.id as string;

    const overduePast = new Date(Date.now() - 20 * DAY_MS).toISOString();
    db.prepare(
      `INSERT INTO flashcards (
         id, ownerId, deck_id, node_id, front, back, state, stability, difficulty,
         ease_factor, interval, repetitions, last_reviewed, next_review
       ) VALUES ('prereq-b-for-challenge', ?, ?, 'node-b', 'Term monotonicity', 'Terms never decrease', 2, 5, 5.0, 2.4, 5, 2, ?, ?)`,
    ).run(localOwnerId, deckId, overduePast, overduePast);

    // GET /api/drills/challenge/node-c generates a difficulty=3 drill since none exists yet
    mockRunStructured.mockResolvedValueOnce({
      prompt: "Prove why a Raft leader cannot directly commit entries from prior terms by counting replicas alone.",
      hints: ["Think Figure 8.", "Consider a new current-term entry.", "Indirect commitment via Log Matching."],
      rubricPoints: [
        "Explains Figure 8 overwrite hazard",
        "Shows current-term entry commits prior entries indirectly",
      ],
      workedSolution: "A prior-term entry on a majority can still be overwritten unless a current-term entry is replicated on a majority.",
    });

    const getChallenge = await request(app)
      .get("/api/drills/challenge/node-c")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);

    expect(getChallenge.body.drill.difficulty).toBe(3);
    expect(getChallenge.body.passThreshold).toBe(0.85);
    const challengeDrillId = getChallenge.body.drill.id as string;

    // POST /api/drills/challenge/node-c with passing unassisted synthesis (score = 0.93, zero errors)
    mockRunStructured.mockResolvedValueOnce({
      extractedClaims: [
        "Raft only commits entries from the leader's current term by counting replicas",
        "Prior-term entries commit indirectly via the Log Matching Property",
      ],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [
        {
          point: "Explains Figure 8 overwrite hazard",
          met: true,
          evidenceOrGap: "Accurately explained",
        },
      ],
      socraticFollowUp: "How does ReadIndex optimize read-only queries?",
      constructiveFeedback: "Spot-on Figure 8 safety proof and clear synthesis.",
      score: 0.93,
      pass: true,
    });

    const feynmanSynthesis =
      "A Raft leader only advances commitIndex by counting replicas for entries from its CURRENT term; older entries commit indirectly once a current-term entry after them reaches a majority.";

    const postChallenge = await request(app)
      .post("/api/drills/challenge/node-c")
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        drillId: challengeDrillId,
        drillSubmission: "Counting replicas on a prior-term entry risks overwrite if a node with a higher lastLogTerm wins election.",
        feynmanExplanation: feynmanSynthesis,
      })
      .expect(200);

    expect(postChallenge.body.pass).toBe(true);
    expect(postChallenge.body.committedSectionId).toBe("mental-model");
    expect(postChallenge.body.graduatedCardIds).toContain(nodeCCardId);
    expect(postChallenge.body.implicit_credit_count).toBeGreaterThanOrEqual(1);

    // Verify card graduated to state = 2, stability = 21, difficulty = 4.5, interval = 21
    const graduatedCard = db
      .prepare(
        "SELECT state, stability, difficulty, interval, repetitions FROM flashcards WHERE ownerId = ? AND id = ?",
      )
      .get(localOwnerId, nodeCCardId) as {
      state: number;
      stability: number;
      difficulty: number;
      interval: number;
      repetitions: number;
    };
    expect(graduatedCard.state).toBe(2);
    expect(graduatedCard.stability).toBe(21);
    expect(graduatedCard.difficulty).toBe(4.5);
    expect(graduatedCard.interval).toBe(21);
    expect(graduatedCard.repetitions).toBeGreaterThanOrEqual(1);

    // Verify guide_content slot was populated
    const savedGuide = db
      .prepare(
        "SELECT content FROM guide_content WHERE ownerId = ? AND kit_id = ? AND pillar_id = 'consensus-pillar' AND topic_id = 'raft-topic' AND section_id = 'mental-model'",
      )
      .get(localOwnerId, customKitId) as { content: string } | undefined;
    expect(savedGuide?.content).toBe(feynmanSynthesis);

    // Verify prerequisite card received upward FIRe stability credit
    const creditedPrereq = db
      .prepare(
        "SELECT stability FROM flashcards WHERE ownerId = ? AND id = 'prereq-b-for-challenge'",
      )
      .get(localOwnerId) as { stability: number };
    expect(creditedPrereq.stability).toBeGreaterThan(5);
  });

  it("attaches Kit badge metadata on GET /api/decks/all/cards/due, supports ?kitId=, and enforces strict tenant isolation", async () => {
    // Create a due new card in Distributed Lab for local owner (Alice)
    const decks = await request(app)
      .get("/api/decks")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    const deckId = decks.body[0].id as string;

    const dueCardRes = await request(app)
      .post(`/api/decks/${deckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        front: "Cross-Kit Badge Check",
        back: "Should carry Distributed Lab metadata",
      })
      .expect(201);
    const aliceDueCardId = dueCardRes.body.id as string;

    const allDueBeforeSetup = await request(app)
      .get("/api/decks/all/cards/due?kitId=distributed-lab")
      .expect(200);
    const badgeCard = allDueBeforeSetup.body.find(
      (c: { id: string }) => c.id === aliceDueCardId,
    );
    expect(badgeCard).toBeDefined();
    expect(badgeCard.kit_id).toBe(customKitId);
    expect(badgeCard.kit_slug).toBe("distributed-lab");
    expect(badgeCard.kit_name).toBe("Distributed Lab");
    expect(badgeCard.kit_icon).toBe("⚡");
    expect(badgeCard.kit_color).toBe("#0ea5e9");

    // Upgrade instance to multi-user mode (Alice Admin + Bob Member) and verify tenant isolation
    const aliceAgent = request.agent(app);
    await aliceAgent
      .post("/api/auth/setup")
      .send({
        email: "alice-wave1d@example.com",
        username: "alice1d",
        displayName: "Alice",
        password: "alice-strong-password-123",
      })
      .expect(201);

    const inviteRes = await aliceAgent
      .post("/api/admin/invitations")
      .send({ email: "bob-wave1d@example.com", role: "member" })
      .expect(201);
    const token = new URL(inviteRes.body.link as string).searchParams.get(
      "token",
    )!;

    const bobAgent = request.agent(app);
    await bobAgent
      .post("/api/auth/accept-invitation")
      .send({
        token,
        email: "bob-wave1d@example.com",
        username: "bob1d",
        displayName: "Bob",
        password: "bob-strong-password-123",
      })
      .expect(201);

    // Bob sees ZERO of Alice's due cards or drills!
    const bobDue = await bobAgent.get("/api/decks/all/cards/due").expect(200);
    expect(bobDue.body).toEqual([]);

    const aliceDrills = await aliceAgent
      .get("/api/drills")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    expect(aliceDrills.body.length).toBeGreaterThanOrEqual(2);

    // Bob cannot access Alice's kit or submit to Alice's drill
    await bobAgent
      .get("/api/drills")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(404);
    await bobAgent
      .post(`/api/drills/${aliceDrills.body[0].id}/submit`)
      .send({ submission: "Cross-tenant attempt" })
      .expect(404);

    // Cross-Kit isolation on /api/graph + /api/graph/health, deck stats, interleaved/review due, card-only review & prereq guard
    const sdDeckRes = await aliceAgent
      .post("/api/decks")
      .set("X-Toolbox-Kit", "system-design")
      .send({ name: "System Design Isolation Deck" })
      .expect(201);
    const sdCardRes = await aliceAgent
      .post(`/api/decks/${sdDeckRes.body.id}/cards`)
      .set("X-Toolbox-Kit", "system-design")
      .send({
        front: "Quorum Math Cross-Kit Collision Probe",
        back: "Belongs to system-design, never distributed-lab",
        node_id: "node-a",
      })
      .expect(201);
    const sdCardId = sdCardRes.body.id as string;

    // Cross-Kit prerequisite_id is rejected/stripped so prerequisites never cross Kits
    const crossPrereqCard = await aliceAgent
      .post(`/api/decks/${deckId}/cards`)
      .set("X-Toolbox-Kit", "distributed-lab")
      .send({
        front: "Cross-Kit Prereq Attempt",
        back: "Should strip foreign Kit prerequisite_id",
        prerequisite_id: sdCardId,
      })
      .expect(201);
    expect(crossPrereqCard.body.prerequisite_id).toBeNull();

    // /api/graph, /api/graph/health, and /api/graph/nodes/:id scope strictly to distributed-lab and compute FSRS stability strength
    for (const graphPath of ["/api/graph", "/api/graph/health"]) {
      const gRes = await aliceAgent
        .get(graphPath)
        .set("X-Toolbox-Kit", "distributed-lab")
        .expect(200);
      const nodeA = gRes.body.nodes.find((n: { id: string }) => n.id === "node-a");
      expect(nodeA).toBeDefined();
      expect(nodeA.strength).toBeGreaterThan(0);
    }
    const nodeDetail = await aliceAgent
      .get("/api/graph/nodes/node-a")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    expect(
      nodeDetail.body.cards.some((c: { id: string }) => c.id === sdCardId),
    ).toBe(false);

    // /api/decks/interleaved/due honors X-Toolbox-Kit while /api/review/due spans all owned Kits
    const kitInterleaved = await aliceAgent
      .get("/api/decks/interleaved/due")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    expect(
      kitInterleaved.body.every(
        (c: { kit_slug: string }) => c.kit_slug === "distributed-lab",
      ),
    ).toBe(true);

    await aliceAgent
      .get("/api/decks/interleaved/due?kitId=nonexistent-kit")
      .expect(404);

    const unifiedReview = await aliceAgent
      .get("/api/review/due")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    const reviewSlugs = new Set(
      unifiedReview.body.map((c: { kit_slug: string }) => c.kit_slug),
    );
    expect(reviewSlugs.has("distributed-lab")).toBe(true);
    expect(reviewSlugs.has("system-design")).toBe(true);

    // /api/decks/stats scopes to active Kit or aggregates across all Kits via ?kitId=all
    const kitStats = await aliceAgent
      .get("/api/decks/stats")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    const allStats = await aliceAgent
      .get("/api/decks/stats?kitId=all")
      .set("X-Toolbox-Kit", "distributed-lab")
      .expect(200);
    expect(kitStats.body.kitId).toBe(customKitId);
    expect(allStats.body.kitId).toBeNull();
    expect(allStats.body.cardCount).toBeGreaterThan(kitStats.body.cardCount);

    // POST /api/decks/cards/:cardId/review grades without requiring :deckId in URL
    const directRev = await aliceAgent
      .post(`/api/decks/cards/${sdCardId}/review`)
      .send({ quality: 5, confidence: "high" })
      .expect(200);
    expect(directRev.body.state).toBe(2);
    expect(directRev.body.repetitions).toBe(1);
    expect(directRev.body.stability).toBeGreaterThan(0);

    // POST /api/calculator/audit passes tenant scope to runStructured
    mockRunStructured.mockResolvedValueOnce({
      verdict: "sound",
      summary: "Throughput fits single-node NVMe budget.",
      findings: [],
      omittedFactors: [],
    });
    const calcRes = await aliceAgent
      .post("/api/calculator/audit")
      .send({
        inputs: { dau: 100000, readsPerUser: 10 },
        results: { qps: 12 },
      })
      .expect(200);
    expect(calcRes.body.summary).toContain("NVMe");
    expect(mockRunStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "quick",
        scope: expect.objectContaining({ ownerId: localOwnerId }),
      }),
    );
  });
});
