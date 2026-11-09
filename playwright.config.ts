/**
 * Production full-workflow Playwright E2E suite for Toolbox v2.
 *
 * Run `npm run build && npm run test:e2e`. Each worker boots its own isolated
 * production Toolbox server (`NODE_ENV=production` serving `dist/` with full
 * security headers and CSP) backed by a fresh throwaway SQLite database.
 */
import { defineConfig, devices } from "@playwright/test";

const CI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./tests/e2e/global-setup.ts",
  outputDir: "test-results",

  // Spec files run in parallel across workers; tests within a file share the
  // worker's ToolboxInstance deterministically without racing each other.
  fullyParallel: false,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,

  timeout: 60_000,
  expect: { timeout: 10_000 },

  reporter: CI
    ? [["list"], ["github"], ["html", { open: "never" }]]
    : [["list"], ["html", { open: "never" }]],

  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    reducedMotion: "reduce",
    locale: "en-US",
    timezoneId: "America/Los_Angeles",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      grepInvert: /@mobile/,
    },
    {
      name: "mobile-chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
      },
      grep: /@mobile/,
    },
  ],
});
