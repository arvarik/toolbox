import { Router } from 'express'
import db from '../db.js'

const router = Router()

/**
 * POST /api/chat
 * Send a message to Gemini and get a response (non-streaming).
 * Body: { message, context, history }
 */
router.post('/', async (req, res) => {
  const { message, context, history = [] } = req.body

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
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })

    // Build system context based on the page
    const systemContext = context
      ? `You are an expert system design interview tutor. Context: ${context}\n\n`
      : 'You are an expert system design interview tutor helping a student prepare for system design interviews.\n\n'

    // Build conversation history
    const chatHistory = history.map((msg) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    })

    const result = await chat.sendMessage(systemContext + message)
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
  const { message, context, history = [] } = req.body

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

  try {
    const { GoogleGenerativeAI } = await import('@google/generative-ai')
    const genAI = new GoogleGenerativeAI(config.value)
    const model = genAI.getGenerativeModel({ model: 'gemini-3.5-flash' })

    const systemContext = context
      ? `You are an expert system design interview tutor. Context: ${context}\n\n`
      : 'You are an expert system design interview tutor helping a student prepare for system design interviews.\n\n'

    const chatHistory = history.map((msg) => ({
      role: msg.role === 'ai' ? 'model' : 'user',
      parts: [{ text: msg.content }],
    }))

    const chat = model.startChat({
      history: chatHistory,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2048,
      },
    })

    const result = await chat.sendMessageStream(systemContext + message)

    for await (const chunk of result.stream) {
      const text = chunk.text()
      if (text) {
        // Encode as SSE data event — escape newlines for SSE protocol
        const lines = text.split('\n')
        for (const line of lines) {
          res.write(`data: ${JSON.stringify({ text: line })}\n\n`)
        }
      }
    }

    res.write('data: [DONE]\n\n')
    res.end()
  } catch (err) {
    console.error('[chat/stream] Error:', err.message)
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`)
    res.end()
  }
})

export default router
