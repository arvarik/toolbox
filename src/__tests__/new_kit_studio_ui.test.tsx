import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import LibraryHomePage from "../pages/LibraryHomePage";
import NewKitStudioPage from "../pages/NewKitStudioPage";
import useKitStore, { type KitDetailItem } from "../stores/useKitStore";

const {
  mockDraftSkeleton,
  mockCreatedKit,
  mockSeedingKit,
  compilerMocks,
} = vi.hoisted(() => {
  const skeleton: KitSkeletonV1 = {
    format: "toolbox-kit",
    schemaVersion: 1,
    exportedAt: "2026-04-08T12:00:00.000Z",
    identity: {
      slug: "raft-storage-engines",
      name: "Raft & Storage Engines",
      description: "Consensus and LSM-tree storage internals.",
      icon: "⚓",
      color: "#006a91",
      version: 1,
      tags: ["consensus", "storage"],
    },
    capabilities: {
      canvas: "architecture",
      calculator: true,
      webResearchDefault: true,
      enableSvgDiagrams: true,
    },
    tutor: {
      rolePrompt: "You are a distributed storage architect.",
      personas: {
        socratic: { label: "Socratic", prompt: "Ask questions." },
        eli5: { label: "Intuitive", prompt: "Simple analogies." },
        strict: { label: "Rigorous", prompt: "Demand invariants." },
        devil: { label: "Devil's Advocate", prompt: "Break assumptions." },
      },
      starterPrompts: ["Explain Raft Figure 8."],
      cardExamples: [],
    },
    pillars: [
      {
        id: "raft-core",
        number: 1,
        name: "Raft Leader Election & Safety",
        shortName: "Raft Core",
        color: "#006a91",
        sections: [
          {
            id: "invariants",
            name: "Safety Invariants",
            icon: "shield",
            promptHint: "Invariants",
            ownershipRule: "Safety",
          },
          {
            id: "tradeoffs",
            name: "Failure Modes",
            icon: "zap",
            promptHint: "Failures",
            ownershipRule: "Failures",
          },
        ],
        topics: [
          {
            id: "leader-election",
            name: "Leader Election & Quorums",
            summary: "Term monotonicity and split votes.",
          },
        ],
      },
    ],
    graph: {
      nodes: [
        {
          id: "quorum-intersection",
          name: "Quorum Intersection",
          pillarId: "raft-core",
          topicId: "leader-election",
          summary: "Majorities overlap in at least one replica.",
          keywords: ["quorum"],
          components: [],
        },
      ],
      edges: [],
      tracks: [
        {
          id: "core-track",
          name: "Consensus Core",
          emoji: "🧭",
          description: "Core path",
          targets: ["quorum-intersection"],
        },
      ],
    },
    seeds: {
      starterDeck: {
        name: "Raft & Storage Engines Core",
        description: "Core cards",
        cards: [],
      },
      drills: [],
      baselineGuideNotes: [],
    },
    bibliography: [
      {
        title: "In Search of an Understandable Consensus Algorithm",
        url: "https://raft.github.io/raft.pdf",
      },
    ],
  };

  const createdKit: KitDetailItem = {
    id: "kit-raft-1",
    slug: "raft-storage-engines",
    name: "Raft & Storage Engines",
    description: "Consensus and LSM-tree storage internals.",
    icon: "⚓",
    color: "#006a91",
    status: "seeding",
    statusDetail: "Seeding Pillar 1/2: Raft Core…",
    forkedFromSharedId: null,
    forkedVersion: null,
    upstreamSlug: null,
    upstreamLatestVersion: null,
    hasUpstreamUpdate: false,
    createdAt: "2026-04-08T12:00:00Z",
    updatedAt: "2026-04-08T12:00:00Z",
    lastOpenedAt: null,
    pillarCount: 2,
    topicCount: 3,
    nodeCount: 8,
    capabilities: skeleton.capabilities,
    deckCount: 1,
    cardCount: 0,
    dueCount: 0,
    newCount: 0,
    reviewedCount: 0,
    masteryPercent: 0,
    guideFilledCount: 0,
    guideTotalCount: 4,
    archivedNotesCount: 0,
    drillCount: 0,
    skeleton,
  };

  return {
    mockDraftSkeleton: skeleton,
    mockCreatedKit: createdKit,
    mockSeedingKit: {
      ...createdKit,
      statusDetail: "Seeding Pillar 2/4: Replication…",
    },
    compilerMocks: {
      uploadSources: vi.fn(),
      ingestUrlOrText: vi.fn(() =>
        Promise.resolve({
          sources: [
            {
              stagedId: "staged-url-1",
              kind: "url" as const,
              title: "Raft Extended Paper",
              url: "https://raft.github.io/raft.pdf",
              mimeType: "application/pdf",
              sizeBytes: 42000,
              wordCount: 6400,
              excerpt: "Raft consensus algorithm...",
              safeBasename: "raft.pdf",
            },
          ],
        }),
      ),
      deleteSource: vi.fn(() => Promise.resolve({ ok: true })),
      calibrate: vi.fn(() =>
        Promise.resolve({
          calibration: {
            suggestedTitle: "Raft & Storage Engines",
            suggestedIcon: "⚓",
            suggestedDescription: "Consensus and LSM-tree storage internals.",
            suggestedCapabilities: skeleton.capabilities,
            dimensions: [
              {
                id: "level",
                label: "Starting Level",
                question: "Where should prerequisites start?",
                options: [
                  "Distributed systems basics",
                  "Production storage internals",
                  "Formal TLA+ verification",
                ],
                recommended: "Production storage internals",
              },
              {
                id: "goal",
                label: "Primary Goal",
                question: "What outcome matters most?",
                options: [
                  "Deep conceptual mental models",
                  "Hands-on Rust engine build",
                  "Architecture interview prep",
                ],
                recommended: "Deep conceptual mental models",
              },
              {
                id: "lens",
                label: "Emphasis",
                question: "Which lens deserves heaviest focus?",
                options: [
                  "Safety invariants",
                  "Jepsen failure modes",
                  "Latency & throughput tuning",
                ],
                recommended: "Jepsen failure modes",
              },
            ],
          },
          stagedSources: [],
        }),
      ),
      compile: vi.fn(() =>
        Promise.resolve({
          skeleton,
          pool: {
            entries: [
              {
                id: "S1",
                kind: "url" as const,
                title: "Raft Extended Paper",
                url: "https://raft.github.io/raft.pdf",
                note: "Ingested Reference URL",
                excerpt: "Election Safety and Log Matching...",
              },
            ],
            gapCheckQueries: [],
          },
          citedSourceIds: ["S1"],
          dagRepair: {
            initialCyclicSccCount: 0,
            llmRepairAttempted: false,
            tieBreakerDroppedCount: 0,
          },
          stagedSources: [],
        }),
      ),
      refine: vi.fn((payload: { skeleton: KitSkeletonV1; instruction: string }) =>
        Promise.resolve({
          skeleton: {
            ...payload.skeleton,
            identity: {
              ...payload.skeleton.identity,
              name: "Raft, ReadIndex & LSM Engines",
            },
          },
          citedSourceIds: ["S1"],
          dagRepair: {
            initialCyclicSccCount: 0,
            llmRepairAttempted: false,
            tieBreakerDroppedCount: 0,
          },
        }),
      ),
      commit: vi.fn(() =>
        Promise.resolve({
          kit: createdKit,
          jobId: "job-seed-1",
          committedSourceIds: ["src-1"],
        }),
      ),
      getSeedStatus: vi.fn(),
      expandKit: vi.fn(() =>
        Promise.resolve({
          kit: {
            ...createdKit,
            pillarCount: 3,
            nodeCount: 11,
            status: "seeding",
            statusDetail: "Seeding Pillar 1/1: Log Compaction…",
          },
          jobId: "job-expand-1",
          addedPillarIds: ["log-compaction"],
          addedTopicIds: ["snapshotting"],
          addedNodeIds: ["install-snapshot"],
          committedSourceIds: [],
          dagRepair: {
            initialCyclicSccCount: 0,
            llmRepairAttempted: false,
            tieBreakerDroppedCount: 0,
          },
        }),
      ),
    },
  };
});
void mockDraftSkeleton;

vi.mock("../utils/compilerApi", () => ({
  compilerApi: compilerMocks,
  default: compilerMocks,
}));

vi.mock("../utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/api")>();
  return {
    ...actual,
    studySessionsApi: {
      list: vi.fn(() => Promise.resolve([])),
    },
    kitsApi: {
      ...actual.kitsApi,
      list: vi.fn(() => Promise.resolve({ kits: [mockSeedingKit] })),
      get: vi.fn(() => Promise.resolve({ kit: mockCreatedKit })),
      touch: vi.fn(() => Promise.resolve({ ok: true })),
    },
  };
});

describe("Wave 2E Frontend: NewKitStudioPage (/new), Seeding Pill & ExpandKitModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useKitStore.setState({
      kits: [],
      activeKitSlug: null,
      activeKit: null,
      kitCache: {},
      isLoadingList: false,
      isLoadingActive: false,
    });
  });

  it("walks through Stage 1 -> Stage 2 Calibration -> Stage 3 Blueprint Editing & Chat Refine -> Stage 4 Instant Save", async () => {
    render(
      <MemoryRouter initialEntries={["/new"]}>
        <Routes>
          <Route path="/new" element={<NewKitStudioPage />} />
          <Route
            path="/k/:slug/guide"
            element={<div data-testid="dest-guide-view">Arrived at Guide</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    // Stage 1: Enter topic, choose Deep Research, ingest URL
    fireEvent.change(screen.getByTestId("studio-topic-input"), {
      target: { value: "Raft Consensus & LSM Storage Engines" },
    });
    fireEvent.click(screen.getByTestId("depth-option-deep"));

    fireEvent.change(screen.getByTestId("studio-url-input"), {
      target: { value: "https://raft.github.io/raft.pdf" },
    });
    fireEvent.click(screen.getByTestId("studio-add-url-btn"));

    expect(await screen.findByText(/\[S1\] Raft Extended Paper/i)).toBeInTheDocument();
    expect(compilerMocks.ingestUrlOrText).toHaveBeenCalledWith({
      url: "https://raft.github.io/raft.pdf",
    });

    // Advance to Stage 2: 3-Chip Scope Calibration
    fireEvent.click(screen.getByTestId("studio-calibrate-btn"));
    expect(
      await screen.findByText("Where should prerequisites start?"),
    ).toBeInTheDocument();

    // Select a calibration chip + custom override
    fireEvent.click(screen.getByRole("button", { name: /Hands-on Rust engine build/i }));
    fireEvent.change(screen.getByTestId("studio-custom-scope-input"), {
      target: { value: "Include ReadIndex and WAL fsync batching" },
    });

    // Advance to Stage 3: Blueprint & DAG Preview
    fireEvent.click(screen.getByTestId("studio-compile-btn"));
    expect(await screen.findByTestId("studio-blueprint-editor")).toBeInTheDocument();
    expect(screen.getByText("Acyclic DAG Verified")).toBeInTheDocument();
    expect(screen.getByTestId("studio-bibliography-section")).toHaveTextContent(
      "[S1]",
    );
    expect(screen.getByText("Raft Extended Paper")).toBeInTheDocument();

    // Interactive Pillar addition + Chat Refine
    fireEvent.click(screen.getByTestId("studio-add-pillar-btn"));
    expect(screen.getByDisplayValue("New Pillar 2")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("studio-refine-input"), {
      target: { value: "Add ReadIndex linearizable reads" },
    });
    fireEvent.click(screen.getByTestId("studio-refine-btn"));

    await waitFor(() => {
      expect(
        screen.getByDisplayValue("Raft, ReadIndex & LSM Engines"),
      ).toBeInTheDocument();
    });

    // Stage 4: Instant Save -> navigates straight to /k/:slug/guide!
    fireEvent.click(screen.getByTestId("studio-commit-btn"));

    expect(await screen.findByTestId("dest-guide-view")).toBeInTheDocument();
    expect(compilerMocks.commit).toHaveBeenCalledTimes(1);
    expect(useKitStore.getState().activeKitSlug).toBe("raft-storage-engines");
  });

  it("renders Create Kit button, live Seeding… status pill, and Living Kit ExpandKitModal on LibraryHomePage", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LibraryHomePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Raft & Storage Engines")).toBeInTheDocument();

    // Header Create Kit CTA -> /new
    const createBtn = screen.getByTestId("create-kit-btn");
    expect(createBtn).toHaveAttribute("href", "/new");

    // Live Seeding… status pill shows per-pillar progress
    const seedPill = screen.getByTestId(
      "kit-seeding-pill-raft-storage-engines",
    );
    expect(seedPill).toHaveTextContent("Seeding Pillar 2/4: Replication…");

    // Click Expand Kit -> opens ExpandKitModal & submits additive expansion
    fireEvent.click(
      screen.getByTestId("expand-kit-btn-raft-storage-engines"),
    );
    const promptBox = await screen.findByTestId("expand-kit-prompt");
    fireEvent.change(promptBox, {
      target: { value: "Add Raft Log Compaction & Snapshotting" },
    });
    fireEvent.click(screen.getByTestId("expand-kit-submit-btn"));

    await waitFor(() => {
      expect(compilerMocks.expandKit).toHaveBeenCalledWith(
        "kit-raft-1",
        expect.objectContaining({
          prompt: "Add Raft Log Compaction & Snapshotting",
        }),
      );
    });
  });
});
