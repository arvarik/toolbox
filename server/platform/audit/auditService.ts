import crypto from "node:crypto";
import type { AuditEntry } from "../../../shared/platform/auth.ts";
import { TOKEN_PREFIX } from "../../appConfig.ts";
import { sqlite } from "../db/connection.ts";
import { getErrorMessage, log } from "../net/errors.ts";

export const AUDIT_ACTIONS = [
  "auth.login.success",
  "auth.login.failed",
  "auth.logout",
  "auth.password.changed",
  "auth.token.created",
  "auth.token.revoked",
  "auth.password.reset",
  "auth.magic_link.used",
  "auth.passkey.added",
  "auth.passkey.renamed",
  "auth.passkey.removed",
  "auth.oidc.linked",
  "auth.oidc.unlinked",
  "auth.email.changed",
  "user.created",
  "user.invited",
  "user.invitation.accepted",
  "user.invitation.revoked",
  "user.role.changed",
  "user.disabled",
  "user.enabled",
  "user.password.reset",
  "user.deleted",
  "settings.changed",
  "backup.created",
  "backup.downloaded",
  "mail.settings.changed",
  "mail.test.sent",
  "integrations.changed",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditTargetType =
  | "user"
  | "token"
  | "invitation"
  | "setting"
  | "backup"
  | "passkey"
  | "mail"
  | "integration";

interface RecordInput {
  actorUserId: string | null;
  action: AuditAction;
  targetType?: AuditTargetType;
  targetId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

const SECRET_KEY = /pass|token|secret|api_?key|credential|hash|link|cookie/i;
const escapedPrefix = TOKEN_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const TOKEN_VALUE = new RegExp(`\\b${escapedPrefix}[A-Za-z0-9_-]{8,}`);
const REDACTED = "[redacted]";

function redact(
  details: Record<string, unknown>,
  action: string,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let redactedAny = false;

  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY.test(key)) {
      out[key] = REDACTED;
      redactedAny = true;
      continue;
    }
    if (typeof value === "string" && TOKEN_VALUE.test(value)) {
      out[key] = REDACTED;
      redactedAny = true;
      continue;
    }
    out[key] = value;
  }

  if (redactedAny) {
    log.warn(
      "Audit",
      `Redacted credential-shaped field from details of "${action}".`,
    );
  }
  return out;
}

function parseCursor(
  before: string | undefined,
): { createdAt: string; id: string } | null {
  if (!before) return null;
  const split = before.lastIndexOf("|");
  if (split <= 0) return null;
  return {
    createdAt: before.slice(0, split),
    id: before.slice(split + 1),
  };
}

function parseDetails(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const auditService = {
  record(input: RecordInput): void {
    try {
      const details = input.details
        ? redact(input.details, input.action)
        : null;
      sqlite
        .prepare(
          `INSERT INTO audit_log (id, actorUserId, action, targetType, targetId, details, ip)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          crypto.randomUUID(),
          input.actorUserId,
          input.action,
          input.targetType ?? null,
          input.targetId ?? null,
          details ? JSON.stringify(details) : null,
          input.ip ?? null,
        );
    } catch (err) {
      log.warn(
        "Audit",
        `Failed to record "${input.action}": ${getErrorMessage(err)}`,
      );
    }
  },

  list(params: { limit: number; before?: string; actions?: string[] }): {
    entries: AuditEntry[];
    nextBefore: string | null;
  } {
    const limit = Math.min(200, Math.max(1, params.limit));
    const cursor = parseCursor(params.before);
    const actions = params.actions?.length ? params.actions : null;

    const where: string[] = [];
    const values: unknown[] = [];
    if (cursor) {
      where.push("(a.createdAt < ? OR (a.createdAt = ? AND a.id < ?))");
      values.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    if (actions) {
      where.push(`a.action IN (${actions.map(() => "?").join(", ")})`);
      values.push(...actions);
    }

    const rows = sqlite
      .prepare(
        `SELECT a.id, a.actorUserId, a.action, a.targetType, a.targetId,
                a.details, a.ip, a.createdAt, u.username AS actorUsername
           FROM audit_log a
           LEFT JOIN users u ON u.id = a.actorUserId
          ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ORDER BY a.createdAt DESC, a.id DESC
          LIMIT ?`,
      )
      .all(...values, limit + 1) as {
      id: string;
      actorUserId: string | null;
      action: string;
      targetType: string | null;
      targetId: string | null;
      details: string | null;
      ip: string | null;
      createdAt: string;
      actorUsername: string | null;
    }[];

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];

    return {
      entries: page.map((row) => ({
        id: row.id,
        actor:
          row.actorUserId && row.actorUsername
            ? { id: row.actorUserId, username: row.actorUsername }
            : null,
        action: row.action,
        targetType: row.targetType,
        targetId: row.targetId,
        details: parseDetails(row.details),
        ip: row.ip,
        createdAt: row.createdAt,
      })),
      nextBefore: hasMore && last ? `${last.createdAt}|${last.id}` : null,
    };
  },
};
