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

    // Fold a notebook dogear on the topic page and verify it persists & surfaces Resume reading on `/`
    await page.getByRole("button", { name: "Dogear this page" }).first().click();
    await expect(
      page.getByRole("button", { name: "Remove page dogear" }).first(),
    ).toBeVisible();

    await page.goto("/");
    const geoCard = page.getByTestId("kit-card-euclidean-geometry");
    await expect(
      page.getByTestId("kit-resume-link-euclidean-geometry"),
    ).toBeVisible();
    await expect(geoCard).toContainText("1 dogeared");

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

  test("7a. calling GET /api/drills on a fresh instance before forking system-design populates flashcards & guide notes without 409", async ({
    page,
  }) => {
    const { ToolboxInstance } = await import("./fixtures/instance.ts");
    const { buildEuclideanGeometryKit } = await import("./fixtures/kits.ts");
    const fresh = await ToolboxInstance.start({ authRequired: false });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));

    try {
      // 1. Trigger ensureDefaultSystemDesignKit via GET /api/drills (creates bare shell with 0 decks/notes)
      const drillsRes = await fetch(`${fresh.baseURL}/api/drills`);
      expect(drillsRes.ok).toBe(true);
      const drills = (await drillsRes.json()) as unknown[];
      expect(Array.isArray(drills)).toBe(true);

      // 2. Forking official system-design kit must hydrate starter deck instead of returning 409 KIT_SLUG_CONFLICT
      const forkRes = await fetch(`${fresh.baseURL}/api/shared-kits/system-design/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(forkRes.status).not.toBe(409);
      expect(forkRes.ok).toBe(true);

      const dueCards = await fresh.api<unknown[]>(
        "GET",
        "/decks/all/cards/due?kitId=system-design",
      );
      expect(dueCards.length).toBeGreaterThan(0);

      // Hydrated starter flashcards are immediately searchable via RAG/FTS
      const searchRes = await fresh.api<{ chunks: unknown[] }>(
        "GET",
        "/search?q=consistent&kitId=system-design",
      );
      expect(searchRes.chunks.length).toBeGreaterThan(0);

      // 3. Also verify a shared kit carrying starterDeck + baselineGuideNotes + drills hydrates all three on fork
      const richSkeleton = buildEuclideanGeometryKit({
        slug: "fork-seed-rich-src",
        name: "Seeded Geometry Reference",
        includeStarterContent: true,
      });
      richSkeleton.seeds.baselineGuideNotes = [
        {
          pillarId: "foundations",
          topicId: "parallel-postulate",
          sectionId: "core-postulates",
          content: "Forked baseline guide note on parallel lines and transversal axioms.",
        },
      ];
      richSkeleton.seeds.drills = [
        {
          key: "fork-parallel-drill",
          nodeId: "axioms-postulates",
          difficulty: 1,
          prompt: "State Euclid's fifth postulate and an equivalent planar statement.",
          hints: ["Consider a line and external point.", "Compare intersecting angles.", "Playfair's axiom."],
          rubricPoints: ["Mentions unique parallel line"],
          workedSolution: "Through a point not on line L, there exists at most one line parallel to L.",
        },
      ];
      const importedRich = await fresh.api<{ kit: { id: string } }>(
        "POST",
        "/kits/import-kit",
        { skeleton: richSkeleton },
      );
      await fresh.api("POST", `/kits/${importedRich.kit.id}/publish`, {
        slug: "fork-seed-rich-shared",
        summary: "Starter cards + baseline guide notes + drills",
        includeBaselineNotes: true,
      });
      const richForkRes = await fetch(
        `${fresh.baseURL}/api/shared-kits/fork-seed-rich-shared/fork`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ customSlug: "fork-seed-rich-copy" }),
        },
      );
      expect(richForkRes.ok).toBe(true);

      const richDue = await fresh.api<unknown[]>(
        "GET",
        "/decks/all/cards/due?kitId=fork-seed-rich-copy",
      );
      expect(richDue.length).toBeGreaterThan(0);

      const richProgress = await fresh.api<Record<string, boolean>>(
        "GET",
        "/guide-content/progress?kitId=fork-seed-rich-copy",
      );
      expect(richProgress["foundations__parallel-postulate__core-postulates"]).toBe(true);

      const richDrills = await fresh.api<unknown[]>(
        "GET",
        "/drills?kitId=fork-seed-rich-copy",
      );
      expect(richDrills.length).toBeGreaterThan(0);

      const richSearch = await fresh.api<{ chunks: unknown[] }>(
        "GET",
        "/search?q=transversal&kitId=fork-seed-rich-copy",
      );
      expect(richSearch.chunks.length).toBeGreaterThan(0);

      await page.goto(`${fresh.baseURL}/k/system-design`);
      await expect(page.getByText(/System Design/i).first()).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await fresh.stop();
    }
  });

  test("7b. remediation stays open on Again and resolves on Good, high-difficulty prereqs unlock on state=2, and interval=21 marks graph node mastered", async ({
    page,
  }) => {
    const { ToolboxInstance } = await import("./fixtures/instance.ts");
    const { buildEuclideanGeometryKit } = await import("./fixtures/kits.ts");
    const { createZipArchive } = await import("../../server/platform/archive/zip.ts");

    const fresh = await ToolboxInstance.start({ authRequired: false });
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));

    try {
      const labSkeleton = buildEuclideanGeometryKit({
        slug: "fsrs-e2e-lab",
        name: "FSRS Remediation Lab",
        includeStarterContent: false,
      });
      await fresh.api("POST", "/kits/import-kit", { skeleton: labSkeleton });

      const deck = await fresh.api<{ id: string }>(
        "POST",
        "/decks",
        { name: "Remediation Gate Deck", settings: { steps: "1m" } },
        { "X-Toolbox-Kit": "fsrs-e2e-lab" },
      );

      const prereqCard = await fresh.api<{ id: string }>(
        "POST",
        `/decks/${deck.id}/cards`,
        {
          front: "What does Euclid's parallel postulate guarantee?",
          back: "At most one parallel line through an external point.",
          node_id: "axioms-postulates",
        },
        { "X-Toolbox-Kit": "fsrs-e2e-lab" },
      );

      const depCard = await fresh.api<{ id: string }>(
        "POST",
        `/decks/${deck.id}/cards`,
        {
          front: "Why do planar triangle angles sum to 180 degrees?",
          back: "Alternate interior angles formed by a parallel line through a vertex.",
          node_id: "triangle-congruence",
          prerequisite_id: prereqCard.id,
        },
        { "X-Toolbox-Kit": "fsrs-e2e-lab" },
      );

      // While prereqCard is unseen (state=0) or in learning (state=1), depCard stays locked
      const dueWhileUnseen = await fresh.api<Array<{ id: string }>>(
        "GET",
        `/decks/${deck.id}/cards/due`,
      );
      expect(dueWhileUnseen.some((c) => c.id === depCard.id)).toBe(false);

      // Fail prereqCard once (Again -> high difficulty, reduced ease, state=1)
      await fresh.api(
        "POST",
        `/decks/${deck.id}/cards/${prereqCard.id}/review`,
        { quality: 1 },
      );
      const dueWhileLearning = await fresh.api<Array<{ id: string }>>(
        "GET",
        `/decks/${deck.id}/cards/due`,
      );
      expect(dueWhileLearning.some((c) => c.id === depCard.id)).toBe(false);

      // Graduate prereqCard to state=2 despite high difficulty / lowered ease
      for (let step = 0; step < 3; step += 1) {
        const cards = await fresh.api<Array<{ id: string; state: number }>>(
          "GET",
          `/decks/${deck.id}/cards`,
        );
        if (cards.find((c) => c.id === prereqCard.id)?.state === 2) break;
        await fresh.api(
          "POST",
          `/decks/${deck.id}/cards/${prereqCard.id}/review`,
          { quality: 4 },
        );
      }

      const cardsAfterGrad = await fresh.api<
        Array<{ id: string; state: number; ease_factor: number; difficulty: number | null }>
      >("GET", `/decks/${deck.id}/cards`);
      const gradPrereq = cardsAfterGrad.find((c) => c.id === prereqCard.id)!;
      expect(gradPrereq.state).toBe(2);

      // High-difficulty graduated prerequisite unlocks depCard
      const dueAfterGrad = await fresh.api<Array<{ id: string }>>(
        "GET",
        `/decks/${deck.id}/cards/due`,
      );
      expect(dueAfterGrad.some((c) => c.id === depCard.id)).toBe(true);

      // Fail depCard to enqueue shaky prereqCard in remediation_queue
      await fresh.api("POST", `/decks/${deck.id}/cards/${depCard.id}/review`, {
        quality: 1,
      });

      const dueWithRem = await fresh.api<
        Array<{ id: string; is_remediation?: number; remediation_reason?: string }>
      >("GET", "/decks/all/cards/due?kitId=fsrs-e2e-lab");
      expect(
        dueWithRem.some((c) => c.id === prereqCard.id && c.is_remediation === 1),
      ).toBe(true);

      // Open /review UI, fail remediation card with Again ('1'), verify remediation stays open
      await page.goto(`${fresh.baseURL}/review`);
      await expect(page.getByTestId("review-remediation-banner")).toBeVisible();
      await expect(page.getByTestId("review-card-front")).toContainText(
        "Euclid's parallel postulate",
      );

      await page.keyboard.press("Space");
      const againRespPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/cards/${prereqCard.id}/review`) &&
          res.request().method() === "PUT",
      );
      await page.keyboard.press("1");
      await againRespPromise;

      const dueAfterAgain = await fresh.api<
        Array<{ id: string; is_remediation?: number }>
      >("GET", "/decks/all/cards/due?kitId=fsrs-e2e-lab");
      expect(
        dueAfterAgain.some((c) => c.id === prereqCard.id && c.is_remediation === 1),
      ).toBe(true);

      // Pass the re-queued remediation card with Good ('3'), verifying remediation resolves cleanly
      await expect(page.getByTestId("review-remediation-banner")).toBeVisible();
      await expect(page.getByRole("button", { name: /Reveal Answer/i })).toBeVisible();
      await page.keyboard.press("Space");
      const goodRespPromise = page.waitForResponse(
        (res) =>
          res.url().includes(`/cards/${prereqCard.id}/review`) &&
          res.request().method() === "PUT",
      );
      await page.keyboard.press("3");
      await goodRespPromise;

      const dueAfterGood = await fresh.api<
        Array<{ id: string; is_remediation?: number }>
      >("GET", "/decks/all/cards/due?kitId=fsrs-e2e-lab");
      expect(
        dueAfterGood.some((c) => c.id === prereqCard.id && c.is_remediation === 1),
      ).toBe(false);

      // Verify interval === 21 marks a Graph node as "mastered" via Mode 2 backup archive restore
      const masteredSkeleton = buildEuclideanGeometryKit({
        slug: "mastered-node-lab",
        name: "Mastered Boundary Lab",
        includeStarterContent: false,
      });
      const nowIso = new Date().toISOString();
      const future21Iso = new Date(Date.now() + 21 * 86_400_000).toISOString();
      const masteredZip = await createZipArchive([
        {
          name: "kit.json",
          data: Buffer.from(JSON.stringify(masteredSkeleton), "utf8"),
        },
        {
          name: "userdata.json",
          data: Buffer.from(
            JSON.stringify({
              format: "toolbox-kit-userdata",
              schemaVersion: 1,
              exportedAt: nowIso,
              originalKitId: "orig-mastered-kit",
              decks: [
                {
                  id: "deck-mastered-21",
                  name: "Mastery Boundary Deck",
                  description: "",
                  createdAt: nowIso,
                  updatedAt: nowIso,
                },
              ],
              flashcards: [
                {
                  id: "card-interval-21",
                  deckId: "deck-mastered-21",
                  nodeId: "axioms-postulates",
                  front: "Boundary 21-day card",
                  back: "Exact interval=21 mastery boundary",
                  state: 2,
                  easeFactor: 2.5,
                  interval: 21,
                  repetitions: 5,
                  stability: 21,
                  difficulty: 4.5,
                  lastReviewed: nowIso,
                  nextReview: future21Iso,
                  createdAt: nowIso,
                  updatedAt: nowIso,
                },
              ],
            }),
            "utf8",
          ),
        },
      ]);

      const form = new FormData();
      form.append(
        "file",
        new Blob([Uint8Array.from(masteredZip)], { type: "application/zip" }),
        "mastered-boundary.toolbox-backup.zip",
      );
      const importRes = await fetch(`${fresh.baseURL}/api/kits/import-backup`, {
        method: "POST",
        body: form,
      });
      expect(importRes.ok).toBe(true);

      const graphRes = await fresh.api<{
        nodes: Array<{ id: string; health: string }>;
      }>("GET", "/graph", undefined, { "X-Toolbox-Kit": "mastered-node-lab" });
      expect(
        graphRes.nodes.find((n) => n.id === "axioms-postulates")?.health,
      ).toBe("mastered");

      await page.goto(`${fresh.baseURL}/k/mastered-node-lab/graph`);
      await page.getByRole("button", { name: "Mastered" }).click();
      await expect(page.getByText("Euclid's Five Postulates").first()).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await fresh.stop();
    }
  });

  test("7c. isolates chat_sessions across Kits so Kit B cannot overwrite or delete Kit A sessions", async ({
    page,
    instance,
  }) => {
    const { buildEuclideanGeometryKit } = await import("./fixtures/kits.ts");
    const errors: string[] = [];
    page.on("pageerror", (err) => errors.push(String(err)));

    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit({
        slug: "chat-iso-kit-a",
        name: "Chat Isolation Kit A",
        includeStarterContent: false,
      }),
    });
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit({
        slug: "chat-iso-kit-b",
        name: "Chat Isolation Kit B",
        includeStarterContent: false,
      }),
    });

    const sharedSessionId = "e2e-chat-iso-session";
    await instance.api(
      "POST",
      "/chat/sessions",
      {
        session: {
          id: sharedSessionId,
          name: "Kit A Private Thread",
          messages: [
            {
              role: "user",
              content: "Confidential Kit A theorem proof prompt",
            },
          ],
        },
      },
      { "X-Toolbox-Kit": "chat-iso-kit-a" },
    );

    // Attempt overwrite & delete from Kit B using the same session ID
    await instance.api(
      "POST",
      "/chat/sessions",
      {
        session: {
          id: sharedSessionId,
          name: "Hijacked From Kit B",
          messages: [],
        },
      },
      { "X-Toolbox-Kit": "chat-iso-kit-b" },
    );
    await instance.api("DELETE", `/chat/sessions/${sharedSessionId}`, undefined, {
      "X-Toolbox-Kit": "chat-iso-kit-b",
    });

    const kitASessions = await instance.api<
      Record<string, { id: string; name: string; messages: Array<{ content: string }> }>
    >("GET", "/chat/sessions", undefined, { "X-Toolbox-Kit": "chat-iso-kit-a" });
    expect(kitASessions[sharedSessionId]?.name).toBe("Kit A Private Thread");
    expect(kitASessions[sharedSessionId]?.messages[0]?.content).toBe(
      "Confidential Kit A theorem proof prompt",
    );

    const kitBSessions = await instance.api<Record<string, unknown>>(
      "GET",
      "/chat/sessions",
      undefined,
      { "X-Toolbox-Kit": "chat-iso-kit-b" },
    );
    expect(kitBSessions[sharedSessionId]).toBeUndefined();

    // Verify in browser UI across both Kit chat routes
    await page.goto("/k/chat-iso-kit-a/chat");
    await expect(
      page.getByText("Confidential Kit A theorem proof prompt"),
    ).toBeVisible();

    await page.goto("/k/chat-iso-kit-b/chat");
    await expect(
      page.getByText("Confidential Kit A theorem proof prompt"),
    ).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
