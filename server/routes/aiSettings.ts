import { Router } from "express";
import {
  AdminAiSettingsUpdateSchema,
  CustomEndpointInputSchema,
  UserByokUpdateSchema,
} from "../../shared/platform/aiSettings.ts";
import db from "../db.ts";
import {
  assertNoUserEmbeddingsOverride,
  deleteUserCustomEndpoint,
  getAdminAiSettingsView,
  getInstanceWebSearchConfig,
  getUserAiSettingsView,
  normalizeEndpointBaseUrl,
  updateAdminAiSettings,
  updateUserByokSettings,
  upsertUserCustomEndpoint,
} from "../platform/ai/aiSettingsService.ts";
import { ValidationError, asyncHandler } from "../platform/net/errors.ts";
import { testSearxngConnection } from "../platform/research/searxng.ts";
import { scopeOf } from "../platform/tenancy/scope.ts";
import { fetchEndpointModels } from "../providers/defs.ts";
import { testProviderKey } from "../providers/index.ts";
import {
  ensureEmbeddingStore,
  reindexMissingEmbeddings,
} from "../search/hybridSearch.ts";
import logger from "../utils/logger.ts";

export const userAiSettingsRouter = Router();
export const adminAiSettingsRouter = Router();

/* ── Per-User BYOK & Capability Overrides (`/api/ai-settings`) ── */

userAiSettingsRouter.get("/", (req, res) => {
  const scope = scopeOf(req);
  res.json(getUserAiSettingsView(scope));
});

userAiSettingsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    assertNoUserEmbeddingsOverride(req.body);
    const parsed = UserByokUpdateSchema.parse(req.body ?? {});
    const updated = updateUserByokSettings(scope, parsed);
    res.json(updated);
  }),
);

userAiSettingsRouter.post(
  "/test-key",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const { provider = "gemini", key } = (req.body ?? {}) as {
      provider?: string;
      key?: string;
    };
    if (!key || !key.trim()) {
      throw new ValidationError("API key is required");
    }
    try {
      await testProviderKey(provider, key.trim());
    } catch (err) {
      res.status(400).json({
        valid: false,
        message: err instanceof Error ? err.message : "Invalid API key",
      });
      return;
    }
    const view = updateUserByokSettings(scope, {
      providerKeys: { [provider]: key.trim() },
    });
    res.json({ valid: true, settings: view });
  }),
);

userAiSettingsRouter.post(
  "/endpoints/test",
  asyncHandler(async (req, res) => {
    const { baseUrl, apiKey } = (req.body ?? {}) as {
      baseUrl?: string;
      apiKey?: string;
    };
    const normalized = normalizeEndpointBaseUrl(baseUrl);
    try {
      const models = await fetchEndpointModels((apiKey ?? "").trim(), normalized);
      res.json({ ok: true, modelCount: models.length });
    } catch (err) {
      res.status(400).json({
        ok: false,
        message:
          err instanceof Error ? err.message : "Could not reach custom endpoint",
      });
    }
  }),
);

userAiSettingsRouter.post(
  "/endpoints",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const skipProbe = body.skipProbe === true;
    const input = CustomEndpointInputSchema.parse({
      name: body.name,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    const endpoint = await upsertUserCustomEndpoint(scope, input, undefined, {
      skipProbe,
    });
    res.status(201).json(endpoint);
  }),
);

userAiSettingsRouter.put(
  "/endpoints/:id",
  asyncHandler(async (req, res) => {
    const scope = scopeOf(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const skipProbe = body.skipProbe === true;
    const input = CustomEndpointInputSchema.parse({
      name: body.name,
      baseUrl: body.baseUrl,
      apiKey: body.apiKey,
    });
    const endpoint = await upsertUserCustomEndpoint(
      scope,
      input,
      String(req.params.id),
      { skipProbe },
    );
    res.json(endpoint);
  }),
);

userAiSettingsRouter.delete("/endpoints/:id", (req, res) => {
  const scope = scopeOf(req);
  deleteUserCustomEndpoint(scope, String(req.params.id));
  res.json({ success: true });
});

/* ── Admin Instance AI Router, Embeddings & SearXNG (`/api/admin/ai-settings`) ── */

adminAiSettingsRouter.get("/", (_req, res) => {
  res.json(getAdminAiSettingsView());
});

adminAiSettingsRouter.put(
  "/",
  asyncHandler(async (req, res) => {
    const parsed = AdminAiSettingsUpdateSchema.parse(req.body ?? {});
    const { embeddingsChanged, embeddings } = updateAdminAiSettings(parsed);
    if (embeddingsChanged) {
      ensureEmbeddingStore(db, embeddings.dimension);
      void reindexMissingEmbeddings(db, { limit: 256 }).catch((err: unknown) => {
        logger.warn(
          `[admin/ai-settings] Background embedding reindex deferred: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }
    res.json(getAdminAiSettingsView());
  }),
);

adminAiSettingsRouter.post(
  "/test-searxng",
  asyncHandler(async (req, res) => {
    const rawUrl =
      typeof req.body?.searxngUrl === "string" && req.body.searxngUrl.trim()
        ? req.body.searxngUrl.trim()
        : getInstanceWebSearchConfig().searxngUrl;
    if (!rawUrl) {
      throw new ValidationError("SearXNG URL is required to test connection");
    }
    const status = await testSearxngConnection(rawUrl);
    if (!status.ok) {
      res.status(400).json(status);
      return;
    }
    res.json(status);
  }),
);

adminAiSettingsRouter.post(
  "/reindex-embeddings",
  asyncHandler(async (_req, res) => {
    ensureEmbeddingStore(db);
    const reindexed = await reindexMissingEmbeddings(db, { limit: 500 });
    res.json({ ok: true, reindexed });
  }),
);
