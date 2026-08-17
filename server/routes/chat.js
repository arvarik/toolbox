import { Router } from 'express'
import crypto from 'crypto'
import { tool } from 'ai'
import { z } from 'zod'
import db from '../db.js'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../src/utils/constants.js'
import logger from '../utils/logger.js'
import { generateEmbedding, cosineSimilarity } from '../utils/embeddings.js'
import { runText, runStructured, chatStream } from '../ai/engine.js'

const router = Router()

// ═══════════════════════════════════════════════════════════════
// Shared helpers
// ═══════════════════════════════════════════════════════════════

/** Map stored chat history roles ('ai'/'model') to AI SDK messages. */
function toModelMessages(history) {
  return (history || [])
    .filter((msg) => typeof msg?.content === 'string' && msg.content.trim() !== '')
    .map((msg) => ({
      role: msg.role === 'ai' || msg.role === 'model' ? 'assistant' : 'user',
      content: msg.content,
    }))
}

/**
 * Rank rows by cosine similarity between a query embedding and each
 * row's stored embedding (a JSON array string). Returns the top N rows.
 */
function rankBySimilarity(queryEmbedding, rows, topN) {
  return rows
    .map((row) => {
      let sim = 0
      try {
        if (row.embedding) sim = cosineSimilarity(queryEmbedding, JSON.parse(row.embedding))
      } catch {
        // Unreadable embedding — treat as unrelated
      }
      return { ...row, sim }
    })
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topN)
}

/** Base tutor persona shared by the chat routes. */
function tutorSystemPrompt(context) {
  return context
    ? `You are an expert system design interview tutor. Context: ${context}`
    : 'You are an expert system design interview tutor helping a student prepare for system design interviews.'
}

// ═══════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════

/**
 * GET /api/chat/starters
 * Generate dynamic chat starters based on a specific topic's guide content, blueprint, and user profile.
 * Query: ?pillarId=X&topicId=Y&topicName=Z&model=...
 */
router.get('/starters', async (req, res) => {
  const { pillarId, topicId, topicName, model } = req.query

  if (!pillarId || !topicId) {
    return res.status(400).json({ message: 'pillarId and topicId are required' })
  }

  try {
    // 1. Fetch blueprint context
    const pillar = PILLARS.find(p => p.id === pillarId) || { name: pillarId, topics: [] }
    const topic = pillar.topics.find(t => t.id === topicId) || { name: topicName || topicId }
    const blueprint = BLUEPRINT_SECTIONS[pillarId] || []

    // 2. Fetch current guide content for this topic
    const rows = db.prepare('SELECT section_id, content FROM guide_content WHERE pillar_id = ? AND topic_id = ?').all(pillarId, topicId)

    // 3. Separate completed vs missing sections
    const completedSections = []
    const missingSections = []

    blueprint.forEach(sec => {
      const row = rows.find(r => r.section_id === sec.id)
      if (row && row.content && row.content.trim().length > 0) {
        completedSections.push({ name: sec.name, content: row.content })
      } else {
        missingSections.push({ name: sec.name })
      }
    })

    // If no blueprint is defined, just use raw content
    if (blueprint.length === 0) {
      rows.forEach(r => completedSections.push({ name: r.section_id, content: r.content }))
    }

    // 4. Fetch User Profile / Shadow Memory
    const profileRow = db.prepare("SELECT profile_text FROM user_profile WHERE id = 1").get()
    const userProfile = profileRow?.profile_text || ""

    // 5. Compute a rich hash for cache invalidation
    const hashData = JSON.stringify({
      completed: completedSections,
      missing: missingSections,
      profile: userProfile,
      blueprintCount: blueprint.length
    })
    const contentHash = crypto.createHash('md5').update(hashData).digest('hex')

    // 6. Check cache
    const cached = db.prepare('SELECT suggestions, content_hash FROM chat_starters WHERE pillar_id = ? AND topic_id = ?').get(pillarId, topicId)

    if (cached && cached.content_hash === contentHash && cached.suggestions !== '[]') {
      try {
        const parsed = JSON.parse(cached.suggestions)
        if (Array.isArray(parsed) && parsed.length > 0) {
          const shuffled = [...parsed].sort(() => 0.5 - Math.random())
          return res.json({ suggestions: shuffled.slice(0, 6) })
        }
      } catch {
        // Cache invalid, fall through to regenerate
      }
    }

    // 7. Cache missing or stale — generate new ones
    const prompt = `You are an expert system design tutor creating contextual chat starters.
The user is studying the topic: "${topic.name}" (Part of the "${pillar.name}" pillar).

Here is the required study blueprint for this topic:
${blueprint.map(b => `- ${b.name}`).join('\n')}

The user has already taken notes on these sections:
${completedSections.length > 0 ? completedSections.map(s => `- ${s.name}:\n  ${s.content.substring(0, 500)}...`).join('\n') : "None."}

The user has NOT yet covered these sections:
${missingSections.length > 0 ? missingSections.map(s => `- ${s.name}`).join('\n') : "None."}

User Profile / Shadow Memory (tailor your suggestions if this is relevant):
${userProfile || "No profile available yet."}

Based on this state, generate 12 to 15 highly targeted starter questions the user could click to continue their study session.
- If they have covered some sections, suggest questions that bridge the gap to the missing sections, or challenge their understanding of what they've written.
- If they are starting fresh, suggest questions to tackle the most important introductory sections.
- Tailor the questions to their user profile if relevant (e.g. focusing on their weak points or upcoming interviews).
- Format as short, actionable questions they would ask YOU (e.g. "Can you quiz me on [X]?", "How does [X] handle [Y] failure mode?").`

    let suggestions
    try {
      suggestions = await runStructured({
        model,
        prompt,
        element: z.string().describe('A short, engaging study question for the user to ask the AI'),
        feature: 'chat/starters',
      })
      if (!Array.isArray(suggestions) || suggestions.length === 0) {
        throw new Error('Empty suggestions')
      }
    } catch {
      suggestions = ["Let's do a deep dive on this topic", "Test my knowledge on this topic"]
    }

    // Save to DB (save all generated prompts)
    db.prepare(`
      INSERT INTO chat_starters (pillar_id, topic_id, suggestions, content_hash, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(pillar_id, topic_id) DO UPDATE SET
        suggestions = excluded.suggestions,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(pillarId, topicId, JSON.stringify(suggestions), contentHash)

    // Return a random selection of 6 prompts
    const shuffled = [...suggestions].sort(() => 0.5 - Math.random())
    res.json({ suggestions: shuffled.slice(0, 6) })
  } catch (err) {
    logger.error('[chat/starters] Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to generate starters.' })
  }
})

/**
 * POST /api/chat
 * Send a message and get a response (non-streaming).
 * Body: { message, context, history, model }
 */
router.post('/', async (req, res) => {
  const { message, context, history = [], model } = req.body

  if (!message) {
    return res.status(400).json({ message: 'Message is required' })
  }

  try {
    const response = await runText({
      model,
      system: tutorSystemPrompt(context),
      messages: [...toModelMessages(history), { role: 'user', content: message }],
      feature: 'chat',
    })
    res.json({ response })
  } catch (err) {
    logger.error('[chat] Error:', { error: err.message })
    res.status(500).json({ message: err.message || 'Failed to get AI response.' })
  }
})

// ─── Streaming chat with tools ────────────────────────────────────────────────

/** Tool set for the streaming chat: just-in-time retrieval from the DB. */
function buildChatTools() {
  return {
    search_flashcards: tool({
      description:
        "Search the user's flashcards by meaning. Use this to see what the user has learned, quiz them on their own cards, or check what they struggle with.",
      inputSchema: z.object({
        query: z.string().describe('Search query for flashcards'),
      }),
      execute: async ({ query }) => {
        const queryEmbedding = await generateEmbedding(query)
        const rows = db.prepare('SELECT front, back, state, ease_factor, embedding FROM flashcards').all()
        if (queryEmbedding.length === 0) {
          return rows.slice(0, 5).map(({ front, back, state, ease_factor }) => ({ front, back, state, ease_factor }))
        }
        const top = rankBySimilarity(queryEmbedding, rows, 5)
          .map(({ front, back, state, ease_factor }) => ({ front, back, state, ease_factor }))
        return top.length ? top : 'No flashcards found.'
      },
    }),
    search_guide: tool({
      description:
        "Search the user's system design guide notes by meaning. Use this to ground answers in what the user has already written.",
      inputSchema: z.object({
        query: z.string().describe('Topic to search for in the guide'),
      }),
      execute: async ({ query }) => {
        const queryEmbedding = await generateEmbedding(query)
        const rows = db.prepare("SELECT content, embedding FROM guide_content WHERE content != ''").all()
        if (queryEmbedding.length === 0) {
          return rows.slice(0, 3).map((r) => r.content)
        }
        const top = rankBySimilarity(queryEmbedding, rows, 3).map((r) => r.content)
        return top.length ? top : 'No guide content found.'
      },
    }),
  }
}

/**
 * Extract long-term episodic memories from a finished chat turn.
 * Runs after the response streamed; failures only log.
 */
async function extractEpisodicMemories({ model, history, message, generatedText }) {
  const transcript = toModelMessages(history)
    .map((m) => `${m.role}: ${m.content}`)
    .join('\n')

  const prompt = `You are the autonomous memory manager for this user.
Analyze the following latest interaction. Extract ANY new, highly important episodic learning events (struggles, analogies that clicked, specific facts mastered).
Only return events that are worth remembering long-term. Return an empty list when nothing qualifies.

Chat History:
${transcript}
user: ${message}
model: ${generatedText}`

  const { events } = await runStructured({
    model,
    prompt,
    schema: z.object({
      events: z.array(
        z.object({
          memory_text: z.string().describe('A concise description of the learning event'),
          importance_score: z.number().describe('Importance score from 1 to 10'),
        })
      ),
    }),
    feature: 'chat/memory',
  })

  for (const ev of events || []) {
    const embedding = await generateEmbedding(ev.memory_text)
    db.prepare('INSERT INTO episodic_memory (memory_text, importance_score, embedding, created_at) VALUES (?, ?, ?, datetime(\'now\'))')
      .run(ev.memory_text, ev.importance_score, JSON.stringify(embedding))
  }
  if (events?.length) {
    logger.info(`[chat/memory] Extracted ${events.length} episodic memories.`)
  }
}

/**
 * POST /api/chat/stream
 * Stream a response via Server-Sent Events (SSE).
 * Body: { message, context, history, model }
 *
 * The system prompt stays small: persona, user profile, and the most
 * relevant episodic memories. The model retrieves flashcards and guide
 * notes just-in-time through tools instead of receiving the whole
 * database up front.
 */
router.post('/stream', async (req, res) => {
  const { message, context, history = [], model } = req.body

  if (!message) {
    return res.status(400).json({ message: 'Message is required' })
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  // Cancel the upstream model call when the client disconnects.
  const abortController = new AbortController()
  res.on('close', () => abortController.abort())

  // Comment heartbeat keeps proxies from closing an idle stream.
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n')
  }, 15_000)

  try {
    // Relevant long-term context only: profile + top episodic memories.
    const profileRow = db.prepare('SELECT profile_text FROM user_profile WHERE id = 1').get()
    const userProfile = profileRow?.profile_text || ''

    const messageEmbedding = await generateEmbedding(message)
    let topEpisodes = []
    if (messageEmbedding.length > 0) {
      const episodes = db.prepare('SELECT memory_text, embedding FROM episodic_memory ORDER BY created_at DESC').all()
      topEpisodes = rankBySimilarity(messageEmbedding, episodes, 5).map((e) => e.memory_text)
    }

    let system = tutorSystemPrompt(context)
    system += `\n\nThe user's flashcards and guide notes live in a database. Use the search_flashcards and search_guide tools whenever an answer should build on what the user has already studied or written.`
    if (userProfile) {
      system += `\n\n[User Profile]:\n${userProfile}`
    }
    if (topEpisodes.length > 0) {
      system += `\n\n[Relevant Past Learning Episodes]:\n` + topEpisodes.map((t) => `- ${t}`).join('\n')
    }

    const messages = [...toModelMessages(history), { role: 'user', content: message }]

    const { result, modelId } = chatStream({
      model,
      system,
      messages,
      tools: buildChatTools(),
      abortSignal: abortController.signal,
    })

    let generatedText = ''
    for await (const part of result.fullStream) {
      if (res.writableEnded) break
      if (part.type === 'text-delta' && part.text) {
        generatedText += part.text
        res.write(`data: ${JSON.stringify({ text: part.text })}\n\n`)
      } else if (part.type === 'tool-call') {
        res.write(`data: ${JSON.stringify({ tool: `Running ${part.toolName}...` })}\n\n`)
      } else if (part.type === 'error') {
        const detail = part.error?.message || String(part.error)
        res.write(`data: ${JSON.stringify({ error: detail })}\n\n`)
      } else if (part.type === 'finish') {
        const usage = part.totalUsage
        logger.info(
          `[ai] chat/stream model=${modelId} finish=${part.finishReason} ` +
          `in=${usage?.inputTokens ?? '?'} out=${usage?.outputTokens ?? '?'}`
        )
      }
    }

    if (!res.writableEnded) {
      res.write('data: [DONE]\n\n')
      res.end()
    }

    // Post-response memory extraction (fire and forget).
    if (!abortController.signal.aborted && generatedText) {
      extractEpisodicMemories({ model, history, message, generatedText }).catch((err) => {
        logger.error('[chat/memory] Error:', { error: err.message })
      })
    }
  } catch (err) {
    logger.error('[chat/stream] Error:', { error: err.message })
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
      res.end()
    }
  } finally {
    clearInterval(heartbeat)
  }
})

/**
 * POST /api/chat/generate-flashcards
 * Generate flashcards from a given text and topic.
 * Body: { text, topicName, model, sessionContext, sections?, pillarId?, topicId? }
 * When `sections` is provided, generates cards per-section with source tagging.
 */
router.post('/generate-flashcards', async (req, res) => {
  const { text, topicName, model, sessionContext, sections, pillarId, topicId } = req.body

  if (!text && (!sections || sections.length === 0)) {
    return res.status(400).json({ message: 'Text or sections are required to generate flashcards.' })
  }

  try {
    // Build context section if available
    let contextBlock = ''
    if (sessionContext) {
      contextBlock = `\n\nFor additional context, this text comes from a study session about "${topicName || 'system design'}". Here is some surrounding conversation context to help you create more informed cards:\n--- SESSION CONTEXT ---\n${sessionContext}\n--- END CONTEXT ---\nUse this context ONLY to better understand the concepts — the flashcard content should primarily come from the source text below.\n`
    }

    // Build source text — either section-aware or flat
    const sectionAware = sections && sections.length > 0
    const sourceBlock = sectionAware
      ? sections.map(s => `=== SECTION: "${s.sectionName}" (id: "${s.sectionId}") ===\n${s.content}`).join('\n\n---\n\n')
      : text

    const sectionAwareInstructions = sectionAware
      ? `\n7. TAG EACH CARD with the section it came from using sourceSectionId and sourceSectionName fields. Use the exact section id and name provided above.
8. Generate cards from EACH section that has substantive content. Aim for 2-4 cards per section, but skip sections with insufficient depth.`
      : ''

    const prompt = `You are an expert flashcard creator for system design study.

Generate high-yield flashcards from the source text below${topicName ? ` (topic: "${topicName}")` : ''}.
${contextBlock}
CARD FORMAT RULES (strictly follow):
1. FRONT (Question): Maximum 1-2 concise lines. Should be a specific, testable question or a term/concept to define. Examples:
   - "What is the thundering herd problem in caching?"
   - "When should you use write-behind vs write-through caching?"
   - "What happens when a Kafka consumer group rebalances?"
2. BACK (Answer): Maximum 2-3 dense lines. Capture the essential knowledge with precise, technical language. Include key thresholds, tradeoffs, or concrete examples where relevant. No fluff.
3. Each card should test ONE specific concept — never bundle multiple ideas.
4. Prioritize cards that test understanding of WHY and WHEN, not just WHAT.
5. Do NOT generate more than 10 cards total. If the text is short (1-3 sentences), generate 1-2 cards maximum.
6. The content should primarily come from the source text. You may add minimal clarification to make answers cohesive, but do NOT invent information not present in the text.${sectionAwareInstructions}

Source material:
${sourceBlock}`

    const cardShape = {
      front: z.string().describe('The front of the flashcard: a concise 1-2 line question'),
      back: z.string().describe('The back of the flashcard: a dense 2-3 line answer'),
    }
    if (sectionAware) {
      cardShape.sourceSectionId = z.string().describe('The section id this card was generated from')
      cardShape.sourceSectionName = z.string().describe('The section name this card was generated from')
    }

    let cards = await runStructured({
      model,
      prompt,
      element: z.object(cardShape),
      feature: 'chat/flashcards',
    })

    // Attach source metadata if available
    if (pillarId || topicId) {
      cards = cards.map(card => ({
        ...card,
        sourcePillarId: pillarId || null,
        sourceTopicId: topicId || null,
      }))
    }

    res.json({ cards })
  } catch (err) {
    logger.error('[chat/generate-flashcards] Error:', { error: err.message })
    res.status(500).json({ message: err.message || 'Failed to generate flashcards.' })
  }
})

/**
 * POST /api/chat/generate-reverse-cards
 * Generate reverse (bidirectional) flashcards from existing Q&A pairs.
 * Body: { cards: [{ front, back }], model }
 */
router.post('/generate-reverse-cards', async (req, res) => {
  const { cards, model } = req.body
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ message: 'Cards array is required.' })
  }

  try {
    const cardList = cards.map((c, i) =>
      `[Card ${i}]\nQ: ${c.front}\nA: ${c.back}`
    ).join('\n\n')

    const prompt = `You are an expert flashcard creator. Given the flashcards below, generate ONE reverse card for each that tests the SAME concept from a different angle or retrieval pathway.

RULES:
1. The reverse card must test the same knowledge but from a different direction.
2. Do NOT simply swap front and back — the back (answer) is a paragraph, not a valid question.
3. Instead, create a NEW question that approaches the same concept differently:
   - If the original asks "What is X?", the reverse might ask "Which technique does Y?" or "When would you choose X over Z?"
   - If the original asks "When to use X?", the reverse might ask "What are the tradeoffs of X?"
4. Keep the same format: 1-2 line question, 2-3 line answer.
5. The originalIndex field must be the [Card N] index number from the input.

--- FLASHCARDS ---
${cardList}
--- END ---

Generate one reverse card per input card.`

    const reverseCards = await runStructured({
      model,
      prompt,
      element: z.object({
        front: z.string().describe('Reverse question'),
        back: z.string().describe('Answer for the reverse question'),
        originalIndex: z.number().int().describe('Index of the original card this reverses'),
      }),
      feature: 'chat/reverse-cards',
    })

    res.json({ reverseCards })
  } catch (err) {
    logger.error('[chat/generate-reverse-cards] Error:', { error: err.message })
    res.status(500).json({ message: err.message || 'Failed to generate reverse cards.' })
  }
})

/**
 * POST /api/chat/summarize
 * Summarize selected chat excerpts into clean guide notes for a specific blueprint section.
 * Body: { excerpts, pillarId, topicId, sectionId, sectionName, topicName, model }
 */
router.post('/summarize', async (req, res) => {
  const { excerpts = [], sectionId, sectionName, topicName, model } = req.body

  if (!excerpts.length || !sectionId) {
    return res.status(400).json({ message: 'excerpts and sectionId are required' })
  }

  try {
    const excerptText = excerpts.join('\n\n---\n\n')
    const prompt = `You are a technical writing assistant helping compile a system design study guide.

The user has been studying "${topicName || 'this topic'}" — specifically the section "${sectionName || sectionId}".

Below are excerpts from their AI-assisted study conversation. Extract and synthesize ONLY the key insights, definitions, patterns, tradeoffs, and concrete examples that are directly relevant to this section. Discard conversational filler, repeated preamble, and meta-commentary.

Format the result as clean, dense markdown suitable for a technical reference guide:
- Use ## for subsection headers when needed
- Use bullet points for lists of properties, tradeoffs, or examples
- Use backtick inline code for technical terms, thresholds, and config values
- Use **bold** for key terms on first use
- Include a brief "Interview Angles" callout at the end if relevant gotchas were discussed

IMPORTANT: Be concise. This is a study reference, not an essay.

--- CONVERSATION EXCERPTS ---
${excerptText}
--- END EXCERPTS ---

Now write the guide section content:`

    const content = await runText({ model, prompt, feature: 'chat/summarize' })
    res.json({ content })
  } catch (err) {
    logger.error('[chat/summarize] Error:', { error: err.message })
    res.status(500).json({ message: err.message || 'Failed to summarize.' })
  }
})

/**
 * POST /api/chat/evaluate-interceptor
 * Evaluates the user's explanation for the "Why?" interceptor.
 * Returns a structured JSON response { pass: boolean, feedback: string }.
 * Body: { explanation, front, back, model }
 */
router.post('/evaluate-interceptor', async (req, res) => {
  const { explanation, front, back, model } = req.body

  if (!explanation || !front || !back) {
    return res.status(400).json({ message: 'explanation, front, and back are required' })
  }

  try {
    const prompt = `You are a strict learning evaluator. The user was asked a flashcard question and must explain WHY the answer is true to prove they aren't just pattern-matching.

Question: ${front}
Answer: ${back}

User's Explanation: "${explanation}"

Evaluate their explanation.`

    let evaluation
    try {
      evaluation = await runStructured({
        model,
        prompt,
        schema: z.object({
          pass: z.boolean().describe("True if the user's explanation demonstrates an understanding of the underlying principle. False if they fail to explain the 'why', are too vague, or are incorrect."),
          feedback: z.string().describe('1-2 sentences of feedback explaining why they passed or failed, and reinforcing the correct concept.'),
        }),
        feature: 'chat/evaluate',
      })
    } catch (err) {
      logger.error('[chat/evaluate-interceptor] Evaluation failed:', { error: err.message })
      evaluation = { pass: false, feedback: 'Error evaluating response format.' }
    }

    res.json(evaluation)
  } catch (err) {
    logger.error('[chat/evaluate-interceptor] Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to evaluate.' })
  }
})

/**
 * @route POST /api/chat/concept-map
 * @description Generates a Mermaid concept map from a session history.
 */
router.post('/concept-map', async (req, res) => {
  const { history = [], model } = req.body

  if (!history || history.length === 0) {
    return res.status(400).json({ message: 'History is required to generate a map.' })
  }

  try {
    const historyText = history.map(msg => `${msg.role}: ${msg.content}`).join('\n\n')

    const prompt = `You are an expert educational visualizer. Extract the key concepts, entities, and their relationships from the following chat history.
Your output MUST be a valid, syntactically correct \`mermaid\` graph definition (e.g. \`graph TD\`).
Use concise node labels and relationship labels. Do not use complex mermaid syntax that might break rendering.
Only output the markdown block containing the mermaid code. Do not output anything else.

Example format:
\`\`\`mermaid
graph TD
  A[Concept 1] -->|relates to| B[Concept 2]
\`\`\`

Chat History:
${historyText}`

    let responseText = await runText({ model, prompt, feature: 'chat/concept-map' })

    if (!responseText.includes('```mermaid')) {
      responseText = `\`\`\`mermaid\n${responseText.replace(/```/g, '')}\n\`\`\``
    }

    res.json({ response: responseText })
  } catch (err) {
    logger.error('[chat/concept-map] Error:', { error: err.message })
    res.status(500).json({ message: err.message || 'Failed to generate concept map.' })
  }
})

// ─── Intelligent Commit Flow ──────────────────────────────────────────────────

/**
 * POST /api/chat/commit
 * Analyze a chat session against a guide topic's sections.
 */
router.post('/commit', async (req, res) => {
  const { messages = [], pillarId, topicId, topicName, model, targetSectionIds = [] } = req.body

  if (!messages.length || !pillarId || !topicId) {
    return res.status(400).json({ message: 'messages, pillarId, and topicId are required' })
  }

  let sections = BLUEPRINT_SECTIONS[pillarId]
  if (!sections || sections.length === 0) {
    return res.status(400).json({ message: `No blueprint sections found for pillar "${pillarId}"` })
  }

  if (targetSectionIds.length > 0) {
    sections = sections.filter(s => targetSectionIds.includes(s.id))
  }

  try {
    logger.info(`[chat/commit] Analyzing session for topic "${topicName}" (${pillarId}/${topicId}). ${messages.length} messages.`)

    // Number each message for reference
    const numberedMessages = messages.map((m, i) =>
      `[MSG ${i}][${m.role === 'ai' ? 'Tutor' : 'Student'}]: ${m.content}`
    )
    const conversationText = numberedMessages.join('\n\n')

    // Fetch existing content for ALL sections upfront
    const existingContentMap = {}
    for (const sec of sections) {
      const row = db.prepare(
        'SELECT content FROM guide_content WHERE pillar_id = ? AND topic_id = ? AND section_id = ?'
      ).get(pillarId, topicId, sec.id)
      existingContentMap[sec.id] = row?.content?.trim() || ''
    }

    // Build existing content context for the prompt
    const existingContentBlock = sections
      .filter(s => existingContentMap[s.id])
      .map(s => `### ${s.name} (id: "${s.id}"):\n${existingContentMap[s.id]}`)
      .join('\n\n---\n\n')

    const sectionList = sections.map(s => {
      const status = existingContentMap[s.id] ? 'HAS EXISTING CONTENT — merge new learnings' : 'EMPTY — create from scratch'
      return `- "${s.id}": ${s.name} [${status}]`
    }).join('\n')

    let taskDescription = 'TASK: Analyze the conversation below and produce updated guide content for EACH section that was substantively discussed. A section counts as "discussed" ONLY if the conversation contains real technical content, examples, tradeoffs, or explanations relevant to that section — not just a brief mention.'
    let inclusionRule = '1. Only include sections that were SUBSTANTIVELY discussed with real technical depth.'

    if (targetSectionIds.length > 0) {
      taskDescription = `TASK: Analyze the conversation below and produce updated guide content SPECIFICALLY for the following selected sections: ${targetSectionIds.join(', ')}. Even if the discussion was brief, extract any relevant information into these sections.`
      inclusionRule = '1. You MUST generate content for ALL the requested sections based on whatever was discussed, even if it is brief.'
    }

    const prompt = `You are a technical editor analyzing a study session conversation and compiling guide content for a system design study guide.

Topic: "${topicName}"

${taskDescription}

AVAILABLE SECTIONS:
${sectionList}

${existingContentBlock ? `EXISTING GUIDE CONTENT (preserve all accurate existing knowledge and merge new learnings into it):\n${existingContentBlock}\n` : ''}CRITICAL RULES:
${inclusionRule}
2. For sections with existing content, your newContent must be the COMPLETE MERGED result: preserve all existing knowledge that is still accurate AND weave in new learnings from the conversation. Reorganize so it reads naturally as a unified reference.
3. For empty sections, create content ONLY from what was discussed in the conversation. Do NOT pad with general knowledge.

MUTUAL EXCLUSIVITY (HIGHEST PRIORITY):
4. Sections must be MUTUALLY EXCLUSIVE in their content. Each fact, example, tradeoff, or explanation belongs in exactly ONE section — the best-fit section based on these ownership rules:
   - "Description & Internal Workings" / "Concept & Mental Model" OWNS: what the thing IS, how it works internally, its data structures and algorithms.
   - "Use Cases & Tradeoffs" / "Strategies & Algorithms" OWNS: WHEN to use it, alternatives comparison, decision criteria.
   - "Scaling" OWNS: capacity math, throughput numbers, horizontal/vertical scaling mechanisms.
   - "Availability & Reliability" OWNS: replication for HA, failover, durability guarantees.
   - "Failure Modes & Blast Radius" OWNS: HOW it breaks, cascading failures, operational risks.
   - "Cost Vectors at Scale" OWNS: economic tradeoffs, resource pricing, optimization levers.
   - "Deployment & APIs" OWNS: configuration, client libraries, operational runbooks.
   - "Tradeoffs & CAP Implications" OWNS: fundamental theoretical tensions and limits.
   - "Interview Angles & Gotchas" OWNS: common mistakes, trick questions, nuanced distinctions.
5. DECISION FRAMEWORK for borderline content: If a concept could fit two sections, ask "what is the PRIMARY teaching goal of this fact?" Place it in the section whose purpose best matches that goal.
6. CROSS-REFERENCES ARE OK: A section MAY include a brief one-line pointer like "See Failure Modes for blast radius details" to provide flow and context, but must NOT duplicate the actual content.
7. SELF-CHECK: Before finalizing, scan all sections you are returning. If any paragraph or bullet appears (even paraphrased) in more than one section, remove it from all but the most appropriate section.

FORMAT RULES:
8. Format as clean, dense markdown for a technical reference guide:
   - Use ## for subsection headers when needed
   - Use bullet points for lists of properties, tradeoffs, or examples
   - Use backtick inline code for technical terms, thresholds, and config values
   - Use **bold** for key terms on first use
   - Be concise — this is a study reference, not an essay

--- CONVERSATION ---
${conversationText}
--- END CONVERSATION ---

Return the targeted sections with their complete updated content.`

    let identifiedSections
    try {
      const parsed = await runStructured({
        model,
        prompt,
        schema: z.object({
          sections: z.array(
            z.object({
              sectionId: z.string().describe('The section id from the provided list'),
              reason: z.string().describe('Brief reason why this section was covered in the conversation'),
              newContent: z.string().describe('The complete updated section content in markdown format'),
            })
          ),
        }),
        // Merged guide sections can be long — give the output extra room.
        maxOutputTokens: 16384,
        feature: 'chat/commit',
      })
      identifiedSections = parsed.sections || []
    } catch (parseErr) {
      logger.error('[chat/commit] Analysis failed:', { error: parseErr.message })
      return res.status(500).json({ message: parseErr.message || 'Failed to analyze conversation sections.' })
    }

    // Validate section IDs against the actual section list
    const validSectionIds = new Set(sections.map(s => s.id))
    identifiedSections = identifiedSections.filter(s => validSectionIds.has(s.sectionId))

    if (identifiedSections.length === 0) {
      logger.info('[chat/commit] No sections identified as discussed.')
      return res.json({ updates: [] })
    }

    // Map to the expected updates format
    const updates = identifiedSections.map(identified => {
      const section = sections.find(s => s.id === identified.sectionId)
      const existingContent = existingContentMap[identified.sectionId] || ''
      return {
        sectionId: identified.sectionId,
        sectionName: section?.name || identified.sectionId,
        reason: identified.reason,
        existingContent,
        newContent: identified.newContent,
        isNew: !existingContent,
      }
    }).filter(u => u.newContent && u.newContent.trim())

    logger.info(`[chat/commit] Analysis complete. ${updates.length} section updates ready for preview.`)
    res.json({ updates })

  } catch (err) {
    logger.error('[chat/commit] Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to analyze session. Please try again.' })
  }
})

/**
 * POST /api/chat/commit/save
 * Batch-save approved section updates from the commit preview.
 * Uses a DB transaction for atomic writes.
 *
 * Body: { pillarId, topicId, updates: [{ sectionId, content }] }
 * Returns: { ok: true, savedCount: N }
 */
router.post('/commit/save', async (req, res) => {
  const { pillarId, topicId, updates = [] } = req.body

  if (!pillarId || !topicId || updates.length === 0) {
    return res.status(400).json({ message: 'pillarId, topicId, and updates are required' })
  }

  try {
    const upsertStmt = db.prepare(`
      INSERT INTO guide_content (pillar_id, topic_id, section_id, content, committed_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(pillar_id, topic_id, section_id)
      DO UPDATE SET content = excluded.content, committed_at = excluded.committed_at
    `)

    const saveAll = db.transaction((items) => {
      let count = 0
      for (const item of items) {
        if (item.sectionId && item.content) {
          upsertStmt.run(pillarId, topicId, item.sectionId, item.content)
          count++
        }
      }
      return count
    })

    const savedCount = saveAll(updates)

    logger.info(`[chat/commit/save] Saved ${savedCount} sections for ${pillarId}/${topicId}`)
    res.json({ ok: true, savedCount })
  } catch (err) {
    logger.error('[chat/commit/save] Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to save guide updates.' })
  }
})

/**
 * GET /api/chat/sessions
 * Fetch all chat sessions
 */
router.get('/sessions', (req, res) => {
  try {
    const rows = db.prepare("SELECT * FROM chat_sessions ORDER BY updated_at DESC").all()
    const sessions = {}
    rows.forEach(r => {
      sessions[r.id] = {
        id: r.id,
        name: r.name,
        createdAt: r.created_at,
        messages: JSON.parse(r.messages || '[]'),
        pillarId: r.pillar_id,
        topicId: r.topic_id,
        topicName: r.topic_name
      }
    })
    res.json(sessions)
  } catch (err) {
    logger.error('[chat/sessions] Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to fetch sessions.' })
  }
})

/**
 * POST /api/chat/sessions
 * Save or update a single chat session
 */
router.post('/sessions', (req, res) => {
  const { session } = req.body
  if (!session || !session.id) return res.status(400).json({message: 'Session required'})

  try {
    db.prepare(`
      INSERT INTO chat_sessions (id, name, messages, pillar_id, topic_id, topic_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        messages = excluded.messages,
        pillar_id = excluded.pillar_id,
        topic_id = excluded.topic_id,
        topic_name = excluded.topic_name,
        updated_at = datetime('now')
    `).run(
      session.id,
      session.name || 'Session',
      JSON.stringify(session.messages || []),
      session.pillarId || null,
      session.topicId || null,
      session.topicName || null,
      session.createdAt || new Date().toISOString()
    )
    res.json({ success: true })
  } catch (err) {
    logger.error('[chat/sessions] POST Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to save session.' })
  }
})

/**
 * POST /api/chat/sessions/bulk
 * Batch save sessions (used for migration)
 */
router.post('/sessions/bulk', (req, res) => {
  const { sessions } = req.body
  if (!sessions || typeof sessions !== 'object') return res.status(400).json({message: 'Sessions object required'})

  try {
    const insert = db.prepare(`
      INSERT INTO chat_sessions (id, name, messages, pillar_id, topic_id, topic_name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        messages = excluded.messages,
        pillar_id = excluded.pillar_id,
        topic_id = excluded.topic_id,
        topic_name = excluded.topic_name,
        updated_at = datetime('now')
    `)
    const transaction = db.transaction((sessObj) => {
      for (const id in sessObj) {
        const s = sessObj[id]
        insert.run(
          s.id, s.name || 'Session', JSON.stringify(s.messages || []),
          s.pillarId || null, s.topicId || null, s.topicName || null,
          s.createdAt || new Date().toISOString()
        )
      }
    })
    transaction(sessions)
    res.json({ success: true })
  } catch (err) {
    logger.error('[chat/sessions/bulk] Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to save sessions in bulk.' })
  }
})

/**
 * DELETE /api/chat/sessions/:id
 * Delete a session
 */
router.delete('/sessions/:id', (req, res) => {
  try {
    db.prepare("DELETE FROM chat_sessions WHERE id = ?").run(req.params.id)
    res.json({ success: true })
  } catch (err) {
    logger.error('[chat/sessions] DELETE Error:', { error: err.message })
    res.status(500).json({ message: 'Failed to delete session.' })
  }
})

export default router
