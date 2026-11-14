/**
 * Architecture Builder Canvas (`/k/:slug/builder`), BotE Capacity Calculator
 * (`/k/:slug/calculator`), and `⌘/` (`Control+/`) Global Search Dialog E2E Journeys.
 */
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";
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
  test,
} from "./fixtures/test.ts";

test.describe("Architecture Canvas, BotE Calculator & Global Search", () => {
  let mockAi: MockAiServer;

  test.beforeAll(async ({ instance }) => {
    mockAi = await startMockAiServer();
    await configureInstanceMockAi(instance, mockAi);

    await resetLibrary(instance);
    await instance.api("POST", "/shared-kits/system-design/fork");
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit(),
    });

    // Seed a distinctive flashcard in `system-design` for FTS5 hybrid search verification
    const deck = await instance.api<{ id: string }>(
      "POST",
      "/decks",
      {
        name: "Consensus Fencing Deck",
        description: "Seeded deck for global search E2E",
      },
      { "X-Toolbox-Kit": "system-design" },
    );
    await instance.api(
      "POST",
      `/decks/${deck.id}/cards`,
      {
        front: "What invariant does ZephyrQuorumLease guarantee across epochs?",
        back: "Monotonic fencing tokens reject delayed writes from zombies.",
      },
      { "X-Toolbox-Kit": "system-design" },
    );
  });

  test.afterAll(async () => {
    await mockAi?.stop();
  });

  test("builds, audits, and persists an architecture board across reload while isolating boards per Kit", async ({
    page,
    instance,
  }, testInfo) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/k/system-design/builder");
    const canvas = page.locator("#builder-canvas");
    await expect(canvas).toBeVisible();

    await expectNoCriticalA11yViolations(page, {
      testInfo,
      label: "system-design-builder",
    });

    // Load a multi-node + multi-edge architecture topology from the Template Gallery
    await page.locator("#template-btn").click();
    const gallery = page.locator("#template-gallery");
    await expect(gallery).toBeVisible();
    await gallery.locator(".template-card").first().click();

    const nodes = canvas.locator(".builder-node");
    await expect.poll(async () => await nodes.count()).toBeGreaterThanOrEqual(3);
    const templateNodeCount = await nodes.count();
    await expect
      .poll(async () => await canvas.locator(".react-flow__edge").count())
      .toBeGreaterThanOrEqual(2);

    // Drop an additional component node from `#builder-toolbox` onto `#builder-canvas`
    const firstToolboxItem = page
      .locator("#builder-toolbox .toolbox-item")
      .first();
    await expect(firstToolboxItem).toBeVisible();
    await page.evaluate(() => {
      const source = document.querySelector("#builder-toolbox .toolbox-item");
      const target = document.querySelector("#builder-canvas");
      if (!source || !target) {
        throw new Error("Missing toolbox item or builder canvas");
      }
      const dt = new DataTransfer();
      source.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt }),
      );
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(
        new DragEvent("dragover", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: rect.left + 220,
          clientY: rect.top + 180,
        }),
      );
      target.dispatchEvent(
        new DragEvent("drop", {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: rect.left + 220,
          clientY: rect.top + 180,
        }),
      );
    });

    await expect(nodes).toHaveCount(templateNodeCount + 1);

    // Rename active board tab -> Save to SQLite
    const activeTab = page.locator("#board-list .board-tab.active");
    await activeTab.dblclick();
    const tabInput = page.locator("#board-list .board-tab-input");
    await expect(tabInput).toBeVisible();
    await tabInput.fill("Zephyr Checkout HA Topology");
    await tabInput.press("Enter");
    await expect(activeTab).toContainText("Zephyr Checkout HA Topology");

    const savePromise = page.waitForResponse(
      (res) =>
        res.url().includes("/api/boards") &&
        (res.request().method() === "POST" || res.request().method() === "PUT"),
    );
    await page.locator("#save-board-btn").click();
    const saveRes = await savePromise;
    expect(saveRes.ok()).toBe(true);

    // Run deterministic Architecture Linter Audit + AI Rubric Critique
    await page.locator("#builder-audit-btn").click();
    const critiqueBtn = page.locator("#run-ai-critique-btn");
    await expect(critiqueBtn).toBeVisible();
    await expect(page.getByText(/components · .* data edges/i)).toBeVisible();

    await critiqueBtn.click();
    await expect(page.getByTestId("rubric-feedback-card")).toBeVisible();
    await expect(page.getByTestId("rubric-pass-badge")).toContainText(
      "Passed Rubric",
    );
    await page.getByRole("button", { name: /Close/i }).last().click();

    // Reload page and verify SQLite board persistence
    await page.reload();
    await expect(
      page.locator("#board-list .board-tab.active"),
    ).toContainText("Zephyr Checkout HA Topology");
    await expect(page.locator("#builder-canvas .builder-node")).toHaveCount(
      templateNodeCount + 1,
    );

    // Switch to a second Kit (`/k/euclidean-geometry/canvas`) and verify strict per-Kit board isolation
    await page.goto("/k/euclidean-geometry/canvas");
    await expect(page.locator("#builder-canvas")).toBeVisible();
    await expect(page.locator("#board-list")).not.toContainText(
      "Zephyr Checkout HA Topology",
    );
    const geometryBoards = await instance.api<Array<{ id: string }>>(
      "GET",
      "/boards",
      undefined,
      { "X-Toolbox-Kit": "euclidean-geometry" },
    );
    expect(geometryBoards).toEqual([]);

    expect(pageErrors).toEqual([]);
  });

  test("recomputes BotE Calculator metrics live and navigates via Control+/ SearchDialog", async ({
    page,
  }, testInfo) => {
    const pageErrors = collectPageErrors(page);

    await page.goto("/k/system-design/calculator");
    await expect(page.locator("#calculator-page")).toBeVisible();
    await expect(page.locator("#calc-sandbox")).toBeVisible();

    await expectNoCriticalA11yViolations(page, {
      testInfo,
      label: "system-design-calculator",
    });

    const writeQpsStat = page
      .locator(".calc-stat")
      .filter({ hasText: "Avg Write QPS" });
    const readQpsStat = page
      .locator(".calc-stat")
      .filter({ hasText: "Avg Read QPS" });
    await expect(writeQpsStat).toBeVisible();

    // Select a BotE Scenario preset chip and verify inputs & results update
    const scenarioGroup = page.getByRole("group", { name: "Scenario presets" });
    const secondChip = scenarioGroup.locator("button").nth(1);
    await secondChip.click();
    await expect(secondChip).toHaveClass(/active/);

    const beforeWriteText = (await writeQpsStat.textContent()) ?? "";
    const beforeReadText = (await readQpsStat.textContent()) ?? "";

    // Modify Daily Active Users (`#calc-dau`) and commit via Enter
    const dauInput = page.locator("#calc-dau");
    await dauInput.fill("85000000");
    await dauInput.press("Enter");

    await expect
      .poll(async () => await writeQpsStat.textContent())
      .not.toBe(beforeWriteText);
    await expect
      .poll(async () => await readQpsStat.textContent())
      .not.toBe(beforeReadText);

    // Trigger global SearchDialog via `Control+/` (`⌘/` shortcut)
    await page.keyboard.press("Control+/");
    const searchDialog = page.locator("#search-dialog");
    await expect(searchDialog).toBeVisible();

    const searchInput = searchDialog.locator('input[type="text"]');
    await expect(searchInput).toBeFocused();
    await searchInput.fill("ZephyrQuorumLease");

    const cardResult = searchDialog
      .locator(".search-result-item")
      .filter({ hasText: "ZephyrQuorumLease" });
    await expect(cardResult).toBeVisible();
    await cardResult.click();

    await expect(searchDialog).toBeHidden();
    await expect(page).toHaveURL(/\/k\/system-design\/study$/);

    expect(pageErrors).toEqual([]);
  });

  test(
    "renders mobile BotE Calculator and Control+/ SearchDialog cleanly on 390x844",
    { tag: "@mobile" },
    async ({ page }, testInfo) => {
      const pageErrors = collectPageErrors(page);

      await page.goto("/k/system-design/calculator");
      await expect(page.locator("#calculator-page")).toBeVisible();
      await expect(page.locator("#calc-sandbox")).toBeVisible();

      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-calculator",
      });

      const hasOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(hasOverflow).toBe(false);

      await page.keyboard.press("Control+/");
      const searchDialog = page.locator("#search-dialog");
      await expect(searchDialog).toBeVisible();
      await expect(searchDialog.locator('input[type="text"]')).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(searchDialog).toBeHidden();

      expect(pageErrors).toEqual([]);
    },
  );

  test("flags single-app-server compute SPOF, recognizes URL Shortener rate limiter, and enforces ChatPanel streaming & shortcut guards", async ({
    page,
    instance,
  }) => {
    const pageErrors = collectPageErrors(page);

    // 1. Seed Client -> API Gateway -> 1 App Server board to verify SPOF & circuit-breaker fix
    const spofBoard = await instance.api<{ id: string }>(
      "POST",
      "/boards",
      {
        name: "Gateway SPOF Topology",
        data: {
          nodes: [
            { id: "c1", type: "arch", name: "Web Client", category: "Clients", icon: "monitor", x: 80, y: 120 },
            { id: "gw1", type: "arch", name: "API Gateway", category: "Compute", icon: "door-open", x: 280, y: 120 },
            { id: "app1", type: "arch", name: "Core Service", category: "Compute", icon: "box", x: 480, y: 120 },
          ],
          edges: [
            { id: "e1", source: "c1", target: "gw1" },
            { id: "e2", source: "gw1", target: "app1" },
          ],
        },
      },
      { "X-Toolbox-Kit": "system-design" },
    );

    await page.goto(`/k/system-design/builder?board=${spofBoard.id}`);
    await expect(page.locator("#builder-canvas .builder-node")).toHaveCount(3);
    await page.locator("#builder-audit-btn").click();
    await expect(page.getByText("Single Point of Failure (Compute)")).toBeVisible();
    await expect(page.getByText("No Circuit Breaker Protection")).toHaveCount(0);
    await page.getByRole("button", { name: /Close/i }).last().click();

    // 2. Load URL Shortener template -> verify Rate Limiter is counted under Resiliency
    await page.locator("#template-btn").click();
    await page.locator("#template-gallery .template-card", { hasText: "URL Shortener" }).click();
    await page.locator("#builder-audit-btn").click();
    await expect(
      page.getByText("Traffic Protection: Rate limiter guards against abuse and burst exhaustion."),
    ).toBeVisible();
    await expect(page.getByText("Missing Ingress Rate Limiter")).toHaveCount(0);
    await page.getByRole("button", { name: /Close/i }).last().click();

    // 3. Control+Shift+J must NOT toggle ChatPanel, while Control+j toggles it open
    await page.keyboard.press("Control+Shift+J");
    await expect(page.getByTestId("chat-panel-container")).toBeHidden();

    await page.keyboard.press("Control+j");
    const chatPanel = page.getByTestId("chat-panel-container");
    await expect(chatPanel).toBeVisible();

    // 4. Verify single loading bubble before first token and safe external link/image rendering
    let releaseStream!: () => void;
    const streamGate = new Promise<void>((resolve) => {
      releaseStream = resolve;
    });
    await page.route("**/api/chat/stream", async (route) => {
      await streamGate;
      const body = [
        'data: {"text":"Read [External Docs](https://example.com/guide) and ![Tracker](https://tracker.example/pixel.png)"}\n\n',
        "data: [DONE]\n\n",
      ].join("");
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/event-stream; charset=utf-8" },
        body,
      });
    });

    await chatPanel.locator("#chat-input-builder").fill("Check streaming bubble and safety");
    await chatPanel.getByRole("button", { name: "Send message" }).click();

    // While stream hasn't delivered first token: exactly 1 AI row containing chat-loading
    await expect(chatPanel.getByTestId("message-ai")).toHaveCount(1);
    await expect(chatPanel.getByTestId("chat-loading")).toHaveCount(1);
    await expect(
      chatPanel.getByTestId("message-ai").getByTestId("chat-loading"),
    ).toBeVisible();

    releaseStream();

    await expect(chatPanel.getByTestId("chat-loading")).toHaveCount(0);
    await expect(chatPanel.getByTestId("message-ai")).toHaveCount(1);

    const extLink = chatPanel.getByRole("link", { name: "External Docs" });
    await expect(extLink).toHaveAttribute("target", "_blank");
    await expect(extLink).toHaveAttribute("rel", "noopener noreferrer");

    await expect(
      chatPanel.locator('img[src*="tracker.example"]'),
    ).toHaveCount(0);
    await expect(chatPanel.getByTestId("external-image-link")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );

    expect(pageErrors).toEqual([]);
  });
});
