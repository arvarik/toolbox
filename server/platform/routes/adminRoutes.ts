import { Router, type Request } from "express";
import {
  adminCreateUserSchema,
  adminDeleteUserSchema,
  adminIntegrationsSchema,
  adminInvitationSchema,
  adminMailSchema,
  adminSettingsSchema,
  adminUpdateUserSchema,
  auditQuerySchema,
} from "../../../shared/platform/auth.ts";
import { AUDIT_ACTIONS, auditService } from "../audit/auditService.ts";
import {
  mailService,
  renderPasswordResetEmail,
  renderTestEmail,
} from "../mail/mailService.ts";
import {
  AppError,
  asyncHandler,
  getErrorMessage,
  validateBody,
} from "../net/errors.ts";
import {
  mailLinkOrigin,
  oidcCallbackUrl,
  publicOrigin,
} from "../net/originAndFetch.ts";
import { createRateLimiter } from "../net/rateLimit.ts";
import {
  SETTING_KEYS,
  getOidcIntegrationStatus,
  isOidcEnvSet,
} from "../settings/settingsService.ts";
import {
  type AdminContext,
  createAdminUser,
  deleteUser,
  disableUser,
  enableUser,
  getBackupIntervalHours,
  getBackupKeep,
  getUser,
  isBackupIntervalEnvSet,
  isBackupKeepEnvSet,
  listBackups,
  listUsers,
  resetPassword,
  runBackup,
  setBackupIntervalHours,
  setBackupKeep,
  snapshotFile,
  updateAdminUser,
} from "../auth/adminAndBackup.ts";
import { requireAdmin, requirePasswordCurrent } from "../auth/authMiddleware.ts";
import {
  ADMIN_RESET_LINK_TTL_SECONDS,
  DEFAULT_SESSION_TTL_DAYS,
  INSTANCE_NAME_MAX,
  MAX_SESSION_TTL_DAYS,
  MIN_SESSION_TTL_DAYS,
  assertInstanceSecured,
  createAuthLink,
  createInvitation,
  discardAuthLink,
  getInstanceName,
  getSessionTtlDays,
  isMagicLinkSignIn,
  isRegistrationOpen,
  listInvitations,
  revokeInvitation,
  setInstanceName,
  setMagicLinkSignIn,
  setRegistrationOpen,
  setSessionTtlDays,
} from "../auth/authService.ts";
import { saveOidcProvider } from "../auth/passkeyAndOidc.ts";

const router = Router();

function adminContext(req: Request): AdminContext {
  return { actor: req.principal!.user, ip: req.ip ?? null };
}

router.get(
  "/users",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ users: listUsers(adminContext(req)) });
  }),
);

router.post(
  "/users",
  requireAdmin,
  validateBody(adminCreateUserSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(await createAdminUser(adminContext(req), req.body));
  }),
);

router.get(
  "/users/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(getUser(adminContext(req), String(req.params.id)));
  }),
);

router.patch(
  "/users/:id",
  requireAdmin,
  validateBody(adminUpdateUserSchema),
  asyncHandler(async (req, res) => {
    res.json({
      user: updateAdminUser(adminContext(req), String(req.params.id), req.body),
    });
  }),
);

router.post(
  "/users/:id/reset-password",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(await resetPassword(adminContext(req), String(req.params.id)));
  }),
);

router.post(
  "/users/:id/reset-link",
  requireAdmin,
  asyncHandler(async (req, res) => {
    if (!mailService.isConfigured()) {
      throw new AppError("Outgoing mail is not configured", 409, {
        code: "MAIL_NOT_CONFIGURED",
      });
    }
    const origin = mailLinkOrigin();
    if (!origin) {
      throw new AppError(
        "Set PUBLIC_URL on the server to send links by mail",
        409,
        { code: "PUBLIC_URL_REQUIRED" },
      );
    }
    const ctx = adminContext(req);
    const { user: target } = getUser(ctx, String(req.params.id));
    if (!target.email) {
      throw new AppError("User does not have an email address", 400);
    }
    const link = createAuthLink(
      "reset",
      target.id,
      ADMIN_RESET_LINK_TTL_SECONDS,
      ctx.actor.id,
      ctx.ip,
    );
    if (!link) throw new AppError("Failed to create reset link", 500);
    const template = renderPasswordResetEmail({
      instanceName: getInstanceName(),
      link: `${origin}/reset-password?token=${link.token}`,
      expiresHours: 24,
    });
    try {
      await mailService.sendOrThrow({ to: target.email, ...template });
    } catch (err) {
      discardAuthLink(link.id);
      throw new AppError(
        `Could not send reset link: ${getErrorMessage(err)}`,
        502,
        { code: "MAIL_SEND_FAILED" },
      );
    }
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "user.password.reset",
      targetType: "user",
      targetId: target.id,
      details: { username: target.username, via: "email" },
      ip: ctx.ip,
    });
    res.json({ sentTo: target.email, expiresAt: link.expiresAt });
  }),
);

router.post(
  "/users/:id/disable",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ user: disableUser(adminContext(req), String(req.params.id)) });
  }),
);

router.post(
  "/users/:id/enable",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json({ user: enableUser(adminContext(req), String(req.params.id)) });
  }),
);

router.delete(
  "/users/:id",
  requireAdmin,
  validateBody(adminDeleteUserSchema),
  asyncHandler(async (req, res) => {
    res.json(
      deleteUser(
        adminContext(req),
        String(req.params.id),
        req.body.decision as string | undefined,
      ),
    );
  }),
);

// Invitations

router.get(
  "/invitations",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ invitations: listInvitations() });
  }),
);

router.post(
  "/invitations",
  requireAdmin,
  validateBody(adminInvitationSchema),
  asyncHandler(async (req, res) => {
    res
      .status(201)
      .json(
        await createInvitation(adminContext(req), req.body, publicOrigin(req)),
      );
  }),
);

router.delete(
  "/invitations/:id",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(revokeInvitation(adminContext(req), String(req.params.id)));
  }),
);

// Instance settings

function settingsView() {
  const interval = getBackupIntervalHours();
  const keep = getBackupKeep();
  return {
    registrationOpen: isRegistrationOpen(),
    sessionTtlDays: getSessionTtlDays(),
    sessionTtlRange: {
      min: MIN_SESSION_TTL_DAYS,
      max: MAX_SESSION_TTL_DAYS,
      default: DEFAULT_SESSION_TTL_DAYS,
    },
    instanceName: getInstanceName(),
    instanceNameMax: INSTANCE_NAME_MAX,
    mailConfigured: mailService.isConfigured(),
    mailLinksReady: mailService.canSendLinks(),
    magicLinkSignIn: isMagicLinkSignIn(),
    backupIntervalHours: interval.value,
    backupIntervalHoursSource: interval.source,
    backupKeep: keep.value,
    backupKeepSource: keep.source,
  };
}

router.get(
  "/settings",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(settingsView());
  }),
);

router.put(
  "/settings",
  requireAdmin,
  validateBody(adminSettingsSchema),
  asyncHandler(async (req, res) => {
    if (req.body.registrationOpen) {
      assertInstanceSecured(req.principal!.user);
    }
    if (req.body.magicLinkSignIn && !mailService.isConfigured()) {
      throw new AppError(
        "Outgoing mail must be configured before enabling magic links",
        409,
        { code: "MAIL_NOT_CONFIGURED" },
      );
    }
    if (req.body.backupIntervalHours !== undefined && isBackupIntervalEnvSet()) {
      throw new AppError(
        "Backup interval is set by environment variable BACKUP_INTERVAL_HOURS",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }
    if (req.body.backupKeep !== undefined && isBackupKeepEnvSet()) {
      throw new AppError(
        "Backup keep count is set by environment variable BACKUP_KEEP",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }

    const changed: string[] = [];
    if (req.body.registrationOpen !== undefined) {
      setRegistrationOpen(req.body.registrationOpen);
      changed.push("auth.registrationOpen");
    }
    if (req.body.sessionTtlDays !== undefined) {
      setSessionTtlDays(req.body.sessionTtlDays);
      changed.push("auth.sessionTtlDays");
    }
    if (req.body.instanceName !== undefined) {
      setInstanceName(req.body.instanceName);
      changed.push("instance.name");
    }
    if (req.body.magicLinkSignIn !== undefined) {
      setMagicLinkSignIn(req.body.magicLinkSignIn);
      changed.push("auth.magicLinkSignIn");
    }
    if (req.body.backupIntervalHours !== undefined) {
      setBackupIntervalHours(req.body.backupIntervalHours);
      changed.push(SETTING_KEYS.backupIntervalHours);
    }
    if (req.body.backupKeep !== undefined) {
      setBackupKeep(req.body.backupKeep);
      changed.push(SETTING_KEYS.backupKeep);
    }

    const ctx = adminContext(req);
    for (const key of changed) {
      auditService.record({
        actorUserId: ctx.actor.id,
        action: "settings.changed",
        targetType: "setting",
        targetId: key,
        ip: ctx.ip,
      });
    }
    res.json(settingsView());
  }),
);

// Integrations (OIDC SSO)

function integrationsFor(req: Request) {
  return {
    oidc: {
      ...getOidcIntegrationStatus(),
      redirectUri: oidcCallbackUrl(req),
    },
  };
}

router.get(
  "/integrations",
  requireAdmin,
  asyncHandler(async (req, res) => {
    res.json(integrationsFor(req));
  }),
);

router.put(
  "/integrations",
  requireAdmin,
  requirePasswordCurrent,
  validateBody(adminIntegrationsSchema),
  asyncHandler(async (req, res) => {
    if (req.body.oidc !== undefined && isOidcEnvSet()) {
      throw new AppError(
        "The OIDC provider is set by environment variables OIDC_ISSUER, OIDC_CLIENT_ID and OIDC_CLIENT_SECRET",
        409,
        { code: "SET_BY_ENVIRONMENT" },
      );
    }
    if (req.body.oidc !== undefined) {
      await saveOidcProvider(req.body.oidc);
      const ctx = adminContext(req);
      auditService.record({
        actorUserId: ctx.actor.id,
        action: "integrations.changed",
        targetType: "integration",
        targetId: "oidc",
        details: { key: "oidc" },
        ip: ctx.ip,
      });
    }
    res.json(integrationsFor(req));
  }),
);

// Outgoing mail

const mailTestLimiter = createRateLimiter({
  windowMs: 10 * 60_000,
  max: 5,
  name: "mail test",
  keyBy: (req) => req.principal?.user.id ?? null,
});

export function __resetAdminRateLimits(): void {
  mailTestLimiter.reset();
}

function mailView(config: ReturnType<typeof mailService.resolveConfig>) {
  return { ...config, publicUrl: mailLinkOrigin() };
}

router.get(
  "/mail",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json(mailView(mailService.resolveConfig()));
  }),
);

router.put(
  "/mail",
  requireAdmin,
  requirePasswordCurrent,
  validateBody(adminMailSchema),
  asyncHandler(async (req, res) => {
    const config = mailService.updateMailSettings(req.body);
    const ctx = adminContext(req);
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "mail.settings.changed",
      targetType: "mail",
      targetId: "smtp",
      ip: ctx.ip,
    });
    res.json(mailView(config));
  }),
);

router.delete(
  "/mail",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const config = mailService.deleteMailSettings();
    const ctx = adminContext(req);
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "mail.settings.changed",
      targetType: "mail",
      targetId: "smtp",
      details: { deleted: true },
      ip: ctx.ip,
    });
    res.json(mailView(config));
  }),
);

router.post(
  "/mail/test",
  requireAdmin,
  mailTestLimiter,
  asyncHandler(async (req, res) => {
    const ctx = adminContext(req);
    const recipient =
      (req.body as { to?: string } | undefined)?.to?.trim() || ctx.actor.email;
    if (!recipient) {
      throw new AppError("No email address configured for test recipient", 400);
    }
    const template = renderTestEmail({ instanceName: getInstanceName() });
    try {
      await mailService.sendOrThrow({ to: recipient, ...template });
    } catch (err) {
      throw new AppError(getErrorMessage(err), 502, {
        code: "MAIL_SEND_FAILED",
      });
    }
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "mail.test.sent",
      targetType: "mail",
      targetId: "test",
      details: { to: recipient },
      ip: ctx.ip,
    });
    res.json({ sentTo: recipient });
  }),
);

// Backups

router.get(
  "/backups",
  requireAdmin,
  asyncHandler(async (_req, res) => {
    res.json({ backups: listBackups() });
  }),
);

router.post(
  "/backups",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ctx = adminContext(req);
    const backup = await runBackup();
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "backup.created",
      targetType: "backup",
      targetId: backup.filename,
      ip: ctx.ip,
    });
    res.status(201).json({ backup });
  }),
);

router.get(
  "/backups/:filename",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const ctx = adminContext(req);
    const filename = String(req.params.filename);
    const file = snapshotFile(filename);
    if (!file) {
      throw new AppError("That snapshot does not exist", 404, {
        code: "BACKUP_NOT_FOUND",
      });
    }
    auditService.record({
      actorUserId: ctx.actor.id,
      action: "backup.downloaded",
      targetType: "backup",
      targetId: filename,
      ip: ctx.ip,
    });
    res.download(file, filename);
  }),
);

// Audit log

router.get(
  "/audit",
  requireAdmin,
  asyncHandler(async (req, res) => {
    const parsed = auditQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new AppError("Invalid audit query", 400, {
        code: "VALIDATION_ERROR",
        details: parsed.error.issues,
      });
    }
    let actions: string[] | undefined;
    if (parsed.data.action) {
      actions = parsed.data.action
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean);
      const unknown = actions.filter(
        (v) => !(AUDIT_ACTIONS as readonly string[]).includes(v),
      );
      if (unknown.length > 0) {
        throw new AppError(
          `Unknown audit action(s): ${unknown.join(", ")}`,
          400,
          { code: "VALIDATION_ERROR" },
        );
      }
    }
    res.json(auditService.list({ ...parsed.data, actions }));
  }),
);

export const adminRouter = router;
