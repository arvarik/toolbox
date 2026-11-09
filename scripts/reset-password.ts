import "../server/utils/loadEnv.ts";
import { sqlite } from "../server/db.ts";
import { auditService } from "../server/platform/audit/auditService.ts";
import { generateTemporaryPassword } from "../server/platform/auth/adminAndBackup.ts";
import { revokeOtherSessions } from "../server/platform/auth/authService.ts";
import { hashPassword } from "../server/platform/auth/passwords.ts";

export interface ResetPasswordCliResult {
  userId: string;
  username: string;
  email: string;
  temporaryPassword: string;
}

function knownUsernames(): string[] {
  return (
    sqlite
      .prepare(
        "SELECT username FROM users WHERE credentialState != 'none' ORDER BY createdAt ASC",
      )
      .all() as { username: string }[]
  ).map((r) => r.username);
}

/**
 * Reset an account's password from the CLI for locked-out self-hosted operators.
 *
 * Looks up the account by username or email, generates a cryptographically
 * random temporary password, hashes it via `scrypt`, sets `mustChangePassword = 1`,
 * clears disabled lockout state, revokes all active sessions, API tokens, auth
 * links, challenges, and linked OIDC identities, and records an audit entry.
 */
export async function resetUserPasswordForCli(
  identifier: string,
): Promise<ResetPasswordCliResult> {
  const query = identifier.trim().toLowerCase();
  if (!query) {
    throw new Error("Username or email is required");
  }

  const user = sqlite
    .prepare(
      `SELECT id, username, email, credentialState FROM users
       WHERE lower(username) = ? OR lower(email) = ? LIMIT 1`,
    )
    .get(query, query) as
    | { id: string; username: string; email: string; credentialState: string }
    | undefined;

  if (!user) {
    const known = knownUsernames();
    const suffix =
      known.length > 0 ? `. Existing accounts: ${known.join(", ")}` : "";
    throw new Error(`Account "${identifier}" not found${suffix}`);
  }

  if (user.credentialState === "none") {
    throw new Error(
      "This account has no password to reset. It is the local account that owns this device's data.",
    );
  }

  const temporaryPassword = generateTemporaryPassword();
  const hash = await hashPassword(temporaryPassword);

  sqlite.transaction(() => {
    sqlite
      .prepare(
        `UPDATE users
            SET passwordHash = ?, mustChangePassword = 1,
                status = 'active', disabledAt = NULL,
                passwordChangedAt = CURRENT_TIMESTAMP, updatedAt = CURRENT_TIMESTAMP
          WHERE id = ?`,
      )
      .run(hash, user.id);
    revokeOtherSessions(user.id, null);
    sqlite
      .prepare(
        `UPDATE api_tokens SET revokedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND revokedAt IS NULL`,
      )
      .run(user.id);
    sqlite
      .prepare(
        `UPDATE auth_links SET usedAt = CURRENT_TIMESTAMP
          WHERE userId = ? AND usedAt IS NULL`,
      )
      .run(user.id);
    sqlite
      .prepare("DELETE FROM auth_challenges WHERE userId = ?")
      .run(user.id);
    const removed = sqlite
      .prepare("DELETE FROM user_identities WHERE userId = ?")
      .run(user.id).changes;
    if (removed > 0) {
      auditService.record({
        actorUserId: null,
        action: "auth.oidc.unlinked",
        targetType: "user",
        targetId: user.id,
        details: { reason: "password-reset", via: "cli", count: removed },
        ip: null,
      });
    }
  })();

  auditService.record({
    actorUserId: null,
    action: "user.password.reset",
    targetType: "user",
    targetId: user.id,
    details: { username: user.username, via: "cli" },
    ip: null,
  });

  return {
    userId: user.id,
    username: user.username,
    email: user.email,
    temporaryPassword,
  };
}

async function main(): Promise<void> {
  const identifier = process.argv[2];
  if (!identifier || identifier === "--help" || identifier === "-h") {
    const known = knownUsernames();
    console.error("Usage: npm run reset-password -- <username-or-email>");
    if (known.length > 0) {
      console.error(`Accounts on this instance: ${known.join(", ")}`);
    }
    process.exit(identifier ? 0 : 1);
  }

  try {
    const result = await resetUserPasswordForCli(identifier);
    console.log(`Password reset for ${result.username} (${result.email}):`);
    console.log(`Temporary password: ${result.temporaryPassword}`);
    console.log(
      "The user will be required to change this password upon sign-in.",
    );
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  (process.argv[1].endsWith("reset-password.ts") ||
    process.argv[1].endsWith("reset-password.js"));

if (isDirectRun) {
  void main();
}
