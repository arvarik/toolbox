/**
 * Multi-Kit Study Workflows E2E (`/k/euclidean-geometry` + `/review`).
 *
 * Exercises non-default Kit routing and `X-Toolbox-Kit` propagation across:
 * - Ordered Mastery Path (`/k/:slug`) + Challenge Node modal
 * - Study Guide (`/k/:slug/guide`) + deep-link `page.reload()` SPA fallback
 * - Guided Drills (`/k/:slug/drills`) + 30-char scratchpad Hint 1 unlock gate
 * - Flashcards (`/k/:slug/study`) + Cross-Kit FSRS-6 Review (`/review`) keyboard flip & grade
 * - Graph (`/k/:slug/graph`), Canvas Concept vs Architecture (`/k/:slug/canvas`),
 *   Feynman (`/k/:slug/feynman`), and Calculator (`/k/:slug/calculator`)
 */
import {
  collectPageErrors,
  expect,
  resetLibrary,
  test,
} from "./fixtures/test.ts";
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";

test.describe("Multi-Kit Study Workflows (/k/euclidean-geometry)", () => {
  test.beforeAll(async ({ instance }) => {
    await resetLibrary(instance);
    await instance.api("POST", "/shared-kits/system-design/fork");
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit(),
    });
  });

  test("walks Ordered Mastery Path, readiness states, and Challenge Node modal", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/k/euclidean-geometry");
    await expect(page.getByTestId("kit-path-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Euclidean Geometry" }),
    ).toBeVisible();

    // Root node has no prerequisites (unlocked In Progress); downstream node -> Locked
    await expect(
      page.getByTestId("path-node-status-axioms-postulates"),
    ).toContainText("In Progress");
    await expect(
      page.getByTestId("path-node-status-triangle-congruence"),
    ).toContainText("Locked");

    // Switch between Topological Order and By Pillar grouping modes
    const groupingGroup = page.getByRole("group", { name: "Grouping mode" });
    await groupingGroup.getByRole("button", { name: "By Pillar" }).click();
    await expect(
      page.getByRole("heading", { name: /Pillar 1: Axiomatic Foundations/ }),
    ).toBeVisible();
    await groupingGroup
      .getByRole("button", { name: "Topological Order" })
      .click();
    await expect(
      page.getByTestId("path-node-pythagorean-theorem"),
    ).toBeVisible();

    // Open Challenge Node modal on the root node & validate form gating (offline, 0 LLM calls)
    await page.getByTestId("challenge-node-btn-axioms-postulates").click();
    const modal = page.getByTestId("challenge-node-modal");
    await expect(modal).toBeVisible();
    await expect(
      page.getByText(/Challenge Node: Euclid's Five Postulates/),
    ).toBeVisible();
    await expect(modal).toContainText("Synthesize Euclid's Five Postulates");

    const submitBtn = page.getByTestId("submit-challenge-btn");
    await expect(submitBtn).toBeDisabled();

    await page
      .locator("#challenge-drill-input")
      .fill("Construct line DE parallel to BC through vertex A and sum alternate interior angles.");
    await expect(submitBtn).toBeDisabled();

    await page
      .locator("#challenge-feynman-input")
      .fill("Playfair's postulate guarantees a unique parallel line, making interior angles sum to a straight line.");
    await expect(submitBtn).toBeEnabled();

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toHaveCount(0);
    expect(pageErrors).toEqual([]);
  });

  test("edits & saves personal Guide note and persists across production SPA deep-link reload", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/k/euclidean-geometry/guide");
    await expect(
      page.getByRole("heading", { name: "Euclidean Geometry Guide" }),
    ).toBeVisible();

    // Navigate into custom Pillar -> Topic
    await page
      .locator(".blueprint-pillar-card", { hasText: "Axioms" })
      .click();
    await expect(page).toHaveURL(/\/k\/euclidean-geometry\/guide\/foundations$/);
    await expect(
      page.getByRole("heading", { name: "Axiomatic Foundations" }),
    ).toBeVisible();

    await page.getByText("Parallel Postulate & Angles").first().click();
    await expect(page).toHaveURL(
      /\/k\/euclidean-geometry\/guide\/foundations\/parallel-postulate$/,
    );

    // Edit & save personal study note in first blueprint section
    const corePostulatesCard = page.locator("#blueprint-core-postulates");
    await expect(corePostulatesCard).toBeVisible();
    await corePostulatesCard.getByRole("button", { name: "Add notes" }).click();

    const noteMarkdown =
      "**Playfair's Axiom**: Equivalent to Euclid's 5th Postulate in neutral geometry.";
    await corePostulatesCard
      .locator(".blueprint-edit-textarea")
      .fill(noteMarkdown);
    await corePostulatesCard.getByRole("button", { name: "Save Notes" }).click();

    await expect(corePostulatesCard).toContainText("✓ Filled");
    await expect(corePostulatesCard).toContainText("Playfair's Axiom");

    // Hard reload on deep-linked `/k/euclidean-geometry/guide/...` route in NODE_ENV=production
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Parallel Postulate & Angles" }),
    ).toBeVisible();
    await expect(page.locator("#blueprint-core-postulates")).toContainText(
      "✓ Filled",
    );
    await expect(page.locator("#blueprint-core-postulates")).toContainText(
      "Equivalent to Euclid's 5th Postulate",
    );
    expect(pageErrors).toEqual([]);
  });

  test("enforces 30-character scratchpad attempt gate before unlocking Hint 1 in Drills", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/k/euclidean-geometry/drills");
    await expect(page.getByTestId("drills-page")).toBeVisible();
    await expect(page.getByTestId("guided-drill-workspace")).toBeVisible();
    await expect(page.getByTestId("drill-prompt-markdown")).toContainText(
      "sum to 180 degrees",
    );

    const hint1Btn = page.getByTestId("reveal-hint-1-btn");
    const scratchpad = page.getByTestId("drill-scratchpad");

    // Locked initially before >= 30 non-whitespace characters
    await expect(hint1Btn).toBeDisabled();
    await scratchpad.fill("Too short attempt");
    await expect(hint1Btn).toBeDisabled();

    // Typing >= 30 non-whitespace characters immediately unlocks Hint 1
    await scratchpad.fill(
      "Let line DE pass through A parallel to BC so alternate interior angles match.",
    );
    await expect(hint1Btn).toBeEnabled();
    await hint1Btn.click();

    await expect(page.getByTestId("hint-1-box")).toContainText(
      "Construct an auxiliary line through vertex A parallel to base BC.",
    );
    expect(pageErrors).toEqual([]);
  });

  test("reviews due flashcard via keyboard shortcuts in /review and updates FSRS-6 state", async ({
    page,
    instance,
  }) => {
    const pageErrors = collectPageErrors(page);

    // Confirm Euclidean Geometry starter deck renders on `/k/euclidean-geometry/study`
    await page.goto("/k/euclidean-geometry/study");
    await expect(page.locator("#study-page")).toBeVisible();
    await expect(page.getByText("Euclidean Geometry Core")).toBeVisible();

    // Measure initial cross-Kit due queue count via API
    const beforeDue = await instance.api<Array<{ id: string }>>(
      "GET",
      "/decks/all/cards/due",
    );
    expect(beforeDue.length).toBeGreaterThan(0);

    // Review a due card in `/review` using Space (flip) + 3 (Good)
    await page.goto("/review");
    await expect(page.getByTestId("review-page")).toBeVisible();
    await expect(page.getByTestId("review-card-front")).toBeVisible();
    await expect(page.getByTestId("reveal-answer-btn")).toBeVisible();

    await page.keyboard.press("Space");
    await expect(page.getByTestId("review-card-back")).toBeVisible();
    await expect(page.getByTestId("grade-btn-good")).toBeVisible();

    const reviewApiPromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/decks/") &&
        res.url().includes("/review") &&
        res.request().method() === "PUT",
    );
    await page.keyboard.press("3");
    const reviewApiRes = await reviewApiPromise;
    expect(reviewApiRes.ok()).toBe(true);
    const updatedCard = (await reviewApiRes.json()) as {
      state: number;
      interval: number;
      stability: number | null;
      repetitions: number;
    };
    expect(updatedCard.state).toBeGreaterThanOrEqual(1);
    expect(updatedCard.stability).not.toBeNull();
    expect(updatedCard.stability!).toBeGreaterThan(0);

    // Verify FSRS-6 stability telemetry updates and due count decremented
    await expect(page.getByText(/Last FSRS-6: S=/)).toBeVisible();
    const afterDue = await instance.api<Array<{ id: string }>>(
      "GET",
      "/decks/all/cards/due",
    );
    expect(afterDue.length).toBeLessThan(beforeDue.length);
    expect(pageErrors).toEqual([]);
  });

  test("renders Graph, Canvas (Concept vs Architecture modes), Feynman, and Calculator with zero runtime errors", async ({
    page,
  }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Knowledge Graph (`/k/euclidean-geometry/graph`)
    await page.goto("/k/euclidean-geometry/graph");
    await expect(page.locator("#graph-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Knowledge Graph" }),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Pillar filter" }),
    ).toContainText("Axioms");

    // 2. Canvas in Concept Map mode (`/k/euclidean-geometry/canvas`)
    await page.goto("/k/euclidean-geometry/canvas");
    await expect(page.locator("#builder-page")).toBeVisible();
    await expect(page.getByLabel("Linking phrase")).toBeVisible();
    await expect(page.locator("#builder-chat-btn")).toContainText("Verify Map");
    await page.locator("#save-board-btn").click();

    // Switch to System Design Kit Canvas (`/k/system-design/canvas`) -> Architecture mode
    await page.goto("/k/system-design/canvas");
    await expect(page.locator("#builder-page")).toBeVisible();
    await expect(page.getByLabel("Edge protocol")).toBeVisible();
    await expect(page.locator("#builder-chat-btn")).toContainText(
      "Verify Design",
    );

    // 3. Feynman Simulator (`/k/euclidean-geometry/feynman`)
    await page.goto("/k/euclidean-geometry/feynman");
    await expect(page.locator("#feynman-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Feynman Simulator" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Back to Euclidean Geometry Path/i }),
    ).toBeVisible();

    // 4. BotE Calculator (`/k/euclidean-geometry/calculator`)
    await page.goto("/k/euclidean-geometry/calculator");
    await expect(page.locator("#calculator-page")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "BotE Calculator" }),
    ).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
