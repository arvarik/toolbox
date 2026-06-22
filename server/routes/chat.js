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
  req.on('close', () => {
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
        contents: [{ role: 'user', parts: [{ text: systemContext }] }],
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
            const lines = text.split('\n')
            for (const line of lines) {
              res.write(`data: ${JSON.stringify({ text: line })}\n\n`)
            }
          }
        }
      }
    } while (isFunctionCall && !isAborted);

    res.write('data: [DONE]\n\n')
    res.end()

    // ─── 4. Autonomous Memory Management (Antigravity Agent) ────────────────
    setTimeout(async () => {
      try {
        if (chatHistory.length > 0) {
          const { GoogleGenAI } = await import('@google/genai');
          const client = new GoogleGenAI({ apiKey: config.value });
          
          const extractionPrompt = `You are the autonomous memory manager (antigravity agent) for this user.
Analyze the following latest interaction. Extract ANY new, highly important episodic learning events (struggles, analogies that clicked, specific facts mastered).
Only return events that are worth remembering long-term.

Chat History:
${chatHistory.map(m => `${m.role}: ${m.parts[0].text}`).join('\n')}
user: ${message}
model: ${generatedText}

Return JSON matching: { "events": [{ "memory_text": "string", "importance_score": 5 }] }`;
          
          const extractResult = await client.interactions.create({
            agent: 'antigravity-preview-05-2026',
            input: extractionPrompt,
            environment: 'remote'
          });
          
          let data;
          try {
            const outText = extractResult.output_text;
            const match = outText.match(/```(?:json)?\n([\s\S]*?)\n```/) || outText.match(/{[\s\S]*}/);
            data = JSON.parse(match ? (match[1] || match[0]) : outText);
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

export default router
