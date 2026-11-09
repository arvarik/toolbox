import "./utils/loadEnv.ts";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { DB_PATH, DEFAULT_PORT } from "./appConfig.ts";
import { createApp } from "./app.ts";
import { isAuthRequired } from "./platform/auth/authMiddleware.ts";
import { validateSecretKey } from "./platform/crypto/secretBox.ts";
import { sqlite } from "./platform/db/connection.ts";
import { validatePublicUrl } from "./platform/net/originAndFetch.ts";
import * as cpuHost from "./platform/workers/cpuHost.ts";
import logger from "./utils/logger.ts";

export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_MS = 66_000;
export const SHUTDOWN_TIMEOUT_MS = 10_000;

export function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

export function createHttpServer(app: Express): http.Server {
  const server = http.createServer(app);
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
  return server;
}

export interface ShutdownOptions {
  signal?: NodeJS.Signals | string;
  timeoutMs?: number;
  db?: {
    open?: boolean;
    pragma: (source: string) => unknown;
    close: () => unknown;
  };
  stopWorker?: () => Promise<void> | void;
  exit?: (code: number) => void;
}

const shuttingDownServers = new WeakSet<http.Server>();

export async function shutdownServer(
  server: http.Server,
  options: ShutdownOptions = {},
): Promise<void> {
  const signal = options.signal ?? "SIGTERM";
  const timeoutMs = options.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const targetDb = options.db ?? sqlite;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  if (shuttingDownServers.has(server)) {
    logger.warn(`Second ${signal} received — exiting immediately`);
    exit(1);
    return;
  }
  shuttingDownServers.add(server);
  logger.info(`${signal} received — draining connections`);

  const failsafe = setTimeout(() => {
    logger.warn("Shutdown deadline reached — forcing close");
    server.closeAllConnections?.();
    try {
      if (targetDb.open !== false) targetDb.close();
    } catch {
      // Best-effort DB close on deadline expiry
    }
    exit(1);
  }, timeoutMs);
  failsafe.unref();

  await new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    const sweepIdle = setInterval(() => {
      server.closeIdleConnections?.();
    }, 50);
    sweepIdle.unref();
    server.close(() => {
      clearInterval(sweepIdle);
      resolve();
    });
    server.closeIdleConnections?.();
  });

  const workerStopper =
    options.stopWorker ??
    (cpuHost as { stopCpuWorker?: () => Promise<void> | void }).stopCpuWorker;
  try {
    await workerStopper?.();
  } catch (err) {
    logger.warn("CPU worker shutdown error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    if (targetDb.open !== false) {
      targetDb.pragma("optimize");
      targetDb.pragma("wal_checkpoint(PASSIVE)");
      targetDb.close();
    }
    logger.info("Database closed cleanly");
  } catch (err) {
    logger.warn("Database close failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  clearTimeout(failsafe);
  exit(0);
}

export function registerShutdownHandlers(
  server: http.Server,
  options: Omit<ShutdownOptions, "signal"> = {},
): () => void {
  const onSigterm = () =>
    void shutdownServer(server, { ...options, signal: "SIGTERM" });
  const onSigint = () =>
    void shutdownServer(server, { ...options, signal: "SIGINT" });
  process.on("SIGTERM", onSigterm);
  process.on("SIGINT", onSigint);
  return () => {
    process.off("SIGTERM", onSigterm);
    process.off("SIGINT", onSigint);
  };
}

function isDirectEntrypoint(): boolean {
  if (!process.argv[1]) return false;
  const selfPath = fileURLToPath(import.meta.url);
  try {
    return (
      fs.realpathSync(path.resolve(process.argv[1])) ===
      fs.realpathSync(selfPath)
    );
  } catch {
    return path.resolve(process.argv[1]) === selfPath;
  }
}

if (isDirectEntrypoint()) {
  validateSecretKey();
  validatePublicUrl();

  const app = createApp();
  const PORT = Number(process.env.PORT || DEFAULT_PORT);
  const HOST = process.env.HOST || "127.0.0.1";
  const isProduction = process.env.NODE_ENV === "production";

  if (!isAuthRequired() && !isLoopbackHost(HOST)) {
    logger.warn(
      `Server binds ${HOST} with NO authentication — set AUTH_REQUIRED=true to require sign-in`,
    );
  }

  const server = createHttpServer(app);
  server.listen(PORT, HOST, () => {
    logger.info(
      `Toolbox v2 server running at http://${HOST}:${PORT} (${isProduction ? "production" : "development"}, db=${DB_PATH})`,
    );
  });
  registerShutdownHandlers(server);
}
