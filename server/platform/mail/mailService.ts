import nodemailer, { type Transporter } from "nodemailer";
import { APP_NAME } from "../../appConfig.ts";
import { seal, open, SecretUnavailableError } from "../crypto/secretBox.ts";
import { AppError, getErrorMessage, log } from "../net/errors.ts";
import { mailLinkOrigin } from "../net/originAndFetch.ts";
import {
  getSetting,
  setSetting,
  deleteSetting,
} from "../settings/settingsService.ts";

export type MailSource = "env" | "settings" | "none";

export interface MailConfig {
  source: MailSource;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  replyTo: string;
  hasPassword: boolean;
}

interface InternalMailConfig extends MailConfig {
  password?: string;
}

interface StoredSmtpSettings {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  passwordSealed?: string;
  from: string;
  replyTo?: string;
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

const SETTING_KEY = "mail.smtp";

let cachedTransport: Transporter | null = null;
let cachedTransportKey: string | null = null;

function parseSmtpUrl(urlStr: string) {
  const url = new URL(urlStr);
  const secure = url.protocol === "smtps:";
  const port = url.port ? parseInt(url.port, 10) : secure ? 465 : 587;
  const host = url.hostname;
  const user = url.username ? decodeURIComponent(url.username) : "";
  const password = url.password ? decodeURIComponent(url.password) : undefined;
  return { host, port, secure, user, password };
}

function resolveInternalConfig(): InternalMailConfig {
  if (process.env.SMTP_URL) {
    try {
      const parsed = parseSmtpUrl(process.env.SMTP_URL);
      const from =
        process.env.MAIL_FROM || (parsed.user.includes("@") ? parsed.user : "");
      return {
        source: "env",
        host: parsed.host,
        port: parsed.port,
        secure: parsed.secure,
        user: parsed.user,
        password: parsed.password,
        from,
        replyTo: process.env.MAIL_REPLY_TO || "",
        hasPassword: Boolean(parsed.password),
      };
    } catch (err) {
      log.warn("Mail", `Failed to parse SMTP_URL: ${getErrorMessage(err)}`);
    }
  }

  const stored = getSetting<StoredSmtpSettings>(SETTING_KEY);
  if (stored && stored.host) {
    let password: string | undefined;
    if (stored.passwordSealed) {
      try {
        password = open(stored.passwordSealed);
      } catch (err) {
        if (err instanceof SecretUnavailableError) {
          log.warn("Mail", "Stored SMTP password cannot be decrypted");
        }
      }
    }
    return {
      source: "settings",
      host: stored.host,
      port: stored.port || (stored.secure ? 465 : 587),
      secure: Boolean(stored.secure),
      user: stored.user || "",
      password,
      from: stored.from || "",
      replyTo: stored.replyTo || "",
      hasPassword: Boolean(stored.passwordSealed),
    };
  }

  return {
    source: "none",
    host: "",
    port: 587,
    secure: false,
    user: "",
    from: "",
    replyTo: "",
    hasPassword: false,
  };
}

function resolveConfig(): MailConfig {
  const { password: _pw, ...publicConfig } = resolveInternalConfig();
  return publicConfig;
}

function isConfigured(): boolean {
  const config = resolveConfig();
  return (
    config.source !== "none" && Boolean(config.host) && Boolean(config.from)
  );
}

function canSendLinks(): boolean {
  return isConfigured() && mailLinkOrigin() !== null;
}

function getTransport(config: InternalMailConfig): Transporter {
  const key = `${config.host}:${config.port}:${config.secure}:${config.user}:${config.password ?? ""}`;
  if (cachedTransport && cachedTransportKey === key) return cachedTransport;
  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user
      ? { auth: { user: config.user, pass: config.password ?? "" } }
      : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 10_000,
  });
  cachedTransportKey = key;
  return cachedTransport;
}

async function sendOrThrow(opts: SendMailOptions): Promise<void> {
  const config = resolveInternalConfig();
  if (config.source === "none" || !config.host || !config.from) {
    throw new AppError("Outgoing mail is not configured", 409, {
      code: "MAIL_NOT_CONFIGURED",
    });
  }
  const transport = getTransport(config);
  await transport.sendMail({
    from: config.from,
    ...(config.replyTo ? { replyTo: config.replyTo } : {}),
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    ...(opts.html ? { html: opts.html } : {}),
  });
}

async function send(opts: SendMailOptions): Promise<boolean> {
  try {
    await sendOrThrow(opts);
    return true;
  } catch (err) {
    log.warn("Mail", `Send failed: ${getErrorMessage(err)}`);
    return false;
  }
}

function updateMailSettings(input: {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  password?: string;
  from: string;
  replyTo?: string;
}): MailConfig {
  if (resolveConfig().source === "env") {
    throw new AppError(
      "Mail is configured by the environment (SMTP_URL).",
      409,
      { code: "MAIL_CONFIGURED_BY_ENV" },
    );
  }
  const stored = getSetting<StoredSmtpSettings>(SETTING_KEY);
  let passwordSealed = stored?.passwordSealed;
  if (input.password !== undefined && input.password !== "") {
    passwordSealed = seal(input.password);
  }
  setSetting(SETTING_KEY, {
    host: input.host.trim(),
    port: input.port,
    secure: input.secure,
    user: input.user?.trim() ?? "",
    passwordSealed,
    from: input.from.trim(),
    replyTo: input.replyTo?.trim() ?? "",
  } satisfies StoredSmtpSettings);
  cachedTransport = null;
  cachedTransportKey = null;
  return resolveConfig();
}

function deleteMailSettings(): MailConfig {
  if (resolveConfig().source === "env") {
    throw new AppError(
      "Mail is configured by the environment (SMTP_URL).",
      409,
      { code: "MAIL_CONFIGURED_BY_ENV" },
    );
  }
  deleteSetting(SETTING_KEY);
  cachedTransport = null;
  cachedTransportKey = null;
  return resolveConfig();
}

export const mailService = {
  resolveConfig,
  isConfigured,
  canSendLinks,
  send,
  sendOrThrow,
  updateMailSettings,
  deleteMailSettings,
};

function brandTitle(instanceName: string): string {
  return instanceName ? `${instanceName} (${APP_NAME})` : APP_NAME;
}

export function renderInvitationEmail(params: {
  instanceName: string;
  link: string;
  role: string;
  expiresAt: string;
}) {
  const title = brandTitle(params.instanceName);
  return {
    subject: `Invitation to join ${title}`,
    text: `You have been invited to join ${title} as a ${params.role}.\n\nOpen this one-time link to create your account:\n${params.link}\n\nThis link expires at ${params.expiresAt}.`,
  };
}

export function renderPasswordResetEmail(params: {
  instanceName: string;
  link: string;
  expiresHours: number;
}) {
  const title = brandTitle(params.instanceName);
  return {
    subject: `Reset your password on ${title}`,
    text: `Use this one-time link to choose a new password on ${title}:\n${params.link}\n\nThis link expires in ${params.expiresHours} hour(s). If you did not ask for this, ignore this message.`,
  };
}

export function renderMagicLinkEmail(params: {
  instanceName: string;
  link: string;
}) {
  const title = brandTitle(params.instanceName);
  return {
    subject: `Sign in to ${title}`,
    text: `Open this one-time link to sign in to ${title} (valid for 15 minutes):\n${params.link}`,
  };
}

export function renderEmailChangeEmail(params: {
  instanceName: string;
  link: string;
  email: string;
}) {
  const title = brandTitle(params.instanceName);
  return {
    subject: `Confirm your email address on ${title}`,
    text: `Confirm changing your ${title} email address to ${params.email}:\n${params.link}`,
  };
}

export function renderTestEmail(params: { instanceName: string }) {
  const title = brandTitle(params.instanceName);
  return {
    subject: `Test message from ${title}`,
    text: `Outgoing mail is working on ${title}.`,
  };
}
