import db from "../db.ts";
import { openCredential } from "../platform/crypto/secretBox.ts";
import {
  applyCatalogGuardrails,
  keepLatestPerFamily,
  inferModelFamily,
  prettyModelName,
} from "./model_filter.ts";
import { customModelId, type RawDiscoveredModel } from "./defs.ts";

export interface CatalogModelEntry {
  id: string;
  upstreamId?: string;
  name: string;
  description: string;
  family: string | null;
  releasedAt: number | null;
}

export interface CustomEndpointRow {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  created_at: string;
  updated_at: string;
}

export function saveCatalog(
  catalogId: string,
  models: CatalogModelEntry[],
): void {
  db.prepare(
    `INSERT INTO model_catalog (catalog_id, models, fetched_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(catalog_id) DO UPDATE SET models = excluded.models, fetched_at = excluded.fetched_at`,
  ).run(catalogId, JSON.stringify(models));
}

export function loadCatalog(
  catalogId: string,
): { models: CatalogModelEntry[]; fetchedAt: string } | null {
  const row = db
    .prepare("SELECT models, fetched_at FROM model_catalog WHERE catalog_id = ?")
    .get(catalogId) as { models: string; fetched_at: string } | undefined;
  if (!row) return null;
  try {
    return {
      models: JSON.parse(row.models) as CatalogModelEntry[],
      fetchedAt: row.fetched_at,
    };
  } catch {
    return null;
  }
}

export function clearCatalog(catalogId: string): void {
  db.prepare("DELETE FROM model_catalog WHERE catalog_id = ?").run(catalogId);
}

export function buildProviderCatalogEntries(
  providerId: string,
  rawModels: readonly RawDiscoveredModel[],
  nowMs: number = Date.now(),
): CatalogModelEntry[] {
  const filtered = applyCatalogGuardrails(rawModels, nowMs);
  const latest = keepLatestPerFamily(providerId, filtered);
  return latest.map((m) => {
    const family = inferModelFamily(providerId, m.id);
    return {
      id: m.id,
      name: m.name || prettyModelName(m.id),
      description: m.description || (family ? `${family} family` : ""),
      family,
      releasedAt: m.releasedAt ?? null,
    };
  });
}

export function buildEndpointCatalogEntries(
  endpoint: { id: string; name: string },
  rawModels: readonly RawDiscoveredModel[],
  nowMs: number = Date.now(),
): CatalogModelEntry[] {
  const filtered = applyCatalogGuardrails(rawModels, nowMs);
  return filtered.map((m) => ({
    id: customModelId(endpoint.id, m.id),
    upstreamId: m.id,
    name: prettyModelName(m.id),
    description: `Served by ${endpoint.name}`,
    family: null,
    releasedAt: m.releasedAt ?? null,
  }));
}

function unsealEndpointRow(row: CustomEndpointRow): CustomEndpointRow {
  return {
    ...row,
    api_key: openCredential(row.api_key),
  };
}

export function listCustomEndpoints(): CustomEndpointRow[] {
  const rows = db
    .prepare("SELECT * FROM custom_endpoints ORDER BY created_at ASC")
    .all() as CustomEndpointRow[];
  return rows.map(unsealEndpointRow);
}

export function getCustomEndpoint(id: string): CustomEndpointRow | undefined {
  const row = db
    .prepare("SELECT * FROM custom_endpoints WHERE id = ?")
    .get(id) as CustomEndpointRow | undefined;
  return row ? unsealEndpointRow(row) : undefined;
}
