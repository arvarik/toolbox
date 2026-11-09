import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import { AppError } from "../net/errors.ts";
import type { Principal } from "../auth/authMiddleware.ts";

declare const ownerIdBrand: unique symbol;

/** A `users.id`. Branded so a bare string cannot be passed as an owner. */
export type OwnerId = string & { readonly [ownerIdBrand]: true };

export interface Scope {
  readonly ownerId: OwnerId;
}

export function scopeForUser(user: { id: string }): Scope {
  return Object.freeze({ ownerId: user.id as OwnerId });
}

/** Background jobs, migrations, and admin offboarding only. */
export function scopeForOwnerId(id: string): Scope {
  return Object.freeze({ ownerId: id as OwnerId });
}

export function scopeOf(req: Request): Scope {
  const p = req.principal;
  if (p) return scopeForUser(p.user);
  throw new AppError("Authentication required", 401, { code: "UNAUTHORIZED" });
}

export interface RequestContext {
  requestId: string;
  principal: Principal | null;
  scope: Scope | null;
}

const als = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return als.run(ctx, fn);
}

export function getContext(): RequestContext | null {
  return als.getStore() ?? null;
}

export function attachRequestContext(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const p = req.principal ?? null;
  const scope = p?.kind === "user" ? scopeForUser(p.user) : null;
  runWithContext({ requestId: req.requestId ?? "-", principal: p, scope }, () =>
    next(),
  );
}
