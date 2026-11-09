/**
 * Stateless Streamable HTTP MCP route mount (`/api/mcp`).
 * - `POST /api/mcp`: Origin guard -> strict Bearer `tbk_` token gate -> password-current check
 *   -> per-user rate limit -> bounded input check -> fresh `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })`.
 * - `GET /api/mcp` & `DELETE /api/mcp`: `405 Method Not Allowed` with `Allow: POST`.
 */

import type { Express, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { requirePasswordCurrent } from "../platform/auth/authMiddleware.ts";
import {
  assertBoundedMcpInput,
  mcpRateLimit,
  requireMcpBearerToken,
} from "../platform/mcp/mcpPrimitives.ts";
import { asyncHandler } from "../platform/net/errors.ts";
import { mcpOriginGuard } from "../platform/net/hostGuard.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { buildToolboxMcpServer } from "./toolboxMcpTools.ts";

function respondStatelessMethodNotAllowed(res: Response): void {
  res.setHeader("Allow", "POST");
  res.status(405).json({
    error: {
      code: "METHOD_NOT_ALLOWED",
      message:
        "Toolbox MCP server runs in stateless Streamable HTTP mode; send JSON-RPC requests via POST /api/mcp.",
    },
  });
}

export function mountMcpRoutes(app: Express): void {
  app.get("/api/mcp", (_req, res) => {
    respondStatelessMethodNotAllowed(res);
  });

  app.delete("/api/mcp", (_req, res) => {
    respondStatelessMethodNotAllowed(res);
  });

  app.post(
    "/api/mcp",
    mcpOriginGuard,
    requireMcpBearerToken,
    requirePasswordCurrent,
    mcpRateLimit,
    asyncHandler(async (req, res) => {
      assertBoundedMcpInput(req.body);
      const scope = scopeOf(req);
      const server = buildToolboxMcpServer(scope, req);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    }),
  );
}
