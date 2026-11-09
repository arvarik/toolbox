import React, { useCallback, useEffect, useState } from "react";
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from "@simplewebauthn/browser";
import {
  Check,
  Copy,
  Database,
  KeyRound,
  Link2,
  LogOut,
  Plus,
  Shield,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import useAppStore from "../../stores/appStore";
import {
  adminApi,
  authApi,
  type AdminUserItem,
  type ApiTokenItem,
  type AuditLogEntry,
  type BackupItem,
  type InvitationItem,
  type PasskeyItem,
  type SessionItem,
} from "../../utils/authApi.ts";
import { passkeysAvailable, useAuth } from "../auth/AuthGate.tsx";

const errMessage = (err: unknown, fallback: string) =>
  err instanceof Error ? err.message : fallback;

export function AccountSecuritySection() {
  const { user, authRequired, localOwnerPresent, isResolved, beginSetup, logout, refresh } =
    useAuth();
  const addToast = useAppStore((s) => s.addToast);

  const [tokens, setTokens] = useState<ApiTokenItem[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeyItem[]>([]);
  const [sessions, setSessions] = useState<SessionItem[]>([]);

  const [tokenName, setTokenName] = useState("");
  const [tokenReadOnly, setTokenReadOnly] = useState(false);
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);

  const loadAccountData = useCallback(async () => {
    if (!isResolved || !authRequired || !user) return;
    try {
      const [tokRes, pkRes, sessRes] = await Promise.all([
        authApi.listTokens(),
        authApi.listPasskeys(),
        authApi.listSessions(),
      ]);
      setTokens(tokRes.tokens.filter((t) => !t.revokedAt));
      setPasskeys(pkRes.passkeys);
      setSessions(sessRes.sessions);
    } catch {
      // Ignore transient load failures
    }
  }, [isResolved, authRequired, user]);

  useEffect(() => {
    void loadAccountData();
  }, [loadAccountData]);

  if (!isResolved) return null;

  if (!authRequired && localOwnerPresent) {
    return (
      <>
        <div className="settings-section" id="account-security-section">
          <h2 className="settings-section-title">Account & Multi-User Mode</h2>
          <p className="settings-section-desc">
            This Toolbox instance is running in local single-user mode. Secure it
            with an administrator account to enable sign-in, Passkeys, personal{" "}
            <code>tbk_</code> API tokens, and multi-user invitations — keeping
            100% of your existing study data.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            id="secure-instance-btn"
            onClick={beginSetup}
          >
            <ShieldCheck size={14} />
            Secure This Instance
          </button>
        </div>
        <div className="divider-h" style={{ margin: "var(--space-6) 0" }} />
      </>
    );
  }

  if (!authRequired || !user) return null;

  const runGuarded = async (fallback: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      addToast({ type: "error", message: errMessage(err, fallback) });
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim()) return;
    await runGuarded("Could not create token", async () => {
      const created = await authApi.createToken({
        name: tokenName.trim(),
        readOnly: tokenReadOnly,
      });
      setRevealedToken(created.token);
      setTokenName("");
      setTokenReadOnly(false);
      await loadAccountData();
      addToast({ type: "success", message: "Personal API token created" });
    });
  };

  const handleRevokeToken = (id: string) =>
    runGuarded("Could not revoke token", async () => {
      await authApi.revokeToken(id);
      await loadAccountData();
      addToast({ type: "info", message: "API token revoked" });
    });

  const handleAddPasskey = async () => {
    try {
      const { ceremonyId, options } = await authApi.passkeyRegisterOptions();
      const response = await startRegistration({
        optionsJSON: options as PublicKeyCredentialCreationOptionsJSON,
      });
      await authApi.passkeyRegisterVerify({ ceremonyId, response });
      await loadAccountData();
      addToast({ type: "success", message: "Passkey registered" });
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") return;
      addToast({ type: "error", message: errMessage(err, "Passkey setup failed") });
    }
  };

  const handleDeletePasskey = (id: string) =>
    runGuarded("Could not remove passkey", async () => {
      await authApi.deletePasskey(id);
      await loadAccountData();
      addToast({ type: "info", message: "Passkey removed" });
    });

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setChangingPassword(true);
    try {
      await runGuarded("Could not change password", async () => {
        await authApi.changePassword({ currentPassword, newPassword });
        setCurrentPassword("");
        setNewPassword("");
        await refresh();
        addToast({ type: "success", message: "Password updated" });
      });
    } finally {
      setChangingPassword(false);
    }
  };

  const handleRevokeOtherSessions = () =>
    runGuarded("Failed to revoke sessions", async () => {
      const { revoked } = await authApi.revokeOtherSessions();
      await loadAccountData();
      addToast({
        type: "info",
        message: `Signed out ${revoked} other session${revoked === 1 ? "" : "s"}`,
      });
    });

  return (
    <>
      <div className="settings-section space-y-5" id="account-security-section">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="settings-section-title">Account & Security</h2>
            <p className="settings-section-desc">
              Signed in as <strong>{user.displayName || user.username}</strong> (
              <code>@{user.username}</code> · {user.role}).
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void logout()}
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>

        {/* Password Change */}
        <form
          onSubmit={handlePasswordChange}
          className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3"
        >
          <div className="text-sm font-medium text-on-surface">
            Change Password
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Current password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="input"
            />
            <input
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
              placeholder="New password (12+ chars)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="input"
            />
          </div>
          <button
            type="submit"
            className="btn btn-secondary"
            disabled={changingPassword || !currentPassword || !newPassword}
          >
            {changingPassword ? "Updating..." : "Update Password"}
          </button>
        </form>

        {/* Passkeys */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div>
              <div className="text-sm font-medium text-on-surface">Passkeys</div>
              <p className="text-xs text-on-surface-variant">
                Sign in with Touch ID, Face ID, or a hardware security key.
              </p>
            </div>
            {passkeysAvailable() && (
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => void handleAddPasskey()}
              >
                <KeyRound size={14} />
                Add Passkey
              </button>
            )}
          </div>
          {passkeys.length > 0 && (
            <div className="space-y-1.5">
              {passkeys.map((pk) => (
                <div
                  key={pk.id}
                  className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-xs border border-outline-variant"
                >
                  <span className="text-on-surface font-medium">{pk.name}</span>
                  <button
                    type="button"
                    onClick={() => void handleDeletePasskey(pk.id)}
                    className="text-danger hover:underline inline-flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Personal API Tokens */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div>
            <div className="text-sm font-medium text-on-surface">
              Personal API Tokens (<code>tbk_</code>)
            </div>
            <p className="text-xs text-on-surface-variant">
              Authenticate scripts and MCP agents against your personal study
              library via <code>Authorization: Bearer tbk_...</code>.
            </p>
          </div>

          {revealedToken && (
            <div className="rounded-lg bg-primary/10 p-3 border border-primary/30 space-y-1.5">
              <div className="text-xs font-medium text-on-primary-wash">
                Copy your new token now — it will not be shown again:
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-surface-container-lowest px-2.5 py-1.5 text-xs text-on-surface border border-outline-variant">
                  {revealedToken}
                </code>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(revealedToken);
                    setCopiedToken(true);
                    setTimeout(() => setCopiedToken(false), 2000);
                  }}
                >
                  {copiedToken ? <Check size={14} /> : <Copy size={14} />}
                  {copiedToken ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={handleCreateToken}
            className="flex items-center gap-2.5 flex-wrap"
          >
            <input
              className="input flex-1 min-w-48"
              placeholder="Token name (e.g. Claude Desktop MCP)"
              value={tokenName}
              onChange={(e) => setTokenName(e.target.value)}
            />
            <label className="inline-flex items-center gap-1.5 text-xs text-on-surface-variant cursor-pointer">
              <input
                type="checkbox"
                checked={tokenReadOnly}
                onChange={(e) => setTokenReadOnly(e.target.checked)}
              />
              Read-only
            </label>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!tokenName.trim()}
            >
              <Plus size={14} />
              Create Token
            </button>
          </form>

          {tokens.length > 0 && (
            <div className="space-y-1.5">
              {tokens.map((tok) => (
                <div
                  key={tok.id}
                  className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-xs border border-outline-variant"
                >
                  <div>
                    <span className="font-medium text-on-surface">
                      {tok.name}
                    </span>{" "}
                    <code className="text-on-surface-variant">
                      ({tok.tokenPrefix}…)
                    </code>
                    {tok.readOnly && (
                      <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[11px] text-on-primary-wash">
                        read-only
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRevokeToken(tok.id)}
                    className="text-danger hover:underline inline-flex items-center gap-1"
                  >
                    <Trash2 size={12} />
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Sessions */}
        {sessions.length > 1 && (
          <div className="flex items-center justify-between rounded-xl bg-surface-container p-4 border border-outline-variant text-xs">
            <span className="text-on-surface-variant">
              {sessions.length} active sessions on your account
            </span>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleRevokeOtherSessions()}
            >
              Sign Out Other Devices
            </button>
          </div>
        )}
      </div>

      <div className="divider-h" style={{ margin: "var(--space-6) 0" }} />
    </>
  );
}

export function InstanceAdminSection() {
  const { authRequired, isAdmin, isResolved, user: me } = useAuth();
  const addToast = useAppStore((s) => s.addToast);

  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [invitations, setInvitations] = useState<InvitationItem[]>([]);
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([]);
  const [registrationOpen, setRegistrationOpen] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"member" | "admin">("member");
  const [latestInviteUrl, setLatestInviteUrl] = useState<string | null>(null);
  const [tempPasswordInfo, setTempPasswordInfo] = useState<{
    username: string;
    password: string;
  } | null>(null);
  const [creatingBackup, setCreatingBackup] = useState(false);

  const loadAdminData = useCallback(async () => {
    if (!isResolved || !authRequired || !isAdmin) return;
    try {
      const [uRes, invRes, setRes, bkRes, audRes] = await Promise.all([
        adminApi.listUsers(),
        adminApi.listInvitations(),
        adminApi.getSettings(),
        adminApi.listBackups(),
        adminApi.listAudit(25),
      ]);
      setUsers(uRes.users);
      setInvitations(
        invRes.invitations.filter((i) => !i.revokedAt && !i.acceptedAt),
      );
      setRegistrationOpen(setRes.registrationOpen);
      setBackups(bkRes.backups);
      setAuditEntries(audRes.entries);
    } catch {
      // Ignore transient errors
    }
  }, [isResolved, authRequired, isAdmin]);

  useEffect(() => {
    void loadAdminData();
  }, [loadAdminData]);

  if (!isResolved || !authRequired || !isAdmin) return null;

  const runAdmin = async (fallback: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      addToast({ type: "error", message: errMessage(err, fallback) });
    }
  };

  const handleToggleRegistration = () =>
    runAdmin("Update failed", async () => {
      const next = !registrationOpen;
      await adminApi.updateSettings({ registrationOpen: next });
      setRegistrationOpen(next);
      addToast({
        type: "success",
        message: next
          ? "Open registration enabled"
          : "Open registration disabled (invite-only)",
      });
    });

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    await runAdmin("Could not create invite", async () => {
      const res = await adminApi.createInvitation({
        email: inviteEmail.trim() || undefined,
        role: inviteRole,
      });
      setLatestInviteUrl(res.link);
      setInviteEmail("");
      await loadAdminData();
      addToast({ type: "success", message: "Invitation link generated" });
    });
  };

  const handleResetUserPassword = (u: AdminUserItem) =>
    runAdmin("Reset failed", async () => {
      const { temporaryPassword } = await adminApi.resetPassword(u.id);
      setTempPasswordInfo({ username: u.username, password: temporaryPassword });
      await loadAdminData();
    });

  const handleToggleUserStatus = (u: AdminUserItem) =>
    runAdmin("Status update failed", async () => {
      if (u.status === "disabled") await adminApi.enableUser(u.id);
      else await adminApi.disableUser(u.id);
      await loadAdminData();
    });

  const handleCreateBackup = async () => {
    setCreatingBackup(true);
    try {
      await runAdmin("Backup failed", async () => {
        const { backup } = await adminApi.createBackup();
        await loadAdminData();
        addToast({
          type: "success",
          message: `Verified backup created (${backup.filename})`,
        });
      });
    } finally {
      setCreatingBackup(false);
    }
  };

  return (
    <>
      <div className="settings-section space-y-5" id="instance-admin-section">
        <div className="flex items-center gap-2">
          <Shield size={18} className="text-primary" />
          <h2 className="settings-section-title" style={{ marginBottom: 0 }}>
            Instance Administration
          </h2>
        </div>
        <p className="settings-section-desc">
          Manage users, invitations, online SQLite backups, and security audit
          logs across this Toolbox server.
        </p>

        {/* Registration policy */}
        <div className="flex items-center justify-between rounded-xl bg-surface-container p-4 border border-outline-variant gap-3 flex-wrap">
          <div>
            <div className="text-sm font-medium text-on-surface">
              Open Account Registration
            </div>
            <p className="text-xs text-on-surface-variant">
              When off, new learners need an invitation link from an
              administrator.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => void handleToggleRegistration()}
          >
            {registrationOpen ? "Disable Open Sign-Up" : "Enable Open Sign-Up"}
          </button>
        </div>

        {/* Invitations */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
            <Link2 size={15} />
            Invitations
          </div>
          {latestInviteUrl && (
            <div className="rounded-lg bg-primary/10 p-3 border border-primary/30 flex items-center justify-between gap-2">
              <code className="truncate text-xs text-on-surface">
                {latestInviteUrl}
              </code>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => {
                  void navigator.clipboard?.writeText(latestInviteUrl);
                  addToast({ type: "info", message: "Invite URL copied" });
                }}
              >
                <Copy size={13} />
                Copy
              </button>
            </div>
          )}
          <form
            onSubmit={handleCreateInvite}
            className="flex items-center gap-2 flex-wrap"
          >
            <input
              type="email"
              className="input flex-1 min-w-48"
              placeholder="Optional invitee email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
            />
            <select
              aria-label="Invited role"
              value={inviteRole}
              onChange={(e) =>
                setInviteRole(e.target.value as "member" | "admin")
              }
              className="rounded-lg bg-surface-container-lowest border border-outline-variant px-3 py-2 text-xs text-on-surface"
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" className="btn btn-primary">
              <Plus size={14} />
              Create Invite Link
            </button>
          </form>
          {invitations.length > 0 && (
            <div className="space-y-1.5">
              {invitations.map((inv) => (
                <div
                  key={inv.id}
                  className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-xs border border-outline-variant"
                >
                  <span className="text-on-surface-variant">
                    {inv.email || "Any email"} · {inv.role}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void adminApi.revokeInvitation(inv.id).then(loadAdminData)
                    }
                    className="text-danger hover:underline"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Users */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
            <Users size={15} />
            Accounts ({users.length})
          </div>
          {tempPasswordInfo && (
            <div className="rounded-lg bg-primary/10 p-3 border border-primary/30 text-xs text-on-primary-wash">
              Temporary password for <strong>@{tempPasswordInfo.username}</strong>
              : <code className="font-mono">{tempPasswordInfo.password}</code>
            </div>
          )}
          <div className="space-y-1.5">
            {users.map((u) => (
              <div
                key={u.id}
                className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-xs border border-outline-variant gap-2 flex-wrap"
              >
                <div>
                  <span className="font-medium text-on-surface">
                    {u.displayName || u.username}
                  </span>{" "}
                  <span className="text-on-surface-variant">
                    (@{u.username} · {u.role}
                    {u.status === "disabled" ? " · disabled" : ""})
                  </span>
                </div>
                {u.id !== me?.id && (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleResetUserPassword(u)}
                      className="text-primary hover:underline"
                    >
                      Reset password
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleToggleUserStatus(u)}
                      className="text-on-surface-variant hover:text-on-surface"
                    >
                      {u.status === "disabled" ? "Enable" : "Disable"}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Online SQLite Backups */}
        <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 text-sm font-medium text-on-surface">
              <Database size={15} />
              Online SQLite Backups
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={creatingBackup}
              onClick={() => void handleCreateBackup()}
            >
              {creatingBackup ? "Snapshotting..." : "Create Verified Backup"}
            </button>
          </div>
          {backups.length > 0 ? (
            <div className="space-y-1.5">
              {backups.slice(0, 6).map((b) => (
                <div
                  key={b.filename}
                  className="flex items-center justify-between rounded-lg bg-surface-container-lowest px-3 py-2 text-xs border border-outline-variant"
                >
                  <span className="text-on-surface font-mono">{b.filename}</span>
                  <a
                    href={adminApi.backupDownloadUrl(b.filename)}
                    className="text-primary hover:underline"
                  >
                    Download ({Math.max(1, Math.round(b.sizeBytes / 1024))} KB)
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-on-surface-variant">
              No backup snapshots created yet.
            </p>
          )}
        </div>

        {/* Audit Log */}
        {auditEntries.length > 0 && (
          <div className="rounded-xl bg-surface-container p-4 border border-outline-variant space-y-2">
            <div className="text-sm font-medium text-on-surface">
              Recent Security Audit Events
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {auditEntries.slice(0, 12).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between text-xs text-on-surface-variant py-1 border-b border-outline-variant/50 last:border-0"
                >
                  <span>
                    <strong className="text-on-surface">{entry.action}</strong>
                    {entry.actor?.username ? ` by @${entry.actor.username}` : ""}
                  </span>
                  <span className="font-mono text-[11px]">
                    {entry.createdAt.slice(0, 19).replace("T", " ")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="divider-h" style={{ margin: "var(--space-6) 0" }} />
    </>
  );
}
