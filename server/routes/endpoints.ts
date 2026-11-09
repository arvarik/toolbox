import { Router } from "express";
import { randomUUID } from "node:crypto";
import db from "../db.ts";
import { sealCredential } from "../kits/kitsSchema.ts";
import { validateEndpointBaseUrl } from "../platform/ai/aiSettingsService.ts";
import { ForbiddenError } from "../platform/net/errors.ts";
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

router.get("/", (req, res) => {
  const isAdmin = req.principal?.user.role === "admin";
  res.json(listCustomEndpoints().map((ep) => toClientEndpoint(ep, isAdmin)));
});

router.post("/test", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can manage instance endpoints"));
    return;
  }
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
    const existing = getCustomEndpoint(endpointId);
    if (existing) effectiveKey = existing.api_key || "";
  }

  try {
    const models = await fetchEndpointModels(effectiveKey, normalized);
    res.json({ ok: true, modelCount: models.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res
      .status(400)
      .json({ ok: false, message: msg || "Could not reach the endpoint" });
  }
});

router.post("/", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can manage instance endpoints"));
    return;
  }
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

  const endpoint = {
    id: randomUUID(),
    name: name.trim(),
    base_url: normalized,
    api_key: key,
  };

  try {
    await fetchEndpointModels(key, normalized);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ message: msg || "Could not reach the endpoint" });
    return;
  }

  db.prepare(
    `INSERT INTO custom_endpoints (id, name, base_url, api_key)
     VALUES (?, ?, ?, ?)`,
  ).run(
    endpoint.id,
    endpoint.name,
    endpoint.base_url,
    sealCredential(endpoint.api_key),
  );

  try {
    await refreshEndpointCatalog(endpoint);
  } catch {
    // Discovery hiccup after pre-flight — endpoint remains saved
  }

  res
    .status(201)
    .json(toClientEndpoint(getCustomEndpoint(endpoint.id)!, true));
});

router.put("/:id", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can manage instance endpoints"));
    return;
  }
  const existing = getCustomEndpoint(req.params.id);
  if (!existing) {
    res.status(404).json({ message: "Endpoint not found" });
    return;
  }

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
  let nextKey = existing.api_key || "";
  if (typeof apiKey === "string" && !isMaskedValue(apiKey)) {
    nextKey = apiKey.trim();
  }

  try {
    await fetchEndpointModels(nextKey, nextUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ message: msg || "Could not reach the endpoint" });
    return;
  }

  db.prepare(
    `UPDATE custom_endpoints
     SET name = ?, base_url = ?, api_key = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(nextName, nextUrl, sealCredential(nextKey), req.params.id);

  handleEndpointRemoved(req.params.id);
  const updated = getCustomEndpoint(req.params.id)!;
  try {
    await refreshEndpointCatalog(updated);
  } catch {
    // Discovery hiccup — user can refresh later
  }

  res.json(toClientEndpoint(updated, true));
});

router.post("/:id/refresh-models", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can manage instance endpoints"));
    return;
  }
  const endpoint = getCustomEndpoint(req.params.id);
  if (!endpoint) {
    res.status(404).json({ message: "Endpoint not found" });
    return;
  }
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

router.delete("/:id", (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can manage instance endpoints"));
    return;
  }
  const existing = getCustomEndpoint(req.params.id);
  if (!existing) {
    res.status(404).json({ message: "Endpoint not found" });
    return;
  }
  db.prepare("DELETE FROM custom_endpoints WHERE id = ?").run(req.params.id);
  handleEndpointRemoved(req.params.id);
  res.json({ success: true });
});

export default router;
