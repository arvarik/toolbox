import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate } from "../components/auth/AuthGate.tsx";
import FeynmanPage from "../pages/FeynmanPage";
import useKeyboardShortcuts from "../hooks/useKeyboardShortcuts";
import useAppStore, { clearClientUserData } from "../stores/appStore";
import useCalcStore from "../stores/useCalcStore";
import useKitStore, { extractKitSlugFromPathname } from "../stores/useKitStore";
import useTimerStore from "../stores/useTimerStore";
import { userAiSettingsApi } from "../utils/aiSettingsApi";
import { compilerApi } from "../utils/compilerApi";
import { boardsApi, decksApi, guideContentApi, kitsApi } from "../utils/api";
import { makeTestKit, resetKitStore } from "./testHelpers";

const webauthn = vi.hoisted(() => ({ startAuthentication: vi.fn() }));
vi.mock("@simplewebauthn/browser", () => ({
  browserSupportsWebAuthn: () => true,
  startAuthentication: webauthn.startAuthentication,
  startRegistration: vi.fn(),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("api.ts HTTP errors + AuthGate", () => {
  beforeEach(() => {
    window.history.pushState({}, "", "/");
    localStorage.clear();
    sessionStorage.clear();
    clearClientUserData();
  });

  afterEach(() => {
    window.history.pushState({}, "", "/");
    Reflect.deleteProperty(window, "SpeechRecognition");
    Reflect.deleteProperty(window, "webkitSpeechRecognition");
    vi.restoreAllMocks();
  });

  it("throws HTTP 401 errors on mutations and signals toolbox:unauthorized", async () => {
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

  it("shows explicit error screen on HTTP 403/502 auth status errors and recovers on Retry", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json(
          { error: { code: "HOST_NOT_ALLOWED", message: "Host header rejected." } },
          403,
        ),
      )
      .mockResolvedValueOnce(
        json({ error: { message: "Upstream bad gateway" } }, 502),
      )
      .mockResolvedValueOnce(
        json({ authRequired: false, authenticated: true, setupRequired: false, user: null }),
      );

    render(
      <AuthGate>
        <div data-testid="app-inside-gate">Study Workspace</div>
      </AuthGate>,
    );

    const firstAlert = await screen.findByRole("alert");
    expect(firstAlert).toHaveTextContent("HTTP 403 (HOST_NOT_ALLOWED)");
    expect(firstAlert).toHaveTextContent("Host header rejected.");
    expect(screen.queryByTestId("app-inside-gate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("HTTP 502");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByTestId("app-inside-gate")).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("handles forgot-password, magic-link requests, and URL token redemptions while stripping ?token", async () => {
    const signedOut = {
      authRequired: true,
      authenticated: false,
      setupRequired: false,
      mailConfigured: true,
      magicLinkSignIn: true,
      user: null,
      instanceName: "Lab",
    };

    const requests: Array<{ url: string; body: unknown }> = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url, body });
      if (url === "/api/auth/status") return json(signedOut);
      if (url === "/api/auth/password-reset/request") return json({}, 202);
      if (url === "/api/auth/magic-link/request") return json({}, 202);
      if (url === "/api/auth/email-change/complete") {
        return json({ email: "updated@example.com" });
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const { unmount } = render(
      <AuthGate>
        <div data-testid="app-inside-gate">Study Workspace</div>
      </AuthGate>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Forgot password?" }));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Reset Link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("password reset link");
    fireEvent.click(screen.getByRole("button", { name: "Back to Sign In" }));

    fireEvent.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "user@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send Sign-In Link" }));
    expect(await screen.findByRole("status")).toHaveTextContent("sign-in link");
    unmount();

    // /confirm-email?token=... strips token and shows confirmation banner
    window.history.pushState({}, "", "/confirm-email?token=confirm-tok-42");
    render(
      <AuthGate>
        <div data-testid="app-inside-gate">Study Workspace</div>
      </AuthGate>,
    );
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("");
    expect(await screen.findByRole("status")).toHaveTextContent("updated@example.com");

    expect(requests).toEqual(
      expect.arrayContaining([
        { url: "/api/auth/password-reset/request", body: { email: "user@example.com" } },
        { url: "/api/auth/magic-link/request", body: { email: "user@example.com" } },
        { url: "/api/auth/email-change/complete", body: { token: "confirm-tok-42" } },
      ]),
    );
  });

  it("emits toolbox:unauthorized on 401 across AI settings, compiler, and kit export APIs and purges client stores/storage", async () => {
    const kit = makeTestKit({ slug: "kit-alpha", name: "Alpha" });
    resetKitStore(kit);
    useAppStore.setState({ apiKeyConfigured: true, searchOpen: true });
    useCalcStore.getState().applyScenario("url-shortener");
    useTimerStore.getState().setTaskName("Confidential Review Task");
    localStorage.setItem("toolbox_chat_history", "secret");
    localStorage.setItem("toolbox_chat_quote", "quote");
    localStorage.setItem("toolbox_calc_state", "calc");
    localStorage.setItem("toolbox_timer_settings", "timer");
    localStorage.setItem("toolbox_learning_sessions_kit-alpha", "sessions");
    localStorage.setItem("toolbox_learning_current_kit-alpha", "s1");
    sessionStorage.setItem("toolbox_chat_draft", "draft");

    let unauthEvents = 0;
    const listener = () => {
      unauthEvents += 1;
    };
    window.addEventListener("toolbox:unauthorized", listener);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ error: { message: "Unauthorized AI" } }, 401))
      .mockResolvedValueOnce(json({ error: { message: "Unauthorized Compiler" } }, 401))
      .mockResolvedValueOnce(json({ error: { message: "Unauthorized Export" } }, 401));

    try {
      await expect(userAiSettingsApi.get()).rejects.toThrow("Unauthorized AI");
      await expect(compilerApi.deleteSource("src-1")).rejects.toThrow("Unauthorized Compiler");
      await expect(kitsApi.downloadExport("kit-alpha")).rejects.toThrow("Unauthorized Export");

      expect(unauthEvents).toBe(3);
      expect(useKitStore.getState().kits).toEqual([]);
      expect(useKitStore.getState().activeKit).toBeNull();
      expect(useKitStore.getState().activeKitSlug).toBeNull();
      expect(useAppStore.getState().searchOpen).toBe(false);
      expect(useCalcStore.getState().scenarioId).toBe("custom");
      expect(useTimerStore.getState().taskName).toBe("");
      expect(localStorage.getItem("toolbox_chat_history")).toBeNull();
      expect(localStorage.getItem("toolbox_chat_quote")).toBeNull();
      expect(localStorage.getItem("toolbox_calc_state")).toBeNull();
      expect(localStorage.getItem("toolbox_timer_settings")).toBeNull();
      expect(localStorage.getItem("toolbox_learning_sessions_kit-alpha")).toBeNull();
      expect(localStorage.getItem("toolbox_learning_current_kit-alpha")).toBeNull();
      expect(sessionStorage.getItem("toolbox_chat_draft")).toBeNull();
    } finally {
      fetchSpy.mockRestore();
      window.removeEventListener("toolbox:unauthorized", listener);
    }
  });

  it("drops stale out-of-order selectKitBySlug responses, handles malformed % slugs, and honors explicit kitSlug overrides & encoded IDs", async () => {
    expect(extractKitSlugFromPathname("/k/%E0%A4%A/guide")).toBeNull();
    window.history.pushState({}, "", "/k/%E0%A4%A/guide");
    const listFetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => json({ kits: [] }));
    await expect(kitsApi.list()).resolves.toEqual({ kits: [] });
    listFetchSpy.mockRestore();

    const kitA = makeTestKit({ slug: "kit-a", name: "Kit A" });
    const kitB = makeTestKit({ slug: "kit-b", name: "Kit B" });
    let resolveA!: (val: { kit?: Record<string, unknown> }) => void;
    let resolveB!: (val: { kit?: Record<string, unknown> }) => void;

    const getSpy = vi.spyOn(kitsApi, "get").mockImplementation((slug) => {
      return new Promise<{ kit?: Record<string, unknown> }>((resolve) => {
        if (slug === "kit-a") resolveA = resolve;
        else resolveB = resolve;
      });
    });
    vi.spyOn(kitsApi, "touch").mockResolvedValue({});

    const pA = useKitStore.getState().selectKitBySlug("kit-a");
    const pB = useKitStore.getState().selectKitBySlug("kit-b");
    expect(getSpy).toHaveBeenCalledTimes(2);

    resolveB({ kit: { ...kitB } });
    await pB;
    resolveA({ kit: { ...kitA } });
    await pA;

    expect(useKitStore.getState().activeKitSlug).toBe("kit-b");
    expect(useKitStore.getState().activeKit?.slug).toBe("kit-b");

    // Navigate URL to kit-b while sending an explicit override for kit-a (plus special chars encoding)
    window.history.pushState({}, "", "/k/kit-b/guide");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => json({ ok: true }));

    await guideContentApi.upsert("p/1", "t#2", "s 3", "draft", "kit-a");
    await boardsApi.update("board/99", { name: "B", data: {} }, "kit-a");

    const [firstUrl, firstInit] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(firstUrl).toBe("/api/guide-content/p%2F1/t%232/s%203");
    expect((firstInit.headers as Record<string, string>)["X-Toolbox-Kit"]).toBe("kit-a");

    const [secondUrl, secondInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
    expect(secondUrl).toBe("/api/boards/board%2F99");
    expect((secondInit.headers as Record<string, string>)["X-Toolbox-Kit"]).toBe("kit-a");
  });

  it("ignores Shift/Alt chords and editable Mod+1..9 shortcuts, and toasts Feynman speech recognition errors", async () => {
    function ShortcutHarness() {
      useKeyboardShortcuts();
      const loc = useLocation();
      return (
        <div>
          <span data-testid="loc">{loc.pathname}</span>
          <input data-testid="editable" />
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={["/k/system-design/guide"]}>
        <ShortcutHarness />
      </MemoryRouter>,
    );

    const editable = screen.getByTestId("editable");
    editable.focus();

    // Shift+Ctrl+J must not toggle chatOpen.guide
    fireEvent.keyDown(document.body, { key: "J", ctrlKey: true, shiftKey: true });
    expect(useAppStore.getState().chatOpen.guide).toBe(false);

    // Ctrl+1 inside <input> must not navigate away
    fireEvent.keyDown(editable, { key: "1", ctrlKey: true });
    expect(screen.getByTestId("loc")).toHaveTextContent("/k/system-design/guide");

    // Plain Ctrl+j toggles guide chat
    fireEvent.keyDown(document.body, { key: "j", ctrlKey: true });
    expect(useAppStore.getState().chatOpen.guide).toBe(true);

    // Feynman SpeechRecognition onerror reports user-visible toast
    type MockRec = { onerror: ((ev: { error?: string }) => void) | null };
    const recognitionInstances: MockRec[] = [];
    const registerRecognition = (rec: MockRec) => {
      recognitionInstances.push(rec);
    };
    class MockSpeechRecognition {
      continuous = false;
      interimResults = false;
      onresult = null;
      onerror: ((ev: { error?: string }) => void) | null = null;
      onend = null;
      start() {}
      stop() {}
      constructor() {
        registerRecognition(this);
      }
    }
    Object.defineProperty(window, "webkitSpeechRecognition", {
      value: MockSpeechRecognition,
      configurable: true,
    });
    resetKitStore(makeTestKit({ slug: "system-design", name: "System Design" }));

    render(
      <MemoryRouter initialEntries={["/k/system-design/feynman"]}>
        <FeynmanPage />
      </MemoryRouter>,
    );

    expect(recognitionInstances.length).toBeGreaterThanOrEqual(1);
    act(() => {
      recognitionInstances[recognitionInstances.length - 1]?.onerror?.({
        error: "not-allowed",
      });
    });

    expect(
      useAppStore
        .getState()
        .toasts.some((t) => t.type === "error" && t.message.includes("Microphone permission denied")),
    ).toBe(true);
  });
});
