/**
 * Typed client helpers for `/api/auth/*` and `/api/admin/*`.
 * Reuses canonical types from `shared/platform/auth.ts` and stays separate from
 * `src/utils/api.js` so auth mutations never enter the offline sync queue.
 */
import type {
  ApiToken,
  AuditEntry,
  AuthStatus,
  BackupInfo,
  InvitationSummary,
  PasskeySummary,
  PublicUser,
} from "../../shared/platform/auth.ts";

export type {
  ApiToken as ApiTokenItem,
  AuditEntry as AuditLogEntry,
  AuthStatus as AuthStatusResponse,
  BackupInfo as BackupItem,
  InvitationSummary as InvitationItem,
  PasskeySummary as PasskeyItem,
  PublicUser as AuthUser,
};

export interface SessionItem {
  id: string;
  current: boolean;
  method: string;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface AdminUserItem extends PublicUser {
  ownedCount?: number;
}

export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function authFetch<T>(
  path: string,
  options: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers:
      options.body !== undefined
        ? { "Content-Type": "application/json" }
        : undefined,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as {
      message?: string;
      error?: { code?: string; message?: string };
    };
    const msg =
      payload?.error?.message ||
      payload?.message ||
      `Request failed (${res.status})`;
    const code = payload?.error?.code;
    if (
      res.status === 401 &&
      !path.startsWith("/auth/login") &&
      !path.startsWith("/auth/status") &&
      typeof window !== "undefined"
    ) {
      window.dispatchEvent(
        new CustomEvent("toolbox:unauthorized", { detail: { code } }),
      );
    }
    throw new AuthApiError(msg, res.status, code);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const authApi = {
  status: () => authFetch<AuthStatus>("/auth/status"),
  setup: (data: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  }) =>
    authFetch<{ user: PublicUser }>("/auth/setup", {
      method: "POST",
      body: data,
    }),
  login: (data: { identifier: string; password: string; remember?: boolean }) =>
    authFetch<{ user: PublicUser }>("/auth/login", {
      method: "POST",
      body: data,
    }),
  register: (data: {
    email: string;
    username: string;
    password: string;
    displayName?: string;
  }) =>
    authFetch<{ user: PublicUser }>("/auth/register", {
      method: "POST",
      body: data,
    }),
  logout: () => authFetch<{ success: boolean }>("/auth/logout", { method: "POST" }),
  checkInvitation: (token: string) =>
    authFetch<{ ok: boolean }>("/auth/invitations/check", {
      method: "POST",
      body: { token },
    }),
  acceptInvitation: (data: {
    token: string;
    email: string;
    username: string;
    password: string;
    displayName?: string;
  }) =>
    authFetch<{ user: PublicUser }>("/auth/accept-invitation", {
      method: "POST",
      body: data,
    }),
  updateProfile: (data: {
    displayName?: string;
    username?: string;
    email?: string;
    currentPassword?: string;
  }) =>
    authFetch<{ user: PublicUser; pendingEmail: string | null }>("/auth/me", {
      method: "PATCH",
      body: data,
    }),
  changePassword: (data: { currentPassword: string; newPassword: string }) =>
    authFetch<{ success: boolean }>("/auth/change-password", {
      method: "POST",
      body: data,
    }),

  listSessions: () => authFetch<{ sessions: SessionItem[] }>("/auth/sessions"),
  revokeOtherSessions: () =>
    authFetch<{ revoked: number }>("/auth/sessions", { method: "DELETE" }),

  listTokens: () => authFetch<{ tokens: ApiToken[] }>("/auth/tokens"),
  createToken: (data: {
    name: string;
    readOnly?: boolean;
    expiresInDays?: number | null;
  }) =>
    authFetch<{
      id: string;
      name: string;
      token: string;
      tokenPrefix: string;
      expiresAt: string | null;
      readOnly: boolean;
    }>("/auth/tokens", {
      method: "POST",
      body: data,
    }),
  revokeToken: (id: string) =>
    authFetch<{ revoked: boolean }>(`/auth/tokens/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  listPasskeys: () =>
    authFetch<{ passkeys: PasskeySummary[]; nudgeDismissed: boolean }>(
      "/auth/passkeys",
    ),
  passkeyRegisterOptions: () =>
    authFetch<{ ceremonyId: string; options: unknown }>(
      "/auth/passkeys/register/options",
      { method: "POST" },
    ),
  passkeyRegisterVerify: (data: {
    ceremonyId: string;
    response: unknown;
    name?: string;
  }) =>
    authFetch<{ passkey: PasskeySummary }>("/auth/passkeys/register/verify", {
      method: "POST",
      body: data,
    }),
  passkeyLoginOptions: () =>
    authFetch<{ ceremonyId: string; options: unknown }>(
      "/auth/passkeys/login/options",
      { method: "POST" },
    ),
  passkeyLoginVerify: (data: {
    ceremonyId: string;
    response: unknown;
    remember?: boolean;
  }) =>
    authFetch<{ user: PublicUser }>("/auth/passkeys/login/verify", {
      method: "POST",
      body: data,
    }),
  deletePasskey: (id: string) =>
    authFetch<{ removed: boolean }>(
      `/auth/passkeys/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
};

export const adminApi = {
  listUsers: () => authFetch<{ users: AdminUserItem[] }>("/admin/users"),
  createUser: (data: {
    email: string;
    username: string;
    displayName?: string;
    role?: "admin" | "member";
    temporaryPassword?: string;
  }) =>
    authFetch<{ user: AdminUserItem; temporaryPassword?: string }>(
      "/admin/users",
      { method: "POST", body: data },
    ),
  updateUser: (
    id: string,
    data: { role?: "admin" | "member"; displayName?: string },
  ) =>
    authFetch<{ user: AdminUserItem }>(
      `/admin/users/${encodeURIComponent(id)}`,
      { method: "PATCH", body: data },
    ),
  disableUser: (id: string) =>
    authFetch<{ user: AdminUserItem }>(
      `/admin/users/${encodeURIComponent(id)}/disable`,
      { method: "POST" },
    ),
  enableUser: (id: string) =>
    authFetch<{ user: AdminUserItem }>(
      `/admin/users/${encodeURIComponent(id)}/enable`,
      { method: "POST" },
    ),
  resetPassword: (id: string) =>
    authFetch<{ temporaryPassword: string }>(
      `/admin/users/${encodeURIComponent(id)}/reset-password`,
      { method: "POST" },
    ),
  deleteUser: (id: string, purge = false) =>
    authFetch<{ deleted: boolean }>(`/admin/users/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: purge ? { decision: "purge" } : {},
    }),

  listInvitations: () =>
    authFetch<{ invitations: InvitationSummary[] }>("/admin/invitations"),
  createInvitation: (data: {
    email?: string;
    role?: "admin" | "member";
    expiresInDays?: number;
  }) =>
    authFetch<{ id: string; link: string; expiresAt: string; sent: boolean }>(
      "/admin/invitations",
      { method: "POST", body: data },
    ),
  revokeInvitation: (id: string) =>
    authFetch<{ revoked: boolean }>(
      `/admin/invitations/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),

  getSettings: () =>
    authFetch<{
      registrationOpen: boolean;
      sessionTtlDays: number;
      instanceName: string;
      backupIntervalHours: number;
      backupKeep: number;
    }>("/admin/settings"),
  updateSettings: (data: {
    registrationOpen?: boolean;
    sessionTtlDays?: number;
    instanceName?: string;
    backupIntervalHours?: number;
    backupKeep?: number;
  }) => authFetch("/admin/settings", { method: "PUT", body: data }),

  listBackups: () => authFetch<{ backups: BackupInfo[] }>("/admin/backups"),
  createBackup: () =>
    authFetch<{ backup: BackupInfo }>("/admin/backups", { method: "POST" }),
  backupDownloadUrl: (filename: string) =>
    `/api/admin/backups/${encodeURIComponent(filename)}`,

  listAudit: (limit = 50) =>
    authFetch<{ entries: AuditEntry[]; nextCursor: string | null }>(
      `/admin/audit?limit=${limit}`,
    ),
};
