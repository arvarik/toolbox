import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../components/auth/AuthGate.tsx";
import { decksApi } from "../utils/api";

describe("api.js HTTP error vs offline queue + AuthGate", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws HTTP 401/403 errors on mutations instead of swallowing them as offline sync", async () => {
    const unauthorizedEvents: unknown[] = [];
    const listener = (e: Event) =>
      unauthorizedEvents.push((e as CustomEvent).detail);
    window.addEventListener("toolbox:unauthorized", listener);

    try {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "AUTH_REQUIRED", message: "Please sign in" },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(decksApi.create({ name: "My Deck" })).rejects.toThrow(
        "Please sign in",
      );
      expect(unauthorizedEvents).toHaveLength(1);
    } finally {
      window.removeEventListener("toolbox:unauthorized", listener);
    }
  });

  it("renders workspace directly when AUTH_REQUIRED=false and gates when authRequired=true", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // Case 1: Default local single-user mode
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authRequired: false,
          authenticated: true,
          setupRequired: false,
          hasAccounts: false,
          user: {
            id: "local-1",
            email: "local@toolbox.local",
            username: "local",
            displayName: "Local account",
            role: "admin",
            createdAt: "2026-11-08T00:00:00Z",
            lastLoginAt: null,
            status: "active",
            credentialState: "none",
            mustChangePassword: false,
            avatarUrl: null,
          },
          deviceItems: 0,
          registrationOpen: false,
          mailConfigured: false,
          magicLinkSignIn: false,
          localOwnerPresent: true,
          publicUrl: null,
          oidc: null,
          instanceName: "Toolbox",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const { unmount } = render(
      <AuthGate>
        <div data-testid="app-inside-gate">Study Workspace</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("app-inside-gate")).toBeInTheDocument();
    });
    unmount();

    // Case 2: Secured multi-user instance, signed out
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          authRequired: true,
          authenticated: false,
          setupRequired: false,
          hasAccounts: true,
          user: null,
          deviceItems: 0,
          registrationOpen: true,
          mailConfigured: false,
          magicLinkSignIn: false,
          localOwnerPresent: false,
          publicUrl: null,
          oidc: { name: "Authentik SSO" },
          instanceName: "Team Study Lab",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <AuthGate>
        <div data-testid="app-inside-gate">Study Workspace</div>
      </AuthGate>,
    );

    await waitFor(() => {
      expect(screen.getByText("Team Study Lab")).toBeInTheDocument();
    });
    expect(screen.queryByTestId("app-inside-gate")).toBeNull();
    expect(screen.getByText("Continue with Authentik SSO")).toBeInTheDocument();
    expect(screen.getByText("Create an account")).toBeInTheDocument();
  });
});
