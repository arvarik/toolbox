import {
  Router,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  acceptInvitationSchema,
  createTokenSchema,
  invitationCheckSchema,
  oidcStartQuerySchema,
  registerSchema,
  type SessionMethod,
} from "../../../shared/platform/auth.ts";
import { auditService } from "../audit/auditService.ts";
import { getOwnerDataHooks } from "../db/connection.ts";
import {
  mailService,
  renderEmailChangeEmail,
  renderMagicLinkEmail,
  renderPasswordResetEmail,
  type SendMailOptions,
} from "../mail/mailService.ts";
import {
  AppError,
  ValidationError,
  asyncHandler,
  log,
  parseQuery,
  validateBody,
} from "../net/errors.ts";
import { mailLinkOrigin, oidcCallbackUrl } from "../net/originAndFetch.ts";
import { createRateLimiter, type RateLimiter } from "../net/rateLimit.ts";
import { getOidcConfig } from "../settings/settingsService.ts";
import {
  clearOidcFlowCookie,
  clearSessionCookie,
  currentSessionId,
  currentUser,
  isAuthenticated,
  isAuthRequired,
  presentedOidcBinding,
  presentedSessionSecret,
  requirePasswordCurrent,
  requireSession,
  setForcedAuth,
  setOidcFlowCookie,
  setSessionCookie,
} from "../auth/authMiddleware.ts";
import {
  EMAIL_CHANGE_LINK_TTL_SECONDS,
  MAGIC_LINK_TTL_SECONDS,
  RESET_LINK_TTL_SECONDS,
  acceptInvitation,
  accountIdForIdentifier,
  assertCurrentPassword,
  cancelEmailChange,
  changePassword,
  checkInvitation,
  checkNewEmail,
  completeEmailChange,
  convertLocalOwner,
  countPasswordAccounts,
  createAuthLink,
  createSession,
  createToken,
  createUser,
  destroySession,
  discardAuthLink,
  findUserByEmail,
  getInstanceName,
  getUserById,
  hasLocalOwner,
  isMagicLinkSignIn,
  isRegistrationOpen,
  listSessions,
  listTokens,
  normalizeEmail,
  pendingEmail,
  publicUser,
  redeemAuthLink,
  resetUserPasswordWithToken,
  revokeOtherSessions,
  revokeToken,
  updateUser,
  verifyCredentials,
  type User,
} from "../auth/authService.ts";
import {
  FLOW_COOKIE_SECONDS,
  accountIdentities,
  createLoginOptions,
  createRegistrationOptions,
  dismissPasskeyNudge,
  finishOidcCallback,
  isPasskeyNudgeDismissed,
  listPasskeys,
  removePasskey,
  renamePasskey,
  startOidc,
  unlinkIdentity,
  verifyLogin,
  verifyRegistration,
} from "../auth/passkeyAndOidc.ts";
import { validatePassword } from "../auth/passwords.ts";

const router = Router();

const credentialLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 10,
  name: "sign-in",
});

const setupLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 5,
  name: "account setup",
});

const tokenLimiter = createRateLimiter({
  windowMs: 3_600_000,
  max: 10,
  name: "token creation",
  keyBy: (req) => req.principal?.user.id ?? null,
});

const linkLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: 3,
  name: "auth links",
});

const oidcLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  name: "single sign-on",
});

const oidcCallbackLimiter = createRateLimiter({
  windowMs: 60_000,
  max: 20,
  name: "single sign-on callback",
});

export function __resetAuthRateLimits(): void {
  oidcLimiter.reset();
  oidcCallbackLimiter.reset();
  credentialLimiter.reset();
  setupLimiter.reset();
  tokenLimiter.reset();
  linkLimiter.reset();
}

function bodyString(req: Request, field: string): string {
  const value = (req.body as Record<string, unknown> | undefined)?.[field];
  return typeof value === "string" ? value : "";
}

function ipOf(req: Request): string | null {
  return req.ip ?? null;
}

function accountDisabled(): AppError {
  return new AppError(
    "This account has been disabled. Ask an administrator to re-enable it.",
    403,
    { code: "ACCOUNT_DISABLED" },
  );
}

function startSession(
  req: Request,
  res: Response,
  user: User,
  method: SessionMethod,
  remember = true,
): void {
  const session = createSession(user.id, req.headers["user-agent"] ?? null, {
    method,
    remember,
  });
  setSessionCookie(req, res, session.secret, session.expiresAt, {
    sessionOnly: !remember,
  });
}

router.get("/status", (req, res) => {
  const authRequired = isAuthRequired();
  const user = currentUser(req);
  const passwordAccounts = countPasswordAccounts();
  const setupRequired = authRequired && passwordAccounts === 0;
  const deviceItems =
    passwordAccounts === 0 ? getOwnerDataHooks().countDeviceItems() : 0;
  const oidcConfig = authRequired ? getOidcConfig() : null;

  res.json({
    authRequired,
    authenticated: isAuthenticated(req),
    setupRequired,
    hasAccounts: passwordAccounts > 0,
    user: user ? publicUser(user) : null,
    deviceItems,
    registrationOpen: isRegistrationOpen(),
    mailConfigured: mailService.canSendLinks(),
    magicLinkSignIn: isMagicLinkSignIn() && mailService.canSendLinks(),
    localOwnerPresent: hasLocalOwner(),
    publicUrl: mailLinkOrigin(),
    oidc: oidcConfig ? { name: oidcConfig.name } : null,
    instanceName: getInstanceName(),
  });
});

router.post(
  "/setup",
  setupLimiter,
  asyncHandler(async (req, res) => {
    if (countPasswordAccounts() > 0) {
      throw new AppError(
        "This instance already has an account. Sign in instead.",
        409,
        { code: "SETUP_COMPLETE" },
      );
    }
    const input = {
      email: bodyString(req, "email"),
      username: bodyString(req, "username"),
      password: bodyString(req, "password"),
      displayName: bodyString(req, "displayName"),
    };
    const user = hasLocalOwner()
      ? await convertLocalOwner(input)
      : await createUser({ ...input, setupOnly: true, emailTrusted: true });
    if (!isAuthRequired()) {
      setForcedAuth(true);
    }
    startSession(req, res, user, "password");
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  "/register",
  credentialLimiter,
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    if (!isRegistrationOpen()) {
      throw new AppError(
        "This instance is not open for registration. Ask an administrator for an invitation.",
        403,
        { code: "REGISTRATION_CLOSED" },
      );
    }
    const user = await createUser({ ...req.body, role: "member" });
    startSession(req, res, user, "password");
    auditService.record({
      actorUserId: user.id,
      action: "user.created",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, role: user.role, self: true },
      ip: ipOf(req),
    });
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  "/login",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    if (!isAuthRequired()) {
      res.json({ authRequired: false, user: null });
      return;
    }
    const identifier =
      bodyString(req, "identifier") ||
      bodyString(req, "username") ||
      bodyString(req, "email");
    const password = bodyString(req, "password");

    const user = await verifyCredentials(identifier, password);
    if (!user) {
      const matched = accountIdForIdentifier(identifier);
      auditService.record({
        actorUserId: null,
        action: "auth.login.failed",
        targetType: matched ? "user" : undefined,
        targetId: matched,
        details: { matched: matched !== null },
        ip: ipOf(req),
      });
      throw new AppError("Incorrect username or password.", 401, {
        code: "INVALID_CREDENTIALS",
      });
    }

    if (user.status === "disabled") {
      auditService.record({
        actorUserId: user.id,
        action: "auth.login.failed",
        targetType: "user",
        targetId: user.id,
        details: { matched: true, reason: "disabled" },
        ip: ipOf(req),
      });
      throw accountDisabled();
    }

    startSession(req, res, user, "password", req.body?.remember !== false);
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username },
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.post("/logout", (req, res) => {
  const secret = presentedSessionSecret(req);
  const actor = currentUser(req);
  if (secret) destroySession(secret);
  clearSessionCookie(req, res);
  if (actor) {
    auditService.record({
      actorUserId: actor.id,
      action: "auth.logout",
      targetType: "user",
      targetId: actor.id,
      ip: ipOf(req),
    });
  }
  res.json({ success: true });
});

router.post(
  "/accept-invitation",
  credentialLimiter,
  validateBody(acceptInvitationSchema),
  asyncHandler(async (req, res) => {
    const user = await acceptInvitation(req.body, ipOf(req));
    startSession(req, res, user, "password");
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  "/invitations/check",
  credentialLimiter,
  validateBody(invitationCheckSchema),
  asyncHandler(async (req, res) => {
    checkInvitation((req.body as { token: string }).token);
    res.json({ ok: true });
  }),
);

function linkMail(
  kind: "reset" | "magic",
  email: string,
  origin: string,
  ip: string | null,
): { userId: string; mail: SendMailOptions } | null {
  const user = findUserByEmail(email);
  if (!user || user.status === "disabled") return null;
  const reset = kind === "reset";
  const link = createAuthLink(
    kind,
    user.id,
    reset ? RESET_LINK_TTL_SECONDS : MAGIC_LINK_TTL_SECONDS,
    null,
    ip,
  );
  if (!link) return null;
  const template = reset
    ? renderPasswordResetEmail({
        instanceName: getInstanceName(),
        link: `${origin}/reset-password?token=${link.token}`,
        expiresHours: 1,
      })
    : renderMagicLinkEmail({
        instanceName: getInstanceName(),
        link: `${origin}/signin-link?token=${link.token}`,
      });
  return { userId: user.id, mail: { to: user.email, ...template } };
}

function answerThenSend(
  res: Response,
  outgoing: ReturnType<typeof linkMail>,
): void {
  res.status(202).json({});
  if (!outgoing) return;
  void mailService.send(outgoing.mail).then((sent) => {
    if (!sent) {
      log.warn("Auth", `Failed to send link email for ${outgoing.userId}`);
    }
  });
}

router.post(
  "/password-reset/request",
  linkLimiter,
  asyncHandler(async (req, res) => {
    const email = bodyString(req, "email").trim().toLowerCase();
    const origin = mailLinkOrigin();
    answerThenSend(
      res,
      email && origin && mailService.isConfigured()
        ? linkMail("reset", email, origin, ipOf(req))
        : null,
    );
  }),
);

router.post(
  "/password-reset/complete",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const token = bodyString(req, "token").trim();
    const password = bodyString(req, "password");
    if (!token) throw new AppError("Reset token is required", 400);
    const passwordError = validatePassword(password);
    if (passwordError) throw new ValidationError(passwordError);

    const link = redeemAuthLink("reset", token);
    const user = await resetUserPasswordWithToken(link.userId, password, ipOf(req));
    startSession(req, res, user, "email-link");
    auditService.record({
      actorUserId: user.id,
      action: "auth.password.reset",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username },
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  "/magic-link/request",
  linkLimiter,
  asyncHandler(async (req, res) => {
    const origin = mailLinkOrigin();
    if (!isMagicLinkSignIn() || !origin || !mailService.isConfigured()) {
      throw new AppError("Magic link sign-in is disabled", 404, {
        code: "MAGIC_LINK_OFF",
      });
    }
    const email = bodyString(req, "email").trim().toLowerCase();
    answerThenSend(res, email ? linkMail("magic", email, origin, ipOf(req)) : null);
  }),
);

router.post(
  "/magic-link/complete",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const token = bodyString(req, "token").trim();
    if (!token) throw new AppError("Sign-in token is required", 400);
    const link = redeemAuthLink("magic", token);
    const user = getUserById(link.userId);
    if (!user || user.status === "disabled") throw accountDisabled();

    startSession(req, res, user, "email-link", req.body?.remember !== false);
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, method: "magic-link" },
      ip: ipOf(req),
    });
    auditService.record({
      actorUserId: user.id,
      action: "auth.magic_link.used",
      targetType: "user",
      targetId: user.id,
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.get("/me", requireSession, (req, res) => {
  const user = currentUser(req)!;
  res.json({
    user: publicUser(user),
    via: req.principal?.via ?? "session",
    pendingEmail: pendingEmail(user.id),
  });
});

function changesEmail(req: Request): boolean {
  const email = (req.body as Record<string, unknown> | undefined)?.email;
  return email !== undefined && normalizeEmail(email) !== currentUser(req)?.email;
}

router.patch(
  "/me",
  requireSession,
  requirePasswordCurrent,
  (req, res, next) =>
    changesEmail(req) ? credentialLimiter(req, res, next) : next(),
  asyncHandler(async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const actor = currentUser(req)!;
    const emailChange = changesEmail(req);
    if (emailChange) await assertCurrentPassword(actor.id, body.currentPassword);
    const origin = mailLinkOrigin();
    const byLink = emailChange && origin !== null && mailService.isConfigured();
    const email = byLink ? checkNewEmail(actor.id, body.email) : null;

    const user = await updateUser(actor.id, {
      ...(body.email !== undefined && !byLink ? { email: body.email } : {}),
      ...(body.username !== undefined ? { username: body.username } : {}),
      ...(body.displayName !== undefined
        ? { displayName: body.displayName }
        : {}),
    });

    if (email && origin) {
      cancelEmailChange(actor.id);
      const link = createAuthLink(
        "email",
        actor.id,
        EMAIL_CHANGE_LINK_TTL_SECONDS,
        null,
        ipOf(req),
        email,
      );
      if (!link) {
        throw new AppError(
          "Too many emails sent to this account in the last hour.",
          429,
          { code: "LINK_LIMIT" },
        );
      }
      const sent = await mailService.send({
        to: email,
        ...renderEmailChangeEmail({
          instanceName: getInstanceName(),
          link: `${origin}/confirm-email?token=${link.token}`,
          email,
        }),
      });
      if (!sent) {
        discardAuthLink(link.id);
        throw new AppError("Could not send confirmation email.", 502, {
          code: "MAIL_FAILED",
        });
      }
    }
    res.json({ user: publicUser(user), pendingEmail: pendingEmail(actor.id) });
  }),
);

router.delete("/email-change", requireSession, (req, res) => {
  cancelEmailChange(currentUser(req)!.id);
  res.json({ ok: true });
});

router.post("/email-change/complete", credentialLimiter, (req, res) => {
  const token = bodyString(req, "token").trim();
  if (!token) throw new AppError("Link token is required", 400);
  const { user } = completeEmailChange(token);
  auditService.record({
    actorUserId: user.id,
    action: "auth.email.changed",
    targetType: "user",
    targetId: user.id,
    details: { username: user.username },
    ip: ipOf(req),
  });
  res.json({ email: user.email });
});

router.post(
  "/change-password",
  requireSession,
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const actor = currentUser(req)!;
    await changePassword(
      actor.id,
      bodyString(req, "currentPassword"),
      bodyString(req, "newPassword"),
      currentSessionId(req),
    );
    auditService.record({
      actorUserId: actor.id,
      action: "auth.password.changed",
      targetType: "user",
      targetId: actor.id,
      ip: ipOf(req),
    });
    res.json({ success: true });
  }),
);

router.get("/sessions", requireSession, (req, res) => {
  res.json({
    sessions: listSessions(currentUser(req)!.id, currentSessionId(req)),
  });
});

router.delete("/sessions", requireSession, (req, res) => {
  const revoked = revokeOtherSessions(
    currentUser(req)!.id,
    currentSessionId(req),
  );
  res.json({ revoked });
});

// Personal API tokens (`tbk_...`)

router.get("/tokens", requireSession, (req, res) => {
  res.json({ tokens: listTokens(currentUser(req)!.id) });
});

router.post(
  "/tokens",
  requireSession,
  requirePasswordCurrent,
  tokenLimiter,
  validateBody(createTokenSchema),
  asyncHandler(async (req, res) => {
    res.status(201).json(createToken(currentUser(req)!, req.body, ipOf(req)));
  }),
);

router.delete(
  "/tokens/:id",
  requireSession,
  asyncHandler(async (req, res) => {
    res.json(revokeToken(currentUser(req)!, String(req.params.id), ipOf(req)));
  }),
);

// Passkeys

router.post(
  "/passkeys/register/options",
  credentialLimiter,
  requireSession,
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    res.json(await createRegistrationOptions(req, req.principal!.user));
  }),
);

router.post(
  "/passkeys/register/verify",
  credentialLimiter,
  requireSession,
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    const { ceremonyId, response, name } = req.body ?? {};
    res.status(201).json(
      await verifyRegistration(req, req.principal!.user, ceremonyId, response, name),
    );
  }),
);

router.get(
  "/passkeys",
  requireSession,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    res.json({
      passkeys: listPasskeys(user.id),
      nudgeDismissed: isPasskeyNudgeDismissed(user.id),
    });
  }),
);

router.patch(
  "/passkeys/:id",
  requireSession,
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    res.json(
      renamePasskey(
        req,
        req.principal!.user.id,
        String(req.params.id),
        bodyString(req, "name"),
      ),
    );
  }),
);

router.delete(
  "/passkeys/:id",
  requireSession,
  requirePasswordCurrent,
  asyncHandler(async (req, res) => {
    res.json(removePasskey(req, req.principal!.user.id, String(req.params.id)));
  }),
);

router.post(
  "/passkeys/login/options",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    res.json(await createLoginOptions(req));
  }),
);

router.post(
  "/passkeys/login/verify",
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const { ceremonyId, response } = req.body ?? {};
    const { user } = await verifyLogin(req, ceremonyId, response);
    if (user.status === "disabled") {
      auditService.record({
        actorUserId: user.id,
        action: "auth.login.failed",
        targetType: "user",
        targetId: user.id,
        details: { identifier: user.username, reason: "disabled" },
        ip: ipOf(req),
      });
      throw accountDisabled();
    }
    startSession(req, res, user, "passkey", req.body?.remember !== false);
    auditService.record({
      actorUserId: user.id,
      action: "auth.login.success",
      targetType: "user",
      targetId: user.id,
      details: { username: user.username, method: "passkey" },
      ip: ipOf(req),
    });
    res.json({ user: publicUser(user) });
  }),
);

router.post(
  "/passkey-nudge/dismiss",
  requireSession,
  asyncHandler(async (req, res) => {
    dismissPasskeyNudge(req.principal!.user.id);
    res.json({ ok: true });
  }),
);

// Single Sign-On (OIDC)

function assertOidcAvailable(): void {
  if (!isAuthRequired() || !getOidcConfig()) {
    throw new AppError("Single sign-on is off", 404, { code: "OIDC_OFF" });
  }
}

async function startBoundOidc(
  req: Request,
  res: Response,
  flow: { linkUserId: string | null; remember?: boolean; returnTo?: string },
): Promise<string> {
  const started = await startOidc({
    redirectUri: oidcCallbackUrl(req),
    ...flow,
  });
  setOidcFlowCookie(req, res, started, FLOW_COOKIE_SECONDS);
  return started.url;
}

const limitPage =
  (limiter: RateLimiter, what: string) =>
  (req: Request, res: Response, next: NextFunction) =>
    limiter(req, res, (err?: unknown) => {
      if (!err) return next();
      log.warn("Auth", `OIDC ${what} refused by rate limit`);
      res.redirect("/?oidc=failed");
    });

router.get(
  "/oidc/start",
  limitPage(oidcLimiter, "sign-in start"),
  asyncHandler(async (req, res) => {
    try {
      assertOidcAvailable();
      const query = parseQuery(oidcStartQuerySchema, req.query);
      res.redirect(
        await startBoundOidc(req, res, {
          linkUserId: null,
          remember: query.remember !== "0",
          returnTo: query.returnTo,
        }),
      );
    } catch (error) {
      log.warn("Auth", "OIDC sign-in could not start", { error });
      res.redirect("/?oidc=failed");
    }
  }),
);

router.post(
  "/oidc/link",
  oidcLimiter,
  requireSession,
  requirePasswordCurrent,
  credentialLimiter,
  asyncHandler(async (req, res) => {
    assertOidcAvailable();
    await assertCurrentPassword(
      req.principal!.user.id,
      bodyString(req, "currentPassword"),
    );
    res.json({
      url: await startBoundOidc(req, res, {
        linkUserId: req.principal!.user.id,
      }),
    });
  }),
);

router.get(
  "/oidc/callback",
  limitPage(oidcCallbackLimiter, "callback"),
  asyncHandler(async (req, res) => {
    const query = req.originalUrl.indexOf("?");
    const callbackUrl = new URL(
      oidcCallbackUrl(req) + (query === -1 ? "" : req.originalUrl.slice(query)),
    );
    const state = callbackUrl.searchParams.get("state") ?? "";
    if (state) clearOidcFlowCookie(req, res, state);
    if (!isAuthRequired()) {
      res.redirect("/");
      return;
    }
    const result = await finishOidcCallback(
      callbackUrl,
      state ? presentedOidcBinding(req, state) : null,
      req.principal?.via === "session" ? req.principal.user.id : null,
      { ip: ipOf(req), userAgent: req.headers["user-agent"] ?? null },
    );
    if (result.session) {
      const { secret, expiresAt, remember } = result.session;
      setSessionCookie(req, res, secret, expiresAt, { sessionOnly: !remember });
    }
    res.redirect(result.landing);
  }),
);

router.get("/identities", requireSession, (req, res) => {
  res.json(accountIdentities(req.principal!.user.id));
});

router.delete(
  "/identities/:id",
  requireSession,
  requirePasswordCurrent,
  credentialLimiter,
  asyncHandler(async (req, res) => {
    const user = req.principal!.user;
    await assertCurrentPassword(user.id, bodyString(req, "currentPassword"));
    unlinkIdentity(user.id, String(req.params.id));
    auditService.record({
      actorUserId: user.id,
      action: "auth.oidc.unlinked",
      targetType: "user",
      targetId: user.id,
      ip: ipOf(req),
    });
    res.json({ ok: true });
  }),
);

export const authRouter = router;
