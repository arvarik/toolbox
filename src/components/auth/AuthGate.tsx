import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  browserSupportsWebAuthn,
  startAuthentication,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { KeyRound, Layers, LogIn, ShieldCheck, UserPlus } from "lucide-react";
import {
  authApi,
  type AuthStatusResponse,
  type AuthUser,
} from "../../utils/authApi.ts";

export interface AuthContextValue {
  status: AuthStatusResponse | null;
  user: AuthUser | null;
  authRequired: boolean;
  isAdmin: boolean;
  localOwnerPresent: boolean;
  isResolved: boolean;
  refresh: () => Promise<void>;
  beginSetup: () => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  status: null,
  user: null,
  authRequired: false,
  isAdmin: false,
  localOwnerPresent: false,
  isResolved: false,
  refresh: async () => {},
  beginSetup: () => {},
  logout: async () => {},
});

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

function takeInviteTokenFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  const url = new URL(window.location.href);
  if (url.pathname !== "/join") return null;
  const token = url.searchParams.get("token")?.trim() || null;
  if (token) {
    window.history.replaceState({}, "", "/");
  }
  return token;
}

export function passkeysAvailable(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  const host = window.location.hostname;
  if (window.location.protocol !== "https:" && host !== "localhost") return false;
  return browserSupportsWebAuthn();
}

type ScreenMode =
  | "checking"
  | "setup"
  | "join"
  | "signin"
  | "register"
  | "password-change"
  | "open";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [screen, setScreen] = useState<ScreenMode>("checking");
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [isResolved, setIsResolved] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(
    takeInviteTokenFromUrl,
  );
  const inviteRef = useRef(inviteToken);
  const manualSetupRef = useRef(false);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form fields shared across auth screens
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const refresh = useCallback(async () => {
    try {
      const next = await authApi.status();
      setStatus(next);
      setIsResolved(true);
      if (inviteRef.current) {
        setScreen("join");
      } else if (next.setupRequired || manualSetupRef.current) {
        setScreen("setup");
      } else if (next.authRequired && !next.authenticated) {
        setScreen("signin");
      } else if (next.user?.mustChangePassword) {
        setScreen("password-change");
      } else {
        setScreen("open");
      }
    } catch {
      // Offline / dev fallback: let local IndexedDB cache render cleanly
      setIsResolved(true);
      setScreen("open");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      void refresh();
    };
    window.addEventListener("toolbox:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("toolbox:unauthorized", onUnauthorized);
  }, [refresh]);

  const beginSetup = useCallback(() => {
    manualSetupRef.current = true;
    setError(null);
    setPassword("");
    setScreen("setup");
  }, []);

  const cancelManualSetup = useCallback(() => {
    manualSetupRef.current = false;
    setError(null);
    setScreen("open");
  }, []);

  const logout = useCallback(async () => {
    await authApi.logout();
    setPassword("");
    await refresh();
  }, [refresh]);

  const handleSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.setup({ email, username, password, displayName });
      manualSetupRef.current = false;
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Account setup failed");
    } finally {
      setBusy(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.login({ identifier, password });
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeySignIn = async () => {
    setBusy(true);
    setError(null);
    try {
      const { ceremonyId, options } = await authApi.passkeyLoginOptions();
      const response = await startAuthentication({
        optionsJSON: options as PublicKeyCredentialRequestOptionsJSON,
      });
      await authApi.passkeyLoginVerify({ ceremonyId, response });
      await refresh();
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError(null);
      } else {
        setError(err instanceof Error ? err.message : "Passkey sign-in failed");
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.register({ email, username, password, displayName });
      setPassword("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setBusy(false);
    }
  };

  const handleAcceptInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteToken) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.acceptInvitation({
        token: inviteToken,
        email,
        username,
        password,
        displayName: displayName || undefined,
      });
      inviteRef.current = null;
      setInviteToken(null);
      setPassword("");
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not accept invitation",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForcedPasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authApi.changePassword({
        currentPassword,
        newPassword: password,
      });
      setCurrentPassword("");
      setPassword("");
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not update password",
      );
    } finally {
      setBusy(false);
    }
  };

  const ctxValue: AuthContextValue = {
    status,
    user: status?.user ?? null,
    authRequired: status?.authRequired ?? false,
    isAdmin: status?.user?.role === "admin",
    localOwnerPresent: status?.localOwnerPresent ?? false,
    isResolved,
    refresh,
    beginSetup,
    logout,
  };

  if (screen === "checking") {
    return (
      <AuthContext.Provider value={ctxValue}>
        <div className="min-h-dvh flex items-center justify-center bg-surface text-on-surface">
          <div
            className="w-7 h-7 rounded-full border-2 border-outline-variant border-t-primary animate-spin"
            aria-label="Checking session"
          />
        </div>
      </AuthContext.Provider>
    );
  }

  if (screen === "open") {
    return (
      <AuthContext.Provider value={ctxValue}>
        <React.Fragment key={status?.user?.id ?? "local"}>
          {children}
        </React.Fragment>
      </AuthContext.Provider>
    );
  }

  const instanceLabel = status?.instanceName || "Toolbox";

  return (
    <AuthContext.Provider value={ctxValue}>
      <main className="min-h-dvh w-full overflow-y-auto flex items-center justify-center p-6 bg-surface text-on-surface">
        <div className="w-full max-w-md rounded-2xl bg-surface-container p-7 border border-outline-variant shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-9 h-9 rounded-lg bg-primary/15 text-on-primary-wash flex items-center justify-center">
              <Layers size={18} />
            </div>
            <div>
              <h1 className="text-lg font-semibold leading-tight text-on-surface">
                {instanceLabel}
              </h1>
              <p className="text-xs text-on-surface-variant">
                {screen === "setup" && "Create Administrator Account"}
                {screen === "signin" && "Sign in to your study workspace"}
                {screen === "register" && "Create a new learner account"}
                {screen === "join" && "Accept your invitation"}
                {screen === "password-change" && "Set a permanent password"}
              </p>
            </div>
          </div>

          {error && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-error/15 px-3.5 py-2.5 text-sm text-danger border border-danger/30"
            >
              {error}
            </div>
          )}

          {screen === "setup" && (
            <form onSubmit={handleSetup} className="space-y-3.5">
              {(status?.localOwnerPresent || (status?.deviceItems ?? 0) > 0) && (
                <div className="rounded-lg bg-primary/10 px-3.5 py-2.5 text-xs text-on-primary-wash">
                  All existing study kits, flashcards, whiteboards, and notes on
                  this instance will stay in your new administrator account.
                </div>
              )}
              <div>
                <label
                  htmlFor="setup-username"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Username
                </label>
                <input
                  id="setup-username"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="alex"
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="setup-display-name"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Display name
                </label>
                <input
                  id="setup-display-name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Alex Rivera"
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="setup-email"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Email
                </label>
                <input
                  id="setup-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="alex@example.com"
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="setup-password"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Password (12+ characters)
                </label>
                <input
                  id="setup-password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div className="flex items-center gap-2 pt-2">
                <button
                  type="submit"
                  disabled={busy}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
                >
                  <ShieldCheck size={16} />
                  {busy ? "Creating..." : "Create Admin Account"}
                </button>
                {!status?.setupRequired && (
                  <button
                    type="button"
                    onClick={cancelManualSetup}
                    className="rounded-lg border border-outline-variant px-3.5 py-2.5 text-sm text-on-surface-variant hover:text-on-surface"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </form>
          )}

          {screen === "signin" && (
            <div className="space-y-4">
              <form onSubmit={handleSignIn} className="space-y-3.5">
                <div>
                  <label
                    htmlFor="signin-identifier"
                    className="block text-xs font-medium text-on-surface-variant mb-1"
                  >
                    Username or email
                  </label>
                  <input
                    id="signin-identifier"
                    required
                    autoComplete="username"
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                  />
                </div>
                <div>
                  <label
                    htmlFor="signin-password"
                    className="block text-xs font-medium text-on-surface-variant mb-1"
                  >
                    Password
                  </label>
                  <input
                    id="signin-password"
                    type="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                  />
                </div>
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
                >
                  <LogIn size={16} />
                  {busy ? "Signing in..." : "Sign In"}
                </button>
              </form>

              {(passkeysAvailable() || status?.oidc) && (
                <div className="space-y-2 pt-2 border-t border-outline-variant">
                  {passkeysAvailable() && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={handlePasskeySignIn}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-surface-container-high px-4 py-2 text-sm text-on-surface border border-outline-variant hover:bg-surface-container-highest"
                    >
                      <KeyRound size={15} />
                      Sign in with Passkey
                    </button>
                  )}
                  {status?.oidc && (
                    <a
                      href="/api/auth/oidc/start"
                      className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-surface-container-high px-4 py-2 text-sm text-on-surface border border-outline-variant hover:bg-surface-container-highest"
                    >
                      Continue with {status.oidc.name}
                    </a>
                  )}
                </div>
              )}

              {status?.registrationOpen && (
                <p className="text-center text-xs text-on-surface-variant pt-1">
                  New here?{" "}
                  <button
                    type="button"
                    onClick={() => {
                      setError(null);
                      setScreen("register");
                    }}
                    className="font-medium text-primary underline"
                  >
                    Create an account
                  </button>
                </p>
              )}
            </div>
          )}

          {screen === "register" && (
            <form onSubmit={handleRegister} className="space-y-3.5">
              <div>
                <label
                  htmlFor="reg-username"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Username
                </label>
                <input
                  id="reg-username"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="reg-display-name"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Display name
                </label>
                <input
                  id="reg-display-name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="reg-email"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Email
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="reg-password"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Password (12+ characters)
                </label>
                <input
                  id="reg-password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
              >
                <UserPlus size={16} />
                {busy ? "Creating..." : "Create Account"}
              </button>
              <p className="text-center text-xs text-on-surface-variant">
                Already have an account?{" "}
                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setScreen("signin");
                  }}
                  className="font-medium text-primary underline"
                >
                  Sign in
                </button>
              </p>
            </form>
          )}

          {screen === "join" && (
            <form onSubmit={handleAcceptInvite} className="space-y-3.5">
              <div>
                <label
                  htmlFor="join-username"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Choose a username
                </label>
                <input
                  id="join-username"
                  required
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="join-display-name"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Display name
                </label>
                <input
                  id="join-display-name"
                  autoComplete="name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="join-email"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Email
                </label>
                <input
                  id="join-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="join-password"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Password (12+ characters)
                </label>
                <input
                  id="join-password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
              >
                <UserPlus size={16} />
                {busy ? "Joining..." : "Accept Invitation & Join"}
              </button>
            </form>
          )}

          {screen === "password-change" && (
            <form onSubmit={handleForcedPasswordChange} className="space-y-3.5">
              <p className="text-xs text-on-surface-variant">
                Your account was created with a temporary password. Choose a new
                password to continue.
              </p>
              <div>
                <label
                  htmlFor="cur-password"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Temporary password
                </label>
                <input
                  id="cur-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <div>
                <label
                  htmlFor="next-password"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  New password (12+ characters)
                </label>
                <input
                  id="next-password"
                  type="password"
                  required
                  minLength={12}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
              >
                {busy ? "Updating..." : "Save New Password"}
              </button>
            </form>
          )}
        </div>
      </main>
    </AuthContext.Provider>
  );
}
