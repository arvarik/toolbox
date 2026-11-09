import type { Request } from "express";
import type Database from "better-sqlite3";
import type { Scope } from "../platform/tenancy/scope.ts";
import { NotFoundError } from "../platform/net/errors.ts";
import type { KitSkeletonV1 } from "../../shared/kits/kitSkeleton.ts";
import { SYSTEM_DESIGN_KIT_SKELETON } from "../../shared/kits/systemDesignKit.ts";
import {
  ensureDefaultSystemDesignKit,
  type ActiveKitContext,
} from "./kitsSchema.ts";

export type { ActiveKitContext };

function parseSkeleton(raw: string): KitSkeletonV1 {
  try {
    return JSON.parse(raw) as KitSkeletonV1;
  } catch {
    return SYSTEM_DESIGN_KIT_SKELETON;
  }
}

export function resolveKitById(
  db: Database.Database,
  scope: Scope,
  kitIdOrSlug: string,
): ActiveKitContext | null {
  const row = db
    .prepare(
      "SELECT id, slug, skeleton_json FROM kits WHERE ownerId = ? AND (id = ? OR slug = ?)",
    )
    .get(scope.ownerId, kitIdOrSlug, kitIdOrSlug) as
    | { id: string; slug: string; skeleton_json: string }
    | undefined;
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    skeleton: parseSkeleton(row.skeleton_json),
  };
}

/**
 * Resolves the caller's active Kit from `X-Toolbox-Kit` header, `?kitId=` / `?kit=` query,
 * or `req.body.kitId`. Falls back to `ensureDefaultSystemDesignKit(db, scope)` when no
 * selector is supplied so legacy `/guide`, `/study`, `/builder` routes continue working.
 */
export function resolveActiveKit(
  req: Request,
  db: Database.Database,
  scope: Scope,
): ActiveKitContext {
  const headerVal = req.headers["x-toolbox-kit"];
  const fromHeader = Array.isArray(headerVal) ? headerVal[0] : headerVal;
  const fromQuery =
    typeof req.query?.kitId === "string"
      ? req.query.kitId
      : typeof req.query?.kit === "string"
        ? req.query.kit
        : undefined;
  const bodyObj =
    req.body && typeof req.body === "object"
      ? (req.body as Record<string, unknown>)
      : undefined;
  const fromBody =
    typeof bodyObj?.kitId === "string" ? bodyObj.kitId : undefined;

  const selector = (fromHeader || fromQuery || fromBody || "").trim();
  if (!selector) {
    return ensureDefaultSystemDesignKit(db, scope);
  }

  const found = resolveKitById(db, scope, selector);
  if (!found) {
    // Allow explicit "system-design" selector to lazily provision the default starter Kit.
    if (selector === "system-design") {
      return ensureDefaultSystemDesignKit(db, scope);
    }
    throw new NotFoundError(`Kit not found: ${selector}`);
  }
  return found;
}
