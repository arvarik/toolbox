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
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  KeyRound,
  LogIn,
  Mail,
  RefreshCw,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { KitLogo } from "../ui/KitLogo";
import {
  AuthApiError,
  authApi,
  type AuthStatusResponse,
  type AuthUser,
} from "../../utils/authApi.ts";
import { clearClientUserData } from "../../stores/appStore";

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

interface UrlAuthTokens {
  inviteToken: string | null;
  resetToken: string | null;
  magicToken: string | null;
  emailToken: string | null;
}

function takeUrlAuthTokens(): UrlAuthTokens {
  const empty: UrlAuthTokens = {
    inviteToken: null,
    resetToken: null,
    magicToken: null,
    emailToken: null,
  };
  if (typeof window === "undefined") return empty;
  const url = new URL(window.location.href);
  const token = url.searchParams.get("token")?.trim() || null;
  if (!token) return empty;

  if (url.pathname === "/join") {
    window.history.replaceState({}, "", "/");
    return { ...empty, inviteToken: token };
  }
  if (url.pathname === "/reset-password") {
    window.history.replaceState({}, "", "/");
    return { ...empty, resetToken: token };
  }
  if (url.pathname === "/signin-link") {
    window.history.replaceState({}, "", "/");
    return { ...empty, magicToken: token };
  }
  if (url.pathname === "/confirm-email") {
    window.history.replaceState({}, "", "/");
    return { ...empty, emailToken: token };
  }
  return empty;
}

export function passkeysAvailable(): boolean {
  if (typeof window === "undefined" || !window.isSecureContext) return false;
  const host = window.location.hostname;
  if (window.location.protocol !== "https:" && host !== "localhost") return false;
  return browserSupportsWebAuthn();
}

type ScreenMode =
  | "checking"
  | "error"
  | "setup"
  | "join"
  | "signin"
  | "forgot-password"
  | "magic-link"
  | "reset-password"
  | "signin-link"
  | "confirm-email"
  | "register"
  | "password-change"
  | "open";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const [initialTokens] = useState<UrlAuthTokens>(takeUrlAuthTokens);
  const [screen, setScreen] = useState<ScreenMode>("checking");
  const [status, setStatus] = useState<AuthStatusResponse | null>(null);
  const [statusError, setStatusError] = useState<{
    status?: number;
    code?: string;
    message: string;
  } | null>(null);
  const [isResolved, setIsResolved] = useState(false);

  const [inviteToken, setInviteToken] = useState<string | null>(
    initialTokens.inviteToken,
  );
  const inviteRef = useRef(inviteToken);
  const [resetToken, setResetToken] = useState<string | null>(
    initialTokens.resetToken,
  );
  const resetRef = useRef(resetToken);
  const [magicToken, setMagicToken] = useState<string | null>(
    initialTokens.magicToken,
  );
  const magicRef = useRef(magicToken);
  const [emailToken, setEmailToken] = useState<string | null>(
    initialTokens.emailToken,
  );
  const emailConfirmRef = useRef(emailToken);

  const manualSetupRef = useRef(false);
  const attemptedMagicRef = useRef<string | null>(null);
  const attemptedEmailRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [confirmedEmail, setConfirmedEmail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Form fields shared across auth screens
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    setStatusError(null);
    try {
      const next = await authApi.status();
      if (!mountedRef.current) return;
      setStatus(next);
      setIsResolved(true);
      if (magicRef.current) {
        setScreen("signin-link");
      } else if (emailConfirmRef.current) {
        setScreen("confirm-email");
      } else if (resetRef.current) {
        setScreen("reset-password");
      } else if (inviteRef.current) {
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
    } catch (err) {
      if (!mountedRef.current) return;
      if (err instanceof TypeError) {
        // Offline / dev fallback: render the app only on unreachable network failure
        setIsResolved(true);
        setScreen("open");
        return;
      }
      const statusCode = err instanceof AuthApiError ? err.status : undefined;
      const errorCode = err instanceof AuthApiError ? err.code : undefined;
      const message =
        err instanceof Error
          ? err.message
          : "Unable to verify session with server";
      setStatusError({ status: statusCode, code: errorCode, message });
      setIsResolved(true);
      setScreen("error");
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onUnauthorized = () => {
      clearClientUserData();
      void refresh();
    };
    window.addEventListener("toolbox:unauthorized", onUnauthorized);
    return () =>
      window.removeEventListener("toolbox:unauthorized", onUnauthorized);
  }, [refresh]);

  useEffect(() => {
    if (screen !== "signin-link" || !magicToken) return;
    if (attemptedMagicRef.current === magicToken) return;
    attemptedMagicRef.current = magicToken;

    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        await authApi.completeMagicLink({ token: magicToken });
        if (!mountedRef.current) return;
        magicRef.current = null;
        setMagicToken(null);
        await refresh();
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Sign-in link is invalid or has expired",
        );
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    };
    void run();
  }, [screen, magicToken, refresh]);

  useEffect(() => {
    if (screen !== "confirm-email" || !emailToken) return;
    if (attemptedEmailRef.current === emailToken) return;
    attemptedEmailRef.current = emailToken;

    const run = async () => {
      setBusy(true);
      setError(null);
      try {
        const res = await authApi.completeEmailChange(emailToken);
        if (!mountedRef.current) return;
        setConfirmedEmail(res.email);
        try {
          const fresh = await authApi.status();
          if (mountedRef.current) setStatus(fresh);
        } catch {
          // Keep confirmation banner visible even if status refresh fails
        }
      } catch (err) {
        if (!mountedRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Email confirmation link is invalid or has expired",
        );
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    };
    void run();
  }, [screen, emailToken]);

  const beginSetup = useCallback(() => {
    manualSetupRef.current = true;
    setError(null);
    setInfoMessage(null);
    setPassword("");
    setScreen("setup");
  }, []);

  const cancelManualSetup = useCallback(() => {
    manualSetupRef.current = false;
    setError(null);
    setScreen("open");
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearClientUserData();
      setPassword("");
      setCurrentPassword("");
      setError(null);
      setInfoMessage(null);
      await refresh();
    }
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

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfoMessage(null);
    try {
      await authApi.requestPasswordReset(email.trim());
      setInfoMessage(
        "If an account matches that email, a password reset link has been sent.",
      );
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not send password reset email",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleCompletePasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetToken) return;
    setBusy(true);
    setError(null);
    try {
      await authApi.completePasswordReset({ token: resetToken, password });
      resetRef.current = null;
      setResetToken(null);
      setPassword("");
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not reset password. Your link may have expired.",
      );
    } finally {
      setBusy(false);
    }
  };

  const handleRequestMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfoMessage(null);
    try {
      await authApi.requestMagicLink(email.trim());
      setInfoMessage(
        "If an account matches that email, a sign-in link has been sent.",
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not send sign-in link",
      );
    } finally {
      setBusy(false);
    }
  };

  const returnToSignIn = () => {
    magicRef.current = null;
    resetRef.current = null;
    emailConfirmRef.current = null;
    setMagicToken(null);
    setResetToken(null);
    setEmailToken(null);
    setConfirmedEmail(null);
    setError(null);
    setInfoMessage(null);
    if (status) {
      if (inviteRef.current) setScreen("join");
      else if (status.setupRequired || manualSetupRef.current) setScreen("setup");
      else if (status.authRequired && !status.authenticated) setScreen("signin");
      else if (status.user?.mustChangePassword) setScreen("password-change");
      else setScreen("open");
    } else {
      void refresh();
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
          <div className="flex items-center gap-3.5 mb-6">
            <div className="w-11 h-11 rounded-xl border border-outline-variant bg-surface-container-high text-on-surface flex items-center justify-center shrink-0">
              <KitLogo size={26} ariaHidden />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2 flex-wrap">
                <h1 className="text-xl font-serif font-semibold leading-tight text-on-surface">
                  {instanceLabel}
                </h1>
                <span className="text-[11px] font-medium uppercase tracking-wider text-on-surface-variant">
                  Tools for Thought
                </span>
              </div>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {screen === "error" && "Unable to connect to workspace"}
                {screen === "setup" && "Create Administrator Account"}
                {screen === "signin" && "Sign in to your study workspace"}
                {screen === "forgot-password" && "Reset your password"}
                {screen === "magic-link" && "Sign in with an email link"}
                {screen === "reset-password" && "Choose a new password"}
                {screen === "signin-link" && "Verifying your sign-in link"}
                {screen === "confirm-email" && "Confirm email address"}
                {screen === "register" && "Create a new learner account"}
                {screen === "join" && "Accept your invitation"}
                {screen === "password-change" && "Set a permanent password"}
              </p>
            </div>
          </div>

          {error && screen !== "error" && (
            <div
              role="alert"
              className="mb-4 rounded-lg bg-error/15 px-3.5 py-2.5 text-sm text-danger border border-danger/30"
            >
              {error}
            </div>
          )}

          {infoMessage && (
            <div
              role="status"
              className="mb-4 rounded-lg bg-primary/10 px-3.5 py-2.5 text-sm text-on-primary-wash"
            >
              {infoMessage}
            </div>
          )}

          {screen === "error" && statusError && (
            <div className="space-y-4">
              <div
                role="alert"
                className="rounded-lg bg-error/15 px-3.5 py-3 text-sm text-danger border border-danger/30 space-y-1"
              >
                <div className="flex items-center gap-2 font-medium">
                  <AlertCircle size={16} />
                  <span>
                    {statusError.status
                      ? `Server returned HTTP ${statusError.status}`
                      : "Session check failed"}
                    {statusError.code ? ` (${statusError.code})` : ""}
                  </span>
                </div>
                <p className="text-xs text-danger">{statusError.message}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setScreen("checking");
                  void refresh();
                }}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary"
              >
                <RefreshCw size={15} />
                Retry
              </button>
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

              {(status?.mailConfigured || status?.magicLinkSignIn) && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs pt-1">
                  {status?.mailConfigured ? (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setInfoMessage(null);
                        setScreen("forgot-password");
                      }}
                      className="font-medium text-primary underline"
                    >
                      Forgot password?
                    </button>
                  ) : (
                    <span />
                  )}
                  {status?.magicLinkSignIn && (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setInfoMessage(null);
                        setScreen("magic-link");
                      }}
                      className="font-medium text-primary underline"
                    >
                      Email me a sign-in link
                    </button>
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
                      setInfoMessage(null);
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

          {screen === "forgot-password" && (
            <form onSubmit={handleRequestPasswordReset} className="space-y-3.5">
              <p className="text-xs text-on-surface-variant">
                Enter your account email and we will send you a password reset
                link.
              </p>
              <div>
                <label
                  htmlFor="forgot-email"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Email address
                </label>
                <input
                  id="forgot-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
              >
                <Mail size={16} />
                {busy ? "Sending..." : "Send Reset Link"}
              </button>
              <button
                type="button"
                onClick={returnToSignIn}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-surface-container-high px-4 py-2 text-sm text-on-surface border border-outline-variant hover:bg-surface-container-highest"
              >
                <ArrowLeft size={15} />
                Back to Sign In
              </button>
            </form>
          )}

          {screen === "magic-link" && (
            <form onSubmit={handleRequestMagicLink} className="space-y-3.5">
              <p className="text-xs text-on-surface-variant">
                Enter your email address and we will send you a one-time link
                to sign in.
              </p>
              <div>
                <label
                  htmlFor="magic-email"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  Email address
                </label>
                <input
                  id="magic-email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-sm text-on-surface focus:border-primary"
                />
              </div>
              <button
                type="submit"
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary disabled:opacity-60"
              >
                <Mail size={16} />
                {busy ? "Sending..." : "Send Sign-In Link"}
              </button>
              <button
                type="button"
                onClick={returnToSignIn}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-surface-container-high px-4 py-2 text-sm text-on-surface border border-outline-variant hover:bg-surface-container-highest"
              >
                <ArrowLeft size={15} />
                Back to Sign In
              </button>
            </form>
          )}

          {screen === "reset-password" && (
            <form onSubmit={handleCompletePasswordReset} className="space-y-3.5">
              <p className="text-xs text-on-surface-variant">
                Enter a new password for your account to complete the reset.
              </p>
              <div>
                <label
                  htmlFor="reset-new-password"
                  className="block text-xs font-medium text-on-surface-variant mb-1"
                >
                  New password (12+ characters)
                </label>
                <input
                  id="reset-new-password"
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
                {busy ? "Resetting..." : "Reset Password"}
              </button>
              <button
                type="button"
                onClick={returnToSignIn}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-surface-container-high px-4 py-2 text-sm text-on-surface border border-outline-variant hover:bg-surface-container-highest"
              >
                <ArrowLeft size={15} />
                Back to Sign In
              </button>
            </form>
          )}

          {screen === "signin-link" && (
            <div className="space-y-4">
              {busy ? (
                <div className="flex items-center gap-3 py-2 text-sm text-on-surface-variant">
                  <div className="w-5 h-5 rounded-full border-2 border-outline-variant border-t-primary animate-spin shrink-0" />
                  <span>Completing your email sign-in...</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={returnToSignIn}
                  className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-surface-container-high px-4 py-2 text-sm text-on-surface border border-outline-variant hover:bg-surface-container-highest"
                >
                  <ArrowLeft size={15} />
                  Back to Sign In
                </button>
              )}
            </div>
          )}

          {screen === "confirm-email" && (
            <div className="space-y-4">
              {busy && !confirmedEmail && !error ? (
                <div className="flex items-center gap-3 py-2 text-sm text-on-surface-variant">
                  <div className="w-5 h-5 rounded-full border-2 border-outline-variant border-t-primary animate-spin shrink-0" />
                  <span>Confirming your email address...</span>
                </div>
              ) : (
                <>
                  {confirmedEmail && (
                    <div
                      role="status"
                      className="rounded-lg bg-primary/10 px-3.5 py-3 text-sm text-on-primary-wash flex items-start gap-2.5"
                    >
                      <CheckCircle2 size={16} className="shrink-0 mt-0.5" />
                      <span>
                        Email address confirmed and updated to{" "}
                        <strong className="font-medium">{confirmedEmail}</strong>
                        .
                      </span>
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={returnToSignIn}
                    className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-on-primary"
                  >
                    {status?.authenticated || !status?.authRequired
                      ? "Continue to Workspace"
                      : "Continue to Sign In"}
                  </button>
                </>
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
