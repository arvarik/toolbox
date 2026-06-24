import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import LearningChat from '../components/chat/LearningChat'
import useAppStore from '../stores/appStore'
import { chatApi } from '../utils/api'

vi.mock('../utils/api', () => ({
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'AI response content' })),
    stream: vi.fn(async (data, onChunk) => {
      const text = `AI response in ${data.context.substring(0, 20)}...`
      if (onChunk) onChunk(text)
      return text
    }),
    generateConceptMap: vi.fn(() => Promise.resolve({ response: 'graph TD\nA-->B' })),
  }
}))

describe('LearningChat Component Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAppStore.setState({ apiKeyConfigured: true, model: 'gemini-3.5-flash', toasts: [] })
    
    // Mock implementations so that await chatApi.stream() resolves correctly
    chatApi.stream.mockImplementation(async (data, onChunk) => {
      onChunk('AI Response')
      return 'AI Response'
    })
    
    chatApi.generateConceptMap.mockResolvedValue({
      response: '```mermaid\ngraph TD\nA-->B\n```'
    })

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
    
    // Polyfill scrollIntoView
    window.HTMLElement.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('1. Switches Persona and applies correct context to API stream', async () => {
    render(<LearningChat />)
    
    // Click a starter prompt with default persona (Socratic)
    const starter1 = screen.getByText('Explain consistent hashing with a concrete example and when I should use it')
    fireEvent.click(starter1)
    
    await waitFor(() => {
      expect(chatApi.stream).toHaveBeenCalledTimes(1)
      const callArgs = chatApi.stream.mock.calls[0][0]
      expect(callArgs.context).toContain('Socratic questioning')
    })
    
    // Switch Persona to Strict
    const personaButton = screen.getByTitle('Change AI Persona')
    fireEvent.click(personaButton)
    const strictOption = screen.getByText('Strict')
    fireEvent.click(strictOption)
    
    // Create a new session to get the starter prompts back (since clear button is removed)
    const sessionPickerBtn = screen.getByRole('button', { name: /No session|Session/i }) // Usually has the session name or 'No session'
    // actually, it has id="session-picker-btn"
    const sessionBtn = document.getElementById('session-picker-btn')
    fireEvent.click(sessionBtn)
    
    const newSessionBtn = screen.getByText('New Session')
    fireEvent.click(newSessionBtn)
    
    // Click another starter prompt
    const starter2 = screen.getByText('Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale')
    fireEvent.click(starter2)
    
    await waitFor(() => {
      expect(chatApi.stream).toHaveBeenCalledTimes(2)
      const callArgs = chatApi.stream.mock.calls[1][0]
      expect(callArgs.context).toContain('highly demanding, intense, and strict')
    })
  })

  it('2. Shows Generate Concept Map button after enough messages and triggers API', async () => {
    // Inject a session with 4 messages directly into localStorage
    const testSessionId = 'session-123'
    const testSession = {
      id: testSessionId,
      name: 'Test Session',
      createdAt: new Date().toISOString(),
      messages: [
        { id: '1', role: 'user', content: 'Message 1' },
        { id: '2', role: 'ai', content: 'Response 1' },
        { id: '3', role: 'user', content: 'Message 2' },
        { id: '4', role: 'ai', content: 'Response 2' }
      ]
    }
    window.localStorage.setItem('toolbox_learning_sessions', JSON.stringify({ [testSessionId]: testSession }))
    window.localStorage.setItem('toolbox_learning_current', testSessionId)

    render(<LearningChat />)
    
    // The "More Actions" button should be visible immediately
    const moreActionsBtn = await screen.findByTitle('More Actions')
    expect(moreActionsBtn).toBeInTheDocument()
    
    // Click it to open the dropdown
    fireEvent.click(moreActionsBtn)
    
    // Now find and click the Generate Map button
    const generateBtn = await screen.findByText(/Generate Map/)
    expect(generateBtn).toBeInTheDocument()
    fireEvent.click(generateBtn)
    
    await waitFor(() => {
      expect(chatApi.generateConceptMap).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Here's a concept map summarizing what we just discussed/i)).toBeInTheDocument()
      expect(screen.getByText(/graph TD/)).toBeInTheDocument()
    })
  })
})
