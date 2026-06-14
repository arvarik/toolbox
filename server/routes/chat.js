import { Router } from 'express'
import db from '../db.js'

const router = Router()

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
    console.error('[chat] Error:', err.message)
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

    // Tools definition
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
        },
        {
          name: "submit_draft",
          description: "MANDATORY: You must NEVER give the final answer directly to the user. You MUST first use this tool to submit your proposed draft. A critic will review it and return feedback or approval. If approved, you can then output the final text.",
          parameters: {
            type: "OBJECT",
            properties: {
              draft_text: { type: "STRING", description: "Your proposed final answer to the user." }
            },
            required: ["draft_text"]
          }
        }
      ]
    }];

    // ─── 1. Memory Compaction ───────────────────────────────────────────────
    let compactedHistory = history;
    let memorySummary = "";

    if (history.length > 8) {
      res.write(`data: ${JSON.stringify({ tool: 'Compacting Memory...' })}\n\n`)
      
      const oldMessages = history.slice(0, history.length - 4);
      compactedHistory = history.slice(history.length - 4);
      
      const summaryModel = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })
      const summaryPrompt = `Summarize this chat history into a dense "Working Memory Summary" of key concepts discussed, the user's current understanding, and any unresolved issues. Keep it under 150 words.\n\nHistory:\n${oldMessages.map(m => `${m.role}: ${m.content}`).join('\n')}`;
      
      const summaryResult = await summaryModel.generateContent(summaryPrompt);
      memorySummary = `\n\n--- WORKING MEMORY SUMMARY ---\n${summaryResult.response.text()}\n------------------------------\n`;
    }

    // ─── 2. Dynamic Context ─────────────────────────────────────────────────
    // Get some quick stats
    const statsRow = db.prepare("SELECT COUNT(*) as c FROM flashcards WHERE state < 2").get()
    const struggling = statsRow?.c || 0;
    
    const profileRow = db.prepare("SELECT profile_text FROM user_profile WHERE id = 1").get();
    const userProfile = profileRow?.profile_text || "";

    let systemContext = context
      ? `You are an expert system design interview tutor. Context: ${context}\n\n`
      : 'You are an expert system design interview tutor helping a student prepare for system design interviews.\n\n';
      
    systemContext += `\n[Global Stats: User has ${struggling} cards in learning state (not yet mastered).]`;
    if (userProfile) {
      systemContext += `\n\n[Shadow Memory / User Profile]:\n${userProfile}`;
    }
    if (memorySummary) systemContext += memorySummary;

    const model = genAI.getGenerativeModel({ 
      model: requestedModel || 'gemini-3.5-flash',
      tools: tools,
      systemInstruction: systemContext
    })

    const chatHistory = compactedHistory.map((msg) => ({
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

    // ─── 3. Harness Loop ────────────────────────────────────────────────────
    let currentMessage = message;
    let isFunctionCall = false;
    let generatedText = '';

    do {
      isFunctionCall = false;
      const result = await chat.sendMessageStream(currentMessage);
      
      for await (const chunk of result.stream) {
        if (isAborted) break;

        if (chunk.functionCalls && chunk.functionCalls.length > 0) {
          isFunctionCall = true;
          const functionResponses = [];
          
          for (const call of chunk.functionCalls) {
            const fnName = call.name;
            const args = call.args;
            
            res.write(`data: ${JSON.stringify({ tool: "Running " + fnName + "..." })}\n\n`);
            
            let toolResult = null;
            if (fnName === 'search_flashcards') {
              const q = args.query || '';
              const rows = db.prepare("SELECT front, back, state, ease_factor FROM flashcards WHERE front LIKE ? OR back LIKE ? LIMIT 5").all(`%${q}%`, `%${q}%`);
              toolResult = rows.length > 0 ? rows : "No flashcards found.";
            } else if (fnName === 'search_guide') {
              const q = args.query || '';
              const rows = db.prepare("SELECT content FROM guide_content WHERE content LIKE ? LIMIT 3").all(`%${q}%`);
              toolResult = rows.length > 0 ? rows.map(r => r.content) : "No guide content found.";
            } else if (fnName === 'submit_draft') {
              const draft = args.draft_text || '';
              res.write(`data: ${JSON.stringify({ tool: 'Critic reviewing draft...' })}\n\n`);
              
              const criticModel = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
              const criticPrompt = `You are a strict technical critic. Review this proposed answer to the user.\n\nDraft:\n${draft}\n\nProvide feedback on accuracy, hallucinations, and clarity. If it is high quality and accurate, output exactly "APPROVED". Otherwise, point out the flaws briefly.`;
              
              const criticResult = await criticModel.generateContent(criticPrompt);
              const critique = criticResult.response.text().trim();
              
              if (critique === 'APPROVED') {
                 toolResult = "APPROVED. You may now output exactly the draft text to the user.";
              } else {
                 toolResult = `REJECTED. Feedback: ${critique}\n\nPlease revise your draft and submit again using submit_draft, or if you think the critic is wrong, address it in your output.`;
              }
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

    // ─── 4. Shadow Memory Extraction (Async) ────────────────────────────────
    setTimeout(async () => {
      try {
        if (chatHistory.length > 1) {
          const extractionModel = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' });
          const oldProfile = db.prepare("SELECT profile_text FROM user_profile WHERE id = 1").get()?.profile_text || "";
          
          const extractionPrompt = `You are a background profiler. Analyze the following chat history. Extract any hard facts about the user (e.g., their upcoming interviews, concepts they struggle with, preferences).
Current Profile:
${oldProfile}

Chat History:
${chatHistory.map(m => `${m.role}: ${m.parts[0].text}`).join('\n')}
user: ${message}
model: ${generatedText}

Output a unified, updated profile text for this user. If there are no new facts, just output the Current Profile unchanged.`;
          
          const extractResult = await extractionModel.generateContent(extractionPrompt);
          const newProfile = extractResult.response.text().trim();
          
          db.prepare("INSERT INTO user_profile (id, profile_text, updated_at) VALUES (1, ?, datetime('now')) ON CONFLICT(id) DO UPDATE SET profile_text = excluded.profile_text, updated_at = excluded.updated_at").run(newProfile);
        }
      } catch (err) {
        console.error('[Shadow Memory] Error:', err.message);
      }
    }, 0);
  } catch (err) {
    console.error('[chat/stream] Error:', err.message)
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
    console.error('[chat/summarize] Error:', err.message)
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
      console.error('[chat/evaluate-interceptor] Failed to parse JSON:', e.message, text)
      // Fallback
      evaluation = { pass: false, feedback: "Error evaluating response format." }
    }

    res.json(evaluation)
  } catch (err) {
    console.error('[chat/evaluate-interceptor] Error:', err.message)
    res.status(500).json({ message: 'Failed to evaluate. Please check your API key.' })
  }
})

export default router
