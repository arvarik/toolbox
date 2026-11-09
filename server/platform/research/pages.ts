import * as cheerio from "cheerio";
import {
  readBodyCapped,
  safeFetch,
} from "../net/originAndFetch.ts";
import { getErrorMessage, log } from "../net/errors.ts";

export interface FetchedReadablePage {
  url: string;
  finalUrl: string;
  title: string;
  excerpt: string;
}

const DEFAULT_MAX_CHARS = 6_000;
const STRIP_SELECTORS =
  "script, style, nav, footer, header, aside, noscript, svg, form, iframe, head, title";

export function extractReadableHtml(
  html: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): { title: string; text: string } {
  const $ = cheerio.load(html);
  const title = $("title").first().text().replace(/\s+/g, " ").trim();
  $(STRIP_SELECTORS).remove();

  const mainText = $("main, article, [role='main']")
    .text()
    .replace(/\s+/g, " ")
    .trim();
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const chosen = mainText.length >= 200 ? mainText : bodyText || mainText;

  return {
    title,
    text: chosen.length > maxChars ? `${chosen.slice(0, maxChars)}…` : chosen,
  };
}

/**
 * Fetches an untrusted result URL with `allowPrivate: false` (strict SSRF + DNS
 * rebinding protection), bounded body size (2 MB) & stream timeout (8 s), and
 * extracts readable text via Cheerio.
 */
export async function fetchReadablePage(
  targetUrl: string,
  opts: {
    maxChars?: number;
    signal?: AbortSignal;
  } = {},
): Promise<
  | { ok: true; page: FetchedReadablePage }
  | { ok: false; url: string; reason: string }
> {
  try {
    const { response, finalUrl } = await safeFetch(targetUrl, {
      allowPrivate: false,
      timeoutMs: 8_000,
      headers: {
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5",
        "User-Agent": "ToolboxStudyBot/2.0 (+https://localhost)",
      },
      signal: opts.signal,
    });

    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        url: targetUrl,
        reason: `HTTP ${response.status}`,
      };
    }

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml") &&
      !contentType.includes("text/plain") &&
      !contentType.includes("text/markdown")
    ) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        url: targetUrl,
        reason: `Unsupported content-type: ${contentType}`,
      };
    }

    const rawBody = await readBodyCapped(response, {
      maxBytes: 2 * 1024 * 1024,
      timeoutMs: 8_000,
      signal: opts.signal,
    });

    const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
    if (contentType.includes("text/plain") || contentType.includes("text/markdown")) {
      const text = rawBody.replace(/\s+/g, " ").trim();
      return {
        ok: true,
        page: {
          url: targetUrl,
          finalUrl,
          title: finalUrl,
          excerpt: text.length > maxChars ? `${text.slice(0, maxChars)}…` : text,
        },
      };
    }

    const { title, text } = extractReadableHtml(rawBody, maxChars);
    return {
      ok: true,
      page: {
        url: targetUrl,
        finalUrl,
        title: title || finalUrl,
        excerpt: text,
      },
    };
  } catch (err) {
    const reason = getErrorMessage(err);
    log.debug("research", `Blocked or failed page fetch for ${targetUrl}: ${reason}`);
    return { ok: false, url: targetUrl, reason };
  }
}

export async function fetchReadablePages(
  urls: readonly string[],
  opts: {
    maxChars?: number;
    signal?: AbortSignal;
  } = {},
): Promise<{
  pages: FetchedReadablePage[];
  blockedUrls: Array<{ url: string; reason: string }>;
}> {
  const outcomes = await Promise.all(
    urls.map((u) => fetchReadablePage(u, opts)),
  );
  const pages: FetchedReadablePage[] = [];
  const blockedUrls: Array<{ url: string; reason: string }> = [];
  for (const o of outcomes) {
    if (o.ok) {
      if (o.page.excerpt) pages.push(o.page);
    } else {
      blockedUrls.push({ url: o.url, reason: o.reason });
    }
  }
  return { pages, blockedUrls };
}
