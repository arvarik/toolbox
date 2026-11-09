import {
  readBodyCapped,
  safeFetch,
} from "../net/originAndFetch.ts";
import { ValidationError, getErrorMessage } from "../net/errors.ts";

export interface SearxngHit {
  title: string;
  url: string;
  snippet: string;
}

interface SearxngJsonResponse {
  results?: Array<{
    url?: string;
    title?: string;
    content?: string;
  }>;
}

export function normalizeSearxngBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) {
    throw new ValidationError("SearXNG URL is not configured");
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new ValidationError("SearXNG URL must be a valid http(s) URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("SearXNG URL must use http or https");
  }
  return trimmed;
}

export async function searxngSearch(
  query: string,
  opts: {
    searxngUrl: string;
    limit?: number;
    signal?: AbortSignal;
  },
): Promise<SearxngHit[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];

  const base = normalizeSearxngBaseUrl(opts.searxngUrl);
  const limit = Math.max(1, Math.min(opts.limit ?? 6, 15));
  const endpoint = new URL(`${base}/search`);
  endpoint.searchParams.set("q", trimmedQuery);
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("safesearch", "0");

  // SearXNG is admin-configured and typically self-hosted on localhost or Docker LAN.
  const { response } = await safeFetch(endpoint, {
    allowPrivate: true,
    timeoutMs: 12_000,
    headers: { Accept: "application/json" },
    signal: opts.signal,
  });

  if (!response.ok) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(`SearXNG returned HTTP ${response.status}`);
  }

  const rawText = await readBodyCapped(response, {
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: 8_000,
    signal: opts.signal,
  });

  let data: SearxngJsonResponse;
  try {
    data = JSON.parse(rawText) as SearxngJsonResponse;
  } catch {
    throw new Error("SearXNG did not return valid JSON (ensure json format is enabled in SearXNG settings.yml)");
  }

  const seen = new Set<string>();
  const hits: SearxngHit[] = [];
  for (const item of data.results ?? []) {
    if (!item?.url) continue;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(item.url);
    } catch {
      continue;
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      continue;
    }
    const normalizedUrl = parsedUrl.toString();
    if (seen.has(normalizedUrl)) continue;
    seen.add(normalizedUrl);
    hits.push({
      title: (item.title ?? normalizedUrl).trim() || normalizedUrl,
      url: normalizedUrl,
      snippet: (item.content ?? "").replace(/\s+/g, " ").trim(),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function testSearxngConnection(searxngUrl: string): Promise<{
  ok: boolean;
  latencyMs: number;
  resultCount: number;
  message?: string;
}> {
  const started = Date.now();
  try {
    const hits = await searxngSearch("distributed systems", {
      searxngUrl,
      limit: 3,
    });
    return {
      ok: true,
      latencyMs: Date.now() - started,
      resultCount: hits.length,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - started,
      resultCount: 0,
      message: getErrorMessage(err),
    };
  }
}
