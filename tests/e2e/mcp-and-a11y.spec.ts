/**
 * MCP Streamable HTTP Server (`/api/mcp`), Mobile Navigation Drawer, and
 * WCAG 2.2 AA Accessibility (`@axe-core/playwright`) E2E Journeys.
 */
import { MCP_TOOLS } from "../../shared/mcpTools.ts";
import {
  collectPageErrors,
  expect,
  expectNoCriticalA11yViolations,
  resetLibrary,
  test,
} from "./fixtures/test.ts";
import { buildEuclideanGeometryKit } from "./fixtures/kits.ts";

interface JsonRpcResponse {
  jsonrpc: string;
  id?: number | string | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
}

async function callMcp(
  baseURL: string,
  token: string,
  payload: Record<string, unknown>,
): Promise<{ status: number; body: JsonRpcResponse }> {
  const res = await fetch(`${baseURL}/api/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(payload),
  });

  const contentType = res.headers.get("content-type") ?? "";
  const raw = await res.text();
  if (contentType.includes("text/event-stream")) {
    const dataLines = raw
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean);
    const lastPayload = dataLines[dataLines.length - 1] ?? "{}";
    return {
      status: res.status,
      body: JSON.parse(lastPayload) as JsonRpcResponse,
    };
  }

  return {
    status: res.status,
    body: JSON.parse(raw) as JsonRpcResponse,
  };
}

test.describe("MCP Streamable HTTP, Mobile Drawer & Accessibility", () => {
  test("mints read-only & writable tbk_ tokens in Settings, enforces MCP tool scopes, and renders MCP-created Markdown + KaTeX flashcards in /review", async ({
    page,
    instance,
  }) => {
    const pageErrors = collectPageErrors(page);

    // Start with a single 0-card Kit so the MCP-created flashcard is the exact due card in `/review`
    await resetLibrary(instance);
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit({ includeStarterContent: false }),
    });

    // 1. Verify MCP Settings UI (`/settings` -> `#mcp-settings-section`)
    await page.goto("/settings");
    const mcpSection = page.locator("#mcp-settings-section");
    await expect(mcpSection).toBeVisible();

    const endpointText = await mcpSection
      .getByTestId("mcp-endpoint-url")
      .textContent();
    expect(endpointText?.trim()).toBe(`${instance.baseURL}/api/mcp`);

    await expect(
      mcpSection.getByTestId("mcp-snippet-claude-code"),
    ).toContainText("claude mcp add --transport http toolbox");
    await expect(mcpSection.getByTestId("mcp-snippet-json")).toContainText(
      '"mcpServers"',
    );

    // All 7 canonical MCP tools are documented in the Settings table
    expect(MCP_TOOLS).toHaveLength(7);
    for (const tool of MCP_TOOLS) {
      await expect(mcpSection).toContainText(tool.name);
    }

    // 2. Mint a READ-ONLY `tbk_` token via the UI
    await mcpSection.getByLabel("MCP token name").fill("E2E Read-Only Client");
    const readOnlyCheckbox = mcpSection.getByRole("checkbox", {
      name: /Read-Only Token/i,
    });
    await readOnlyCheckbox.check();
    await mcpSection
      .getByRole("button", { name: "Generate MCP Token" })
      .click();

    const roTokenEl = mcpSection.getByTestId("mcp-minted-token");
    await expect(roTokenEl).toBeVisible();
    const readOnlyToken = (await roTokenEl.textContent())?.trim() ?? "";
    expect(readOnlyToken.startsWith("tbk_")).toBe(true);

    // Call `initialize`, `tools/list`, and `tools/call` (`list_kits`) with read-only token
    const initRes = await callMcp(instance.baseURL, readOnlyToken, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "playwright-e2e", version: "1.0.0" },
      },
    });
    expect(initRes.status).toBe(200);
    expect(initRes.body.error).toBeUndefined();

    const roToolsRes = await callMcp(instance.baseURL, readOnlyToken, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {},
    });
    expect(roToolsRes.status).toBe(200);
    const roToolNames = (
      (roToolsRes.body.result?.tools as Array<{ name: string }>) ?? []
    ).map((t) => t.name);
    expect(roToolNames.sort()).toEqual([
      "get_due_cards",
      "get_kit_path",
      "list_kits",
      "search_kit",
    ]);
    expect(roToolNames).not.toContain("create_flashcards");
    expect(roToolNames).not.toContain("review_card");
    expect(roToolNames).not.toContain("commit_guide_note");

    const listKitsRes = await callMcp(instance.baseURL, readOnlyToken, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "list_kits", arguments: {} },
    });
    expect(listKitsRes.status).toBe(200);
    const structuredKits = listKitsRes.body.result?.structuredContent as {
      kits: Array<{ slug: string }>;
    };
    expect(structuredKits.kits.map((k) => k.slug)).toContain(
      "euclidean-geometry",
    );

    // 3. Mint a WRITABLE `tbk_` token via the UI and call `create_flashcards`
    await mcpSection.getByLabel("MCP token name").fill("E2E Read-Write Client");
    await readOnlyCheckbox.uncheck();
    await mcpSection
      .getByRole("button", { name: "Generate MCP Token" })
      .click();

    await expect(mcpSection).toContainText("New read & write token minted");
    const rwToken = (await roTokenEl.textContent())?.trim() ?? "";
    expect(rwToken.startsWith("tbk_")).toBe(true);
    expect(rwToken).not.toBe(readOnlyToken);

    const createCardsRes = await callMcp(instance.baseURL, rwToken, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "create_flashcards",
        arguments: {
          kit: "euclidean-geometry",
          cards: [
            {
              front:
                "State the **Pythagorean Theorem** for hypotenuse $c$ and legs $a, b$ ($x^2$ form).",
              back: "In Euclidean geometry, **orthogonal legs** satisfy $a^2 + b^2 = c^2$.",
              nodeId: "pythagorean-theorem",
              pillarId: "triangles-circles",
              topicId: "right-triangles",
              sectionId: "theorems",
            },
          ],
        },
      },
    });
    expect(createCardsRes.status).toBe(200);
    expect(createCardsRes.body.result?.isError).toBeFalsy();

    // 4. Open `/review` in Chromium and verify Markdown `<strong>` + KaTeX `.katex` render live
    await page.goto("/review");
    const front = page.getByTestId("review-card-front");
    await expect(front).toBeVisible();
    await expect(front.locator("strong")).toContainText("Pythagorean Theorem");
    await expect(front.locator(".katex").first()).toBeVisible();

    await page.keyboard.press("Space");
    const back = page.getByTestId("review-card-back");
    await expect(back).toBeVisible();
    await expect(back.locator("strong")).toContainText("orthogonal legs");
    await expect(back.locator(".katex").first()).toBeVisible();

    expect(pageErrors).toEqual([]);
  });

  test("passes WCAG 2.2 AA critical/serious axe-core audits across key desktop screens", async ({
    page,
    instance,
  }, testInfo) => {
    await resetLibrary(instance);
    await instance.api("POST", "/kits/import-kit", {
      skeleton: buildEuclideanGeometryKit(),
    });

    const routes: Array<{ path: string; label: string; readySelector: string }> =
      [
        {
          path: "/",
          label: "library-home",
          readySelector: '[data-testid="kit-card-euclidean-geometry"]',
        },
        {
          path: "/k/euclidean-geometry",
          label: "kit-path",
          readySelector: '[data-testid="kit-path-page"]',
        },
        {
          path: "/review",
          label: "daily-review",
          readySelector: '[data-testid="review-card-front"]',
        },
        {
          path: "/settings",
          label: "settings-mcp",
          readySelector: "#mcp-settings-section",
        },
      ];

    for (const route of routes) {
      await page.goto(route.path);
      await expect(page.locator(route.readySelector)).toBeVisible();
      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: route.label,
      });
    }
  });

  test(
    "operates mobile navigation drawer cleanly on 390x844 phone viewport",
    { tag: "@mobile" },
    async ({ page, instance }, testInfo) => {
      const pageErrors = collectPageErrors(page);
      await resetLibrary(instance);
      await instance.api("POST", "/kits/import-kit", {
        skeleton: buildEuclideanGeometryKit(),
      });

      await page.goto("/");
      await expect(
        page.getByTestId("kit-card-euclidean-geometry"),
      ).toBeVisible();

      const menuBtn = page.locator("#mobile-menu-btn");
      await expect(menuBtn).toBeVisible();
      await menuBtn.click();

      const drawer = page.locator("#mobile-drawer");
      await expect(drawer).toBeVisible();

      await drawer.locator("#drawer-nav-shared").click();
      await expect(page).toHaveURL(/\/shared$/);
      await expect(
        page.getByRole("heading", { name: "Shared Community Library" }),
      ).toBeVisible();

      await menuBtn.click();
      await expect(drawer).toBeVisible();
      await drawer.locator("#drawer-nav-settings").click();
      await expect(page).toHaveURL(/\/settings$/);
      await expect(page.locator("#mcp-settings-section")).toBeVisible();

      await expectNoCriticalA11yViolations(page, {
        testInfo,
        label: "mobile-settings",
      });
      expect(pageErrors).toEqual([]);
    },
  );
});
