import { z } from "zod";

export const userRoleSchema = z.enum(["admin", "member"]);
export type UserRole = z.infer<typeof userRoleSchema>;

export type SessionMethod = "password" | "passkey" | "oidc" | "email-link";

export interface PublicUser {
  id: string;
  email: string;
  username: string;
  displayName: string | null;
  role: string;
  createdAt: string;
  lastLoginAt: string | null;
  status: string;
  credentialState: string;
  mustChangePassword: boolean;
  avatarUrl: string | null;
}

export interface AuthStatus {
  authRequired: boolean;
  authenticated: boolean;
  setupRequired: boolean;
  hasAccounts: boolean;
  user: PublicUser | null;
  deviceItems: number;
  registrationOpen: boolean;
  mailConfigured: boolean;
  magicLinkSignIn: boolean;
  localOwnerPresent: boolean;
  publicUrl: string | null;
  oidc: { name: string } | null;
  instanceName: string;
}

export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  readOnly: boolean;
  kind: string;
}

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface InvitationSummary {
  id: string;
  email: string | null;
  role: string;
  status: InvitationStatus;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  revokedAt: string | null;
  invitedBy: string | null;
  invitedByUsername: string | null;
}

export interface PasskeySummary {
  id: string;
  name: string;
  deviceType: string;
  backedUp: boolean;
  transports: string[] | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface AuditEntry {
  id: string;
  actor: { id: string; username: string } | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

export interface BackupVerification {
  ok: boolean;
  checkedAt: string;
  integrity: string;
  rows: Record<string, number>;
  liveRows: Record<string, number>;
  problem?: string;
}

export interface BackupInfo {
  filename: string;
  sizeBytes: number;
  createdAt: string;
  verification: BackupVerification | null;
}

export const registerSchema = z.object({
  email: z.string().trim().min(1).max(254),
  username: z.string().trim().min(1).max(32),
  password: z.string().min(8).max(1024),
  displayName: z.string().max(100).optional(),
});

export const acceptInvitationSchema = registerSchema.extend({
  token: z.string().min(1),
});

export const invitationCheckSchema = z.object({
  token: z.string().min(1),
});

export const createTokenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),
  readOnly: z.boolean().optional().default(false),
});

export const oidcStartQuerySchema = z.object({
  remember: z.string().optional(),
  returnTo: z.string().optional(),
});

export const adminCreateUserSchema = z.object({
  email: z.string().trim().min(1).max(254),
  username: z.string().trim().min(1).max(32),
  displayName: z.string().max(200).nullable().optional(),
  role: userRoleSchema.default("member"),
  temporaryPassword: z.string().min(1).max(1024).optional(),
});

export const adminUpdateUserSchema = z
  .object({
    role: userRoleSchema.optional(),
    displayName: z.string().max(200).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send a role or a display name to change",
  });

export const adminDeleteUserSchema = z
  .object({ decision: z.literal("purge").optional() })
  .nullish()
  .transform((body) => body ?? {});

export const adminInvitationSchema = z.object({
  email: z.string().trim().max(254).nullable().optional(),
  role: userRoleSchema.default("member"),
  expiresInDays: z.number().int().min(1).max(90).optional(),
  send: z.boolean().optional().default(false),
});

export const adminMailSchema = z.object({
  host: z.string().trim().min(1, "Host is required"),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean().default(false),
  user: z.string().trim().optional().default(""),
  password: z.string().optional(),
  from: z.string().trim().min(1, "From address is required"),
  replyTo: z.string().trim().optional().default(""),
});

export const adminSettingsSchema = z
  .object({
    registrationOpen: z.boolean().optional(),
    sessionTtlDays: z.number().int().optional(),
    instanceName: z.string().max(200).optional(),
    magicLinkSignIn: z.boolean().optional(),
    backupIntervalHours: z.number().int().min(0).max(168).optional(),
    backupKeep: z.number().int().min(1).max(50).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send a setting to change",
  });

/** An OIDC issuer address: https, or http on a loopback host. */
export function isAllowedIssuer(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}

export function normalizeIssuer(value: string): string {
  return value.trim().replace(/\/\.well-known\/openid-configuration\/?$/, "");
}

export const adminIntegrationsSchema = z
  .object({
    oidc: z
      .object({
        issuer: z
          .string()
          .trim()
          .url("Issuer must be a URL")
          .refine(isAllowedIssuer, {
            message: "Issuer must use https:// (http only for localhost)",
          }),
        clientId: z.string().trim().min(1, "Client ID is required"),
        clientSecret: z.string().trim().optional(),
        name: z.string().trim().min(1).max(40),
        matchByEmail: z.boolean(),
      })
      .nullable()
      .optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Send an integration to change",
  });

export const auditQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  before: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
});

/** Human-readable label for a User-Agent (passkey & session naming). */
export function describeDevice(userAgent: string | null | undefined): string {
  if (!userAgent) return "Passkey";
  const ua = userAgent.toLowerCase();
  const os = ua.includes("iphone")
    ? "iPhone"
    : ua.includes("ipad")
      ? "iPad"
      : ua.includes("mac os") || ua.includes("macintosh")
        ? "Mac"
        : ua.includes("android")
          ? "Android"
          : ua.includes("windows")
            ? "Windows"
            : ua.includes("linux")
              ? "Linux"
              : null;
  const browser = ua.includes("edg/")
    ? "Edge"
    : ua.includes("firefox/")
      ? "Firefox"
      : ua.includes("chrome/")
        ? "Chrome"
        : ua.includes("safari/")
          ? "Safari"
          : null;
  if (browser && os) return `${browser} on ${os}`;
  return os ?? browser ?? "Passkey";
}
