import {
  assertPublicHttpUrl,
  safeFetch,
} from "../net/originAndFetch.ts";

export interface ResearchCitation {
  title: string;
  url: string;
  snippet?: string;
}

export function isGroundingRedirectUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    return (
      parsed.hostname === "vertexaisearch.cloud.google.com" &&
      parsed.pathname.startsWith("/grounding-api-redirect/")
    );
  } catch {
    return false;
  }
}

async function unwrapSingleRedirect(
  uri: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!isGroundingRedirectUrl(uri)) return uri;

  for (const method of ["HEAD", "GET"] as const) {
    try {
      const { response } = await safeFetch(uri, {
        method,
        redirect: "manual",
        allowPrivate: false,
        timeoutMs: 5_000,
        signal,
      });
      void response.body?.cancel().catch(() => undefined);

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return uri;
        const resolved = new URL(location, uri).toString();
        await assertPublicHttpUrl(resolved);
        return resolved;
      }
      if (method === "HEAD" && (response.status === 405 || response.status === 400)) {
        continue;
      }
      return uri;
    } catch {
      return uri;
    }
  }
  return uri;
}

/**
 * Unwraps Google Gemini `vertexaisearch.cloud.google.com/grounding-api-redirect/*`
 * URLs via SSRF-guarded `safeFetch(..., { allowPrivate: false })` and validates
 * the target `Location` is a public `http(s)` URL.
 */
export async function resolveRedirects(
  uris: readonly string[],
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const unique = [...new Set(uris.filter(Boolean))];
  const entries = await Promise.all(
    unique.map(async (u) => [u, await unwrapSingleRedirect(u, signal)] as const),
  );
  return new Map(entries);
}

export function dedupeCitations(
  citations: readonly ResearchCitation[],
): ResearchCitation[] {
  const seen = new Set<string>();
  const out: ResearchCitation[] = [];
  for (const c of citations) {
    if (!c.url) continue;
    let parsed: URL;
    try {
      parsed = new URL(c.url);
    } catch {
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") continue;
    const key = parsed.toString();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: c.title?.trim() || parsed.hostname,
      url: key,
      ...(c.snippet ? { snippet: c.snippet } : {}),
    });
  }
  return out;
}
