/**
 * Account security & instance administration E2E (`AUTH_REQUIRED=true`).
 *
 * Admin invites a member by link, the member joins through `/join`, the admin
 * resets the member's password, the member clears the forced password change,
 * mints and revokes a `tbk_` token, rotates the password, and is then disabled.
 * The admin finally downloads a verified SQLite backup from Settings.
 */
import { readFile } from "node:fs/promises";
import { collectPageErrors, expect, gatedTest } from "./fixtures/test.ts";

const ADMIN = { username: "root_admin", password: "Admin-Passphrase-2026!" };
const MEMBER = { username: "mia_member", email: "mia@example.com" };

gatedTest.describe("Account Security & Instance Administration", () => {
  gatedTest(
    "joins by invitation, enforces admin password resets, revokes tokens, rotates passwords, disables accounts, and downloads a verified backup",
    async ({ page, browser, gated }) => {
      const adminErrors = collectPageErrors(page);
      const setup = await page.request.post("/api/auth/setup", {
        data: { ...ADMIN, email: "root@example.com", displayName: "Root Admin" },
      });
      expect(setup.status()).toBe(201);

      // 1. Admin checks security headers, config/export-db admin fences, and creates an invitation link
      const settingsRes = await page.goto("/settings");
      expect(settingsRes?.headers()["permissions-policy"]).toBe(
        "camera=(), microphone=(self), geolocation=()",
      );
      expect(settingsRes?.headers()["content-security-policy"]).toContain(
        "img-src 'self' data: blob:",
      );
      expect(settingsRes?.headers()["content-security-policy"]).not.toContain(
        "img-src 'self' data: blob: https:",
      );

      // Admin session enforces PUT /api/config allowlist; Admin tbk_ token gets redacted config and 403 SESSION_REQUIRED on admin routes
      expect(
        (await page.request.put("/api/config", { data: { gemini_api_key: "AIza-e2e-admin-secret-9999" } })).status(),
      ).toBe(200);
      expect(
        (await page.request.put("/api/config", { data: { unallowlisted_key: "nope" } })).status(),
      ).toBe(400);

      const adminAccount = page.locator("#account-security-section");
      await adminAccount.getByPlaceholder("Token name (e.g. Claude Desktop MCP)").fill("Admin CLI");
      await adminAccount.getByRole("button", { name: "Create Token" }).click();
      const adminToken = (
        await adminAccount.locator("code").filter({ hasText: /^tbk_[\w-]{40,}$/ }).textContent()
      )!.trim();
      const adminTokenConfig = await fetch(`${gated.baseURL}/api/config`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      expect(adminTokenConfig.status).toBe(200);
      const adminTokenConfigJson = (await adminTokenConfig.json()) as Record<string, unknown>;
      expect(adminTokenConfigJson.gemini_api_key).toBeUndefined();
      expect(adminTokenConfigJson.api_key_configured).toBe(true);
      for (const [method, endpointPath] of [
        ["PUT", "/api/config"],
        ["POST", "/api/config/test-key"],
        ["POST", "/api/endpoints/test"],
        ["GET", "/api/system/export-db"],
      ] as const) {
        const res = await fetch(`${gated.baseURL}${endpointPath}`, {
          method,
          headers: {
            Authorization: `Bearer ${adminToken}`,
            ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
          },
          ...(method !== "GET" ? { body: "{}" } : {}),
        });
        expect(res.status, `${method} ${endpointPath}`).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SESSION_REQUIRED");
      }
      const sysExport = await page.request.get("/api/system/export-db");
      expect(sysExport.status()).toBe(200);
      expect((await sysExport.body()).subarray(0, 15).toString("utf8")).toBe("SQLite format 3");
      await page.request.put("/api/config", { data: { gemini_api_key: "" } });

      const admin = page.locator("#instance-admin-section");
      await admin.getByRole("button", { name: "Create Invite Link" }).click();
      const inviteLink = (await admin.locator("code").filter({ hasText: "/join?token=" }).textContent())!.trim();
      expect(inviteLink.startsWith(`${gated.baseURL}/join?token=`)).toBe(true);

      // 2. Member joins through the link; the token leaves the address bar
      const memberContext = await browser.newContext({ baseURL: gated.baseURL });
      const member = await memberContext.newPage();
      const memberErrors = collectPageErrors(member);
      await member.goto(inviteLink);
      await member.locator("#join-username").fill(MEMBER.username);
      await member.locator("#join-email").fill(MEMBER.email);
      await member.locator("#join-password").fill("Member-Original-Pass-1");
      expect(new URL(member.url()).search).toBe("");
      await member.getByRole("button", { name: "Accept Invitation & Join" }).click();
      await expect(member.getByRole("heading", { name: "My Study Library" })).toBeVisible();

      // 3. Admin resets the member's password: the member's session ends
      await page.reload();
      await admin.getByRole("button", { name: "Reset password" }).click();
      const temporary = (await admin.getByText(/^Temporary password for/).locator("code").textContent())!.trim();
      expect(temporary).toMatch(/^[A-Za-z0-9]{20}$/);
      await member.reload();
      await expect(member.locator("#signin-identifier")).toBeVisible();

      // 4. The temporary password only opens the forced password change screen
      await member.locator("#signin-identifier").fill(MEMBER.username);
      await member.locator("#signin-password").fill(temporary);
      await member.getByRole("button", { name: "Sign In" }).click();
      await expect(member.getByText("Set a permanent password")).toBeVisible();
      expect((await member.request.get("/api/decks")).status()).toBe(403);
      await member.locator("#cur-password").fill(temporary);
      await member.locator("#next-password").fill("Member-Permanent-Pass-2");
      await member.getByRole("button", { name: "Save New Password" }).click();
      await expect(member.getByRole("heading", { name: "My Study Library" })).toBeVisible();

      // 5. Member mints a personal token in Account & Security, uses it, then revokes it
      await member.goto("/settings");
      const account = member.locator("#account-security-section");
      await account.getByPlaceholder("Token name (e.g. Claude Desktop MCP)").fill("Laptop script");
      await account.getByRole("button", { name: "Create Token" }).click();
      const revealed = account.locator("code").filter({ hasText: /^tbk_[\w-]{40,}$/ });
      await expect(revealed).toBeVisible();
      const token = (await revealed.textContent())!.trim();
      const withToken = () =>
        fetch(`${gated.baseURL}/api/decks`, { headers: { Authorization: `Bearer ${token}` } });
      expect((await withToken()).status).toBe(200);
      await account.getByRole("button", { name: "Revoke" }).click();
      await expect(account.getByText("Laptop script")).toHaveCount(0);
      expect((await withToken()).status).toBe(401);

      // 5b. Member mints a Read-only token via UI: allowed on reads, blocked on writes AND mutating LLM GET routes
      await account.getByPlaceholder("Token name (e.g. Claude Desktop MCP)").fill("RO Observer");
      await account.getByLabel("Read-only").check();
      await account.getByRole("button", { name: "Create Token" }).click();
      await expect(account.getByText("RO Observer")).toBeVisible();
      await expect(revealed).not.toHaveText(token);
      const roToken = (await revealed.textContent())!.trim();
      expect(
        (await fetch(`${gated.baseURL}/api/decks`, { headers: { Authorization: `Bearer ${roToken}` } })).status,
      ).toBe(200);
      for (const [method, roPath] of [
        ["POST", "/api/decks"],
        ["GET", "/api/chat/starters?pillarId=p&topicId=t"],
        ["GET", "/api/drills/challenge/node-1"],
      ] as const) {
        const res = await fetch(`${gated.baseURL}${roPath}`, {
          method,
          headers: {
            Authorization: `Bearer ${roToken}`,
            ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          },
          ...(method === "POST" ? { body: JSON.stringify({ name: "Blocked" }) } : {}),
        });
        expect(res.status, `${method} ${roPath}`).toBe(403);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe("TOKEN_READ_ONLY");
      }

      // Mint a persistent active token to verify disabling permanently revokes tokens across re-enable
      await account.getByPlaceholder("Token name (e.g. Claude Desktop MCP)").fill("Persistent CLI");
      const roToggle = account.getByLabel("Read-only");
      if (await roToggle.isChecked()) await roToggle.uncheck();
      await account.getByRole("button", { name: "Create Token" }).click();
      await expect(account.getByText("Persistent CLI")).toBeVisible();
      await expect(revealed).not.toHaveText(roToken);
      const persistentToken = (await revealed.textContent())!.trim();
      expect(
        (await fetch(`${gated.baseURL}/api/decks`, { headers: { Authorization: `Bearer ${persistentToken}` } })).status,
      ).toBe(200);

      // 6. Member rotates the password; only the new one signs in
      await account.getByPlaceholder("Current password").fill("Member-Permanent-Pass-2");
      await account.getByPlaceholder("New password (12+ chars)").fill("Member-Rotated-Pass-3");
      await account.getByRole("button", { name: "Update Password" }).click();
      await expect(member.getByText("Password updated")).toBeVisible();
      await account.getByRole("button", { name: "Sign Out", exact: true }).click();
      await member.locator("#signin-identifier").fill(MEMBER.username);
      await member.locator("#signin-password").fill("Member-Permanent-Pass-2");
      await member.getByRole("button", { name: "Sign In" }).click();
      await expect(member.getByRole("alert")).toHaveText("Incorrect username or password.");
      await member.locator("#signin-password").fill("Member-Rotated-Pass-3");
      await member.getByRole("button", { name: "Sign In" }).click();
      await expect(member.locator("#account-security-section")).toBeVisible();

      // 7. Admin disables the member: the open session and tokens die, sign-in explains why,
      // and re-enabling does NOT resurrect previously revoked personal API tokens.
      await page.reload();
      await admin.getByRole("button", { name: "Disable" }).click();
      await expect(admin.getByText(`(@${MEMBER.username} · member · disabled)`)).toBeVisible();
      expect(
        (await fetch(`${gated.baseURL}/api/decks`, { headers: { Authorization: `Bearer ${persistentToken}` } })).status,
      ).toBe(401);
      await member.reload();
      await member.locator("#signin-identifier").fill(MEMBER.username);
      await member.locator("#signin-password").fill("Member-Rotated-Pass-3");
      await member.getByRole("button", { name: "Sign In" }).click();
      await expect(member.getByRole("alert")).toContainText("This account has been disabled");

      await admin.getByRole("button", { name: "Enable", exact: true }).click();
      await expect(admin.getByText(`(@${MEMBER.username} · member)`)).toBeVisible();
      expect(
        (await fetch(`${gated.baseURL}/api/decks`, { headers: { Authorization: `Bearer ${persistentToken}` } })).status,
      ).toBe(401);

      // 8. Admin takes a verified backup and downloads a readable SQLite snapshot
      await admin.getByRole("button", { name: "Create Verified Backup" }).click();
      await expect(page.getByText(/Verified backup created \(toolbox-.*\.db\)/)).toBeVisible();
      const downloadLink = admin.getByRole("link", { name: /Download \(\d+ KB\)/ });
      const [download] = await Promise.all([page.waitForEvent("download"), downloadLink.click()]);
      expect(download.suggestedFilename()).toMatch(/^toolbox-.*\.db$/);
      const snapshot = await readFile((await download.path())!);
      expect(snapshot.subarray(0, 15).toString()).toBe("SQLite format 3");

      const audit = await page.request.get("/api/admin/audit?action=user.password.reset,user.disabled,backup.downloaded");
      expect(((await audit.json()) as { entries: Array<{ action: string }> }).entries.map((e) => e.action).sort()).toEqual([
        "backup.downloaded",
        "user.disabled",
        "user.password.reset",
      ]);

      await memberContext.close();
      expect(adminErrors).toEqual([]);
      expect(memberErrors).toEqual([]);
    },
  );
});
