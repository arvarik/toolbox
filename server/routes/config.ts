import { Router } from "express";
import db from "../db.ts";
import { adminRefusal, requireAdmin } from "../platform/auth/authMiddleware.ts";
import { openCredential, sealCredential } from "../platform/crypto/secretBox.ts";
import { ValidationError } from "../platform/net/errors.ts";
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

const UPSERT_CONFIG_SQL = `INSERT INTO config (key, value, updated_at)
  VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`;

router.get("/", (req, res) => {
  const isAdmin = adminRefusal(req) === null;
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
    config[row.key] = apiKeyFields.includes(row.key)
      ? maskSecret(openCredential(row.value))
      : row.value;
  }
  config.api_keys_configured = keyStatus;
  config.api_key_configured = Object.values(keyStatus).some(Boolean);
  res.json(config);
});

router.put("/", requireAdmin, (req, res) => {
  const rawBody = req.body;
  if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
    throw new ValidationError("Configuration payload must be a JSON object");
  }
  const apiKeyFields = getApiKeyFields();
  const allowedKeys = new Set(apiKeyFields);
  const body = rawBody as Record<string, unknown>;
  const entries = Object.entries(body);
  if (entries.length > 100) {
    throw new ValidationError("Too many configuration keys in single update");
  }
  const upsert = db.prepare(UPSERT_CONFIG_SQL);

  const removedProviders: string[] = [];
  db.transaction(() => {
    for (const [key, value] of entries) {
      if (!key.trim() || key.length > 100) {
        throw new ValidationError("Invalid configuration key");
      }
      if (!allowedKeys.has(key)) {
        throw new ValidationError(`Unknown configuration key: "${key}"`);
      }
      if (value !== null && value !== undefined && typeof value === "object") {
        throw new ValidationError(`Configuration value for "${key}" must be a primitive`);
      }
      if (typeof value === "number" && !Number.isFinite(value)) {
        throw new ValidationError(`Configuration value for "${key}" must be finite`);
      }
      const strValue = String(value ?? "");
      if (strValue.length > 10_000) {
        throw new ValidationError(`Configuration value for "${key}" exceeds maximum length`);
      }
      if (isMaskedValue(strValue)) continue;
      if (strValue === "") {
        const providerId = getProviderIdForConfigKey(key);
        if (providerId) removedProviders.push(providerId);
        upsert.run(key, "");
      } else {
        upsert.run(key, sealCredential(strValue));
      }
    }
  })();

  for (const providerId of removedProviders) {
    handleProviderKeyRemoved(providerId);
  }
  res.json({ success: true });
});

router.post("/test-key", requireAdmin, async (req, res) => {
    const { key, provider = "gemini" } = (req.body ?? {}) as {
      key?: unknown;
      provider?: unknown;
    };
    if (typeof key !== "string" || !key.trim() || key.length > 2000) {
      res.status(400).json({ message: "API key is required" });
      return;
    }
    if (typeof provider !== "string" || !provider.trim() || provider.length > 64) {
      res.status(400).json({ message: "Valid provider is required" });
      return;
    }

    try {
      await testProviderKey(provider, key);
      const providerDef = getProviderDefinitions().find((p) => p.id === provider);
      const configKey = providerDef ? providerDef.configKey : `${provider}_api_key`;
      db.prepare(UPSERT_CONFIG_SQL).run(configKey, sealCredential(key));

      let modelsDiscovered = 0;
      try {
        modelsDiscovered = (await refreshProviderCatalog(provider, key)).length;
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
  },
);

router.get("/available-models", (_req, res) => {
  res.json({
    providers: getProviderDefinitions(),
    groups: getAvailableModels(),
  });
});

router.post("/refresh-models", requireAdmin, async (_req, res) => {
    const { refreshed, errors } = await refreshAllCatalogs();
    res.json({
      refreshed,
      errors,
      providers: getProviderDefinitions(),
      groups: getAvailableModels(),
    });
  },
);

export default router;
