/**
 * New Kit Studio (`/new`) + Living Kit Expansion (`ExpandKitModal`) E2E Journeys.
 *
 * Exercises the full multi-stage Deep Research Kit Compiler against a local
 * deterministic OpenAI-compatible mock server (`mockAiServer.ts`):
 *   Stage 1 (Topic + Staged Syllabus) -> Stage 2 (3-Chip Calibration) ->
 *   Stage 3 (2-Pass Acyclic Blueprint & Verified [S1] Citations) ->
 *   Stage 4 (Commit + Background Pillar Seed Hydration) ->
 *   Ordered Mastery Path (`/k/:slug`) -> Living Kit Additive DAG Expansion.
 */
import { test as base } from "@playwright/test";
import { ToolboxInstance } from "./fixtures/instance.ts";
import {
  configureInstanceMockAi,
  startMockAiServer,
  type MockAiServer,
} from "./fixtures/mockAiServer.ts";
import {
  collectPageErrors,
  expect,
  expectNoCriticalA11yViolations,
  resetLibrary,
} from "./fixtures/test.ts";

interface CompilerWorkerFixtures {
  compilerInstance: ToolboxInstance;
  mockAi: MockAiServer;
}

const test = base.extend<{ serverLog: void }, CompilerWorkerFixtures>({
  mockAi: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const server = await startMockAiServer();
      await use(server);
      await server.stop();
    },
    { scope: "worker" },
  ],
  compilerInstance: [
    async ({ mockAi }, use) => {
      const instance = await ToolboxInstance.start({
        authRequired: false,
        env: { DISABLE_BACKGROUND_JOBS: "false" },
      });
      await configureInstanceMockAi(instance, mockAi);
      await use(instance);
      await instance.stop();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ compilerInstance }, use) => {
    await use(compilerInstance.baseURL);
  },
  serverLog: [
    async ({ compilerInstance }, use, testInfo) => {
      const mark = compilerInstance.mark();
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("server.log", {
          body: compilerInstance.logSince(mark),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
});

test.describe("New Kit Studio Compiler & Living Kit Expansion", () => {
  test("compiles a grounded Study Kit through Stages 1-4, hydrates starter content, renders /k/:slug mastery path, and expands the Living Kit DAG", async ({
    page,
    compilerInstance,
    mockAi,
  }, testInfo) => {
    const pageErrors = collectPageErrors(page);
    await resetLibrary(compilerInstance);
    mockAi.reset();

    // ── Stage 1: Topic, Depth, & Staged Syllabus Source ────────────────
    await page.goto("/new");
    await expect(
      page.getByRole("heading", { name: "Deep Research Kit Studio" }),
    ).toBeVisible();
    await expectNoCriticalA11yViolations(page, {
      testInfo,
      label: "new-kit-studio-stage1",
    });

    await page
      .getByTestId("studio-topic-input")
      .fill(
        "Distributed Consensus & Replicated State Machines (Lamport clocks, majority quorums, and Raft log commitment)",
      );

    // Disable outbound web research so compilation grounds strictly in staged [S1] notes
    const webToggle = page.getByTestId("studio-web-research-toggle");
    if (await webToggle.isChecked()) {
      await webToggle.uncheck();
    }

    await page.getByRole("button", { name: "Paste Syllabus" }).click();
    await page
      .getByPlaceholder(/Source title/i)
      .fill("Raft & Quorum Lecture Notes");
    await page
      .getByPlaceholder(/Paste raw markdown/i)
      .fill(
        "# Distributed Consensus Notes\n\n" +
          "1. Lamport logical timestamps establish causal partial order.\n" +
          "2. Any two majorities of N=2f+1 replicas intersect in at least one witness node.\n" +
          "3. Raft enforces Election Safety and Log Matching across monotonic terms.\n",
      );
    await page.getByRole("button", { name: "Stage Notes" }).click();

    await expect(page.getByTestId("staged-source-0")).toContainText(
      "[S1] Raft & Quorum Lecture Notes",
    );

    // ── Stage 2: 3-Chip Scope Calibration ──────────────────────────────
    await page.getByTestId("studio-calibrate-btn").click();

    const suggestedTitle = page.getByTestId("studio-suggested-title");
    await expect(suggestedTitle).toHaveValue("Distributed Consensus Systems");
    await expect(page.getByTestId("calibration-dim-background")).toBeVisible();
    await expect(page.getByTestId("calibration-dim-goal")).toBeVisible();
    await expect(page.getByTestId("calibration-dim-emphasis")).toBeVisible();

    await expectNoCriticalA11yViolations(page, {
      testInfo,
      label: "new-kit-studio-stage2",
    });

    await page
      .getByTestId("calibration-dim-goal")
      .getByRole("button", { name: /Production storage implementation/i })
      .click();

    // ── Stage 3: 2-Pass Blueprint & Acyclic Prerequisite DAG ───────────
    await page.getByTestId("studio-compile-btn").click();

    const blueprintEditor = page.getByTestId("studio-blueprint-editor");
    await expect(blueprintEditor).toBeVisible();
    await expect(blueprintEditor).toContainText("Acyclic DAG Verified");
    await expect(blueprintEditor).toContainText(
      "2 Pillars • 4 Topics • 4 Concept Nodes • 3 Prerequisite Edges • 1 Tracks",
    );
    await expect(
      blueprintEditor.locator('input[value="Quorum & Logical Time"]'),
    ).toBeVisible();
    await expect(
      blueprintEditor.locator('input[value="Raft Consensus & Replication"]'),
    ).toBeVisible();
    await expect(blueprintEditor).toContainText("Raft & Quorum Lecture Notes");

    await expectNoCriticalA11yViolations(page, {
      testInfo,
      label: "new-kit-studio-stage3",
    });

    // ── Stage 4: Commit Study Kit + Background Pillar Seed Hydration ───
    await page.getByTestId("studio-commit-btn").click();
    await expect(page).toHaveURL(/\/k\/distributed-consensus\/guide$/);

    // Wait deterministically for background seedHydrator job to finish
    await expect
      .poll(
        async () => {
          const status = await compilerInstance.api<{
            status: string;
            cardCount: number;
            drillCount: number;
            guideFilledCount: number;
          }>("GET", "/compiler/kits/distributed-consensus/seed-status");
          return status.status === "ready" ? status.cardCount : -1;
        },
        { timeout: 10_000 },
      )
      .toBe(4);

    // Open `/k/distributed-consensus` Ordered Mastery Path and verify DAG nodes & due cards
    await page.goto("/k/distributed-consensus");
    const kitPath = page.getByTestId("kit-path-page");
    await expect(kitPath).toBeVisible();
    await expect(
      kitPath.getByRole("heading", { name: "Distributed Consensus Systems" }),
    ).toBeVisible();
    await expect(kitPath).toContainText("Curriculum Concepts (4)");
    await expect(kitPath).toContainText("0 / 2");
    await expect(kitPath.getByTestId("track-chip-core-consensus")).toBeVisible();
    await expect(kitPath.getByTestId("kit-due-cards-btn")).toBeVisible();
    for (const nodeName of [
      "Lamport Timestamps",
      "Majority Quorum Overlap",
      "Raft Leader Election",
      "Log Matching & Commitment",
    ]) {
      await expect(kitPath).toContainText(nodeName);
    }

    // ── Living Kit Additive Expansion via `ExpandKitModal` on `/` ──────
    await page.goto("/");
    await page.getByTestId("expand-kit-btn-distributed-consensus").click();

    await page
      .getByTestId("expand-kit-prompt")
      .fill(
        "Add a Pillar on Jepsen linearizability history checkers and asymmetric partition nemeses",
      );
    await page.getByTestId("expand-kit-submit-btn").click();

    await expect(page.getByTestId("expand-kit-prompt")).toBeHidden();

    // Poll until the newly added Pillar's background seed job finishes (+2 cards -> 6 total)
    await expect
      .poll(
        async () => {
          const status = await compilerInstance.api<{
            status: string;
            cardCount: number;
          }>("GET", "/compiler/kits/distributed-consensus/seed-status");
          return status.status === "ready" ? status.cardCount : -1;
        },
        { timeout: 10_000 },
      )
      .toBe(6);

    // Re-open `/k/distributed-consensus` and verify zero-data-loss additive DAG growth
    await page.goto("/k/distributed-consensus");
    await expect(kitPath).toContainText("Curriculum Concepts (6)");
    await expect(
      kitPath.getByTestId("track-chip-fault-verification"),
    ).toBeVisible();
    await expect(kitPath).toContainText("Linearizability History Checkers");
    await expect(kitPath).toContainText("Asymmetric Partition Nemeses");
    await expect(kitPath).toContainText("Lamport Timestamps");

    expect(mockAi.requests.length).toBeGreaterThanOrEqual(6);
    expect(pageErrors).toEqual([]);
  });

  test(
    "supports mobile /new Kit Studio compilation without horizontal overflow or WCAG 2.2 AA violations",
    { tag: "@mobile" },
    async ({ page, compilerInstance }, testInfo) => {
      const pageErrors = collectPageErrors(page);
      await resetLibrary(compilerInstance);

      await page.goto("/new");
      await expect(
        page.getByRole("heading", { name: "Deep Research Kit Studio" }),
      ).toBeVisible();

      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-new-kit-studio",
      });

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(hasHorizontalOverflow).toBe(false);

      const webToggle = page.getByTestId("studio-web-research-toggle");
      if (await webToggle.isChecked()) {
        await webToggle.uncheck();
      }

      await page
        .getByTestId("studio-topic-input")
        .fill("Consensus Quorums & Replicated Logs");
      await page.getByTestId("studio-skip-calibrate-btn").click();

      await expect(page.getByTestId("studio-blueprint-editor")).toBeVisible();
      await page.getByTestId("studio-commit-btn").click();
      await expect(page).toHaveURL(/\/k\/distributed-consensus\/guide$/);

      expect(pageErrors).toEqual([]);
    },
  );
});
