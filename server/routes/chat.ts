import { Router } from "express";
import crypto from "node:crypto";
import { tool, type ModelMessage, type ToolSet } from "ai";
import { z } from "zod";
import db from "../db.ts";
import { scopeOf, type Scope } from "../platform/tenancy/scope.ts";
import { runWebResearch } from "../platform/research/webResearch.ts";
import {
  resolveActiveKit,
  type ActiveKitContext,
} from "../kits/kitContext.ts";
import logger from "../utils/logger.ts";
import { generateEmbedding } from "../utils/embeddings.ts";
import {
  hybridSearch,
  syncDomainSourcesToRag,
  upsertRagChunk,
  upsertRagChunksBatch,
} from "../search/hybridSearch.ts";
import { runText, runStructured, chatStream } from "../ai/engine.ts";

const router = Router();

interface StoredMessage {
  role?: string;
  content?: string;
}

function toModelMessages(history: StoredMessage[] | undefined): ModelMessage[] {
  return (history || [])
    .filter(
      (msg): msg is { role: string; content: string } =>
        typeof msg?.content === "string" && msg.content.trim() !== "",
    )
    .map((msg) => ({
      role:
        msg.role === "ai" || msg.role === "model"
          ? ("assistant" as const)
          : ("user" as const),
      content: msg.content,
    }));
}

function tutorSystemPrompt(rolePrompt: string, context?: string): string {
  return context ? `${rolePrompt} Context: ${context}` : rolePrompt;
}

router.get("/starters", async (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const pillarId = String(req.query.pillarId || "");
  const topicId = String(req.query.topicId || "");
  const topicName = req.query.topicName ? String(req.query.topicName) : undefined;
  const model = req.query.model ? String(req.query.model) : undefined;

  if (!pillarId || !topicId) {
    res.status(400).json({ message: "pillarId and topicId are required" });
    return;
  }

  try {
    const pillar = kit.skeleton.pillars.find((p) => p.id === pillarId);
    const topic = pillar?.topics.find((t) => t.id === topicId);
    const resolvedPillarName = pillar?.name || pillarId;
    const resolvedTopicName = topic?.name || topicName || topicId;
    const blueprint = pillar?.sections || [];

    const rows = db
      .prepare(
        "SELECT section_id, content FROM guide_content WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ?",
      )
      .all(scope.ownerId, kit.id, pillarId, topicId) as Array<{
      section_id: string;
      content: string;
    }>;

    const completedSections: Array<{ name: string; content: string }> = [];
    const missingSections: Array<{ name: string }> = [];

    for (const sec of blueprint) {
      const row = rows.find((r) => r.section_id === sec.id);
      if (row && row.content && row.content.trim().length > 0) {
        completedSections.push({ name: sec.name, content: row.content });
      } else {
        missingSections.push({ name: sec.name });
      }
    }

    if (blueprint.length === 0) {
      for (const r of rows) {
        completedSections.push({ name: r.section_id, content: r.content });
      }
    }

    const profileRow = db
      .prepare(
        "SELECT profile_text FROM user_learning_profile WHERE ownerId = ?",
      )
      .get(scope.ownerId) as { profile_text: string } | undefined;
    const userProfile = profileRow?.profile_text || "";

    const hashData = JSON.stringify({
      completed: completedSections,
      missing: missingSections,
      profile: userProfile,
      blueprintCount: blueprint.length,
    });
    const contentHash = crypto.createHash("md5").update(hashData).digest("hex");

    const cached = db
      .prepare(
        "SELECT suggestions, content_hash FROM chat_starters WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ?",
      )
      .get(scope.ownerId, kit.id, pillarId, topicId) as
      | { suggestions: string; content_hash: string }
      | undefined;

    if (
      cached &&
      cached.content_hash === contentHash &&
      cached.suggestions !== "[]"
    ) {
      try {
        const parsed = JSON.parse(cached.suggestions) as string[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          const shuffled = [...parsed].sort(() => 0.5 - Math.random());
          res.json({ suggestions: shuffled.slice(0, 6) });
          return;
        }
      } catch {
        // Stale or corrupt cache — regenerate
      }
    }

    const prompt = `${kit.skeleton.tutor.rolePrompt}
You are creating contextual chat starters for the topic "${resolvedTopicName}" (part of "${resolvedPillarName}" in ${kit.skeleton.identity.name}).

Study blueprint sections for this topic:
${blueprint.map((b) => `- ${b.name}`).join("\n")}

Sections the learner has already written notes for:
${completedSections.length > 0 ? completedSections.map((s) => `- ${s.name}:\n  ${s.content.substring(0, 500)}...`).join("\n") : "None."}

Sections NOT yet covered:
${missingSections.length > 0 ? missingSections.map((s) => `- ${s.name}`).join("\n") : "None."}

Learner Profile:
${userProfile || "No profile available yet."}

Generate 12 to 15 targeted, short, actionable starter questions the learner could click to ask YOU next.`;

    let suggestions: string[];
    try {
      suggestions = await runStructured<string[]>({
        model,
        scope,
        capability: "quick",
        prompt,
        element: z
          .string()
          .describe("A short, engaging study question for the learner to ask"),
        feature: "chat/starters",
      });
      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error("Empty suggestions");
      }
    } catch {
      suggestions = [
        "Let's do a deep dive on this topic",
        "Test my knowledge on this topic",
      ];
    }

    db.prepare(
      `INSERT INTO chat_starters (ownerId, kit_id, pillar_id, topic_id, suggestions, content_hash, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId, kit_id, pillar_id, topic_id) DO UPDATE SET
         suggestions = excluded.suggestions,
         content_hash = excluded.content_hash,
         updated_at = excluded.updated_at`,
    ).run(
      scope.ownerId,
      kit.id,
      pillarId,
      topicId,
      JSON.stringify(suggestions),
      contentHash,
    );

    const shuffled = [...suggestions].sort(() => 0.5 - Math.random());
    res.json({ suggestions: shuffled.slice(0, 6) });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/starters] Error:", { error: msg });
    res.status(500).json({ message: "Failed to generate starters." });
  }
});

router.post("/", async (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    message,
    context,
    history = [],
    model,
  } = req.body as {
    message?: string;
    context?: string;
    history?: StoredMessage[];
    model?: string;
  };

  if (!message) {
    res.status(400).json({ message: "Message is required" });
    return;
  }

  try {
    const response = await runText({
      model,
      scope,
      capability: "deep",
      system: tutorSystemPrompt(kit.skeleton.tutor.rolePrompt, context),
      messages: [
        ...toModelMessages(history),
        { role: "user", content: message },
      ],
      feature: "chat",
    });
    res.json({ response });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat] Error:", { error: msg });
    res.status(500).json({ message: msg || "Failed to get AI response." });
  }
});

export function buildStudyTools(
  scope: Scope,
  kit: ActiveKitContext,
  opts: {
    enableWebResearch?: boolean;
    abortSignal?: AbortSignal;
    onCitations?: (citations: Array<{ title: string; url: string; snippet?: string }>) => void;
  } = {},
): ToolSet {
  const tools: ToolSet = {
    search_flashcards: tool({
      description:
        "Search the learner's flashcards by hybrid keyword + semantic similarity. Use this to see what they have learned, quiz them on their own cards, or check what they struggle with.",
      inputSchema: z.object({
        query: z.string().describe("Search query for flashcards"),
      }),
      execute: async ({ query }) => {
        await syncDomainSourcesToRag(db, scope, kit.id);
        const hits = await hybridSearch(db, scope, query, {
          kitId: kit.id,
          kinds: ["flashcard"],
          limit: 5,
        });
        if (hits.length === 0) return "No flashcards found.";
        const ids = hits.map((h) => h.sourceRefId);
        const ph = ids.map(() => "?").join(", ");
        const rows = db
          .prepare(
            `SELECT id, front, back, state, ease_factor
             FROM flashcards
             WHERE ownerId = ? AND id IN (${ph})`,
          )
          .all(scope.ownerId, ...ids) as Array<{
          id: string;
          front: string;
          back: string;
          state: number;
          ease_factor: number;
        }>;
        const byId = new Map(rows.map((r) => [r.id, r]));
        const ordered = ids
          .map((id) => byId.get(id))
          .filter((r): r is NonNullable<typeof r> => Boolean(r))
          .map(({ front, back, state, ease_factor }) => ({
            front,
            back,
            state,
            ease_factor,
          }));
        return ordered.length ? ordered : "No flashcards found.";
      },
    }),
    search_guide: tool({
      description:
        "Search the learner's committed study guide notes by hybrid keyword + semantic similarity. Use this to ground answers in what they have already written.",
      inputSchema: z.object({
        query: z.string().describe("Topic to search for in the study guide"),
      }),
      execute: async ({ query }) => {
        await syncDomainSourcesToRag(db, scope, kit.id);
        const hits = await hybridSearch(db, scope, query, {
          kitId: kit.id,
          kinds: ["guide"],
          limit: 4,
        });
        return hits.length
          ? hits.map((h) => ({ title: h.title, content: h.content }))
          : "No guide content found.";
      },
    }),
    search_kit_sources: tool({
      description:
        "Search uploaded reference materials, PDFs, and source documents attached to this Kit.",
      inputSchema: z.object({
        query: z.string().describe("Search query for Kit reference sources"),
      }),
      execute: async ({ query }) => {
        await syncDomainSourcesToRag(db, scope, kit.id);
        const hits = await hybridSearch(db, scope, query, {
          kitId: kit.id,
          kinds: ["source_chunk"],
          limit: 5,
        });
        return hits.length
          ? hits.map((h) => ({
              title: h.title,
              excerpt: h.content,
              score: h.score,
            }))
          : "No Kit source documents matched.";
      },
    }),
  };

  if (opts.enableWebResearch) {
    tools.web_research = tool({
      description:
        "Search the public web for up-to-date facts, benchmarks, specifications, or primary documentation when the learner's notes and Kit sources do not cover it.",
      inputSchema: z.object({
        query: z.string().describe("Concise web search query"),
      }),
      execute: async ({ query }) => {
        const res = await runWebResearch({
          scope,
          query,
          signal: opts.abortSignal,
        });
        if (res.citations.length > 0) {
          opts.onCitations?.(res.citations);
        }
        return {
          summary: res.summary || "No web results found.",
          citations: res.citations,
        };
      },
    });
  }

  return tools;
}

async function extractEpisodicMemories({
  scope,
  kitId,
  model,
  history,
  message,
  generatedText,
}: {
  scope: Scope;
  kitId: string;
  model?: string;
  history: StoredMessage[];
  message: string;
  generatedText: string;
}): Promise<void> {
  const transcript = toModelMessages(history)
    .map((m) => `${m.role}: ${String(m.content)}`)
    .join("\n");

  const prompt = `You are the autonomous memory manager for this learner.
Analyze the following latest interaction. Extract ANY new, highly important episodic learning events (struggles, analogies that clicked, specific facts mastered).
Only return events that are worth remembering long-term. Return an empty list when nothing qualifies.

Chat History:
${transcript}
user: ${message}
model: ${generatedText}`;

  const { events } = await runStructured<{
    events: Array<{ memory_text: string; importance_score: number }>;
  }>({
    model,
    scope,
    capability: "quick",
    prompt,
    schema: z.object({
      events: z.array(
        z.object({
          memory_text: z
            .string()
            .describe("A concise description of the learning event"),
          importance_score: z
            .number()
            .describe("Importance score from 1 to 10"),
        }),
      ),
    }),
    feature: "chat/memory",
  });

  const ins = db.prepare(
    "INSERT INTO episodic_memory (ownerId, kit_id, memory_text, importance_score, embedding, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))",
  );
  for (const ev of events || []) {
    const embedding = await generateEmbedding(ev.memory_text);
    const info = ins.run(
      scope.ownerId,
      kitId,
      ev.memory_text,
      ev.importance_score,
      JSON.stringify(embedding),
    );
    await upsertRagChunk(db, scope, {
      kitId,
      kind: "episodic",
      sourceRefId: String(info.lastInsertRowid),
      title: "Episodic Memory",
      content: ev.memory_text,
    });
  }
  if (events?.length) {
    logger.info(
      `[chat/memory] Extracted ${events.length} episodic memories.`,
    );
  }
}

router.post("/stream", async (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    message,
    context,
    history = [],
    model,
    webResearch,
  } = req.body as {
    message?: string;
    context?: string;
    history?: StoredMessage[];
    model?: string;
    webResearch?: boolean;
  };

  if (!message) {
    res.status(400).json({ message: "Message is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const abortController = new AbortController();
  res.on("close", () => abortController.abort());

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(": ping\n\n");
  }, 15_000);

  try {
    const profileRow = db
      .prepare(
        "SELECT profile_text FROM user_learning_profile WHERE ownerId = ?",
      )
      .get(scope.ownerId) as { profile_text: string } | undefined;
    const userProfile = profileRow?.profile_text || "";

    await syncDomainSourcesToRag(db, scope, kit.id);
    const episodicHits = await hybridSearch(db, scope, message, {
      kitId: kit.id,
      kinds: ["episodic"],
      limit: 5,
    });
    const topEpisodes = episodicHits.map((h) => h.content);

    const enableWebResearch =
      typeof webResearch === "boolean"
        ? webResearch
        : Boolean(kit.skeleton.capabilities?.webResearchDefault);

    let system = tutorSystemPrompt(kit.skeleton.tutor.rolePrompt, context);
    system += `\n\nThe learner's flashcards, study guide notes, and Kit reference sources live in a hybrid search index. Use search_flashcards, search_guide, and search_kit_sources whenever an answer should build on their material.${enableWebResearch ? " Use web_research when up-to-date external facts or primary sources are needed." : ""}`;
    if (userProfile) {
      system += `\n\n[User Profile]:\n${userProfile}`;
    }
    if (topEpisodes.length > 0) {
      system +=
        `\n\n[Relevant Past Learning Episodes]:\n` +
        topEpisodes.map((t) => `- ${t}`).join("\n");
    }

    const messages: ModelMessage[] = [
      ...toModelMessages(history),
      { role: "user", content: message },
    ];

    const { result, modelId } = chatStream({
      model,
      scope,
      capability: "deep",
      system,
      messages,
      tools: buildStudyTools(scope, kit, {
        enableWebResearch,
        abortSignal: abortController.signal,
        onCitations: (citations) => {
          if (!res.writableEnded) {
            res.write(`data: ${JSON.stringify({ citations })}\n\n`);
          }
        },
      }),
      abortSignal: abortController.signal,
    });

    let generatedText = "";
    for await (const part of result.fullStream) {
      if (res.writableEnded) break;
      if (part.type === "text-delta" && part.text) {
        generatedText += part.text;
        res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`);
      } else if (part.type === "tool-call") {
        res.write(
          `data: ${JSON.stringify({ tool: `Running ${part.toolName}...` })}\n\n`,
        );
      } else if (part.type === "error") {
        const detail =
          part.error instanceof Error
            ? part.error.message
            : String(part.error);
        res.write(`data: ${JSON.stringify({ error: detail })}\n\n`);
      } else if (part.type === "finish") {
        const usage = part.totalUsage;
        logger.info(
          `[ai] chat/stream model=${modelId} finish=${part.finishReason} ` +
            `in=${usage?.inputTokens ?? "?"} out=${usage?.outputTokens ?? "?"}`,
        );
      }
    }

    if (!res.writableEnded) {
      res.write("data: [DONE]\n\n");
      res.end();
    }

    if (!abortController.signal.aborted && generatedText) {
      extractEpisodicMemories({
        scope,
        kitId: kit.id,
        model,
        history,
        message,
        generatedText,
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("[chat/memory] Error:", { error: msg });
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/stream] Error:", { error: msg });
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: msg })}\n\n`);
      res.end();
    }
  } finally {
    clearInterval(heartbeat);
  }
});

router.post("/generate-flashcards", async (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    text,
    topicName,
    model,
    sessionContext,
    sections,
    pillarId,
    topicId,
  } = req.body as {
    text?: string;
    topicName?: string;
    model?: string;
    sessionContext?: string;
    sections?: Array<{ sectionId: string; sectionName: string; content: string }>;
    pillarId?: string;
    topicId?: string;
  };

  if (!text && (!sections || sections.length === 0)) {
    res
      .status(400)
      .json({ message: "Text or sections are required to generate flashcards." });
    return;
  }

  try {
    let contextBlock = "";
    if (sessionContext) {
      contextBlock = `\n\nFor additional context, this text comes from a study session about "${topicName || kit.skeleton.identity.name}". Here is some surrounding conversation context:\n--- SESSION CONTEXT ---\n${sessionContext}\n--- END CONTEXT ---\nUse this context ONLY to better understand the concepts — the flashcard content should primarily come from the source text below.\n`;
    }

    const sectionAware = Boolean(sections && sections.length > 0);
    const sourceBlock = sectionAware
      ? sections!
          .map(
            (s) =>
              `=== SECTION: "${s.sectionName}" (id: "${s.sectionId}") ===\n${s.content}`,
          )
          .join("\n\n---\n\n")
      : (text ?? "");

    const sectionAwareInstructions = sectionAware
      ? `\n7. TAG EACH CARD with the section it came from using sourceSectionId and sourceSectionName fields. Use the exact section id and name provided above.
8. Generate cards from EACH section that has substantive content. Aim for 2-4 cards per section, but skip sections with insufficient depth.`
      : "";

    const prompt = `You are an expert flashcard creator for ${kit.skeleton.identity.name} study.

Generate high-yield flashcards from the source text below${topicName ? ` (topic: "${topicName}")` : ""}.
${contextBlock}
CARD FORMAT RULES (strictly follow):
1. FRONT (Question): Maximum 1-2 concise lines. Specific, testable question or concept.
2. BACK (Answer): Maximum 2-3 dense lines. Capture essential knowledge with precise terminology, key thresholds, tradeoffs, or concrete examples. No fluff.
3. Each card should test ONE specific concept — never bundle multiple ideas.
4. Prioritize cards that test understanding of WHY and WHEN, not just WHAT.
5. Do NOT generate more than 10 cards total. If the text is short (1-3 sentences), generate 1-2 cards maximum.
6. The content should primarily come from the source text.${sectionAwareInstructions}

Source material:
${sourceBlock}`;

    const baseElement = z.object({
      front: z
        .string()
        .describe("The front of the flashcard: a concise 1-2 line question"),
      back: z
        .string()
        .describe("The back of the flashcard: a dense 2-3 line answer"),
    });
    const element = sectionAware
      ? baseElement.extend({
          sourceSectionId: z
            .string()
            .describe("The section id this card was generated from"),
          sourceSectionName: z
            .string()
            .describe("The section name this card was generated from"),
        })
      : baseElement;

    let cards = await runStructured<Array<Record<string, unknown>>>({
      model,
      scope,
      capability: "quick",
      prompt,
      element,
      feature: "chat/flashcards",
    });

    if (pillarId || topicId) {
      cards = cards.map((card) => ({
        ...card,
        sourcePillarId: pillarId || null,
        sourceTopicId: topicId || null,
      }));
    }

    res.json({ cards });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/generate-flashcards] Error:", { error: msg });
    res
      .status(500)
      .json({ message: msg || "Failed to generate flashcards." });
  }
});

router.post("/generate-reverse-cards", async (req, res) => {
  const scope = scopeOf(req);
  const { cards, model } = req.body as {
    cards?: Array<{ front: string; back: string }>;
    model?: string;
  };
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    res.status(400).json({ message: "Cards array is required." });
    return;
  }

  try {
    const cardList = cards
      .map((c, i) => `[Card ${i}]\nQ: ${c.front}\nA: ${c.back}`)
      .join("\n\n");

    const prompt = `You are an expert flashcard creator. Given the flashcards below, generate ONE reverse card for each that tests the SAME concept from a different angle or retrieval pathway.

RULES:
1. The reverse card must test the same knowledge from a different direction.
2. Do NOT simply swap front and back — create a NEW question approaching the concept differently.
3. Keep the same format: 1-2 line question, 2-3 line answer.
4. The originalIndex field must be the [Card N] index number from the input.

--- FLASHCARDS ---
${cardList}
--- END ---

Generate one reverse card per input card.`;

    const reverseCards = await runStructured({
      model,
      scope,
      capability: "quick",
      prompt,
      element: z.object({
        front: z.string().describe("Reverse question"),
        back: z.string().describe("Answer for the reverse question"),
        originalIndex: z
          .number()
          .int()
          .describe("Index of the original card this reverses"),
      }),
      feature: "chat/reverse-cards",
    });

    res.json({ reverseCards });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/generate-reverse-cards] Error:", { error: msg });
    res
      .status(500)
      .json({ message: msg || "Failed to generate reverse cards." });
  }
});

router.post("/summarize", async (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    excerpts = [],
    sectionId,
    sectionName,
    topicName,
    model,
  } = req.body as {
    excerpts?: string[];
    sectionId?: string;
    sectionName?: string;
    topicName?: string;
    model?: string;
  };

  if (!excerpts.length || !sectionId) {
    res.status(400).json({ message: "excerpts and sectionId are required" });
    return;
  }

  try {
    const excerptText = excerpts.join("\n\n---\n\n");
    const prompt = `You are a technical writing assistant helping compile a ${kit.skeleton.identity.name} study guide.

The learner has been studying "${topicName || "this topic"}" — specifically the section "${sectionName || sectionId}".

Below are excerpts from their AI-assisted study conversation. Extract and synthesize ONLY the key insights, definitions, patterns, tradeoffs, and concrete examples directly relevant to this section. Discard conversational filler.

Format as clean, dense markdown suitable for a study reference guide (## headers, bullet points, inline backticks, **bold** key terms).

--- CONVERSATION EXCERPTS ---
${excerptText}
--- END EXCERPTS ---

Now write the guide section content:`;

    const content = await runText({
      model,
      scope,
      capability: "deep",
      prompt,
      feature: "chat/summarize",
    });
    res.json({ content });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/summarize] Error:", { error: msg });
    res.status(500).json({ message: msg || "Failed to summarize." });
  }
});

router.post("/evaluate-interceptor", async (req, res) => {
  const scope = scopeOf(req);
  const { explanation, front, back, model } = req.body as {
    explanation?: string;
    front?: string;
    back?: string;
    model?: string;
  };

  if (!explanation || !front || !back) {
    res
      .status(400)
      .json({ message: "explanation, front, and back are required" });
    return;
  }

  try {
    const prompt = `You are a rigorous, anti-sycophancy learning evaluator. The learner was asked a flashcard question and must explain WHY the answer is true to prove genuine understanding rather than pattern-matching.

Question: ${front}
Canonical Answer: ${back}

Learner's Explanation: "${explanation}"

Follow this strict falsification-first evaluation order:
1. Extract every distinct factual or causal claim made by the learner in extractedClaims.
2. Actively look for any factual inaccuracies, inverted causal logic, missing core mechanisms, or hand-waving in factualOrLogicalErrors (leave empty ONLY when the explanation is genuinely sound).
3. Write 1-2 sentences of specific, constructive feedback.
4. Set pass = true ONLY if factualOrLogicalErrors is empty AND the learner explained the core mechanism.`;

    let responsePayload: {
      pass: boolean;
      feedback: string;
      extractedClaims: string[];
      factualOrLogicalErrors: string[];
    };
    try {
      const evaluation = await runStructured<{
        extractedClaims: string[];
        factualOrLogicalErrors: string[];
        feedback: string;
        pass: boolean;
      }>({
        model,
        scope,
        capability: "quick",
        prompt,
        schema: z.object({
          extractedClaims: z
            .array(z.string())
            .describe(
              "Distinct factual or causal claims stated in the learner's explanation.",
            ),
          factualOrLogicalErrors: z
            .array(z.string())
            .describe(
              "Any factual mistakes, logical contradictions, or missing essential mechanisms. Empty array only if completely sound.",
            ),
          feedback: z
            .string()
            .describe(
              "1-2 concise sentences explaining why the explanation passed or what was flawed.",
            ),
          pass: z
            .boolean()
            .describe(
              "True only when factualOrLogicalErrors is empty and the core mechanism is explained.",
            ),
        }),
        feature: "chat/evaluate",
      });
      const finalPass =
        evaluation.pass && evaluation.factualOrLogicalErrors.length === 0;
      responsePayload = {
        pass: finalPass,
        feedback: evaluation.feedback,
        extractedClaims: evaluation.extractedClaims,
        factualOrLogicalErrors: evaluation.factualOrLogicalErrors,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[chat/evaluate-interceptor] Evaluation failed:", {
        error: msg,
      });
      responsePayload = {
        pass: false,
        feedback: "Error evaluating response format.",
        extractedClaims: [],
        factualOrLogicalErrors: [],
      };
    }

    res.json(responsePayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/evaluate-interceptor] Error:", { error: msg });
    res.status(500).json({ message: "Failed to evaluate." });
  }
});

router.post("/concept-map", async (req, res) => {
  const scope = scopeOf(req);
  const { history = [], model } = req.body as {
    history?: StoredMessage[];
    model?: string;
  };

  if (!history || history.length === 0) {
    res.status(400).json({ message: "History is required to generate a map." });
    return;
  }

  try {
    const historyText = history
      .map((msg) => `${msg.role}: ${msg.content}`)
      .join("\n\n");

    const prompt = `You are an expert educational visualizer. Extract the key concepts, entities, and their relationships from the following chat history.
Your output MUST be a valid, syntactically correct \`mermaid\` graph definition (e.g. \`graph TD\`).
Use concise node labels and relationship labels. Only output the markdown block containing the mermaid code.

Chat History:
${historyText}`;

    let responseText = await runText({
      model,
      scope,
      capability: "quick",
      prompt,
      feature: "chat/concept-map",
    });

    if (!responseText.includes("```mermaid")) {
      responseText = `\`\`\`mermaid\n${responseText.replace(/```/g, "")}\n\`\`\``;
    }

    res.json({ response: responseText });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/concept-map] Error:", { error: msg });
    res
      .status(500)
      .json({ message: msg || "Failed to generate concept map." });
  }
});

router.post("/commit", async (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    messages = [],
    pillarId,
    topicId,
    topicName,
    model,
    targetSectionIds = [],
  } = req.body as {
    messages?: StoredMessage[];
    pillarId?: string;
    topicId?: string;
    topicName?: string;
    model?: string;
    targetSectionIds?: string[];
  };

  if (!messages.length || !pillarId || !topicId) {
    res
      .status(400)
      .json({ message: "messages, pillarId, and topicId are required" });
    return;
  }

  const pillar = kit.skeleton.pillars.find((p) => p.id === pillarId);
  let sections = pillar?.sections || [];
  if (sections.length === 0) {
    res.status(400).json({
      message: `No blueprint sections found for pillar "${pillarId}"`,
    });
    return;
  }

  if (targetSectionIds.length > 0) {
    sections = sections.filter((s) => targetSectionIds.includes(s.id));
  }

  try {
    const numberedMessages = messages.map(
      (m, i) =>
        `[MSG ${i}][${m.role === "ai" ? "Tutor" : "Student"}]: ${m.content}`,
    );
    const conversationText = numberedMessages.join("\n\n");

    const existingContentMap: Record<string, string> = {};
    for (const sec of sections) {
      const row = db
        .prepare(
          "SELECT content FROM guide_content WHERE ownerId = ? AND kit_id = ? AND pillar_id = ? AND topic_id = ? AND section_id = ?",
        )
        .get(scope.ownerId, kit.id, pillarId, topicId, sec.id) as
        | { content: string }
        | undefined;
      existingContentMap[sec.id] = row?.content?.trim() || "";
    }

    const existingContentBlock = sections
      .filter((s) => existingContentMap[s.id])
      .map(
        (s) => `### ${s.name} (id: "${s.id}"):\n${existingContentMap[s.id]}`,
      )
      .join("\n\n---\n\n");

    const sectionList = sections
      .map((s) => {
        const status = existingContentMap[s.id]
          ? "HAS EXISTING CONTENT — merge new learnings"
          : "EMPTY — create from scratch";
        return `- "${s.id}": ${s.name} [${status}]`;
      })
      .join("\n");

    const ownershipRules = sections
      .map(
        (s) =>
          `   - "${s.name}" (${s.id}): ${s.ownershipRule || s.promptHint || "Owns material directly addressing this section."}`,
      )
      .join("\n");

    let taskDescription =
      'TASK: Analyze the conversation below and produce updated guide content for EACH section that was substantively discussed.';
    let inclusionRule =
      "1. Only include sections that were SUBSTANTIVELY discussed with real depth.";

    if (targetSectionIds.length > 0) {
      taskDescription = `TASK: Analyze the conversation below and produce updated guide content SPECIFICALLY for the following selected sections: ${targetSectionIds.join(", ")}.`;
      inclusionRule =
        "1. You MUST generate content for ALL the requested sections based on whatever was discussed.";
    }

    const prompt = `You are a technical editor compiling guide content for a ${kit.skeleton.identity.name} study guide.

Topic: "${topicName || topicId}"

${taskDescription}

AVAILABLE SECTIONS:
${sectionList}

${existingContentBlock ? `EXISTING GUIDE CONTENT (preserve accurate existing knowledge and merge new learnings into it):\n${existingContentBlock}\n` : ""}CRITICAL RULES:
${inclusionRule}
2. For sections with existing content, your newContent must be the COMPLETE MERGED result.
3. For empty sections, create content ONLY from what was discussed in the conversation.
4. MUTUAL EXCLUSIVITY: Each fact, example, or tradeoff belongs in exactly ONE section according to these ownership rules:
${ownershipRules}
5. Format as clean, dense markdown (## headers, bullet points, inline backticks, **bold** key terms).

--- CONVERSATION ---
${conversationText}
--- END CONVERSATION ---

Return the targeted sections with their complete updated content.`;

    let identifiedSections: Array<{
      sectionId: string;
      reason: string;
      newContent: string;
    }>;
    try {
      const parsed = await runStructured<{
        sections: Array<{
          sectionId: string;
          reason: string;
          newContent: string;
        }>;
      }>({
        model,
        scope,
        capability: "deep",
        prompt,
        schema: z.object({
          sections: z.array(
            z.object({
              sectionId: z
                .string()
                .describe("The section id from the provided list"),
              reason: z
                .string()
                .describe("Brief reason why this section was covered"),
              newContent: z
                .string()
                .describe("The complete updated section content in markdown"),
            }),
          ),
        }),
        maxOutputTokens: 16384,
        feature: "chat/commit",
      });
      identifiedSections = parsed.sections || [];
    } catch (parseErr) {
      const msg =
        parseErr instanceof Error ? parseErr.message : String(parseErr);
      logger.error("[chat/commit] Analysis failed:", { error: msg });
      res
        .status(500)
        .json({ message: msg || "Failed to analyze conversation sections." });
      return;
    }

    const validSectionIds = new Set(sections.map((s) => s.id));
    identifiedSections = identifiedSections.filter((s) =>
      validSectionIds.has(s.sectionId),
    );

    if (identifiedSections.length === 0) {
      res.json({ updates: [] });
      return;
    }

    const updates = identifiedSections
      .map((identified) => {
        const section = sections.find((s) => s.id === identified.sectionId);
        const existingContent = existingContentMap[identified.sectionId] || "";
        return {
          sectionId: identified.sectionId,
          sectionName: section?.name || identified.sectionId,
          reason: identified.reason,
          existingContent,
          newContent: identified.newContent,
          isNew: !existingContent,
        };
      })
      .filter((u) => u.newContent && u.newContent.trim());

    res.json({ updates });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/commit] Error:", { error: msg });
    res
      .status(500)
      .json({ message: "Failed to analyze session. Please try again." });
  }
});

router.post("/commit/save", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const {
    pillarId,
    topicId,
    updates = [],
  } = req.body as {
    pillarId?: string;
    topicId?: string;
    updates?: Array<{ sectionId?: string; content?: string }>;
  };

  if (!pillarId || !topicId || updates.length === 0) {
    res
      .status(400)
      .json({ message: "pillarId, topicId, and updates are required" });
    return;
  }

  try {
    const upsertStmt = db.prepare(
      `INSERT INTO guide_content (ownerId, kit_id, pillar_id, topic_id, section_id, content, committed_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId, kit_id, pillar_id, topic_id, section_id)
       DO UPDATE SET content = excluded.content, committed_at = excluded.committed_at`,
    );

    const saveAll = db.transaction(
      (items: Array<{ sectionId?: string; content?: string }>) => {
        let count = 0;
        for (const item of items) {
          if (item.sectionId && item.content) {
            upsertStmt.run(
              scope.ownerId,
              kit.id,
              pillarId,
              topicId,
              item.sectionId,
              item.content,
            );
            count++;
          }
        }
        return count;
      },
    );

    const savedCount = saveAll(updates);
    const ragInputs = updates
      .filter((u): u is { sectionId: string; content: string } =>
        Boolean(u.sectionId && u.content?.trim()),
      )
      .map((u) => ({
        kitId: kit.id,
        kind: "guide" as const,
        sourceRefId: `${pillarId}:${topicId}:${u.sectionId}`,
        title: `${topicId} — ${u.sectionId}`,
        content: u.content,
      }));
    if (ragInputs.length > 0) {
      void upsertRagChunksBatch(db, scope, ragInputs).catch((err: unknown) => {
        logger.warn("[chat/commit/save] Deferred RAG sync:", {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    res.json({ ok: true, savedCount });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/commit/save] Error:", { error: msg });
    res.status(500).json({ message: "Failed to save guide updates." });
  }
});

router.get("/sessions", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  try {
    const rows = db
      .prepare(
        "SELECT * FROM chat_sessions WHERE ownerId = ? AND kit_id = ? ORDER BY updated_at DESC",
      )
      .all(scope.ownerId, kit.id) as Array<{
      id: string;
      name: string;
      created_at: string;
      messages: string;
      pillar_id: string | null;
      topic_id: string | null;
      topic_name: string | null;
    }>;
    const sessions: Record<string, unknown> = {};
    for (const r of rows) {
      sessions[r.id] = {
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        messages: JSON.parse(r.messages || "[]"),
        pillarId: r.pillar_id,
        topicId: r.topic_id,
        topicName: r.topic_name,
      };
    }
    res.json(sessions);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/sessions] Error:", { error: msg });
    res.status(500).json({ message: "Failed to fetch sessions." });
  }
});

interface IncomingChatSession {
  id?: string;
  name?: string;
  messages?: unknown[];
  pillarId?: string | null;
  topicId?: string | null;
  topicName?: string | null;
  createdAt?: string;
}

router.post("/sessions", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { session } = req.body as { session?: IncomingChatSession };
  if (!session || !session.id) {
    res.status(400).json({ message: "Session required" });
    return;
  }

  try {
    db.prepare(
      `INSERT INTO chat_sessions (id, ownerId, kit_id, name, messages, pillar_id, topic_id, topic_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId, id) DO UPDATE SET
         name = excluded.name,
         messages = excluded.messages,
         pillar_id = excluded.pillar_id,
         topic_id = excluded.topic_id,
         topic_name = excluded.topic_name,
         updated_at = datetime('now')`,
    ).run(
      session.id,
      scope.ownerId,
      kit.id,
      session.name || "Session",
      JSON.stringify(session.messages || []),
      session.pillarId || null,
      session.topicId || null,
      session.topicName || null,
      session.createdAt || new Date().toISOString(),
    );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/sessions] POST Error:", { error: msg });
    res.status(500).json({ message: "Failed to save session." });
  }
});

router.post("/sessions/bulk", (req, res) => {
  const scope = scopeOf(req);
  const kit = resolveActiveKit(req, db, scope);
  const { sessions } = req.body as {
    sessions?: Record<string, IncomingChatSession>;
  };
  if (!sessions || typeof sessions !== "object") {
    res.status(400).json({ message: "Sessions object required" });
    return;
  }

  try {
    const insert = db.prepare(
      `INSERT INTO chat_sessions (id, ownerId, kit_id, name, messages, pillar_id, topic_id, topic_name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(ownerId, id) DO UPDATE SET
         name = excluded.name,
         messages = excluded.messages,
         pillar_id = excluded.pillar_id,
         topic_id = excluded.topic_id,
         topic_name = excluded.topic_name,
         updated_at = datetime('now')`,
    );
    const transaction = db.transaction(
      (sessObj: Record<string, IncomingChatSession>) => {
        for (const id of Object.keys(sessObj)) {
          const s = sessObj[id];
          if (!s?.id) continue;
          insert.run(
            s.id,
            scope.ownerId,
            kit.id,
            s.name || "Session",
            JSON.stringify(s.messages || []),
            s.pillarId || null,
            s.topicId || null,
            s.topicName || null,
            s.createdAt || new Date().toISOString(),
          );
        }
      },
    );
    transaction(sessions);
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/sessions/bulk] Error:", { error: msg });
    res.status(500).json({ message: "Failed to save sessions in bulk." });
  }
});

router.delete("/sessions/:id", (req, res) => {
  const scope = scopeOf(req);
  try {
    db.prepare("DELETE FROM chat_sessions WHERE ownerId = ? AND id = ?").run(
      scope.ownerId,
      req.params.id,
    );
    res.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[chat/sessions] DELETE Error:", { error: msg });
    res.status(500).json({ message: "Failed to delete session." });
  }
});

export default router;
