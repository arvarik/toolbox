import { Router } from "express";
import db from "../db.ts";
import { openCredential, sealCredential } from "../kits/kitsSchema.ts";
import { ForbiddenError } from "../platform/net/errors.ts";
import {
  getAvailableModels,
  getApiKeyStatus,
  testProviderKey,
  getProviderDefinitions,
  getApiKeyFields,
  getProviderIdForConfigKey,
  refreshProviderCatalog,
  refreshAllCatalogs,
  handleProviderKeyRemoved,
} from "../providers/index.ts";
import { maskSecret, isMaskedValue } from "../utils/mask.ts";
import logger from "../utils/logger.ts";

const router = Router();

router.get("/", (req, res) => {
  const isAdmin = req.principal?.user.role === "admin";
  const keyStatus = getApiKeyStatus();
  if (!isAdmin) {
    res.json({
      api_keys_configured: keyStatus,
      api_key_configured: Object.values(keyStatus).some(Boolean),
    });
    return;
  }
  const rows = db.prepare("SELECT key, value FROM config").all() as Array<{
    key: string;
    value: string;
  }>;
  const apiKeyFields = getApiKeyFields();
  const config: Record<string, unknown> = {};
  for (const row of rows) {
    if (apiKeyFields.includes(row.key)) {
      const opened = openCredential(row.value);
      config[row.key] = maskSecret(opened);
    } else {
      config[row.key] = row.value;
    }
  }
  config.api_keys_configured = keyStatus;
  config.api_key_configured = Object.values(keyStatus).some(Boolean);
  res.json(config);
});

router.put("/", (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can modify instance configuration"));
    return;
  }
  const apiKeyFields = getApiKeyFields();
  const body = (req.body || {}) as Record<string, unknown>;

  const upsert = db.prepare(
    `INSERT INTO config (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  );

  const removedProviders: string[] = [];
  const transaction = db.transaction(() => {
    for (const [key, value] of Object.entries(body)) {
      const strValue = String(value ?? "");
      if (apiKeyFields.includes(key)) {
        if (isMaskedValue(strValue)) continue;
        if (strValue === "") {
          const providerId = getProviderIdForConfigKey(key);
          if (providerId) removedProviders.push(providerId);
          upsert.run(key, "");
        } else {
          upsert.run(key, sealCredential(strValue));
        }
        continue;
      }
      upsert.run(key, strValue);
    }
  });

  transaction();
  for (const providerId of removedProviders) {
    handleProviderKeyRemoved(providerId);
  }
  res.json({ success: true });
});

router.post("/test-key", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can configure instance API keys"));
    return;
  }
  const { key, provider = "gemini" } = req.body as {
    key?: string;
    provider?: string;
  };

  if (!key) {
    res.status(400).json({ message: "API key is required" });
    return;
  }

  try {
    await testProviderKey(provider, key);

    const providerDefs = getProviderDefinitions();
    const providerDef = providerDefs.find((p) => p.id === provider);
    const configKey = providerDef ? providerDef.configKey : `${provider}_api_key`;

    db.prepare(
      `INSERT INTO config (key, value, updated_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ).run(configKey, sealCredential(key));

    let modelsDiscovered = 0;
    try {
      const models = await refreshProviderCatalog(provider, key);
      modelsDiscovered = models.length;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        `[config] Model discovery after key save failed for ${provider}: ${msg}`,
      );
    }

    res.json({ valid: true, modelsDiscovered });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ valid: false, message: msg || "Invalid API key" });
  }
});

router.get("/available-models", (_req, res) => {
  const models = getAvailableModels();
  const providers = getProviderDefinitions();
  res.json({ providers, groups: models });
});

router.post("/refresh-models", async (req, res, next) => {
  if (req.principal?.user.role !== "admin") {
    next(new ForbiddenError("Only administrators can refresh instance catalogs"));
    return;
  }
  const { refreshed, errors } = await refreshAllCatalogs();
  const models = getAvailableModels();
  const providers = getProviderDefinitions();
  res.json({ refreshed, errors, providers, groups: models });
});

export default router;
