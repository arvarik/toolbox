import { Router, type Response } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.ts";
import { adminRefusal, requireAdmin } from "../platform/auth/authMiddleware.ts";
import { sealCredential } from "../platform/crypto/secretBox.ts";
import { validateEndpointBaseUrl } from "../platform/ai/aiSettingsService.ts";
import { fetchEndpointModels } from "../providers/defs.ts";
import {
  getCustomEndpoint,
  listCustomEndpoints,
  loadCatalog,
  type CustomEndpointRow,
} from "../providers/catalog.ts";
import {
  refreshEndpointCatalog,
  handleEndpointRemoved,
} from "../providers/index.ts";
import { maskSecret, isMaskedValue } from "../utils/mask.ts";

const router = Router();

function toClientEndpoint(row: CustomEndpointRow, isAdmin: boolean) {
  const catalog = loadCatalog(`custom:${row.id}`);
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKeyMasked: isAdmin ? maskSecret(row.api_key) : row.api_key ? "••••" : "",
    hasApiKey: Boolean(row.api_key),
    models: catalog?.models || [],
    modelsFetchedAt: catalog?.fetchedAt || null,
    createdAt: row.created_at,
  };
}

function requireEndpoint(
  id: string,
  res: Response,
): CustomEndpointRow | undefined {
  const existing = getCustomEndpoint(id);
  if (!existing) res.status(404).json({ message: "Endpoint not found" });
  return existing ?? undefined;
}

async function probeModelsOrFail(
  key: string,
  url: string,
  res: Response,
): Promise<boolean> {
  try {
    await fetchEndpointModels(key, url, { allowPrivate: true });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ message: msg || "Could not reach the endpoint" });
    return false;
  }
}

router.get("/", (req, res) => {
  const isAdmin = adminRefusal(req) === null;
  res.json(listCustomEndpoints().map((ep) => toClientEndpoint(ep, isAdmin)));
});

router.post("/test", requireAdmin, async (req, res) => {
  const { baseUrl, apiKey, endpointId } = req.body as {
    baseUrl?: string;
    apiKey?: string;
    endpointId?: string;
  };
  let normalized: string;
  try {
    normalized = await validateEndpointBaseUrl(baseUrl, { allowPrivate: true });
  } catch (err) {
    const msg =
      err instanceof Error ? err.message : "A valid http(s) Base URL is required";
    res.status(400).json({ ok: false, message: msg });
    return;
  }

  let effectiveKey =
    typeof apiKey === "string" && !isMaskedValue(apiKey) ? apiKey : "";
  if (!effectiveKey && endpointId) {
    effectiveKey = getCustomEndpoint(endpointId)?.api_key || "";
  }

  try {
    const models = await fetchEndpointModels(effectiveKey, normalized, {
      allowPrivate: true,
    });
    res.json({ ok: true, modelCount: models.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res
      .status(400)
      .json({ ok: false, message: msg || "Could not reach the endpoint" });
  }
});

router.post("/", requireAdmin, async (req, res, next) => {
  const { name, baseUrl, apiKey } = req.body as {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  if (typeof name !== "string" || !name.trim()) {
    res.status(400).json({ message: "A name is required" });
    return;
  }
  let normalized: string;
  try {
    normalized = await validateEndpointBaseUrl(baseUrl, { allowPrivate: true });
  } catch (err) {
    next(err);
    return;
  }
  const key =
    typeof apiKey === "string" && !isMaskedValue(apiKey) ? apiKey.trim() : "";

  if (!(await probeModelsOrFail(key, normalized, res))) return;

  const endpoint = {
    id: randomUUID(),
    name: name.trim(),
    base_url: normalized,
    api_key: key,
  };
  db.prepare(
    "INSERT INTO custom_endpoints (id, name, base_url, api_key) VALUES (?, ?, ?, ?)",
  ).run(
    endpoint.id,
    endpoint.name,
    endpoint.base_url,
    sealCredential(endpoint.api_key),
  );

  await refreshEndpointCatalog(endpoint).catch(() => {});
  res
    .status(201)
    .json(toClientEndpoint(getCustomEndpoint(endpoint.id)!, true));
});

router.put("/:id", requireAdmin, async (req, res, next) => {
  const id = String(req.params.id);
  const existing = requireEndpoint(id, res);
  if (!existing) return;

  const { name, baseUrl, apiKey } = req.body as {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
  };
  const nextName =
    typeof name === "string" && name.trim() ? name.trim() : existing.name;
  let nextUrl: string;
  try {
    nextUrl = await validateEndpointBaseUrl(
      baseUrl !== undefined ? baseUrl : existing.base_url,
      { allowPrivate: true },
    );
  } catch (err) {
    next(err);
    return;
  }
  const nextKey =
    typeof apiKey === "string" && !isMaskedValue(apiKey)
      ? apiKey.trim()
      : existing.api_key || "";

  if (!(await probeModelsOrFail(nextKey, nextUrl, res))) return;

  db.prepare(
    `UPDATE custom_endpoints
     SET name = ?, base_url = ?, api_key = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(nextName, nextUrl, sealCredential(nextKey), id);

  handleEndpointRemoved(id);
  const updated = getCustomEndpoint(id)!;
  await refreshEndpointCatalog(updated).catch(() => {});
  res.json(toClientEndpoint(updated, true));
});

router.post("/:id/refresh-models", requireAdmin, async (req, res, next) => {
  const endpoint = requireEndpoint(String(req.params.id), res);
  if (!endpoint) return;
  try {
    await validateEndpointBaseUrl(endpoint.base_url, { allowPrivate: true });
  } catch (err) {
    next(err);
    return;
  }
  try {
    await refreshEndpointCatalog(endpoint);
    res.json(toClientEndpoint(getCustomEndpoint(endpoint.id)!, true));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ message: msg || "Could not reach the endpoint" });
  }
});

router.delete("/:id", requireAdmin, (req, res) => {
  const id = String(req.params.id);
  if (!requireEndpoint(id, res)) return;
  db.prepare("DELETE FROM custom_endpoints WHERE id = ?").run(id);
  handleEndpointRemoved(id);
  res.json({ success: true });
});

export default router;
