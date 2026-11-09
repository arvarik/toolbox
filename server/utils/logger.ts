import { log } from "../platform/net/errors.ts";

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    log.info("server", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    log.warn("server", msg, meta),
  error: (msg: string, meta?: unknown) =>
    log.error(
      "server",
      msg,
      meta && typeof meta === "object" && !Array.isArray(meta)
        ? (meta as Record<string, unknown>)
        : meta !== undefined
          ? { detail: String(meta) }
          : undefined,
    ),
};

export default logger;
