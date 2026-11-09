/**
 * Shared Playwright fixtures and accessibility assertions for Toolbox E2E.
 *
 *   test       open (`AUTH_REQUIRED=false`) worker-scoped ToolboxInstance.
 *   gatedTest  fresh (`AUTH_REQUIRED=true`) per-test ToolboxInstance with 0 users.
 */
import {
  test as base,
  expect,
  type Page,
  type TestInfo,
} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { ToolboxInstance } from "./instance.ts";

interface OpenWorkerFixtures {
  instance: ToolboxInstance;
}

interface OpenTestFixtures {
  serverLog: void;
}

export const test = base.extend<OpenTestFixtures, OpenWorkerFixtures>({
  instance: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      const instance = await ToolboxInstance.start({ authRequired: false });
      await use(instance);
      await instance.stop();
    },
    { scope: "worker" },
  ],
  baseURL: async ({ instance }, use) => {
    await use(instance.baseURL);
  },
  serverLog: [
    async ({ instance }, use, testInfo) => {
      const mark = instance.mark();
      await use();
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach("server.log", {
          body: instance.logSince(mark),
          contentType: "text/plain",
        });
      }
    },
    { auto: true },
  ],
});

interface GatedTestFixtures {
  gated: ToolboxInstance;
}

export const gatedTest = base.extend<GatedTestFixtures>({
  // eslint-disable-next-line no-empty-pattern
  gated: async ({}, use, testInfo) => {
    const instance = await ToolboxInstance.start({ authRequired: true });
    await use(instance);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach("server.log", {
        body: instance.log(),
        contentType: "text/plain",
      });
    }
    await instance.stop();
  },
  baseURL: async ({ gated }, use) => {
    await use(gated.baseURL);
  },
});

export { expect };

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];
type AxeResults = Awaited<ReturnType<AxeBuilder["analyze"]>>;
type AxeViolation = AxeResults["violations"][number];

const WCAG_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
] as const;

function formatViolations(violations: AxeViolation[]): string {
  if (violations.length === 0) return "no serious/critical violations";
  return violations
    .map((v) => {
      const nodes = v.nodes
        .map((n) => `    ${n.target.join(" ")}: ${n.failureSummary ?? ""}`)
        .join("\n");
      return `${v.id} (${v.impact ?? "unknown"}): ${v.help}\n${nodes}`;
    })
    .join("\n\n");
}

/**
 * Scan the settled page with axe-core WCAG 2.2 AA rules and assert zero
 * serious or critical accessibility violations.
 */
export async function expectNoCriticalA11yViolations(
  page: Page,
  options?: {
    testInfo?: TestInfo;
    label?: string;
    disableRules?: string[];
  },
): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((anim) => anim.effect?.getTiming().iterations !== Infinity)
        .map((anim) => anim.finished.catch(() => {})),
    ),
  );
  let builder = new AxeBuilder({
    page: page as unknown as AxePage,
  }).withTags([...WCAG_TAGS]);
  if (options?.disableRules?.length) {
    builder = builder.disableRules(options.disableRules);
  }
  const results = await builder.analyze();
  const criticalOrSerious = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  if (options?.testInfo) {
    await options.testInfo.attach(`${options.label ?? "axe"}-results`, {
      body: JSON.stringify(results, null, 2),
      contentType: "application/json",
    });
  }
  expect(criticalOrSerious, formatViolations(criticalOrSerious)).toEqual([]);
}

/**
 * Collect uncaught `pageerror` exceptions during a browser flow so specs can
 * assert zero runtime exceptions across route transitions.
 */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (err) => {
    errors.push(err.stack ?? err.message);
  });
  return errors;
}

/**
 * Reset the open worker's library to a clean slate before a spec file runs,
 * ensuring deterministic behavior regardless of worker count (1, 2, or 4).
 */
export async function resetLibrary(instance: ToolboxInstance): Promise<void> {
  const { kits } = await instance.api<{ kits: Array<{ id: string }> }>(
    "GET",
    "/kits",
  );
  for (const kit of kits) {
    await instance.api("DELETE", `/kits/${kit.id}`);
  }
}
