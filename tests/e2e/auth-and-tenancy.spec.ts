/**
 * Auth Setup Wizard & Multi-Tenant Isolation E2E (`AUTH_REQUIRED=true`).
 *
 * Boots a fresh gated instance with zero accounts, walks the browser Setup
 * Wizard to create Admin User A, creates private Kit + Deck + Board data,
 * enables registration in Settings, signs out, registers User B in the
 * browser, and proves User A's data is 100% invisible (`0` items / `404`) to
 * User B across both UI and API.
 */
import {
  collectPageErrors,
  expect,
  gatedTest,
} from "./fixtures/test.ts";
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";

gatedTest.describe("Auth Setup Wizard & Multi-Tenant Isolation", () => {
  gatedTest(
    "creates Admin via Setup Wizard, registers User B, and enforces strict tenant isolation",
    async ({ page }) => {
      const pageErrors = collectPageErrors(page);

      // 1. Fresh AUTH_REQUIRED=true instance opens onto the Setup Wizard
      await page.goto("/");
      await expect(
        page.getByRole("button", { name: "Create Admin Account" }),
      ).toBeVisible();

      await page.locator("#setup-username").fill("alice_admin");
      await page.locator("#setup-display-name").fill("Alice Admin");
      await page.locator("#setup-email").fill("alice@example.com");
      await page
        .locator("#setup-password")
        .fill("CorrectHorseBatteryStaple1!");
      await page.getByRole("button", { name: "Create Admin Account" }).click();

      // Lands on Library Home (`/`) as Admin User A
      await expect(
        page.getByRole("heading", { name: "My Study Library" }),
      ).toBeVisible();

      // 2. User A imports a private Study Kit, creates a Deck, and saves a Board
      const importRes = await page.request.post("/api/kits/import-kit", {
        data: { skeleton: buildEuclideanGeometryKit() },
      });
      expect(importRes.ok()).toBe(true);
      const importBody = (await importRes.json()) as {
        kit: { id: string; slug: string };
      };
      const aliceKitId = importBody.kit.id;

      const deckRes = await page.request.post("/api/decks", {
        headers: { "X-Toolbox-Kit": "euclidean-geometry" },
        data: {
          name: "Alice Secret Axioms",
          description: "Private theorems deck owned by Alice",
        },
      });
      expect(deckRes.ok()).toBe(true);
      const aliceDeck = (await deckRes.json()) as { id: string };

      const boardRes = await page.request.post("/api/boards", {
        headers: { "X-Toolbox-Kit": "euclidean-geometry" },
        data: {
          name: "Alice Private Concept Map",
          data: {
            nodes: [
              {
                id: "n1",
                type: "concept",
                name: "Parallel Postulate",
                category: "axiom",
                x: 120,
                y: 80,
              },
            ],
            edges: [],
          },
        },
      });
      expect(boardRes.status()).toBe(201);
      const aliceBoard = (await boardRes.json()) as { id: string };

      await page.reload();
      await expect(
        page.getByTestId("kit-card-euclidean-geometry"),
      ).toBeVisible();

      // 3. User A enables open sign-up in Settings and signs out
      await page.goto("/settings");
      const adminSection = page.locator("#instance-admin-section");
      await expect(adminSection).toBeVisible();
      await adminSection
        .getByRole("button", { name: "Enable Open Sign-Up" })
        .click();
      await expect(
        adminSection.getByRole("button", { name: "Disable Open Sign-Up" }),
      ).toBeVisible();

      await page
        .locator("#account-security-section")
        .getByRole("button", { name: "Sign Out" })
        .click();

      await expect(page.locator("#signin-identifier")).toBeVisible();

      // 4. Register User B in the browser
      await page.getByRole("button", { name: "Create an account" }).click();
      await page.locator("#reg-username").fill("bob_learner");
      await page.locator("#reg-display-name").fill("Bob Learner");
      await page.locator("#reg-email").fill("bob@example.com");
      await page
        .locator("#reg-password")
        .fill("Tr0ub4dorAnd3lephantBattery!");
      await page.getByRole("button", { name: "Create Account" }).click();

      // Registration completes on current route (`/settings`); navigate to `/`
      await expect(
        page.locator("#account-security-section").getByText("Bob Learner"),
      ).toBeVisible();
      await page.locator("#nav-library").click();

      // 5. Prove strict multi-tenant isolation in UI + API
      await expect(
        page.getByRole("heading", { name: "My Study Library" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", {
          name: "Your Personal Study Library is Empty",
        }),
      ).toBeVisible();
      await expect(
        page.getByTestId("kit-card-euclidean-geometry"),
      ).toHaveCount(0);

      const bobKitsRes = await page.request.get("/api/kits");
      expect(bobKitsRes.ok()).toBe(true);
      expect(await bobKitsRes.json()).toEqual({ kits: [] });

      const bobStealKitById = await page.request.get(
        `/api/kits/${aliceKitId}`,
      );
      expect(bobStealKitById.status()).toBe(404);

      const bobStealKitBySlug = await page.request.get(
        "/api/kits/euclidean-geometry",
      );
      expect(bobStealKitBySlug.status()).toBe(404);

      const bobStealDeck = await page.request.get(
        `/api/decks/${aliceDeck.id}`,
      );
      expect(bobStealDeck.status()).toBe(404);

      const bobStealBoard = await page.request.get(
        `/api/boards/${aliceBoard.id}`,
      );
      expect(bobStealBoard.status()).toBe(404);

      const bobDueCards = await page.request.get("/api/decks/all/cards/due");
      expect(bobDueCards.ok()).toBe(true);
      expect(await bobDueCards.json()).toEqual([]);

      // 6. Sign out Bob and sign back in as Alice — Alice's Kit is untouched
      await page.goto("/settings");
      await page
        .locator("#account-security-section")
        .getByRole("button", { name: "Sign Out" })
        .click();

      await page.locator("#signin-identifier").fill("alice_admin");
      await page
        .locator("#signin-password")
        .fill("CorrectHorseBatteryStaple1!");
      await page.getByRole("button", { name: "Sign In" }).click();

      // Wait for Argon2id login to settle on `/settings` before navigating to `/`
      await expect(
        page.locator("#account-security-section").getByText("Alice Admin"),
      ).toBeVisible();
      await page.locator("#nav-library").click();
      await expect(
        page.getByTestId("kit-card-euclidean-geometry"),
      ).toBeVisible();
      expect(pageErrors).toEqual([]);
    },
  );
});
