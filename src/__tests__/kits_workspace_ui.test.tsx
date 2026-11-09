import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "../components/layout/Layout";
import GuidePage from "../pages/GuidePage";
import LibraryHomePage from "../pages/LibraryHomePage";
import SharedLibraryPage from "../pages/SharedLibraryPage";
import useKitStore, {
  getActiveKitSlugForRequest,
  type KitDetailItem,
} from "../stores/useKitStore";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";

const { mockRustKit } = vi.hoisted(() => {
  const rustKit = {
    id: "kit-rust-1",
    slug: "distributed-rust",
    name: "Distributed Rust",
    description: "Memory safety and consensus in Rust.",
    icon: "🦀",
    color: "#f97316",
    status: "ready",
    statusDetail: null,
    forkedFromSharedId: "shared-rust-1",
    forkedVersion: 1,
    upstreamSlug: "distributed-rust",
    upstreamLatestVersion: 2,
    hasUpstreamUpdate: true,
    createdAt: "2026-04-08T10:00:00Z",
    updatedAt: "2026-04-08T10:00:00Z",
    lastOpenedAt: null,
    pillarCount: 1,
    topicCount: 1,
    nodeCount: 1,
    capabilities: {
      canvas: "concept" as const,
      calculator: false,
      webResearchDefault: false,
      enableSvgDiagrams: true,
    },
    deckCount: 1,
    cardCount: 12,
    dueCount: 4,
    newCount: 2,
    reviewedCount: 10,
    masteryPercent: 75,
    guideFilledCount: 1,
    guideTotalCount: 2,
    archivedNotesCount: 1,
    drillCount: 2,
    skeleton: {
      format: "toolbox-kit" as const,
      schemaVersion: 1 as const,
      exportedAt: "2026-04-08T10:00:00.000Z",
      identity: {
        slug: "distributed-rust",
        name: "Distributed Rust",
        description: "Memory safety and consensus in Rust.",
        icon: "🦀",
        color: "#f97316",
        version: 1,
        tags: ["rust", "systems"],
      },
      capabilities: {
        canvas: "concept" as const,
        calculator: false,
        webResearchDefault: false,
        enableSvgDiagrams: true,
      },
      tutor: {
        rolePrompt: "You are a Rust systems tutor.",
        personas: {
          socratic: { label: "Socratic Tutor", prompt: "Ask questions." },
          eli5: { label: "ELI5", prompt: "Simple analogies." },
          strict: { label: "Strict", prompt: "Demand rigor." },
          devil: { label: "Devil's Advocate", prompt: "Challenge assumptions." },
        },
        starterPrompts: ["Explain ownership."],
        cardExamples: [],
      },
      pillars: [
        {
          id: "ownership",
          number: 1,
          name: "Ownership & Borrow Checking",
          shortName: "Ownership",
          color: "#f97316",
          topics: [{ id: "borrowing", name: "Borrow Rules" }],
          sections: [
            {
              id: "mechanics",
              name: "Borrow Mechanics",
              icon: "cpu",
              promptHint: "Core borrow rules",
              ownershipRule: "Mechanics",
            },
            {
              id: "pitfalls",
              name: "Aliasing Pitfalls",
              icon: "alert-triangle",
              promptHint: "Pitfalls",
              ownershipRule: "Pitfalls",
            },
          ],
        },
      ],
      graph: {
        nodes: [
          {
            id: "ownership-node",
            name: "Ownership",
            pillarId: "ownership",
            topicId: "borrowing",
            summary: "Single owner",
            keywords: [],
            components: [],
          },
        ],
        edges: [],
        tracks: [],
      },
      seeds: {
        drills: [],
        baselineGuideNotes: [],
      },
      bibliography: [],
    },
  } satisfies KitDetailItem;
  return { mockRustKit: rustKit };
});
void SYSTEM_DESIGN_KIT_SKELETON;

vi.mock("../utils/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utils/api")>();
  return {
    ...actual,
    configApi: {
      ...actual.configApi,
      get: vi.fn(() => Promise.resolve({ api_key_configured: true })),
      getAvailableModels: vi.fn(() =>
        Promise.resolve({ groups: [], providers: [] }),
      ),
    },
    studySessionsApi: {
      list: vi.fn(() => Promise.resolve([{ date: "2026-04-08", count: 8 }])),
    },
    guideContentApi: {
      ...actual.guideContentApi,
      progress: vi.fn(() => Promise.resolve({ ownership__borrowing__mechanics: true })),
      getForTopic: vi.fn(() =>
        Promise.resolve({
          mechanics: {
            content: "Single mutable XOR shared borrows.",
            committedAt: "2026-04-08T10:00:00Z",
          },
        }),
      ),
    },
    kitsApi: {
      ...actual.kitsApi,
      list: vi.fn(() => Promise.resolve({ kits: [mockRustKit] })),
      get: vi.fn((slug: string) =>
        Promise.resolve({ kit: slug === "distributed-rust" ? mockRustKit : null }),
      ),
      touch: vi.fn(() => Promise.resolve({ ok: true })),
      getArchivedNotes: vi.fn(() =>
        Promise.resolve({
          notes: [
            {
              pillarId: "legacy-async",
              topicId: "futures-01",
              sectionId: "overview",
              content: "Preserved retired Futures 0.1 notes",
              committedAt: "2026-04-01T00:00:00Z",
            },
          ],
        }),
      ),
      syncUpstream: vi.fn(() =>
        Promise.resolve({
          kit: { ...mockRustKit, forkedVersion: 2, hasUpstreamUpdate: false },
          addedCards: 3,
        }),
      ),
    },
    sharedKitsApi: {
      list: vi.fn(() =>
        Promise.resolve({
          kits: [
            {
              id: "shared-sys",
              slug: "system-design",
              name: "System Design",
              description: "Official system design curriculum.",
              icon: "🏗️",
              color: "#006a91",
              authorId: null,
              authorName: "Toolbox Official",
              isOfficial: true,
              latestVersion: 1,
              tags: ["architecture", "distributed-systems"],
              downloadsCount: 42,
              pillarCount: 7,
              topicCount: 38,
              nodeCount: 54,
              starterCardCount: 0,
              starterDrillCount: 0,
              createdAt: "2026-04-08T00:00:00Z",
              updatedAt: "2026-04-08T00:00:00Z",
            },
          ],
        }),
      ),
      get: vi.fn(() => Promise.resolve({ sharedKit: null })),
      fork: vi.fn(() => Promise.resolve({ kit: mockRustKit })),
    },
  };
});

describe("Multi-Kit Library Home, Shared Library & Workspace Capability Routing", () => {
  beforeEach(() => {
    useKitStore.setState({
      kits: [],
      activeKitSlug: null,
      activeKit: null,
      kitCache: {},
      isLoadingList: false,
      isLoadingActive: false,
    });
  });

  it("renders Personal Library Home with Cross-Kit SRS Triage Bar and upstream update badge", async () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LibraryHomePage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Distributed Rust")).toBeInTheDocument();
    expect(screen.getByTestId("cross-kit-review-btn")).toHaveTextContent(
      "Review 4 Due Cards",
    );
    expect(screen.getByText(/Update v2 available/i)).toBeInTheDocument();
  });

  it("renders Shared Community Library with Official badge and tag filter chips", async () => {
    render(
      <MemoryRouter initialEntries={["/shared"]}>
        <Routes>
          <Route path="/shared" element={<SharedLibraryPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("System Design")).toBeInTheDocument();
    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "#architecture" })).toBeInTheDocument();
  });

  it("swaps Guide skeleton, gates Sidebar capabilities, sets X-Toolbox-Kit slug, and renders Archived Notes drawer on /k/:slug/guide", async () => {
    render(
      <MemoryRouter initialEntries={["/k/distributed-rust/guide/ownership/borrowing"]}>
        <Routes>
          <Route element={<Layout />}>
            <Route
              path="/k/:slug/guide/:pillarId/:topicId"
              element={<GuidePage />}
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getAllByText("Borrow Rules").length).toBeGreaterThan(0);
    });
    expect(getActiveKitSlugForRequest()).toBe("distributed-rust");

    // Custom section lens rendered
    expect(screen.getByText("Borrow Mechanics")).toBeInTheDocument();

    // Sidebar adapts: `canvas: "concept"` shows Concept Map -> /k/distributed-rust/canvas, and `calculator: false` hides Calculator
    const conceptLink = screen.getByRole("link", { name: /concept map/i });
    expect(conceptLink).toHaveAttribute("href", "/k/distributed-rust/canvas");
    expect(
      screen.queryByRole("link", { name: /calculator/i }),
    ).not.toBeInTheDocument();
    expect(document.getElementById("guide-calc-btn")).toBeNull();

    // Collapsible Archived Notes drawer surfaces orphaned retired-topic notes!
    const drawer = await screen.findByTestId("archived-notes-drawer");
    expect(drawer).toHaveTextContent("Archived Notes (1)");
    fireEvent.click(screen.getByRole("button", { name: /archived notes \(1\)/i }));
    expect(
      await screen.findByText("Preserved retired Futures 0.1 notes"),
    ).toBeInTheDocument();
  });
});
