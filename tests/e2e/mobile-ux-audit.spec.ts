/**
 * Comprehensive Mobile UX & Frontend Stability E2E Suite (`@mobile` + desktop harmony).
 *
 * Verifies across 320px, 375px, 390px, and 430px widths:
 * - Zero horizontal scroll (`document.documentElement.scrollWidth <= window.innerWidth`)
 * - >= 44x44px touch targets on primary mobile controls (WCAG 2.5.8 / Apple HIG)
 * - >= 16px computed font-size on mobile textual inputs/textareas (iOS Safari auto-zoom prevention)
 * - Mobile Chat workspace switching (Topics sheet <-> Chat <-> Context Notes bottom-sheet)
 * - Mobile Guide dogear toggle + Ask AI + math/code horizontal scroll containment
 * - Mobile Review scratchpad + 4-button side-by-side Anki grading bar
 * - Mobile Graph touch canvas (MiniMap hidden) + bottom-sheet NodePanel inspector
 * - WCAG 2.2 AA critical/serious axe-core compliance across mobile views
 */
import type { Locator, Page } from "@playwright/test";
import {
  collectPageErrors,
  expect,
  expectNoCriticalA11yViolations,
  resetLibrary,
  test,
} from "./fixtures/test.ts";
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";

const MOBILE_VIEWPORTS = [
  { width: 320, height: 568, label: "320x568" },
  { width: 375, height: 812, label: "375x812" },
  { width: 390, height: 844, label: "390x844" },
  { width: 430, height: 932, label: "430x932" },
] as const;

async function expectNoHorizontalOverflow(page: Page, contextLabel: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(
    metrics.scrollWidth,
    `Expected zero horizontal overflow on ${contextLabel} (scrollWidth=${metrics.scrollWidth}, innerWidth=${metrics.innerWidth})`,
  ).toBeLessThanOrEqual(metrics.innerWidth);
}

async function expectTouchTargetAtLeast44(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${label} bounding box`).not.toBeNull();
  expect(
    box!.width,
    `${label} width (${box!.width}px) should be >= 44px`,
  ).toBeGreaterThanOrEqual(43.5);
  expect(
    box!.height,
    `${label} height (${box!.height}px) should be >= 44px`,
  ).toBeGreaterThanOrEqual(43.5);
}

async function expectFontSizeAtLeast16(locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  const px = await locator.evaluate((el) =>
    Number.parseFloat(window.getComputedStyle(el).fontSize),
  );
  expect(
    px,
    `${label} font-size (${px}px) should be >= 16px on mobile`,
  ).toBeGreaterThanOrEqual(16);
}

test.describe("Mobile View Excellence & Frontend Harmony", () => {
  test(
    "enforces zero horizontal scroll across 320px/375px/390px/430px and passes mobile touch, font-size, bottom-sheet & axe-core checks",
    { tag: "@mobile" },
    async ({ page, instance }, testInfo) => {
      const pageErrors = collectPageErrors(page);

      await resetLibrary(instance);
      const skeleton = buildEuclideanGeometryKit();
      // Inject a wide code block + display KaTeX block into starter guide notes to verify overflow containment
      skeleton.seeds.baselineGuideNotes.push({
        pillarId: "foundations",
        topicId: "parallel-postulate",
        sectionId: "core-postulates",
        content:
          "Playfair's axiom holds on Euclidean planes.\n\n$$\\sum_{k=1}^{n} \\left(\\frac{a_k^2 + b_k^2}{c_k^2}\\right) = \\int_{0}^{\\infty} e^{-\\lambda x} \\cos(\\omega x)\\,dx$$\n\n```ts\nexport const veryLongIdentifierPreventingHorizontalPageOverflowOn320PxViewport = (alpha: number, beta: number) => Math.hypot(alpha, beta);\n```\n",
      });
      await instance.api("POST", "/kits/import-kit", { skeleton });

      // 1. Sweep all 4 canonical mobile widths (320, 375, 390, 430) across core views for zero overflow
      const coreRoutes: Array<{ path: string; ready: string; name: string }> = [
        {
          path: "/",
          ready: '[data-testid="kit-card-euclidean-geometry"]',
          name: "library",
        },
        {
          path: "/k/euclidean-geometry",
          ready: '[data-testid="kit-path-page"]',
          name: "kit-path",
        },
        {
          path: "/k/euclidean-geometry/guide/foundations/parallel-postulate",
          ready: 'h1:has-text("Parallel Postulate & Angles")',
          name: "guide-topic",
        },
        {
          path: "/k/euclidean-geometry/chat",
          ready: '[data-testid="mobile-chat-topics-btn"]',
          name: "chat",
        },
        {
          path: "/review",
          ready: '[data-testid="review-card-front"]',
          name: "review",
        },
        {
          path: "/k/euclidean-geometry/graph",
          ready: "#graph-canvas",
          name: "graph",
        },
        {
          path: "/k/euclidean-geometry/drills",
          ready: '[data-testid="drills-page"]',
          name: "drills",
        },
        {
          path: "/k/euclidean-geometry/feynman",
          ready: "textarea",
          name: "feynman",
        },
        {
          path: "/shared",
          ready: 'h1:has-text("Shared Community Library")',
          name: "shared",
        },
        {
          path: "/design-system",
          ready: '[data-testid="design-system-page"]',
          name: "design-system",
        },
        {
          path: "/settings",
          ready: "#mcp-settings-section",
          name: "settings",
        },
      ];

      for (const vp of MOBILE_VIEWPORTS) {
        await page.setViewportSize({ width: vp.width, height: vp.height });
        for (const route of coreRoutes) {
          await page.goto(route.path);
          await expect(page.locator(route.ready).first()).toBeVisible();
          await expectNoHorizontalOverflow(page, `${route.name}@${vp.label}`);
        }
      }

      // 2. Deep interactive mobile UX + a11y audit at 375x812 (iPhone standard) & 320x568 (narrowest)
      await page.setViewportSize({ width: 375, height: 812 });

      // Library + Mobile Header Search + Mobile Drawer touch targets & a11y
      await page.goto("/");
      await expect(
        page.getByTestId("kit-card-euclidean-geometry"),
      ).toBeVisible();
      await expectTouchTargetAtLeast44(
        page.locator("#mobile-menu-btn"),
        "Mobile menu button",
      );
      await expectTouchTargetAtLeast44(
        page.locator("#mobile-search-btn"),
        "Mobile search button",
      );
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-library",
      });

      // Open SearchDialog from MobileHeader & verify >=16px input + zero overflow
      await page.locator("#mobile-search-btn").click();
      const searchDialog = page.locator("#search-dialog");
      await expect(searchDialog).toBeVisible();
      await expectFontSizeAtLeast16(
        searchDialog.locator("input").first(),
        "Mobile search dialog input",
      );
      await expectNoHorizontalOverflow(page, "search-dialog@375x812");
      await page.keyboard.press("Escape");
      await expect(searchDialog).toBeHidden();

      // Open MobileDrawer & verify close button >=44x44px
      await page.locator("#mobile-menu-btn").click();
      await expect(page.locator("#mobile-drawer")).toBeVisible();
      await expectTouchTargetAtLeast44(
        page.locator("#mobile-nav-close"),
        "Mobile drawer close button",
      );
      await page.locator("#mobile-nav-close").click();

      // Guide Topic: dogear >=44x44px, mobile Ask AI button, KaTeX & code containment, axe-core
      await page.goto(
        "/k/euclidean-geometry/guide/foundations/parallel-postulate",
      );
      await expect(
        page.getByRole("heading", { name: "Parallel Postulate & Angles" }),
      ).toBeVisible();
      await expectTouchTargetAtLeast44(
        page.getByRole("button", { name: /Dogear this page|Remove page dogear/i }).first(),
        "Guide dogear button",
      );
      await expect(page.getByTestId("mobile-guide-ask-ai")).toBeVisible();
      await expectNoHorizontalOverflow(page, "guide-with-math-and-code@375");
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-guide",
      });

      // Chat Workspace: >=16px composer, Topics sheet, Context Notes sheet, Commit button reachability, axe-core
      await page.goto("/k/euclidean-geometry/chat");
      const composer = page.locator("textarea.learning-chat-input");
      await expectFontSizeAtLeast16(composer, "Mobile chat composer");
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-chat",
      });

      await page.getByTestId("mobile-chat-topics-btn").click();
      const topicsSheet = page.getByTestId("mobile-chat-topics-sheet");
      await expect(topicsSheet).toBeVisible();
      await expectNoHorizontalOverflow(page, "chat-topics-sheet@375");
      await topicsSheet.getByText("Triangles", { exact: true }).click();
      await topicsSheet
        .getByText("Right Triangles & Area Proofs")
        .first()
        .click();
      await expect(topicsSheet).toBeHidden();

      await page.getByTestId("chat-notebook-toggle").click();
      const notesInspector = page.getByTestId("chat-notebook-inspector");
      await expect(notesInspector).toBeVisible();
      await notesInspector.getByRole("tab", { name: /Updates/i }).click();
      await expect(
        notesInspector.getByTestId("inspector-commit-btn"),
      ).toBeVisible();
      await expectNoHorizontalOverflow(page, "chat-context-notes-sheet@375");
      await notesInspector
        .getByRole("button", { name: /Close/i })
        .first()
        .click();
      await expect(notesInspector).toBeHidden();

      // Review at 320x568: scratchpad >=16px, reveal >=44px, all 4 Anki grade buttons side-by-side >=44px height
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto("/review");
      await expect(page.getByTestId("review-card-front")).toBeVisible();
      await page.getByTestId("review-scratchpad-toggle").click();
      const scratchpad = page.getByTestId("review-scratchpad-input");
      await expectFontSizeAtLeast16(scratchpad, "Mobile review scratchpad");
      await scratchpad.fill("Recall check on mobile 320px");

      const revealBtn = page.getByTestId("reveal-answer-btn");
      await expectTouchTargetAtLeast44(revealBtn, "Reveal Answer button");
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-review-front",
      });

      await revealBtn.click();
      await expect(page.getByTestId("review-card-back")).toBeVisible();
      await expect(page.getByTestId("review-scratchpad-note")).toContainText(
        "Recall check on mobile 320px",
      );

      const gradeIds = [
        "grade-btn-again",
        "grade-btn-hard",
        "grade-btn-good",
        "grade-btn-easy",
      ] as const;
      const boxes = [];
      for (const gid of gradeIds) {
        const btn = page.getByTestId(gid);
        await expect(btn).toBeVisible();
        const b = await btn.boundingBox();
        expect(b).not.toBeNull();
        expect(b!.height).toBeGreaterThanOrEqual(44);
        boxes.push(b!);
      }
      // All 4 Anki grade buttons sit on the same horizontal thumb row even at 320px
      expect(Math.abs(boxes[0].y - boxes[3].y)).toBeLessThanOrEqual(2);
      await expectNoHorizontalOverflow(page, "review-graded-row@320");
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-review-back",
      });

      // Graph at 375x812: MiniMap hidden on mobile, tapping node opens bottom-sheet #graph-node-panel
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto("/k/euclidean-geometry/graph");
      await expect(page.locator("#graph-canvas")).toBeVisible();
      await expect(page.locator(".react-flow__minimap")).toHaveCount(0);

      const nodeEl = page.locator("#graph-node-pythagorean-theorem");
      await expect(nodeEl).toBeVisible();
      await nodeEl.click();

      const nodePanel = page.locator("#graph-node-panel");
      await expect(nodePanel).toBeVisible();
      await expectTouchTargetAtLeast44(
        nodePanel.locator(".graph-panel-close"),
        "Graph node inspector close button",
      );
      await expectNoHorizontalOverflow(page, "graph-node-panel@375");
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-graph-inspector",
      });

      // Settings at 375x812: inputs/textareas >=16px + axe-core
      await page.goto("/settings");
      await expect(page.locator("#mcp-settings-section")).toBeVisible();
      await expectFontSizeAtLeast16(
        page.locator("#mcp-settings-section").getByLabel("MCP token name"),
        "Settings MCP token input",
      );
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-settings-audit",
      });

      expect(pageErrors).toEqual([]);
    },
  );

  test("preserves desktop viewport meta accessibility, Graph MiniMap, and 4-column Review grading bar", async ({
    page,
    instance,
  }) => {
    const pageErrors = collectPageErrors(page);
    await resetLibrary(instance);
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit(),
    });

    await page.goto("/");
    const viewportContent = await page
      .locator('meta[name="viewport"]')
      .getAttribute("content");
    expect(viewportContent).toContain("viewport-fit=cover");
    expect(viewportContent).toContain("interactive-widget=resizes-content");
    expect(viewportContent).not.toContain("user-scalable=no");

    await page.goto("/k/euclidean-geometry/graph");
    await expect(page.locator("#graph-canvas")).toBeVisible();
    await expect(page.locator(".react-flow__minimap")).toBeVisible();

    await page.goto("/review");
    await expect(page.getByTestId("review-card-front")).toBeVisible();
    await page.getByTestId("reveal-answer-btn").click();
    await expect(page.getByTestId("grade-btn-good")).toBeVisible();

    expect(pageErrors).toEqual([]);
  });
});
