import { generateText } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { WebSearchEngine } from "../../../shared/platform/aiSettings.ts";
import {
  getEffectiveWebSearchConfig,
  resolveModelDescriptor,
} from "../ai/aiSettingsService.ts";
import { getErrorMessage, log } from "../net/errors.ts";
import type { Scope } from "../tenancy/scope.ts";
import {
  dedupeCitations,
  resolveRedirects,
  type ResearchCitation,
} from "./citations.ts";
import { fetchReadablePages, type FetchedReadablePage } from "./pages.ts";
import { searxngSearch } from "./searxng.ts";

export interface WebResearchResult {
  query: string;
  engineUsed: WebSearchEngine;
  summary: string;
  citations: ResearchCitation[];
  pages: FetchedReadablePage[];
  blockedUrls: Array<{ url: string; reason: string }>;
}

const PROVIDER_RESEARCH_TIMEOUT_MS = 60_000;

async function runProviderGroundedSearch(
  scope: Scope | undefined,
  query: string,
  signal?: AbortSignal,
): Promise<{ summary: string; citations: ResearchCitation[] }> {
  const desc = resolveModelDescriptor(undefined, {
    scope,
    capability: "research",
  });

  if (desc.kind !== "builtin") {
    throw new Error(
      "Provider web search requires a Gemini, OpenAI, or Claude research model (or configure SearXNG).",
    );
  }

  const signals: AbortSignal[] = [
    AbortSignal.timeout(PROVIDER_RESEARCH_TIMEOUT_MS),
  ];
  if (signal) signals.push(signal);
  const abortSignal = AbortSignal.any(signals);

  const systemPrompt =
    "You are a technical research assistant. Use web search to gather accurate, up-to-date facts and cite primary sources concisely.";

  let result;
  if (desc.providerId === "gemini") {
    const google = createGoogleGenerativeAI({ apiKey: desc.apiKey });
    result = await generateText({
      model: google(desc.modelId),
      system: systemPrompt,
      prompt: query,
      tools: {
        google_search: google.tools.googleSearch({}),
      },
      abortSignal,
    });
  } else if (desc.providerId === "openai") {
    const openai = createOpenAI({ apiKey: desc.apiKey });
    result = await generateText({
      model: openai.responses(desc.modelId),
      system: systemPrompt,
      prompt: query,
      tools: {
        web_search: openai.tools.webSearch(),
      },
      abortSignal,
    });
  } else {
    const anthropic = createAnthropic({ apiKey: desc.apiKey });
    result = await generateText({
      model: anthropic(desc.modelId),
      system: systemPrompt,
      prompt: query,
      tools: {
        web_search: anthropic.tools.webSearch_20260209({ maxUses: 5 }),
      },
      abortSignal,
    });
  }

  const rawSources = (result.sources ?? []) as Array<{
    url?: string;
    title?: string;
  }>;
  const rawUris = rawSources
    .map((s) => s.url)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
  const redirectMap = await resolveRedirects(rawUris, signal);

  const citations = dedupeCitations(
    rawSources
      .filter((s): s is { url: string; title?: string } => Boolean(s.url))
      .map((s) => ({
        url: redirectMap.get(s.url) ?? s.url,
        title: s.title || s.url,
      })),
  );

  return {
    summary: result.text.trim(),
    citations,
  };
}

async function runSearxngLeg(
  searxngUrl: string,
  query: string,
  maxResults: number,
  signal?: AbortSignal,
): Promise<{
  citations: ResearchCitation[];
  pages: FetchedReadablePage[];
  blockedUrls: Array<{ url: string; reason: string }>;
}> {
  const hits = await searxngSearch(query, {
    searxngUrl,
    limit: maxResults,
    signal,
  });

  const { pages, blockedUrls } = await fetchReadablePages(
    hits.map((h) => h.url),
    { signal },
  );

  // Only cite URLs that were not SSRF-blocked!
  const blockedSet = new Set(blockedUrls.map((b) => b.url));
  const pageByUrl = new Map(pages.map((p) => [p.url, p]));

  const citations = dedupeCitations(
    hits
      .filter((h) => !blockedSet.has(h.url))
      .map((h) => {
        const fetched = pageByUrl.get(h.url);
        return {
          title: fetched?.title || h.title,
          url: fetched?.finalUrl || h.url,
          snippet: h.snippet || fetched?.excerpt.slice(0, 240),
        };
      }),
  );

  return { citations, pages, blockedUrls };
}

export async function runWebResearch({
  scope,
  query,
  engine,
  searxngUrlOverride,
  maxResults = 5,
  signal,
}: {
  scope?: Scope;
  query: string;
  engine?: WebSearchEngine;
  searxngUrlOverride?: string;
  maxResults?: number;
  signal?: AbortSignal;
}): Promise<WebResearchResult> {
  const trimmed = query.trim();
  const cfg = getEffectiveWebSearchConfig(scope);
  const effectiveEngine = engine ?? cfg.engine;
  const searxngUrl = (searxngUrlOverride ?? cfg.searxngUrl).trim();

  if (!trimmed) {
    return {
      query: "",
      engineUsed: effectiveEngine,
      summary: "",
      citations: [],
      pages: [],
      blockedUrls: [],
    };
  }

  if (effectiveEngine === "searxng") {
    const leg = await runSearxngLeg(searxngUrl, trimmed, maxResults, signal);
    const summary = leg.pages
      .map((p, i) => `[${i + 1}] ${p.title} (${p.finalUrl})\n${p.excerpt}`)
      .join("\n\n");
    return {
      query: trimmed,
      engineUsed: "searxng",
      summary,
      citations: leg.citations,
      pages: leg.pages,
      blockedUrls: leg.blockedUrls,
    };
  }

  if (effectiveEngine === "provider") {
    const grounded = await runProviderGroundedSearch(scope, trimmed, signal);
    return {
      query: trimmed,
      engineUsed: "provider",
      summary: grounded.summary,
      citations: grounded.citations,
      pages: [],
      blockedUrls: [],
    };
  }

  // Combined mode: run SearXNG (if configured) and provider grounding in parallel,
  // tolerating partial failure when at least one leg succeeds.
  const [searxOutcome, providerOutcome] = await Promise.allSettled([
    searxngUrl
      ? runSearxngLeg(searxngUrl, trimmed, maxResults, signal)
      : Promise.resolve({ citations: [], pages: [], blockedUrls: [] }),
    runProviderGroundedSearch(scope, trimmed, signal),
  ]);

  const searxVal =
    searxOutcome.status === "fulfilled"
      ? searxOutcome.value
      : (() => {
          log.warn(
            "research",
            `Combined SearXNG leg failed: ${getErrorMessage(searxOutcome.reason)}`,
          );
          return { citations: [], pages: [], blockedUrls: [] };
        })();

  const providerVal =
    providerOutcome.status === "fulfilled"
      ? providerOutcome.value
      : (() => {
          log.warn(
            "research",
            `Combined provider leg failed: ${getErrorMessage(providerOutcome.reason)}`,
          );
          return { summary: "", citations: [] };
        })();

  if (
    searxOutcome.status === "rejected" &&
    providerOutcome.status === "rejected"
  ) {
    throw providerOutcome.reason;
  }

  const pageDigest = searxVal.pages
    .map((p, i) => `[Page ${i + 1}] ${p.title} (${p.finalUrl})\n${p.excerpt}`)
    .join("\n\n");
  const summary = [providerVal.summary, pageDigest].filter(Boolean).join("\n\n");

  return {
    query: trimmed,
    engineUsed: "combined",
    summary,
    citations: dedupeCitations([
      ...providerVal.citations,
      ...searxVal.citations,
    ]),
    pages: searxVal.pages,
    blockedUrls: searxVal.blockedUrls,
  };
}
