/**
 * Auth Setup Wizard & Multi-Tenant Isolation E2E (`AUTH_REQUIRED=true`).
 *
 * Boots a fresh gated instance with zero accounts, walks the browser Setup
 * Wizard to create Admin User A, creates private Kit + Deck + Board data,
 * enables registration in Settings, signs out, registers User B in the
 * browser, and proves User A's data is 100% invisible (`0` items / `404`) to
 * User B across both UI and API.
 */
import net from "node:net";
import {
  collectPageErrors,
  expect,
  gatedTest,
} from "./fixtures/test.ts";
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";

interface CapturedMail {
  to: string[];
  text: string;
}

async function startFakeSmtp(): Promise<{
  port: number;
  inbox: CapturedMail[];
  close: () => Promise<void>;
}> {
  const inbox: CapturedMail[] = [];
  const server = net.createServer((sock) => {
    let mail: CapturedMail = { to: [], text: "" };
    let data: string[] | null = null;
    let pending = "";
    sock.write("220 fake ESMTP\r\n");
    sock.on("data", (chunk) => {
      pending += chunk.toString();
      for (
        let end = pending.indexOf("\r\n");
        end !== -1;
        end = pending.indexOf("\r\n")
      ) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (data) {
          if (line !== ".") {
            data.push(line);
            continue;
          }
          const raw = data.join("\n");
          const body = raw.slice(raw.indexOf("\n\n") + 2);
          mail.text = /quoted-printable/i.test(raw)
            ? body
                .replace(/=\n/g, "")
                .replace(/=([0-9A-F]{2})/g, (_, hex: string) =>
                  String.fromCharCode(parseInt(hex, 16)),
                )
            : body;
          inbox.push(mail);
          mail = { to: [], text: "" };
          data = null;
          sock.write("250 queued\r\n");
          continue;
        }
        const [verb = ""] = line.split(" ");
        if (/^EHLO$/i.test(verb)) {
          sock.write("250-fake\r\n250 AUTH PLAIN\r\n");
        } else if (/^AUTH$/i.test(verb)) {
          sock.write("235 ok\r\n");
        } else if (/^RCPT$/i.test(verb)) {
          mail.to.push(/<(.*)>/.exec(line)?.[1] ?? "");
          sock.write("250 ok\r\n");
        } else if (/^DATA$/i.test(verb)) {
          data = [];
          sock.write("354 go\r\n");
        } else if (/^QUIT$/i.test(verb)) {
          sock.end("221 bye\r\n");
        } else {
          sock.write("250 ok\r\n");
        }
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  return {
    port,
    inbox,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

function extractEmailLinkPath(mail: CapturedMail, pathname: string): string {
  const escaped = pathname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`https?://[^\\s]+(${escaped}\\?token=[^\\s>]+)`).exec(
    mail.text,
  );
  if (!match?.[1]) {
    throw new Error(`Expected ${pathname} link in email body:\n${mail.text}`);
  }
  return match[1];
}

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

      // Seed client-side user storage to verify complete browser purge on Sign Out
      await page.evaluate(() => {
        localStorage.setItem(
          "toolbox_chat_history",
          JSON.stringify([{ role: "user", content: "Alice secret prompt" }]),
        );
        localStorage.setItem("toolbox_chat_quote", "Alice private highlight");
        localStorage.setItem(
          "toolbox_calc_state",
          JSON.stringify({ state: { scenarioId: "alice-scenario" } }),
        );
        localStorage.setItem(
          "toolbox_timer_settings",
          JSON.stringify({ state: { taskName: "Alice Secret Study Task" } }),
        );
        localStorage.setItem(
          "toolbox_learning_sessions_euclidean-geometry",
          JSON.stringify({ s1: { title: "Alice private thread" } }),
        );
        sessionStorage.setItem("toolbox_chat_draft", "Alice draft note");
      });

      await page
        .locator("#account-security-section")
        .getByRole("button", { name: "Sign Out" })
        .click();

      await expect(page.locator("#signin-identifier")).toBeVisible();

      const remainingClientKeys = await page.evaluate(() => ({
        chatHistory: localStorage.getItem("toolbox_chat_history"),
        chatQuote: localStorage.getItem("toolbox_chat_quote"),
        calcState: localStorage.getItem("toolbox_calc_state"),
        timerSettings: localStorage.getItem("toolbox_timer_settings"),
        learningSessions: localStorage.getItem(
          "toolbox_learning_sessions_euclidean-geometry",
        ),
        chatDraft: sessionStorage.getItem("toolbox_chat_draft"),
      }));
      expect(remainingClientKeys).toEqual({
        chatHistory: null,
        chatQuote: null,
        calcState: null,
        timerSettings: null,
        learningSessions: null,
        chatDraft: null,
      });

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

      // Wait for the sign-in to settle on `/settings` before navigating to `/`
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

  gatedTest(
    "shows explicit HTTP error screen on 403 HOST_NOT_ALLOWED with Retry recovery and survives malformed % URLs",
    async ({ page }) => {
      const pageErrors = collectPageErrors(page);

      let blockStatus = true;
      await page.route("**/api/auth/status", async (route) => {
        if (blockStatus) {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({
              error: {
                code: "HOST_NOT_ALLOWED",
                message: "Request Host header is not allowed.",
              },
            }),
          });
          return;
        }
        await route.continue();
      });

      await page.goto("/");
      await expect(page.getByRole("alert")).toContainText(
        "Server returned HTTP 403 (HOST_NOT_ALLOWED)",
      );
      await expect(page.getByRole("alert")).toContainText(
        "Request Host header is not allowed.",
      );
      await expect(
        page.getByRole("heading", { name: "My Study Library" }),
      ).toHaveCount(0);

      blockStatus = false;
      await page.getByRole("button", { name: "Retry" }).click();
      await expect(
        page.getByRole("button", { name: "Create Admin Account" }),
      ).toBeVisible();

      await page.locator("#setup-username").fill("dana_admin");
      await page.locator("#setup-display-name").fill("Dana Admin");
      await page.locator("#setup-email").fill("dana@example.com");
      await page
        .locator("#setup-password")
        .fill("CorrectHorseBatteryStaple1!");
      await page.getByRole("button", { name: "Create Admin Account" }).click();

      await expect(
        page.getByRole("heading", { name: "My Study Library" }),
      ).toBeVisible();

      // Client navigation to a malformed percent-encoded Kit slug must not throw an uncaught URIError
      await page.evaluate(() => {
        window.history.pushState({}, "", "/k/%E0%A4%A/guide");
        window.dispatchEvent(new PopStateEvent("popstate"));
      });
      await expect(page.locator("#nav-library")).toBeVisible();
      await page.locator("#nav-library").click();
      await expect(
        page.getByRole("heading", { name: "My Study Library" }),
      ).toBeVisible();
      expect(pageErrors).toEqual([]);
    },
  );

  gatedTest(
    "redeems magic-link sign-in, email-change confirmation, and password reset tokens via email links",
    async ({ page }) => {
      const pageErrors = collectPageErrors(page);
      const smtp = await startFakeSmtp();

      try {
        await page.goto("/");
        await page.locator("#setup-username").fill("erin_admin");
        await page.locator("#setup-display-name").fill("Erin Admin");
        await page.locator("#setup-email").fill("erin@example.com");
        await page
          .locator("#setup-password")
          .fill("CorrectHorseBatteryStaple1!");
        await page
          .getByRole("button", { name: "Create Admin Account" })
          .click();
        await expect(
          page.getByRole("heading", { name: "My Study Library" }),
        ).toBeVisible();

        // Configure SMTP and enable passwordless magic-link sign-in
        const mailRes = await page.request.put("/api/admin/mail", {
          data: {
            host: "127.0.0.1",
            port: smtp.port,
            user: "mailer",
            password: "smtp-secret-password",
            from: "Toolbox <noreply@example.com>",
          },
        });
        expect(mailRes.ok()).toBe(true);

        const settingsRes = await page.request.put("/api/admin/settings", {
          data: { magicLinkSignIn: true },
        });
        expect(settingsRes.ok()).toBe(true);

        const waitForInboxLength = async (targetCount: number) => {
          await expect
            .poll(() => smtp.inbox.length, { timeout: 5000 })
            .toBeGreaterThanOrEqual(targetCount);
          return smtp.inbox[targetCount - 1];
        };

        // 1. Sign out -> request and redeem Magic Sign-In Link
        await page.goto("/settings");
        await page
          .locator("#account-security-section")
          .getByRole("button", { name: "Sign Out" })
          .click();
        await expect(page.locator("#signin-identifier")).toBeVisible();

        const beforeMagicCount = smtp.inbox.length;
        await page
          .getByRole("button", { name: "Email me a sign-in link" })
          .click();
        await page.locator("#magic-email").fill("erin@example.com");
        await page.getByRole("button", { name: "Send Sign-In Link" }).click();
        await expect(page.getByRole("status")).toContainText("sign-in link");

        const magicMail = await waitForInboxLength(beforeMagicCount + 1);
        const magicPath = extractEmailLinkPath(magicMail, "/signin-link");
        await page.goto(magicPath);
        await expect(page).toHaveURL(/\/$/);
        await expect(
          page.getByRole("heading", { name: "My Study Library" }),
        ).toBeVisible();

        // 2. Request email change -> redeem /confirm-email?token=... banner
        const beforeEmailChangeCount = smtp.inbox.length;
        const emailPatchRes = await page.request.patch("/api/auth/me", {
          data: {
            email: "erin.new@example.com",
            currentPassword: "CorrectHorseBatteryStaple1!",
          },
        });
        expect(emailPatchRes.ok()).toBe(true);

        const confirmMail = await waitForInboxLength(beforeEmailChangeCount + 1);
        const confirmPath = extractEmailLinkPath(confirmMail, "/confirm-email");
        await page.goto(confirmPath);
        await expect(page).toHaveURL(/\/$/);
        await expect(page.getByRole("status")).toContainText(
          "erin.new@example.com",
        );
        await page
          .getByRole("button", { name: "Continue to Workspace" })
          .click();
        await expect(
          page.getByRole("heading", { name: "My Study Library" }),
        ).toBeVisible();

        // 3. Sign out -> Forgot password? -> redeem /reset-password?token=...
        const updatedStatus = await page.request.get("/api/auth/status");
        expect(updatedStatus.ok()).toBe(true);
        expect((await updatedStatus.json()).user?.email).toBe(
          "erin.new@example.com",
        );
        await page.goto("/settings");
        await expect(page.locator("#account-security-section")).toBeVisible();
        await page
          .locator("#account-security-section")
          .getByRole("button", { name: "Sign Out" })
          .click();

        const beforeResetCount = smtp.inbox.length;
        await page.getByRole("button", { name: "Forgot password?" }).click();
        await page.locator("#forgot-email").fill("erin.new@example.com");
        await page.getByRole("button", { name: "Send Reset Link" }).click();
        await expect(page.getByRole("status")).toContainText(
          "password reset link",
        );

        const resetMail = await waitForInboxLength(beforeResetCount + 1);
        const resetPath = extractEmailLinkPath(resetMail, "/reset-password");
        await page.goto(resetPath);
        await expect(page).toHaveURL(/\/$/);
        await page
          .locator("#reset-new-password")
          .fill("ResetHorseBatteryStaple2!");
        await page.getByRole("button", { name: "Reset Password" }).click();
        await expect(
          page.getByRole("heading", { name: "My Study Library" }),
        ).toBeVisible();

        // Sign out and verify the new password signs in cleanly
        await page.goto("/settings");
        await page
          .locator("#account-security-section")
          .getByRole("button", { name: "Sign Out" })
          .click();
        await page.locator("#signin-identifier").fill("erin_admin");
        await page
          .locator("#signin-password")
          .fill("ResetHorseBatteryStaple2!");
        await page.getByRole("button", { name: "Sign In" }).click();
        await expect(
          page.locator("#account-security-section").getByText("Erin Admin"),
        ).toBeVisible();

        expect(pageErrors).toEqual([]);
      } finally {
        await smtp.close();
      }
    },
  );
});
