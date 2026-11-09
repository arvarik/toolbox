import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../components/auth/AuthGate.tsx";
import { decksApi } from "../utils/api";

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: webauthn.startAuthentication,
  startRegistration: vi.fn(),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

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

  it("signs in with a passkey, stays quiet on a cancelled prompt, shows server rejections, and re-gates on toolbox:unauthorized", async () => {
    Object.defineProperty(window, "isSecureContext", { value: true, configurable: true });
    const signedOut = { authRequired: true, authenticated: false, setupRequired: false, user: null, instanceName: "Lab" };
    let status: Record<string, unknown> = signedOut;
    const verifyResults = [
      json({ error: { code: "PASSKEY_VERIFICATION_FAILED", message: "Passkey verification failed." } }, 401),
      json({ user: { id: "u1", username: "ada" } }),
    ];
    const verifyBodies: unknown[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === "/api/auth/status") return json(status);
      if (url === "/api/auth/passkeys/login/options") return json({ ceremonyId: "c1", options: { challenge: "ch" } });
      if (url === "/api/auth/passkeys/login/verify") {
        verifyBodies.push(JSON.parse(String(init?.body)));
        return verifyResults.shift()!;
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    webauthn.startAuthentication
      .mockRejectedValueOnce(Object.assign(new Error("The operation was cancelled."), { name: "NotAllowedError" }))
      .mockResolvedValue({ id: "cred-1", type: "public-key" });

    try {
      render(
        <AuthGate>
          <div data-testid="app-inside-gate">Study Workspace</div>
        </AuthGate>,
      );
      const passkeyButton = await screen.findByRole("button", { name: "Sign in with Passkey" });

      fireEvent.click(passkeyButton);
      await waitFor(() => expect(webauthn.startAuthentication).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(passkeyButton).toBeEnabled());
      expect(screen.queryByRole("alert")).toBeNull();
      expect(verifyBodies).toEqual([]);

      fireEvent.click(passkeyButton);
      expect(await screen.findByRole("alert")).toHaveTextContent("Passkey verification failed.");

      status = { ...signedOut, authenticated: true, user: { id: "u1", username: "ada", mustChangePassword: false } };
      fireEvent.click(screen.getByRole("button", { name: "Sign in with Passkey" }));
      expect(await screen.findByTestId("app-inside-gate")).toBeInTheDocument();
      expect(webauthn.startAuthentication).toHaveBeenLastCalledWith({ optionsJSON: { challenge: "ch" } });
      expect(verifyBodies).toEqual([
        { ceremonyId: "c1", response: { id: "cred-1", type: "public-key" } },
        { ceremonyId: "c1", response: { id: "cred-1", type: "public-key" } },
      ]);

      // An expired session anywhere in the app sends the user back to sign-in
      status = signedOut;
      window.dispatchEvent(new CustomEvent("toolbox:unauthorized"));
      expect(await screen.findByLabelText("Username or email")).toBeInTheDocument();
      expect(screen.queryByTestId("app-inside-gate")).toBeNull();
    } finally {
      Reflect.deleteProperty(window, "isSecureContext");
    }
  });

  it("falls back to the local workspace when the auth status call fails offline", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    render(
      <AuthGate>
        <div data-testid="app-inside-gate">Study Workspace</div>
      </AuthGate>,
    );
    expect(await screen.findByTestId("app-inside-gate")).toBeInTheDocument();
  });
});
