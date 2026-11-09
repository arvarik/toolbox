/**
 * Multi-User Shared Community Library (`/shared`) Publish/Fork + Strict Tenant
 * Isolation (`AUTH_REQUIRED=true`) + Guided Drills (`/k/:slug/drills`) &
 * Feynman Simulator (`/k/:slug/feynman`) Rubric Pedagogy E2E Journeys.
 */
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";
import {
  configureInstanceMockAi,
  startMockAiServer,
} from "./fixtures/mockAiServer.ts";
import {
  collectPageErrors,
  expect,
  expectNoCriticalA11yViolations,
  gatedTest,
  resetLibrary,
  test,
} from "./fixtures/test.ts";

gatedTest.describe(
  "Shared Community Library Multi-User Publish/Fork & AI Pedagogy",
  () => {
    gatedTest(
      "publishes a Kit as User A, forks & studies as User B in a separate browser context with strict tenant isolation, and grades Drills + Feynman explanations via rubric AI",
      async ({ page, browser, gated }, testInfo) => {
        const mockAi = await startMockAiServer();
        const userAErrors = collectPageErrors(page);
        const userBContext = await browser.newContext({
          baseURL: gated.baseURL,
        });
        const userBPage = await userBContext.newPage();
        const userBErrors = collectPageErrors(userBPage);

        try {
          // ── 1. Browser Context 1 (User A / Admin): Setup + Mock AI + Publish ──
          // auth-and-tenancy.spec.ts walks the Setup Wizard, Open Sign-Up, and registration UI.
          const setupRes = await page.request.post("/api/auth/setup", {
            data: {
              username: "alice_publisher",
              displayName: "Alice Publisher",
              email: "alice@toolbox.local",
              password: "CorrectHorseBatteryStaple1!",
            },
          });
          expect(setupRes.status()).toBe(201);
          const adminCookie = (await page.context().cookies())
            .map((c) => `${c.name}=${c.value}`)
            .join("; ");
          // Instance-wide mock AI endpoint, so all users inherit deterministic AI
          await configureInstanceMockAi(gated, mockAi, { Cookie: adminCookie });
          await gated.api(
            "PUT",
            "/admin/settings",
            { registrationOpen: true },
            { Cookie: adminCookie },
          );

          // Import custom Euclidean Geometry Kit as User A and publish to Shared Library
          const importRes = await page.request.post("/api/kits/import-kit", {
            data: { skeleton: buildEuclideanGeometryKit() },
          });
          expect(importRes.ok()).toBe(true);

          await page.goto("/");
          await page
            .getByRole("button", { name: "Publish Euclidean Geometry" })
            .click();
          await page
            .getByPlaceholder("What's new or improved in this release?")
            .fill("v1 foundational postulates, triangle congruence, and drills");
          const published = page.waitForResponse(
            (res) => res.url().endsWith("/publish") && res.request().method() === "POST",
          );
          await page
            .getByRole("button", { name: "Publish to Shared Library" })
            .click();
          expect((await published).ok()).toBe(true);

          // ── 2. Browser Context 2 (User B / Learner): Register + Fork from `/shared` ──
          const registerRes = await userBPage.request.post("/api/auth/register", {
            data: {
              username: "bob_scholar",
              displayName: "Bob Scholar",
              email: "bob@toolbox.local",
              password: "Tr0ub4dorAnd3lephantBattery!",
            },
          });
          expect(registerRes.status()).toBe(201);

          // Open Shared Community Library (`/shared`), scan WCAG 2.2 AA, and fork Alice's Kit
          await userBPage.goto("/shared");
          await expect(
            userBPage.getByRole("heading", {
              name: "Shared Community Library",
            }),
          ).toBeVisible();
          await expectNoCriticalA11yViolations(userBPage, {
            testInfo,
            label: "shared-community-library",
          });

          const sharedGeoCard = userBPage.getByTestId(
            "shared-kit-euclidean-geometry",
          );
          await expect(sharedGeoCard).toBeVisible();
          await expect(sharedGeoCard).toContainText("Euclidean Geometry");
          await expect(sharedGeoCard).toContainText("v1");
          await sharedGeoCard
            .getByRole("button", { name: "Add to My Library" })
            .click();

          await expect(userBPage).toHaveURL(
            /\/k\/euclidean-geometry(\/guide)?$/,
          );

          // Also fork Official `system-design` for User B so `/k/system-design/feynman` is active
          const forkSysRes = await userBPage.request.post(
            "/api/shared-kits/system-design/fork",
          );
          expect(forkSysRes.ok()).toBe(true);

          // ── 3. Guided Drills Rubric Evaluation + Tenant Progress Isolation ──
          await userBPage.goto("/k/euclidean-geometry/drills");
          const drillWorkspace = userBPage.getByTestId(
            "guided-drill-workspace",
          );
          await expect(drillWorkspace).toBeVisible();

          await expectNoCriticalA11yViolations(userBPage, {
            testInfo,
            label: "guided-drills-workspace",
          });

          await userBPage
            .getByTestId("drill-scratchpad")
            .fill(
              "By Euclid's parallel postulate, constructing a line parallel to the base through the apex forms alternate interior angles equal to the two base angles, summing to a straight 180-degree angle.",
            );
          await userBPage.getByTestId("submit-drill-btn").click();

          const drillFeedback = userBPage.getByTestId("rubric-feedback-card");
          await expect(drillFeedback).toBeVisible();
          await expect(userBPage.getByTestId("rubric-pass-badge")).toContainText(
            "Passed Rubric",
          );
          await expect(userBPage.getByTestId("rubric-score-pill")).toContainText(
            "92%",
          );

          // Record a personal Guide note + FSRS review as User B
          const bobNoteRes = await userBPage.request.put(
            "/api/guide-content/foundations/parallel-postulate/core-postulates",
            {
              headers: { "X-Toolbox-Kit": "euclidean-geometry" },
              data: {
                content:
                  "Bob's private Euclidean study note — invisible to Alice.",
              },
            },
          );
          expect(bobNoteRes.ok()).toBe(true);

          const bobDueRes = await userBPage.request.get(
            "/api/decks/all/cards/due?kitId=euclidean-geometry",
          );
          const bobDue = (await bobDueRes.json()) as Array<{
            id: string;
            deck_id: string;
          }>;
          expect(bobDue.length).toBeGreaterThan(0);
          const bobRevRes = await userBPage.request.post(
            `/api/decks/${bobDue[0].deck_id}/cards/${bobDue[0].id}/review`,
            {
              headers: { "X-Toolbox-Kit": "euclidean-geometry" },
              data: { quality: 5, confidence: "high" },
            },
          );
          expect(bobRevRes.ok()).toBe(true);

          // Assert User B's progress incremented while User A's source Kit remains untouched
          const bobKits = (await (
            await userBPage.request.get("/api/kits")
          ).json()) as {
            kits: Array<{
              slug: string;
              reviewedCount: number;
              guideFilledCount: number;
            }>;
          };
          const bobGeo = bobKits.kits.find(
            (k) => k.slug === "euclidean-geometry",
          );
          expect(bobGeo?.reviewedCount).toBe(1);
          expect(bobGeo?.guideFilledCount).toBe(1);

          const aliceKits = (await (
            await page.request.get("/api/kits")
          ).json()) as {
            kits: Array<{
              slug: string;
              reviewedCount: number;
              guideFilledCount: number;
            }>;
          };
          const aliceGeo = aliceKits.kits.find(
            (k) => k.slug === "euclidean-geometry",
          );
          expect(aliceGeo?.reviewedCount).toBe(0);
          expect(aliceGeo?.guideFilledCount).toBe(0);

          const aliceDrillsRes = await page.request.get("/api/drills", {
            headers: { "X-Toolbox-Kit": "euclidean-geometry" },
          });
          const aliceDrills = (await aliceDrillsRes.json()) as Array<{
            mastered: boolean;
            attemptCount?: number;
          }>;
          expect(aliceDrills.length).toBeGreaterThan(0);
          expect(
            aliceDrills.every(
              (d) => !d.mastered && (d.attemptCount ?? 0) === 0,
            ),
          ).toBe(true);

          // ── 4. Feynman Simulator Evaluation + WCAG 2.2 AA (`/k/system-design/feynman`) ──
          await userBPage.goto("/k/system-design/feynman");
          await expect(
            userBPage.getByRole("heading", { name: "Feynman Simulator" }),
          ).toBeVisible();

          await expectNoCriticalA11yViolations(userBPage, {
            testInfo,
            label: "system-design-feynman",
          });

          const nodeSelect = userBPage.getByTestId("feynman-node-select");
          await nodeSelect.selectOption({ index: 1 });

          await userBPage
            .getByTestId("feynman-explanation-input")
            .fill(
              "Majority quorums require floor(N/2)+1 replicas for both writes and leader elections, so by pigeonhole overlap at least one replica bridges every committed write into the next leader's log.",
            );
          await userBPage.locator("#feynman-analyze-btn").click();

          await expect(
            userBPage.getByTestId("rubric-feedback-card"),
          ).toBeVisible();
          await expect(
            userBPage.getByTestId("rubric-pass-badge"),
          ).toContainText("Passed Rubric");
          await expect(userBPage.getByTestId("rubric-score-pill")).toContainText(
            "92%",
          );

          expect(userAErrors).toEqual([]);
          expect(userBErrors).toEqual([]);
        } finally {
          await userBContext.close();
          await mockAi.stop();
        }
      },
    );
  },
);

test.describe("Mobile Shared Library & Feynman Accessibility", () => {
  test(
    "renders /shared and /k/system-design/feynman cleanly on 390x844 mobile viewport",
    { tag: "@mobile" },
    async ({ page, instance }, testInfo) => {
      const mockAi = await startMockAiServer();
      const pageErrors = collectPageErrors(page);

      try {
        await configureInstanceMockAi(instance, mockAi);
        await resetLibrary(instance);
        await instance.api("POST", "/shared-kits/system-design/fork");

        await page.goto("/shared");
        await expect(
          page.getByRole("heading", { name: "Shared Community Library" }),
        ).toBeVisible();
        await expectNoCriticalA11yViolations(page, {
          testInfo,
          label: "mobile-shared-library",
        });

        await page.goto("/k/system-design/feynman");
        await expect(
          page.getByRole("heading", { name: "Feynman Simulator" }),
        ).toBeVisible();
        await expectNoCriticalA11yViolations(page, {
          testInfo,
          label: "mobile-feynman-simulator",
        });

        const hasOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth + 1,
        );
        expect(hasOverflow).toBe(false);
        expect(pageErrors).toEqual([]);
      } finally {
        await mockAi.stop();
      }
    },
  );
});
