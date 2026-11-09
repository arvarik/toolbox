import React from "react";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton";
import { auditArchitecture } from "../utils/architectureLinter";
import KitPathPage from "../pages/KitPathPage";
import DrillsPage from "../pages/DrillsPage";
import GuidedDrillWorkspace from "../components/drills/GuidedDrillWorkspace";
import FeynmanPage from "../pages/FeynmanPage";
import ReviewPage from "../pages/ReviewPage";
import BuilderPage from "../pages/BuilderPage";
import { buildStudyNavItems } from "../components/layout/Sidebar";
import useAppStore from "../stores/appStore";
import useKitStore, { type KitDetailItem } from "../stores/useKitStore";

const mockGraphGet = vi.fn();
const mockDueAll = vi.fn();
const mockReviewCard = vi.fn();
const mockBoardsList = vi.fn();
const mockBoardsCreate = vi.fn();

const mockDrillsList = vi.fn();
const mockDrillsGenerate = vi.fn();
const mockDrillsSubmit = vi.fn();
const mockGetChallenge = vi.fn();
const mockSubmitChallenge = vi.fn();
const mockFeynmanEvaluate = vi.fn();
const mockCanvasCritique = vi.fn();

vi.mock("../utils/api", () => ({
  graphApi: {
    get: (...args: unknown[]) => mockGraphGet(...args),
    nodeCards: vi.fn(() => Promise.resolve([])),
    trackCards: vi.fn(() => Promise.resolve([])),
  },
  flashcardsApi: {
    dueAll: (...args: unknown[]) => mockDueAll(...args),
    review: (...args: unknown[]) => mockReviewCard(...args),
  },
  boardsApi: {
    list: (...args: unknown[]) => mockBoardsList(...args),
    get: vi.fn(() => Promise.resolve({})),
    create: (...args: unknown[]) => mockBoardsCreate(...args),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
    rename: vi.fn(() => Promise.resolve({})),
    reorder: vi.fn(() => Promise.resolve([])),
  },
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: "ok" })),
    stream: vi.fn(async () => "ok"),
  },
  kitsApi: {
    list: vi.fn(() => Promise.resolve({ kits: [] })),
    get: vi.fn(() => Promise.resolve(null)),
  },
}));

vi.mock("../utils/pedagogyApi", () => ({
  drillsApi: {
    list: (...args: unknown[]) => mockDrillsList(...args),
    generate: (...args: unknown[]) => mockDrillsGenerate(...args),
    submit: (...args: unknown[]) => mockDrillsSubmit(...args),
    getChallenge: (...args: unknown[]) => mockGetChallenge(...args),
    submitChallenge: (...args: unknown[]) => mockSubmitChallenge(...args),
  },
  feynmanApi: {
    evaluate: (...args: unknown[]) => mockFeynmanEvaluate(...args),
  },
  canvasCritiqueApi: {
    critique: (...args: unknown[]) => mockCanvasCritique(...args),
  },
}));

function buildRustConceptKitSkeleton(): KitSkeletonV1 {
  const base = structuredClone(SYSTEM_DESIGN_KIT_SKELETON);
  base.identity = {
    slug: "distributed-rust",
    name: "Distributed Rust",
    description: "Ownership, lifetimes, and lock-free concurrency.",
    icon: "🦀",
    color: "#f97316",
    version: 1,
    tags: ["rust", "concurrency"],
  };
  base.capabilities = {
    canvas: "concept",
    calculator: false,
    webResearchDefault: false,
    enableSvgDiagrams: true,
  };
  base.pillars = [
    {
      id: "ownership",
      number: 1,
      name: "Ownership & Borrowing",
      shortName: "Ownership",
      color: "#f97316",
      sections: [
        {
          id: "mechanics",
          name: "Borrow Mechanics",
          icon: "cpu",
          promptHint: "Explain aliasing XOR mutability.",
          ownershipRule: "Owns core borrow rules.",
        },
      ],
      topics: [
        {
          id: "move-semantics",
          name: "Move Semantics",
          summary: "Single owner transfers responsibility on assignment.",
        },
        {
          id: "lifetimes",
          name: "Non-Lexical Lifetimes",
          summary: "Region-based borrow liveness across CFG.",
        },
      ],
    },
  ];
  base.graph = {
    nodes: [
      {
        id: "moves",
        name: "Move Semantics",
        pillarId: "ownership",
        topicId: "move-semantics",
        summary: "Affine ownership transfer without deep copies.",
        keywords: ["move", "drop"],
        components: [],
      },
      {
        id: "borrows",
        name: "Aliasing XOR Mutability",
        pillarId: "ownership",
        topicId: "move-semantics",
        summary: "Either many &T readers or one &mut T writer.",
        keywords: ["borrow", "mut"],
        components: [],
      },
      {
        id: "nll",
        name: "Non-Lexical Lifetimes",
        pillarId: "ownership",
        topicId: "lifetimes",
        summary: "CFG-based borrow spans rather than lexical blocks.",
        keywords: ["lifetime", "nll"],
        components: [],
      },
    ],
    edges: [
      { from: "moves", to: "borrows" },
      { from: "borrows", to: "nll" },
    ],
    tracks: [
      {
        id: "borrow-mastery",
        name: "Borrow Checker Deep Dive",
        emoji: "🦀",
        description: "From affine moves to NLL.",
        targets: ["borrows"],
      },
    ],
  };
  base.canvasConfig = {
    components: [],
    protocols: ["implies", "prevents", "depends on", "example of"],
    templates: [],
    auditRubric: ["Verify aliasing XOR mutability propositions."],
  };
  return base;
}

function buildRustKitDetail(
  skeleton: KitSkeletonV1,
  overrides: Partial<KitDetailItem> = {},
): KitDetailItem {
  return {
    id: "kit-rust-1",
    slug: "distributed-rust",
    name: "Distributed Rust",
    description: skeleton.identity.description,
    icon: "🦀",
    color: "#f97316",
    status: "ready",
    statusDetail: null,
    forkedFromSharedId: null,
    forkedVersion: 1,
    upstreamSlug: null,
    upstreamLatestVersion: null,
    hasUpstreamUpdate: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    lastOpenedAt: null,
    pillarCount: 1,
    topicCount: 2,
    nodeCount: 3,
    capabilities: skeleton.capabilities,
    deckCount: 1,
    cardCount: 6,
    dueCount: 2,
    newCount: 4,
    reviewedCount: 2,
    masteryPercent: 45,
    guideFilledCount: 1,
    guideTotalCount: 2,
    archivedNotesCount: 0,
    drillCount: 1,
    skeleton,
    ...overrides,
  };
}

describe("Wave 2F — Ordered Mastery Path, Attempt-Gated Drills, Grounded Feynman, Cross-Kit Review & Adaptive Canvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.innerWidth = 1200;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    useAppStore.setState({
      model: "gemini-2.5-flash",
      toasts: [],
      nodes: [],
      edges: [],
      srsVersion: 0,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
    });

    useKitStore.setState({
      kits: [],
      activeKitSlug: null,
      activeKit: null,
      kitCache: {},
      isLoadingList: false,
      isLoadingActive: false,
    });
  });

  it("1. auditArchitecture runs SPOF checks in 'architecture' mode and Novakian proposition checks in 'concept' mode", () => {
    const sysNodes = [
      { id: "c1", data: { name: "Web Client", category: "Clients", icon: "monitor" } },
      { id: "s1", data: { name: "Order Service", category: "Compute", icon: "box" } },
    ];
    const sysEdges = [{ id: "e1", source: "c1", target: "s1" }];
    const archAudit = auditArchitecture(sysNodes, sysEdges);
    expect(archAudit.findings.map((f: { id: string }) => f.id)).toContain("unshielded-ingress");
    expect(archAudit.findings.map((f: { id: string }) => f.id)).toContain("compute-spof");

    // Concept mode does NOT emit Load Balancer / Cache / Queue warnings; checks propositions & orphans
    const conceptNodes = [
      { id: "k1", data: { name: "Ownership", category: "Foundations", icon: "brain" } },
      { id: "k2", data: { name: "Move Semantics", category: "Mechanisms", icon: "cog" } },
      { id: "k3", data: { name: "Orphan Concept", category: "Foundations", icon: "brain" } },
    ];
    const unlabeledEdges = [{ id: "ce1", source: "k1", target: "k2" }];
    const conceptAudit = auditArchitecture(conceptNodes, unlabeledEdges, { mode: "concept" });
    const findingIds = conceptAudit.findings.map((f: { id: string }) => f.id);
    expect(findingIds).not.toContain("compute-spof");
    expect(findingIds).not.toContain("missing-cache-tier");
    expect(findingIds).toContain("orphan-concepts");
    expect(findingIds).toContain("unlabeled-propositions");

    // Labeled, connected concept map with concrete example earns Well-Structured Concept Map
    const cleanNodes = [
      { id: "k1", data: { name: "Ownership", category: "Foundations", icon: "brain" } },
      { id: "k2", data: { name: "Single Drop", category: "Mechanisms", icon: "cog" } },
      { id: "k3", data: { name: "Vec<u8> Move Example", category: "Evidence", icon: "file-text" } },
    ];
    const cleanEdges = [
      { id: "e1", source: "k1", target: "k2", label: "guarantees" },
      { id: "e2", source: "k2", target: "k3", label: "example of" },
    ];
    const cleanAudit = auditArchitecture(cleanNodes, cleanEdges, { mode: "concept" });
    expect(cleanAudit.findings).toHaveLength(0);
    expect(cleanAudit.rating).toBe("Well-Structured Concept Map");
    expect(cleanAudit.score).toBe(100);
  });

  it("2. KitPathPage renders ordered nodes, seeding banner, track filter chips, and fast-tracks a Locked node via ChallengeNodeModal", async () => {
    const rustSkeleton = buildRustConceptKitSkeleton();
    const rustDetail = buildRustKitDetail(rustSkeleton, {
      status: "seeding",
      statusDetail: "Generating scenario drills (2/3 pillars)…",
    });

    useKitStore.setState({
      kits: [rustDetail],
      activeKitSlug: "distributed-rust",
      activeKit: rustDetail,
      kitCache: {
        "distributed-rust": rustDetail,
      },
    });

    mockGraphGet.mockResolvedValue({
      nodes: [
        {
          id: "moves",
          name: "Move Semantics",
          pillarId: "ownership",
          pillarName: "Ownership & Borrowing",
          pillarColor: "#f97316",
          topicId: "move-semantics",
          summary: "Affine ownership transfer.",
          health: "mastered",
          strength: 0.94,
          counts: { total: 2, new: 0, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 2 },
          ready: true,
          locked: false,
        },
        {
          id: "borrows",
          name: "Aliasing XOR Mutability",
          pillarId: "ownership",
          pillarName: "Ownership & Borrowing",
          pillarColor: "#f97316",
          topicId: "move-semantics",
          summary: "Shared vs exclusive references.",
          health: "unseen",
          strength: 0,
          counts: { total: 2, new: 2, learning: 0, lapsed: 0, due: 1, maturing: 0, mastered: 0 },
          ready: true,
          locked: false,
        },
        {
          id: "nll",
          name: "Non-Lexical Lifetimes",
          pillarId: "ownership",
          pillarName: "Ownership & Borrowing",
          pillarColor: "#f97316",
          topicId: "lifetimes",
          summary: "CFG-based borrow spans.",
          health: "unseen",
          strength: 0,
          counts: { total: 2, new: 2, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 0 },
          ready: false,
          locked: true,
        },
      ],
      edges: rustSkeleton.graph.edges,
      tracks: [],
      stats: { mastered: 1, due: 0, decayed: 0, unseen: 2 },
      remediationCount: 0,
    });
    mockDrillsList.mockResolvedValue([]);

    mockGetChallenge.mockResolvedValue({
      nodeId: "nll",
      nodeName: "Non-Lexical Lifetimes",
      pillarId: "ownership",
      topicId: "lifetimes",
      drill: {
        id: "drill-nll-hard",
        nodeId: "nll",
        difficulty: 3,
        prompt: "Why does `let r = &mut v; drop(v);` fail while last-use NLL allows early borrow end?",
        hints: [],
        rubricPoints: ["Explains CFG live range"],
      },
      feynmanPrompt: "Explain Non-Lexical Lifetimes from first principles.",
    });

    mockSubmitChallenge.mockResolvedValue({
      nodeId: "nll",
      drillId: "drill-nll-hard",
      pass: true,
      score: 0.91,
      assisted: false,
      masteryEligible: true,
      extractedClaims: ["NLL ends a borrow at its final control-flow read/write rather than block exit."],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [
        { point: "Explains CFG live range", met: true, evidenceOrGap: "Accurate CFG live-range explanation." },
      ],
      socraticFollowUp: "How do Drop impls interact with NLL?",
      constructiveFeedback: "Crisp first-principles derivation.",
      graduatedCardIds: ["card-nll-1", "card-nll-2"],
      committedSectionId: "mechanics",
      implicit_credit_count: 2,
      implicitCredit: {
        updatedCardIds: ["card-move-1", "card-borrow-1"],
        nodesCredited: ["moves", "borrows"],
      },
    });

    render(
      <MemoryRouter initialEntries={["/k/distributed-rust"]}>
        <Routes>
          <Route path="/k/:slug" element={<KitPathPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Live seeding progress banner + node status pills
    expect(await screen.findByTestId("kit-seeding-banner")).toHaveTextContent(
      "Generating scenario drills (2/3 pillars)…",
    );
    expect(screen.getByTestId("path-node-status-moves")).toHaveTextContent("Mastered");
    expect(screen.getByTestId("path-node-status-borrows")).toHaveTextContent("Ready / Unlocked");
    expect(screen.getByTestId("path-node-status-nll")).toHaveTextContent("Locked");

    // Learning Track filter narrows visible nodes to target + transitive prerequisites (moves + borrows, excluding nll)
    fireEvent.click(screen.getByTestId("track-chip-borrow-mastery"));
    expect(screen.getByTestId("path-node-moves")).toBeInTheDocument();
    expect(screen.getByTestId("path-node-borrows")).toBeInTheDocument();
    expect(screen.queryByTestId("path-node-nll")).not.toBeInTheDocument();

    // Unfilter track and fast-track Challenge the Locked `nll` node
    fireEvent.click(screen.getByTestId("track-chip-borrow-mastery"));
    fireEvent.click(screen.getByTestId("challenge-node-btn-nll"));

    expect(await screen.findByTestId("challenge-node-modal")).toBeInTheDocument();
    expect(mockGetChallenge).toHaveBeenCalledWith("nll", "gemini-2.5-flash");

    fireEvent.change(screen.getByTestId("challenge-drill-input"), {
      target: {
        value:
          "Under NLL, a reference's borrow region spans only up to its last use in the MIR control-flow graph.",
      },
    });
    fireEvent.change(screen.getByTestId("challenge-feynman-input"), {
      target: {
        value:
          "Instead of locking data until the closing curly brace, the compiler releases the borrow right after the last line that reads the reference.",
      },
    });
    fireEvent.click(screen.getByTestId("submit-challenge-btn"));

    expect(await screen.findByTestId("challenge-pass-celebration")).toBeInTheDocument();
    expect(screen.getByTestId("challenge-graduated-cards")).toHaveTextContent("2 cards → stability = 21d");
    expect(screen.getByTestId("challenge-fire-credit")).toHaveTextContent("+2 prerequisite cards credited");
    expect(screen.getByTestId("challenge-committed-section")).toHaveTextContent("Committed → mechanics");
  });

  it("3. DrillsPage enforces attempt-gated progressive hints, Assisted Attempt flagging on Hint 3, and 1-click Unassisted Variant generation", async () => {
    mockDrillsList.mockResolvedValue([
      {
        id: "drill-quorum-1",
        nodeId: "quorums",
        nodeName: "Quorum Consensus",
        pillarId: "distributed-mechanics",
        topicId: "replication-strategies",
        difficulty: 2,
        prompt: "Given $N = 5$ replicas, choose $R$ and $W$ for low-latency reads with strong consistency.",
        hints: [
          "Recall the Pigeonhole overlap condition on R + W.",
          "Minimize R while keeping R + W > 5 and tolerating node failures.",
          "Set W = 4, R = 2 (or W = 5, R = 1 if zero write fault tolerance is acceptable).",
        ],
        workedSolution: "Choose W = 3, R = 3 for balanced HA, or W = 4, R = 2 for faster reads.",
        rubricPoints: ["States R + W > N"],
        source: "ai",
        attemptCount: 0,
        bestScore: null,
        mastered: false,
      },
    ]);

    mockDrillsSubmit.mockResolvedValue({
      attemptId: "att-1",
      drillId: "drill-quorum-1",
      nodeId: "quorums",
      score: 0.78,
      pass: true,
      assisted: true,
      masteryEligible: false,
      hintsUsed: 3,
      viewedWorkedSolution: false,
      extractedClaims: ["R + W > 5 guarantees overlap."],
      factualOrLogicalErrors: ["Claimed W=5 tolerates 1 replica crash on writes."],
      unexplainedJargon: ["anti-entropy"],
      rubricChecks: [
        { point: "States R + W > N", met: true, evidenceOrGap: "Explicitly wrote R + W > 5." },
      ],
      socraticFollowUp: "How many replicas can fail if W = 5?",
      constructiveFeedback: "Watch write availability when W = N.",
      remediation: [
        {
          cardId: "rem-card-1",
          nodeId: "replication-lag",
          nodeName: "Replication Lag",
          front: "What happens to write availability when W = N?",
          reason: "Missed write fault-tolerance bound",
        },
      ],
    });

    mockDrillsGenerate.mockResolvedValue({
      id: "drill-quorum-variant-2",
      nodeId: "quorums",
      nodeName: "Quorum Consensus",
      pillarId: "distributed-mechanics",
      topicId: "replication-strategies",
      difficulty: 2,
      prompt: "Fresh Variant: With $N = 7$ across 3 AZs, design $R$ and $W$ to survive an entire AZ outage.",
      hints: ["Each AZ holds 2-3 replicas.", "Check surviving replicas when 3 go offline.", "Use R=4, W=4."],
      workedSolution: "With 3-2-2 placement, surviving 4 replicas allow W=4, R=4.",
      rubricPoints: ["Survives AZ loss"],
      source: "ai",
      attemptCount: 0,
      bestScore: null,
      mastered: false,
    });

    render(
      <MemoryRouter initialEntries={["/k/system-design/drills?node=quorums"]}>
        <Routes>
          <Route path="/k/:slug/drills" element={<DrillsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    const hint1Btn = await screen.findByTestId("reveal-hint-1-btn");
    expect(hint1Btn).toBeDisabled();

    // Whitespace-padded short input (< 30 non-whitespace chars) keeps Hint 1 locked
    const scratchpad = screen.getByTestId("drill-scratchpad");
    fireEvent.change(scratchpad, { target: { value: "   too short   " } });
    expect(hint1Btn).toBeDisabled();

    // >= 30 non-whitespace chars immediately unlocks Hint 1
    fireEvent.change(scratchpad, {
      target: {
        value: "By Pigeonhole Principle we require R + W > 5 so read and write sets intersect.",
      },
    });
    expect(hint1Btn).not.toBeDisabled();

    // Progressive unlock: Hint 1 -> Hint 2 -> Hint 3 (marks Assisted Mode)
    fireEvent.click(hint1Btn);
    expect(screen.getByTestId("hint-1-box")).toBeInTheDocument();

    const hint2Btn = screen.getByTestId("reveal-hint-2-btn");
    expect(hint2Btn).not.toBeDisabled();
    fireEvent.click(hint2Btn);
    expect(screen.getByTestId("hint-2-box")).toBeInTheDocument();

    const hint3Btn = screen.getByTestId("reveal-hint-3-btn");
    expect(hint3Btn).not.toBeDisabled();
    fireEvent.click(hint3Btn);
    expect(screen.getByTestId("hint-3-box")).toBeInTheDocument();
    expect(screen.getByTestId("live-assisted-pill")).toHaveTextContent("Assisted Mode");

    // Submit attempt -> graded as Assisted, surfaces factual errors + jargon + remediation + Unassisted Variant CTA
    fireEvent.click(screen.getByTestId("submit-drill-btn"));

    expect(await screen.findByTestId("rubric-assisted-badge")).toBeInTheDocument();
    expect(mockDrillsSubmit).toHaveBeenCalledWith(
      "drill-quorum-1",
      expect.objectContaining({ hintsUsed: 3, viewedWorkedSolution: false }),
    );
    expect(screen.getByTestId("factual-errors-callout")).toHaveTextContent(
      "Claimed W=5 tolerates 1 replica crash",
    );
    expect(screen.getByTestId("unexplained-jargon-box")).toHaveTextContent("anti-entropy");
    expect(screen.getByTestId("remediation-queue-callout")).toHaveTextContent("Replication Lag");

    // 1-click Generate Unassisted Variant loads fresh drill and resets hint locks
    fireEvent.click(screen.getByTestId("generate-unassisted-variant-btn"));
    await waitFor(() => {
      expect(mockDrillsGenerate).toHaveBeenCalledWith(
        expect.objectContaining({ nodeId: "quorums", difficulty: 2 }),
      );
    });
    expect(await screen.findByText(/With \$N = 7\$ across 3 AZs/i)).toBeInTheDocument();
  });

  it("4. FeynmanPage evaluates against server anti-sycophancy rubric and routes gaps to Socratic Chat", async () => {
    mockFeynmanEvaluate.mockResolvedValue({
      conceptName: "CAP Theorem",
      nodeId: "cap-theorem",
      pillarId: "distributed-mechanics",
      topicId: "consistency-models",
      score: 0.52,
      pass: false,
      extractedClaims: ["CA systems work across wide-area networks without partitions."],
      factualOrLogicalErrors: ["Network partitions (P) are inevitable in distributed systems; CA is not achievable across nodes."],
      unexplainedJargon: ["split-brain"],
      rubricChecks: [
        { point: "Explains P inevitability", met: false, evidenceOrGap: "Treated P as optional." },
      ],
      socraticFollowUp: "Can two servers over Ethernet guarantee zero packet loss?",
      constructiveFeedback: "Choose between C and A *during* a partition.",
    });

    render(
      <MemoryRouter initialEntries={["/k/system-design/feynman?node=cap-theorem"]}>
        <Routes>
          <Route path="/k/:slug/feynman" element={<FeynmanPage />} />
          <Route path="/k/:slug/chat" element={<div data-testid="kit-chat-dest">Chat Loaded</div>} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.change(screen.getByTestId("feynman-explanation-input"), {
      target: { value: "Just pick Consistency and Availability and disable network partitions to avoid split-brain." },
    });
    fireEvent.click(document.getElementById("feynman-analyze-btn")!);

    expect(await screen.findByTestId("rubric-fail-badge")).toHaveTextContent("Needs Revision");
    expect(screen.getByTestId("factual-errors-callout")).toHaveTextContent(
      "Network partitions (P) are inevitable",
    );

    fireEvent.click(screen.getByTestId("feynman-practice-chat-btn"));
    expect(await screen.findByTestId("kit-chat-dest")).toBeInTheDocument();
    expect(sessionStorage.getItem("toolbox_chat_draft")).toContain("CAP & PACELC");
  });

  it("5. ReviewPage runs unified Cross-Kit FSRS-6 daily queue with Kit badges, Space/number hotkeys, and FIRe credit feedback", async () => {
    mockDueAll.mockResolvedValue([
      {
        id: "card-rust-1",
        deck_id: "deck-rust",
        front: "State Rust's **Aliasing XOR Mutability** rule.",
        back: "Any value may have *either* any number of immutable `&T` borrows *or* a single `&mut T` borrow.",
        deckName: "Ownership Core",
        kit_slug: "distributed-rust",
        kit_name: "Distributed Rust",
        kit_icon: "🦀",
        kit_color: "#f97316",
        stability: 8.5,
        difficulty: 4.2,
        last_reviewed: new Date().toISOString(),
        srs_previews: { again: "1m", hard: "3d", good: "11d", easy: "24d" },
      },
      {
        id: "card-sys-1",
        deck_id: "deck-sys",
        front: "When do read/write quorums overlap?",
        back: "Whenever $R + W > N$.",
        deckName: "Consensus",
        kit_slug: "system-design",
        kit_name: "System Design",
        kit_icon: "🏗️",
        kit_color: "#006a91",
        stability: 12.0,
        difficulty: 5.0,
        last_reviewed: new Date().toISOString(),
      },
    ]);

    mockReviewCard
      .mockResolvedValueOnce({
        id: "card-rust-1",
        deck_id: "deck-rust",
        state: 2,
        stability: 19.4,
        difficulty: 4.0,
        implicit_credit_count: 3,
      })
      .mockResolvedValueOnce({
        id: "card-sys-1",
        deck_id: "deck-sys",
        state: 2,
        stability: 26.1,
        difficulty: 4.8,
        implicit_credit_count: 0,
      });

    render(
      <MemoryRouter initialEntries={["/review"]}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/" element={<div data-testid="library-home-dest">Library</div>} />
        </Routes>
      </MemoryRouter>,
    );

    // Card 1 shows Distributed Rust Kit badge
    expect(await screen.findByText(/Distributed Rust/i)).toBeInTheDocument();
    expect(screen.getByText(/Ownership Core/i)).toBeInTheDocument();

    // Press Space to reveal back, then '3' (Good -> quality 4)
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    expect(await screen.findByText(/single/i)).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "3" });
    await waitFor(() => {
      expect(mockReviewCard).toHaveBeenCalledWith("deck-rust", "card-rust-1", 4, "medium");
    });

    // Advances to Card 2 (System Design) and displays live FIRe prerequisite credit pill from Card 1
    expect(await screen.findByTestId("review-fire-credit-pill")).toHaveTextContent(
      "+3 prerequisite cards stabilized",
    );
    expect(screen.getByText(/System Design/i)).toBeInTheDocument();

    // Reveal & grade Card 2 -> Session Complete summary
    fireEvent.keyDown(window, { key: " ", code: "Space" });
    fireEvent.keyDown(window, { key: "4" });

    expect(await screen.findByTestId("review-completion-summary")).toBeInTheDocument();
    expect(screen.getByTestId("summary-fire-credits")).toHaveTextContent("+3");

    fireEvent.click(screen.getByTestId("return-library-btn"));
    expect(await screen.findByTestId("library-home-dest")).toBeInTheDocument();
  });

  it("6. BuilderPage adapts to Concept-Map Kits and runs grounded AI Rubric Critique inside ArchitectureAuditModal", async () => {
    const rustSkeleton = buildRustConceptKitSkeleton();
    const rustDetail = buildRustKitDetail(rustSkeleton, {
      dueCount: 0,
      masteryPercent: 80,
    });

    useKitStore.setState({
      kits: [rustDetail],
      activeKitSlug: "distributed-rust",
      activeKit: rustDetail,
      kitCache: {
        "distributed-rust": rustDetail,
      },
    });

    mockBoardsList.mockResolvedValue([]);
    mockBoardsCreate.mockResolvedValue({ id: "board-rust-saved", name: "Untitled Concept Map" });
    mockCanvasCritique.mockResolvedValue({
      boardId: "board-rust-saved",
      kitId: "kit-rust-1",
      mode: "concept",
      score: 0.88,
      pass: true,
      extractedClaims: ["Exclusive &mut T prevents data races."],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [
        {
          point: "Verify aliasing XOR mutability propositions",
          met: true,
          evidenceOrGap: "Propositions accurately capture exclusive mutability.",
        },
      ],
      socraticFollowUp: "Where does UnsafeCell fit into interior mutability?",
      constructiveFeedback: "Strong Novakian concept map.",
    });

    render(
      <MemoryRouter initialEntries={["/k/distributed-rust/canvas"]}>
        <Routes>
          <Route path="/k/:slug/canvas" element={<BuilderPage />} />
        </Routes>
      </MemoryRouter>,
    );

    // Concept-Map palette + linking phrase selector + hidden Estimate button (calculator: false)
    expect(screen.getByText("Concept Primitives")).toBeInTheDocument();
    expect(screen.getByText("Core Concept")).toBeInTheDocument();
    expect(screen.getByText("Counterexample / Edge Case")).toBeInTheDocument();
    expect(screen.queryByText("Estimate")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Linking phrase")).toBeInTheDocument();

    // Quick-add a custom concept node onto the map
    fireEvent.change(screen.getByLabelText("Custom concept name"), {
      target: { value: "Exclusive &mut T" },
    });
    fireEvent.click(screen.getByLabelText("Add concept node"));
    expect(useAppStore.getState().nodes.some((n: { data?: { name?: string } }) => n.data?.name === "Exclusive &mut T")).toBe(true);

    // Open Concept Map Audit modal and run AI Rubric Critique (auto-saves local board first)
    fireEvent.click(document.getElementById("builder-audit-btn")!);
    expect(await screen.findByText("Concept Map Audit & AI Critique")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("run-ai-critique-btn"));
    await waitFor(() => {
      expect(mockBoardsCreate).toHaveBeenCalledTimes(1);
      expect(mockCanvasCritique).toHaveBeenCalledWith(
        "board-rust-saved",
        expect.objectContaining({ model: "gemini-2.5-flash" }),
      );
    });

    expect(await screen.findByTestId("rubric-pass-badge")).toHaveTextContent("Passed Rubric");
    expect(screen.getByText(/Strong Novakian concept map/i)).toBeInTheDocument();
  });

  it("7. GuidedDrillWorkspace unlocks Hint 1 after 20s read timer and buildStudyNavItems wires exact Path + Drills links", () => {
    // Verify Kit-scoped vs top-level study nav items
    const kitItems = buildStudyNavItems("/k/distributed-rust", {
      canvas: "concept",
      calculator: false,
    });
    expect(kitItems[0]).toMatchObject({
      to: "/k/distributed-rust",
      label: "Path",
      exact: true,
    });
    expect(kitItems.some((i: { to: string; label: string }) => i.to === "/k/distributed-rust/drills" && i.label === "Drills")).toBe(true);

    const legacyItems = buildStudyNavItems("", { canvas: "architecture", calculator: true });
    expect(legacyItems.some((i: { label: string }) => i.label === "Path")).toBe(false);
    expect(legacyItems.some((i: { to: string; label: string }) => i.to === "/drills" && i.label === "Drills")).toBe(true);

    // Verify 20-second countdown gate unlocks Hint 1 even with 0 scratchpad characters
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter>
          <GuidedDrillWorkspace
            drill={{
              id: "drill-timer-1",
              kitId: "kit-sys",
              nodeId: "consensus",
              nodeName: "Raft Consensus",
              difficulty: 1,
              prompt: "Why does Raft randomize election timeouts?",
              hints: ["Think about split votes.", "Compare synchronized vs jittered timers.", "150-300ms uniform random interval."],
              workedSolution: "Randomized election timeouts break split-vote symmetry.",
              rubricPoints: ["Explains split-vote avoidance"],
              seedKey: null,
              createdAt: "2026-09-01T00:00:00Z",
              attemptCount: 0,
              bestScore: null,
              mastered: false,
              lastAttemptAt: null,
            }}
          />
        </MemoryRouter>,
      );

      const hint1Btn = screen.getByTestId("reveal-hint-1-btn");
      expect(hint1Btn).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(19_000);
      });
      expect(hint1Btn).toBeDisabled();

      act(() => {
        vi.advanceTimersByTime(1_000);
      });
      expect(hint1Btn).not.toBeDisabled();
    } finally {
      vi.useRealTimers();
    }
  });
});
