// @vitest-environment node
// Route authorization inventory. It walks every route on the real Express app
// (sub-routers included) and sends real requests. A new route that is mounted
// without `authed` or `requireAdmin` makes this test fail.
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupTwoTenants, type TwoTenantsContext } from "./testHelpers.ts";

interface Layer {
  name: string;
  handle: { stack?: Layer[] };
  route?: { path: string; methods: Record<string, boolean>; stack: Layer[] };
  mountPath?: string;
}

// Express 5 layers do not keep their mount path, so record it on every use().
// This runs before the app module is imported below.
const routerProto = express.Router.prototype as unknown as {
  use(this: { stack: Layer[] }, ...args: unknown[]): unknown;
};
const originalUse = routerProto.use;
routerProto.use = function (this: { stack: Layer[] }, ...args: unknown[]) {
  const before = this.stack.length;
  const result = originalUse.apply(this, args);
  for (const layer of this.stack.slice(before)) {
    layer.mountPath = typeof args[0] === "string" ? args[0] : "/";
  }
  return result;
};

// Reachable without a session or token on purpose. Keep a reason on each entry.
// Static assets and the SPA fallback are outside /api and only mounted in production.
const PUBLIC_ROUTES = new Set([
  "GET /api/health", // liveness probe
  "GET /api/auth/status", // tells the SPA which sign-in screen to show
  "POST /api/auth/setup", // first-run owner account; refused once an account exists
  "POST /api/auth/register", // open registration; refused unless an admin enables it
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "POST /api/auth/accept-invitation", // needs the emailed invitation token
  "POST /api/auth/invitations/check",
  "POST /api/auth/password-reset/request",
  "POST /api/auth/password-reset/complete", // needs the emailed reset token
  "POST /api/auth/magic-link/request",
  "POST /api/auth/magic-link/complete", // needs the emailed magic-link token
  "POST /api/auth/email-change/complete", // needs the emailed confirmation token
  "POST /api/auth/passkeys/login/options", // passkey sign-in ceremony
  "POST /api/auth/passkeys/login/verify",
  "GET /api/auth/oidc/start", // SSO sign-in redirect
  "GET /api/auth/oidc/callback",
  "GET /api/mcp", // always 405: MCP is POST-only with a tbk_ token
  "DELETE /api/mcp",
]);

interface RouteInfo {
  key: string;
  method: string;
  path: string;
  chain: string[];
}

const join = (a: string, b: string) => (a + (b === "/" ? "" : b)).replace(/\/+/g, "/") || "/";
const covers = (mount: string, path: string) =>
  mount === "/" || path === mount || path.startsWith(`${mount}/`);

function collectRoutes(
  stack: Layer[],
  prefix: string,
  inherited: Array<{ path: string; name: string }>,
  out: RouteInfo[],
): RouteInfo[] {
  const middleware = [...inherited];
  for (const layer of stack) {
    if (layer.route) {
      const path = join(prefix, layer.route.path);
      const guards = middleware.filter((m) => covers(m.path, path)).map((m) => m.name);
      for (const m of Object.keys(layer.route.methods)) {
        const method = m.toUpperCase();
        out.push({
          key: `${method} ${path}`,
          method,
          path,
          chain: [...guards, ...layer.route.stack.map((l) => l.name)],
        });
      }
    } else if (layer.handle.stack) {
      collectRoutes(layer.handle.stack, join(prefix, layer.mountPath ?? "/"), middleware, out);
    } else {
      middleware.push({ path: join(prefix, layer.mountPath ?? "/"), name: layer.name });
    }
  }
  return out;
}

function send(
  agent: ReturnType<typeof request> | ReturnType<typeof request.agent>,
  route: RouteInfo,
) {
  const url = route.path.replace(/:\w+/g, "probe-id");
  const verb = route.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  const req = agent[verb](url).set("Accept", "application/json");
  return route.method === "GET" ? req : req.send({});
}

describe("Route authorization inventory (AUTH_REQUIRED=true)", () => {
  let app: Express;
  let routes: RouteInfo[];
  let tenants: TwoTenantsContext;
  const previousAuthRequired = process.env.AUTH_REQUIRED;

  beforeAll(async () => {
    process.env.AUTH_REQUIRED = "true";
    const { createApp, __resetAppRateLimits } = await import("../app.ts");
    __resetAppRateLimits();
    app = createApp();
    routes = collectRoutes(
      (app as unknown as { router: { stack: Layer[] } }).router.stack,
      "",
      [],
      [],
    );
    tenants = await setupTwoTenants(app, "inventory");
  });

  afterAll(() => {
    routerProto.use = originalUse;
    if (previousAuthRequired === undefined) delete process.env.AUTH_REQUIRED;
    else process.env.AUTH_REQUIRED = previousAuthRequired;
  });

  it("finds every route, and the public allowlist has no stale entries", () => {
    expect(routes.length).toBeGreaterThan(150);
    const keys = new Set(routes.map((r) => r.key));
    expect([...PUBLIC_ROUTES].filter((k) => !keys.has(k))).toEqual([]);
  });

  it("refuses an unauthenticated request with 401 or 403 on every non-public route", async () => {
    const open: string[] = [];
    for (const route of routes) {
      if (PUBLIC_ROUTES.has(route.key)) continue;
      const res = await send(request(app), route);
      if (res.status !== 401 && res.status !== 403) open.push(`${route.key} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });

  it("refuses a signed-in member with 403 on every admin-only route", async () => {
    const adminOnly = routes.filter((r) => r.chain.includes("requireAdmin"));
    // Every /api/admin route, and these instance-wide routes elsewhere, must sit behind requireAdmin.
    const adminOutsidePrefix = [
      "PUT /api/config",
      "POST /api/config/test-key",
      "POST /api/config/refresh-models",
      "POST /api/endpoints/test",
      "POST /api/endpoints",
      "PUT /api/endpoints/:id",
      "POST /api/endpoints/:id/refresh-models",
      "DELETE /api/endpoints/:id",
      "GET /api/system/export-db",
    ];
    expect(
      routes
        .filter((r) => r.path.startsWith("/api/admin/") || adminOutsidePrefix.includes(r.key))
        .filter((r) => !adminOnly.includes(r))
        .map((r) => r.key),
    ).toEqual([]);
    expect(adminOnly.length).toBeGreaterThan(30);

    const open: string[] = [];
    for (const route of adminOnly) {
      const res = await send(tenants.bobAgent, route);
      if (res.status !== 403) open.push(`${route.key} -> ${res.status}`);
    }
    expect(open).toEqual([]);
  });
});
