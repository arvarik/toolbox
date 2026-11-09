import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MCP_TOOLS } from "../../shared/mcpTools.ts";
import { McpSettingsSection } from "../components/settings/McpSettingsSection.tsx";
import { authApi } from "../utils/authApi.ts";

describe("McpSettingsSection UI", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders endpoint URL, 7-tool capability table from shared/mcpTools.ts, Resources & Prompts, and mints read-write & read-only tbk_ tokens into client snippets", async () => {
    const createTokenSpy = vi
      .spyOn(authApi, "createToken")
      .mockResolvedValueOnce({
        id: "tok-rw-1",
        name: "Claude Code Laptop",
        token: "tbk_live_rw_secret_token_abcdef123456",
        tokenPrefix: "tbk_live_rw_",
        expiresAt: null,
        readOnly: false,
      })
      .mockResolvedValueOnce({
        id: "tok-ro-2",
        name: "Cursor ReadOnly",
        token: "tbk_live_ro_secret_token_999888777666",
        tokenPrefix: "tbk_live_ro_",
        expiresAt: null,
        readOnly: true,
      });

    render(<McpSettingsSection />);

    // 1. Endpoint URL + Stateless Streamable HTTP badge
    expect(screen.getByText("Stateless Streamable HTTP")).toBeInTheDocument();
    const endpointNode = screen.getByTestId("mcp-endpoint-url");
    expect(endpointNode.textContent).toMatch(/\/api\/mcp$/);

    // 2. Placeholder token shown initially in both Claude Code and JSON snippets
    expect(
      screen.getByTestId("mcp-snippet-claude-code").textContent,
    ).toContain("<YOUR_TBK_TOKEN>");
    expect(screen.getByTestId("mcp-snippet-json").textContent).toContain(
      "<YOUR_TBK_TOKEN>",
    );

    // 3. All 7 canonical tools from shared/mcpTools.ts + 4 resources + 2 prompts are rendered
    const toolsTable = screen.getByRole("table");
    for (const tool of MCP_TOOLS) {
      expect(within(toolsTable).getByText(tool.name)).toBeInTheDocument();
    }
    expect(screen.getByText("toolbox://library/overview")).toBeInTheDocument();
    expect(
      screen.getByText("toolbox://kits/{slug}/skeleton"),
    ).toBeInTheDocument();
    expect(screen.getByText("/study_briefing(kit)")).toBeInTheDocument();
    expect(screen.getByText("/socratic_drill(kit, topic)")).toBeInTheDocument();

    // 4. Mint a read-write MCP token (default readOnly = false)
    const nameInput = screen.getByLabelText("MCP token name");
    fireEvent.change(nameInput, { target: { value: "Claude Code Laptop" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Generate MCP Token/i }),
    );

    await waitFor(() => {
      expect(createTokenSpy).toHaveBeenCalledWith({
        name: "Claude Code Laptop",
        readOnly: false,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("mcp-minted-token").textContent).toBe(
        "tbk_live_rw_secret_token_abcdef123456",
      );
    });
    expect(
      screen.getByTestId("mcp-snippet-claude-code").textContent,
    ).toContain("Bearer tbk_live_rw_secret_token_abcdef123456");
    expect(screen.getByTestId("mcp-snippet-json").textContent).toContain(
      "Bearer tbk_live_rw_secret_token_abcdef123456",
    );

    // 5. Toggle Read-Only Token checkbox and mint a read-only token
    const readOnlyCheckbox = screen.getByRole("checkbox");
    fireEvent.click(readOnlyCheckbox);
    fireEvent.change(nameInput, { target: { value: "Cursor ReadOnly" } });
    fireEvent.click(
      screen.getByRole("button", { name: /Generate MCP Token/i }),
    );

    await waitFor(() => {
      expect(createTokenSpy).toHaveBeenCalledWith({
        name: "Cursor ReadOnly",
        readOnly: true,
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("mcp-minted-token").textContent).toBe(
        "tbk_live_ro_secret_token_999888777666",
      );
    });
    expect(
      screen.getByTestId("mcp-snippet-claude-code").textContent,
    ).toContain("Bearer tbk_live_ro_secret_token_999888777666");
    expect(screen.getByTestId("mcp-snippet-json").textContent).toContain(
      "Bearer tbk_live_ro_secret_token_999888777666",
    );
  });
});
