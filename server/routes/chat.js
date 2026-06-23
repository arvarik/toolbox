import { Router } from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../src/utils/constants.js'
import logger from '../utils/logger.js'
import { generateEmbedding, cosineSimilarity } from '../utils/embeddings.js'

const router = Router()



/**
 * GET /api/chat/starters
 * Generate dynamic chat starters based on a specific topic's guide content, blueprint, and user profile.
 * Query: ?pillarId=X&topicId=Y&topicName=Z&model=gemini-3.5-flash
 */
router.get('/starters', async (req, res) => {
  const { pillarId, topicId, topicName, model: requestedModel } = req.query

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
    const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
    if (!config?.value) {
      return res.status(400).json({ message: 'API key not configured.' })
    }

    const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)
    const model = genAI.getGenerativeModel({
      model: requestedModel || 'gemini-3.5-flash',
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.ARRAY,
          items: {
            type: SchemaType.STRING,
          },
          description: "An array of 12 to 15 short, engaging study questions for the user to ask the AI."
        }
      }
    })

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
- Format as short, actionable questions they would ask YOU (e.g. "Can you quiz me on [X]?", "How does [X] handle [Y] failure mode?").
`

    const result = await model.generateContent(prompt)
    let suggestionsText = result.response.text()
    
    // Validate JSON
    let parsedSuggestions = []
    try {
      parsedSuggestions = JSON.parse(suggestionsText)
    } catch {
      parsedSuggestions = ["Let's do a deep dive on this topic", "Test my knowledge on this topic"]
      suggestionsText = JSON.stringify(parsedSuggestions)
    }

    // Save to DB (save all generated prompts)
    db.prepare(`
      INSERT INTO chat_starters (pillar_id, topic_id, suggestions, content_hash, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(pillar_id, topic_id) DO UPDATE SET 
        suggestions = excluded.suggestions,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(pillarId, topicId, JSON.stringify(parsedSuggestions), contentHash)

    // Return a random selection of 6 prompts
    const shuffled = [...parsedSuggestions].sort(() => 0.5 - Math.random())
    res.json({ suggestions: shuffled.slice(0, 6) })
  } catch (err) {
    logger.error('[chat/starters] Error:', err.message)
    res.status(500).json({ message: 'Failed to generate starters.' })
  }
})

/**
 * POST /api/chat
 * Send a message to Gemini and get a response (non-streaming).
 * Body: { message, context, history }
 */
router.post('/', async (req, res) => {
  const { message, context, history = [], model: requestedModel } = req.body

  if (!message) {
    return res.status(400).json({ message: 'Message is required' })
  }

  // Get API key from config
  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)

    // Build system context based on the page
    const systemContext = context
      ? `You are an expert system design interview tutor. Context: ${context}\n\n`
      : 'You are an expert system design interview tutor helping a student prepare for system design interviews.\n\n'

    const model = genAI.getGenerativeModel({ 
      model: requestedModel || 'gemini-3.5-flash',
      systemInstruction: systemContext
    })

    // Build conversation history
    const chatHistory = history.map((msg) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192,
        thinkingConfig: {
          thinkingBudget: 1024,
          includeThoughts: false
        }
      },
    })

    const result = await chat.sendMessage(message)
    const response = result.response.text()

    res.json({ response })
  } catch (err) {
    logger.error('[chat] Error:', err.message)
    res.status(500).json({ message: 'Failed to get AI response. Please check your API key.' })
  }
})

/**
 * POST /api/chat/stream
 * Stream a response from Gemini via Server-Sent Events (SSE).
 * Body: { message, context, history }
 */
router.post('/stream', async (req, res) => {
  const { message, context, history = [], model: requestedModel } = req.body

  if (!message) {
    return res.status(400).json({ message: 'Message is required' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  let isAborted = false;
  res.on('close', () => {
    isAborted = true;
  });

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)

    // Tools definition (submit_draft removed — critic pattern is incompatible
    // with thinking-mode streaming due to function call turn adjacency rules)
    const tools = [{
      functionDeclarations: [
        {
          name: "search_flashcards",
          description: "Search the user's flashcards. Useful to see what concepts they have learned or are struggling with.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Search query for flashcards" }
            },
            required: ["query"]
          }
        },
        {
          name: "search_guide",
          description: "Search the global system design guide content.",
          parameters: {
            type: "OBJECT",
            properties: {
              query: { type: "STRING", description: "Topic to search for in the guide" }
            },
            required: ["query"]
          }
        }
      ]
    }];

    // ─── 1. Infinite Working Memory (No Compaction) ─────────────────────────
    // We do NOT compact memory. We pass the full history.
    const fullHistory = history;

    // Fetch all flashcards and guide notes to build the ultimate context
    const allFlashcards = db.prepare("SELECT id, front, back, state, interval FROM flashcards").all();
    const allGuides = db.prepare("SELECT section_id, content FROM guide_content WHERE content != ''").all();
    
    let globalKnowledgeContext = `\n\n--- GLOBAL FLASHCARD DATABASE ---\n`;
    allFlashcards.forEach(f => {
      globalKnowledgeContext += `Card [${f.id}]: Q: ${f.front} | A: ${f.back} (State: ${f.state}, Interval: ${f.interval})\n`;
    });
    globalKnowledgeContext += `\n--- GLOBAL GUIDE NOTES ---\n`;
    allGuides.forEach(g => {
      globalKnowledgeContext += `Section [${g.section_id}]: ${g.content}\n`;
    });

    // ─── 2. Autonomous Episodic Memory Injection ────────────────────────────
    const profileRow = db.prepare("SELECT profile_text FROM user_profile WHERE id = 1").get();
    const userProfile = profileRow?.profile_text || "";

    // Semantic search for episodic memories related to current message
    const msgEmbedding = await generateEmbedding(message);
    const episodes = db.prepare("SELECT memory_text, embedding FROM episodic_memory ORDER BY created_at DESC").all();
    
    let topEpisodes = [];
    if (msgEmbedding.length > 0) {
      const scored = episodes.map(ep => {
        let sim = 0;
        try {
          const epEmb = JSON.parse(ep.embedding);
          sim = cosineSimilarity(msgEmbedding, epEmb);
        } catch (e) { void e; }
        return { text: ep.memory_text, sim };
      }).sort((a, b) => b.sim - a.sim);
      topEpisodes = scored.slice(0, 5).map(e => e.text);
    }

    let systemContext = context
      ? `You are an expert system design interview tutor. Context: ${context}\n\n`
      : 'You are an expert system design interview tutor helping a student prepare for system design interviews.\n\n';
      
    if (userProfile) {
      systemContext += `\n\n[Shadow Memory / User Profile]:\n${userProfile}`;
    }
    if (topEpisodes.length > 0) {
      systemContext += `\n\n[Relevant Past Learning Episodes]:\n` + topEpisodes.map(t => `- ${t}`).join('\n');
    }
    
    // Append the massive knowledge base
    systemContext += globalKnowledgeContext;

    let model;
    try {
      const { GoogleAICacheManager } = await import('@google/generative-ai/server');
      const cacheManager = new GoogleAICacheManager(config.value);
      const cache = await cacheManager.create({
        model: 'models/' + (requestedModel || 'gemini-3.5-flash'),
        systemInstruction: systemContext,
        contents: [
          { role: 'user', parts: [{ text: 'Understood. I am ready to help the student.' }] },
          { role: 'model', parts: [{ text: 'Ready.' }] }
        ],
        ttlSeconds: 600
      });
      model = genAI.getGenerativeModelFromCachedContent(cache, { tools: tools });
    } catch (cacheErr) {
      logger.warn(`[chat/stream] Context caching skipped or failed (${cacheErr.message}). Falling back to standard model init.`);
      model = genAI.getGenerativeModel({ 
        model: requestedModel || 'gemini-3.5-flash',
        tools: tools,
        systemInstruction: systemContext
      });
    }

    const chatHistory = fullHistory.map((msg) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 8192,
      },
    })

    // ─── 3. Harness Loop ────────────────────────────────────────────────────
    let currentMessage = message;
    let isFunctionCall = false;
    let generatedText = '';

    do {
      isFunctionCall = false;
      const result = await chat.sendMessageStream(currentMessage);
      
      for await (const chunk of result.stream) {
        if (isAborted) break;

        // Note: In @google/generative-ai SDK, functionCalls is a method, not a property.
        const chunkFunctionCalls = typeof chunk.functionCalls === 'function'
          ? chunk.functionCalls()
          : chunk.functionCalls;

        if (chunkFunctionCalls && chunkFunctionCalls.length > 0) {
          isFunctionCall = true;
          const functionResponses = [];
          
          for (const call of chunkFunctionCalls) {
            const fnName = call.name;
            const args = call.args;
            
            res.write(`data: ${JSON.stringify({ tool: "Running " + fnName + "..." })}\n\n`);
            
            let toolResult = null;
            if (fnName === 'search_flashcards') {
              const q = args.query || '';
              const qEmb = await generateEmbedding(q);
              const rows = db.prepare("SELECT front, back, state, ease_factor, embedding FROM flashcards").all();
              
              if (qEmb.length > 0) {
                const scored = rows.map(r => {
                  let sim = 0;
                  try {
                    if (r.embedding) sim = cosineSimilarity(qEmb, JSON.parse(r.embedding));
                  } catch (e) { void e; }
                  return { ...r, sim };
                }).sort((a, b) => b.sim - a.sim);
                toolResult = scored.slice(0, 5).map(r => ({ front: r.front, back: r.back, state: r.state, ease_factor: r.ease_factor }));
              } else {
                toolResult = rows.slice(0, 5);
              }
              if (!toolResult.length) toolResult = "No flashcards found.";
            } else if (fnName === 'search_guide') {
              const q = args.query || '';
              const qEmb = await generateEmbedding(q);
              const rows = db.prepare("SELECT content, embedding FROM guide_content").all();
              
              if (qEmb.length > 0) {
                const scored = rows.map(r => {
                  let sim = 0;
                  try {
                    if (r.embedding) sim = cosineSimilarity(qEmb, JSON.parse(r.embedding));
                  } catch (e) { void e; }
                  return { ...r, sim };
                }).sort((a, b) => b.sim - a.sim);
                toolResult = scored.slice(0, 3).map(r => r.content);
              } else {
                toolResult = rows.slice(0, 3).map(r => r.content);
              }
              if (!toolResult.length) toolResult = "No guide content found.";
            }

            functionResponses.push({
              functionResponse: {
                name: fnName,
                response: { result: toolResult }
              }
            });
          }
          currentMessage = functionResponses;
          break; // Exit the stream processing for this turn, loop back to send functionResponses
        } else {
          const text = chunk.text()
          if (text) {
            generatedText += text;
            res.write(`data: ${JSON.stringify({ text })}\n\n`)
          }
        }
      }
    } while (isFunctionCall && !isAborted);

    res.write('data: [DONE]\n\n')
    res.end()

    // ─── 4. Autonomous Memory Management (Interactions API) ────────────────
    setTimeout(async () => {
      try {
        if (chatHistory.length > 0) {
          const { GoogleGenAI } = await import('@google/genai');
          const client = new GoogleGenAI({ apiKey: config.value });
          
          const extractionPrompt = `You are the autonomous memory manager for this user.
Analyze the following latest interaction. Extract ANY new, highly important episodic learning events (struggles, analogies that clicked, specific facts mastered).
Only return events that are worth remembering long-term.

Chat History:
${chatHistory.map(m => `${m.role}: ${m.parts[0].text}`).join('\n')}
user: ${message}
model: ${generatedText}`;
          
          const extractResult = await client.models.generateContent({
            model: requestedModel || 'gemini-3.5-flash',
            contents: extractionPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: 'object',
                properties: {
                  events: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        memory_text: { type: 'string', description: 'A concise description of the learning event' },
                        importance_score: { type: 'number', description: 'Importance score from 1 to 10' }
                      },
                      required: ['memory_text', 'importance_score']
                    }
                  }
                },
                required: ['events']
              }
            }
          });
          
          let data;
          try {
            data = JSON.parse(extractResult.text);
          } catch(e) {
            logger.error('[Memory Manager] JSON Parse error', e.message);
          }

          
          if (data && data.events && data.events.length > 0) {
            for (const ev of data.events) {
              const emb = await generateEmbedding(ev.memory_text);
              db.prepare("INSERT INTO episodic_memory (memory_text, importance_score, embedding, created_at) VALUES (?, ?, ?, datetime('now'))")
                .run(ev.memory_text, ev.importance_score, JSON.stringify(emb));
            }
            logger.info(`[Memory Manager] Extracted ${data.events.length} episodic memories.`);
          }
        }
      } catch (err) {
        logger.error('[Memory Manager] Error:', err.message);
      }
    }, 0);
  } catch (err) {
    logger.error('[chat/stream] Error:', err.message)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

/**
 * POST /api/chat/generate-flashcards
 * Generate flashcards from a given text and topic.
 * Body: { text, topicName, model, sessionContext, sections?, pillarId?, topicId? }
 * When `sections` is provided, generates cards per-section with source tagging.
 */
router.post('/generate-flashcards', async (req, res) => {
  const { text, topicName, model: requestedModel, sessionContext, sections, pillarId, topicId } = req.body

  if (!text && (!sections || sections.length === 0)) {
    return res.status(400).json({ message: 'Text or sections are required to generate flashcards.' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai')
    const client = new GoogleGenAI({ apiKey: config.value })
    const modelName = requestedModel || 'gemini-3.5-flash'

    // Build context section if available
    let contextBlock = ''
    if (sessionContext) {
      contextBlock = `\n\nFor additional context, this text comes from a study session about "${topicName || 'system design'}". Here is some surrounding conversation context to help you create more informed cards:\n--- SESSION CONTEXT ---\n${sessionContext}\n--- END CONTEXT ---\nUse this context ONLY to better understand the concepts — the flashcard content should primarily come from the source text below.\n`
    }

    // Build source text — either section-aware or flat
    let sourceBlock = ''
    if (sections && sections.length > 0) {
      sourceBlock = sections.map(s => 
        `=== SECTION: "${s.sectionName}" (id: "${s.sectionId}") ===\n${s.content}`
      ).join('\n\n---\n\n')
    } else {
      sourceBlock = text
    }

    const sectionAwareInstructions = sections && sections.length > 0
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

    // Build schema — with or without section tagging
    const cardProperties = {
      front: { type: 'string', description: 'The front of the flashcard: a concise 1-2 line question' },
      back: { type: 'string', description: 'The back of the flashcard: a dense 2-3 line answer' },
    }
    const requiredFields = ['front', 'back']

    if (sections && sections.length > 0) {
      cardProperties.sourceSectionId = { type: 'string', description: 'The section id this card was generated from' }
      cardProperties.sourceSectionName = { type: 'string', description: 'The section name this card was generated from' }
      requiredFields.push('sourceSectionId', 'sourceSectionName')
    }

    const result = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: cardProperties,
            required: requiredFields,
          },
        },
      },
    })

    let generatedCards = []
    try {
      generatedCards = JSON.parse(result.text)
    } catch {
      return res.status(500).json({ message: 'Failed to parse generated flashcards.' })
    }

    // Attach source metadata if available
    if (pillarId || topicId) {
      generatedCards = generatedCards.map(card => ({
        ...card,
        sourcePillarId: pillarId || null,
        sourceTopicId: topicId || null,
      }))
    }

    res.json({ cards: generatedCards })
  } catch (err) {
    logger.error('[chat/generate-flashcards] Error:', err.message)
    res.status(500).json({ message: 'Failed to generate flashcards.' })
  }
})

/**
 * POST /api/chat/generate-reverse-cards
 * Generate reverse (bidirectional) flashcards from existing Q&A pairs.
 * Body: { cards: [{ front, back }], model }
 */
router.post('/generate-reverse-cards', async (req, res) => {
  const { cards, model: requestedModel } = req.body
  if (!cards || !Array.isArray(cards) || cards.length === 0) {
    return res.status(400).json({ message: 'Cards array is required.' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({ message: 'Gemini API key not configured.' })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai')
    const client = new GoogleGenAI({ apiKey: config.value })
    const modelName = requestedModel || 'gemini-3.5-flash'

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

    const result = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              front: { type: 'string', description: 'Reverse question' },
              back: { type: 'string', description: 'Answer for the reverse question' },
              originalIndex: { type: 'integer', description: 'Index of the original card this reverses' },
            },
            required: ['front', 'back', 'originalIndex'],
          },
        },
      },
    })

    let reverseCards = []
    try {
      reverseCards = JSON.parse(result.text)
    } catch {
      return res.status(500).json({ message: 'Failed to parse reverse cards.' })
    }

    res.json({ reverseCards })
  } catch (err) {
    logger.error('[chat/generate-reverse-cards] Error:', err.message)
    res.status(500).json({ message: 'Failed to generate reverse cards.' })
  }
})

/**
 * POST /api/chat/summarize
 * Summarize selected chat excerpts into clean guide notes for a specific blueprint section.
 * Body: { excerpts, pillarId, topicId, sectionId, sectionName, topicName, model }
 */
router.post('/summarize', async (req, res) => {
  const {
    excerpts = [],
    sectionId,
    sectionName,
    topicName,
    model: requestedModel,
  } = req.body

  if (!excerpts.length || !sectionId) {
    return res.status(400).json({ message: 'excerpts and sectionId are required' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)
    const model = genAI.getGenerativeModel({ model: requestedModel || 'gemini-3.5-flash' })

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

    const result = await model.generateContent(prompt)
    const content = result.response.text()

    res.json({ content })
  } catch (err) {
    logger.error('[chat/summarize] Error:', err.message)
    res.status(500).json({ message: 'Failed to summarize. Please check your API key.' })
  }
})

/**
 * POST /api/chat/evaluate-interceptor
 * Evaluates the user's explanation for the "Why?" interceptor.
 * Returns a structured JSON response { pass: boolean, feedback: string }.
 * Body: { explanation, front, back, model }
 */
router.post('/evaluate-interceptor', async (req, res) => {
  const { explanation, front, back, model: requestedModel } = req.body

  if (!explanation || !front || !back) {
    return res.status(400).json({ message: 'explanation, front, and back are required' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  try {
    const { GoogleGenerativeAI, SchemaType } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)
    const model = genAI.getGenerativeModel({ 
      model: requestedModel || 'gemini-3.5-flash',
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            pass: {
              type: SchemaType.BOOLEAN,
              description: "True if the user's explanation demonstrates an understanding of the underlying principle. False if they fail to explain the 'why', are too vague, or are incorrect."
            },
            feedback: {
              type: SchemaType.STRING,
              description: "1-2 sentences of feedback explaining why they passed or failed, and reinforcing the correct concept."
            }
          },
          required: ["pass", "feedback"],
        }
      }
    })

    const prompt = `You are a strict learning evaluator. The user was asked a flashcard question and must explain WHY the answer is true to prove they aren't just pattern-matching.

Question: ${front}
Answer: ${back}

User's Explanation: "${explanation}"

Evaluate their explanation.`

    const result = await model.generateContent(prompt)
    const text = result.response.text()
    
    let evaluation;
    try {
      evaluation = JSON.parse(text)
    } catch (e) {
      logger.error('[chat/evaluate-interceptor] Failed to parse JSON:', e.message, text)
      // Fallback
      evaluation = { pass: false, feedback: "Error evaluating response format." }
    }

    res.json(evaluation)
  } catch (err) {
    logger.error('[chat/evaluate-interceptor] Error:', err.message)
    res.status(500).json({ message: 'Failed to evaluate. Please check your API key.' })
  }
})

/**
 * @route POST /api/chat/concept-map
 * @description Generates a Mermaid concept map from a session history.
 * Pings Gemini to extract key concepts, entities, and relationships, returning a valid mermaid graph.
 * @param {Object[]} req.body.history - Array of chat messages.
 * @param {string} req.body.model - Gemini model to use.
 * @returns {Object} JSON object with a 'response' containing the markdown block for mermaid code.
 */
router.post('/concept-map', async (req, res) => {
  const { history = [], model: requestedModel } = req.body

  if (!history || history.length === 0) {
    return res.status(400).json({ message: 'History is required to generate a map.' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)
    const model = genAI.getGenerativeModel({ model: requestedModel || 'gemini-3.5-flash' })

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

    const result = await model.generateContent(prompt)
    let responseText = result.response.text()
    
    if (!responseText.includes('```mermaid')) {
      responseText = `\`\`\`mermaid\n${responseText.replace(/```/g, '')}\n\`\`\``
    }

    res.json({ response: responseText })
  } catch (err) {
    logger.error('[chat/concept-map] Error:', err.message)
    res.status(500).json({ message: 'Failed to generate concept map.' })
  }
})

// ─── Intelligent Commit Flow ──────────────────────────────────────────────────

/**
 * POST /api/chat/commit
 * Analyze a chat session against a guide topic's sections.
 * Step 1: Identify which sections were substantively discussed.
 * Step 2: For each identified section, reconcile session content with existing guide content.
 *
 * Body: { messages, pillarId, topicId, topicName, model }
 * Returns: { updates: [{ sectionId, sectionName, existingContent, newContent, isNew }] }
 */
router.post('/commit', async (req, res) => {
  const { messages = [], pillarId, topicId, topicName, model: requestedModel } = req.body

  if (!messages.length || !pillarId || !topicId) {
    return res.status(400).json({ message: 'messages, pillarId, and topicId are required' })
  }

  const config = db.prepare("SELECT value FROM config WHERE key = 'gemini_api_key'").get()
  if (!config?.value) {
    return res.status(400).json({
      message: 'Gemini API key not configured. Please add your key in Settings.',
    })
  }

  const sections = BLUEPRINT_SECTIONS[pillarId]
  if (!sections || sections.length === 0) {
    return res.status(400).json({ message: `No blueprint sections found for pillar "${pillarId}"` })
  }

  try {
    const { GoogleGenAI } = await import('@google/genai')
    const client = new GoogleGenAI({ apiKey: config.value })
    const modelName = requestedModel || 'gemini-3.5-flash'

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

    const prompt = `You are a technical editor analyzing a study session conversation and compiling guide content for a system design study guide.

Topic: "${topicName}"

TASK: Analyze the conversation below and produce updated guide content for EACH section that was substantively discussed. A section counts as "discussed" ONLY if the conversation contains real technical content, examples, tradeoffs, or explanations relevant to that section — not just a brief mention.

AVAILABLE SECTIONS:
${sectionList}

${existingContentBlock ? `EXISTING GUIDE CONTENT (preserve all accurate existing knowledge and merge new learnings into it):\n${existingContentBlock}\n` : ''}CRITICAL RULES:
1. Only include sections that were SUBSTANTIVELY discussed with real technical depth.
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

Return the sections that were substantively discussed with their complete updated content.`

    const result = await client.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  sectionId: { type: 'string', description: 'The section id from the provided list' },
                  reason: { type: 'string', description: 'Brief reason why this section was covered in the conversation' },
                  newContent: { type: 'string', description: 'The complete updated section content in markdown format' }
                },
                required: ['sectionId', 'reason', 'newContent']
              }
            }
          },
          required: ['sections']
        }
      }
    })

    let identifiedSections
    try {
      const parsed = JSON.parse(result.text)
      identifiedSections = parsed.sections || []
    } catch (parseErr) {
      logger.error('[chat/commit] Failed to parse response:', parseErr.message)
      return res.status(500).json({ message: 'Failed to analyze conversation sections.' })
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
    logger.error('[chat/commit] Error:', err.message)
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
    logger.error('[chat/commit/save] Error:', err.message)
    res.status(500).json({ message: 'Failed to save guide updates.' })
  }
})

export default router
