import { Router } from "express";
import { z } from "zod";
import db from "../db.ts";
import { ValidationError } from "../platform/net/errors.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import {
  forkSharedKit,
  getSharedKitBySlug,
  listSharedKits,
} from "../kits/kitService.ts";

const router = Router();

const ForkBodySchema = z.object({
  customSlug: z.string().min(1).max(80).optional(),
});

router.get("/", (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
  const kits = listSharedKits(db, { q, tag });
  res.json({ kits });
});

router.get("/:slug", (req, res) => {
  const sharedKit = getSharedKitBySlug(db, String(req.params.slug));
  res.json({ sharedKit });
});

router.post("/:slug/fork", (req, res) => {
  const scope = scopeOf(req);
  const parsed = ForkBodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    throw new ValidationError(
      parsed.error.issues[0]?.message ?? "Invalid fork payload",
    );
  }
  const kit = forkSharedKit(db, scope, String(req.params.slug), parsed.data);
  res.status(201).json({ kit });
});

export default router;
