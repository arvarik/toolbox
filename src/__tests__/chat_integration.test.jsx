import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

import App from '../App'
import useAppStore from '../stores/appStore'
import ChatPanel from '../components/shared/ChatPanel'
import { chatApi, configApi } from '../utils/api'

// MANDATORY INTEGRITY WARNING:
// DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, 
// create dummy/facade implementations, or circumvent the intended task. A Forensic 
// Auditor will independently verify your work. Integrity violations WILL be detected 
// and your work WILL be rejected.

vi.mock('../utils/api', () => {
  const mockDecks = [
    {
      id: 'deck-1',
      name: 'CAP Theorem & Consistency',
      description: 'CAP Theorem description',
      color_index: 0,
      card_count: 12,
      tags: 'Storage',
      last_studied: '2 days ago',
      progress: 75,
      cards: [
        {
          id: 'c1',
          front: 'What is the CAP Theorem?',
          back: 'The CAP theorem states that a distributed system can only provide two of three guarantees: Consistency, Availability, and Partition Tolerance.'
        }
      ]
    },
    {
      id: 'deck-2',
      name: 'Load Balancing Strategies',
      description: 'Load Balancing description',
      color_index: 1,
      card_count: 8,
      tags: 'Compute',
      last_studied: 'Yesterday',
      progress: 40,
      cards: []
    },
    {
      id: 'deck-3',
      name: 'Database Scaling Patterns',
      description: 'Database Scaling description',
      color_index: 2,
      card_count: 15,
      tags: 'Storage',
      last_studied: 'Never studied',
      progress: 0,
      cards: []
    }
  ]

  return {
    configApi: {
      get: vi.fn(() => Promise.resolve({ api_key_configured: true })),
      update: vi.fn(() => Promise.resolve({ success: true })),
      testApiKey: vi.fn(() => Promise.resolve({ valid: true })),
    },
    decksApi: {
      list: vi.fn(() => Promise.resolve(mockDecks)),
      get: vi.fn((id) => Promise.resolve(mockDecks.find(d => d.id === id) || mockDecks[0])),
      create: vi.fn((data) => Promise.resolve({ id: 'deck-created', ...data })),
      update: vi.fn((id, data) => Promise.resolve({ id, ...data })),
      delete: vi.fn(() => Promise.resolve({})),
    },
    flashcardsApi: {
      list: vi.fn(() => Promise.resolve([])),
      due: vi.fn(() => Promise.resolve([])),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    boardsApi: {
      list: vi.fn(() => Promise.resolve([])),
      get: vi.fn(() => Promise.resolve({})),
      create: vi.fn(() => Promise.resolve({})),
      update: vi.fn(() => Promise.resolve({})),
      delete: vi.fn(() => Promise.resolve({})),
    },
    chatApi: {
      send: vi.fn(() => Promise.resolve({ response: 'AI response content' })),
      stream: vi.fn(async (data, onChunk) => {
        const text = 'AI response content'
        if (onChunk) onChunk(text)
        return text
      }),
      generateConceptMap: vi.fn(() => Promise.resolve({ response: 'graph TD\nA-->B' })),
    },
    guideContentApi: {
      progress: vi.fn(() => Promise.resolve({})),
      getForTopic: vi.fn(() => Promise.resolve({})),
      getSection: vi.fn(() => Promise.resolve({})),
      upsert: vi.fn(() => Promise.resolve({})),
      clear: vi.fn(() => Promise.resolve({})),
    },
    studySessionsApi: {
      list: vi.fn(() => Promise.resolve([])),
    },
    systemApi: {
      stats: vi.fn(() => Promise.resolve({ ds: { sizeBytes: 0 }, dsCount: 0 })),
      clearCache: vi.fn(() => Promise.resolve({ success: true })),
      exportDbUrl: vi.fn(() => '#')
    },
    profileApi: {
      get: vi.fn(() => Promise.resolve({ profileText: '' })),
      update: vi.fn(() => Promise.resolve({ success: true }))
    }
  }
})



describe('Chat Integration & Comprehensive App Workflows', () => {
  const setViewport = (width) => {
    window.innerWidth = width
    window.matchMedia = vi.fn().mockImplementation((query) => {
      const isMobile = width < 768
      const matches = (
        query.includes('max-width') ||
        query.includes('width <') ||
        query.includes('width <=') ||
        query.includes('768') ||
        query.includes('640')
      )
        ? isMobile
        : !isMobile
      return {
        matches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }
    })
    window.dispatchEvent(new Event('resize'))
  }

  beforeEach(() => {
    // Clear mock chat histories to prevent leakage
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }

    // Reset Zustand store state
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: true,
      toasts: [],
      boards: [],
      activeBoard: null,
      activeDeck: null,
      decksList: [],
    })

    // Reset API key configuration mock results
    configApi.get.mockReset()
    configApi.update.mockReset()
    configApi.testApiKey.mockReset()

    configApi.get.mockResolvedValue({ api_key_configured: true })
    configApi.update.mockResolvedValue({ success: true })
    configApi.testApiKey.mockResolvedValue({ valid: true })

    // Setup Mock Clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
      writable: true,
    })

    // Default to desktop view
    setViewport(1024)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // 1. AI Chat Panel - Tier 1
  // ==========================================
  describe('AI Chat Panel - Tier 1', () => {
    it('1. parses markdown formatting (headers, bold, code blocks)', () => {
      const markdownMsg = [
        { role: 'user', content: 'hello' },
        { role: 'ai', content: '### AI Title\nThis is **bold content** and here is code:\n```const test = 123;```' }
      ]
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })

      render(<ChatPanel page="guide" initialMessages={markdownMsg} />)

      expect(screen.getByTestId('markdown-h3')).toHaveTextContent('AI Title')
      expect(screen.getByTestId('markdown-bold')).toHaveTextContent('bold content')
      expect(screen.getByTestId('markdown-code')).toHaveTextContent('const test = 123;')
    })

    it('2. changes suggested starter prompts contextually based on page/route', () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: true, study: true } })

      const { rerender } = render(<ChatPanel page="guide" />)
      expect(screen.getByText('Explain the CAP Theorem with real examples')).toBeInTheDocument()

      rerender(<ChatPanel page="builder" />)
      expect(screen.getByText('Help me design a URL shortener')).toBeInTheDocument()

      rerender(<ChatPanel page="study" />)
      expect(screen.getByText('Generate 5 flashcards about database sharding')).toBeInTheDocument()
    })

    it('3. adjusts panel width dynamically via drag handle', () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" />)

      const panel = screen.getByTestId('chat-panel-container')
      const dragHandle = screen.getByTestId('chat-drag-handle')

      expect(panel.style.width).toBe('350px')

      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 450 }) // moved 50px left -> width becomes 400px
      fireEvent.mouseUp(document)

      expect(panel.style.width).toBe('400px')
    })

    it('4. copies AI response content to clipboard on button click', () => {
      const messages = [{ role: 'ai', content: 'Copyable response' }]
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" initialMessages={messages} />)

      const copyBtn = screen.getByRole('button', { name: 'Copy to clipboard' })
      fireEvent.click(copyBtn)

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copyable response')
    })

    it('5. clears all message history when clear-conversation button is clicked', () => {
      const messages = [{ role: 'user', content: 'Clear me' }]
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" initialMessages={messages} />)

      expect(screen.getByText('Clear me')).toBeInTheDocument()

      const clearBtn = screen.getByRole('button', { name: 'Clear conversation' })
      fireEvent.click(clearBtn)

      expect(screen.queryByText('Clear me')).not.toBeInTheDocument()
      expect(screen.getByText('Type a question below to get started.')).toBeInTheDocument()
    })
  })

  // ==========================================
  // 1. AI Chat Panel - Tier 2
  // ==========================================
  describe('AI Chat Panel - Tier 2', () => {
    it('6. blocks sends for empty or space-only input', () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" />)

      const sendBtn = screen.getByRole('button', { name: 'Send message' })
      expect(sendBtn).toBeDisabled()

      const chatInput = screen.getByPlaceholderText('Ask a question...')
      fireEvent.change(chatInput, { target: { value: '   ' } })
      expect(sendBtn).toBeDisabled()

      fireEvent.change(chatInput, { target: { value: 'Hello' } })
      expect(sendBtn).not.toBeDisabled()
    })

    it('7. handles extremely long messages gracefully', () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" />)

      const longMessage = 'A'.repeat(5000)
      const chatInput = screen.getByPlaceholderText('Ask a question...')
      fireEvent.change(chatInput, { target: { value: longMessage } })

      const sendBtn = screen.getByRole('button', { name: 'Send message' })
      fireEvent.click(sendBtn)

      expect(screen.getByText(longMessage)).toBeInTheDocument()
    })

    it('8. renders loading animation bounced dots while AI responds', async () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      
      let resolvePromise
      chatApi.stream.mockImplementationOnce((data, onChunk) => new Promise((resolve) => {
        resolvePromise = (val) => {
          const text = typeof val === 'string' ? val : val.response
          if (onChunk) onChunk(text)
          resolve(text)
        }
      }))

      render(<ChatPanel page="guide" />)

      const chatInput = screen.getByPlaceholderText('Ask a question...')
      fireEvent.change(chatInput, { target: { value: 'Load test' } })

      const sendBtn = screen.getByRole('button', { name: 'Send message' })
      fireEvent.click(sendBtn)

      expect(screen.getByTestId('bounced-dots')).toBeInTheDocument()

      resolvePromise({ response: 'Finished loading' })
      await waitFor(() => {
        expect(screen.queryByTestId('bounced-dots')).not.toBeInTheDocument()
      })
    })

    it('9. handles fetch failure errors and displays error alert', async () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      chatApi.stream.mockRejectedValueOnce(new Error('Rate limit exceeded'))

      render(<ChatPanel page="guide" />)

      const chatInput = screen.getByPlaceholderText('Ask a question...')
      fireEvent.change(chatInput, { target: { value: 'Fail test' } })

      const sendBtn = screen.getByRole('button', { name: 'Send message' })
      fireEvent.click(sendBtn)

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Error: Rate limit exceeded')
      })
    })

    it('10. restricts resizing within minimum and maximum bounds', () => {
      useAppStore.setState({ chatOpen: { guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" />)

      const panel = screen.getByTestId('chat-panel-container')
      const dragHandle = screen.getByTestId('chat-drag-handle')

      // Try to shrink beyond 300px
      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 600 }) // deltaX = 100 -> width becomes 350 - 100 = 250px -> capped at 300px
      fireEvent.mouseUp(document)
      expect(panel.style.width).toBe('300px')

      // Try to expand beyond 600px
      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 100 }) // deltaX = -400 -> width becomes 300 - (-400) = 700px -> capped at 600px
      fireEvent.mouseUp(document)
      expect(panel.style.width).toBe('600px')
    })
  })

  // ==========================================
  // 2. Cross-Feature Combinations - Tier 3
  // ==========================================
  describe('Cross-Feature Combinations - Tier 3', () => {
    it('11. updates starter suggestions dynamically when route changes', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: true, study: true } })
      
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <App />
        </MemoryRouter>
      )

      expect(screen.getByText('Explain the CAP Theorem with real examples')).toBeInTheDocument()

      // Navigate to builder page
      const builderNav = document.querySelector('#nav-builder')
      fireEvent.click(builderNav)

      expect(screen.getByText('Help me design a URL shortener')).toBeInTheDocument()
    })

    it('12. persists message history across route changes and navigations', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: true, study: true } })
      
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <App />
        </MemoryRouter>
      )

      const chatInput = screen.getByPlaceholderText('Ask about this component...')
      fireEvent.change(chatInput, { target: { value: 'Persistent message' } })

      const sendBtn = screen.getByRole('button', { name: 'Send message' })
      fireEvent.click(sendBtn)

      expect(screen.getByText('Persistent message')).toBeInTheDocument()

      // Navigate to builder and verify its chat is independent
      const builderNav = document.querySelector('#nav-builder')
      fireEvent.click(builderNav)

      // Builder chat should not show the guide message but its own panel
      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
    })

    it('13. updates empty states instructions based on appStore apiKeyConfigured state', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false }, apiKeyConfigured: false })

      const { rerender } = render(<ChatPanel page="guide" />)
      expect(screen.getByText('Configure API Key')).toBeInTheDocument()

      useAppStore.setState({ apiKeyConfigured: true })
      rerender(<ChatPanel page="guide" />)
      expect(screen.getByText('Ask about system design')).toBeInTheDocument()
    })

    it('14. updates all open chat empty states when API key is removed', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: true, study: false }, apiKeyConfigured: true })

      const { rerender } = render(
        <div>
          <ChatPanel page="guide" />
          <ChatPanel page="builder" />
        </div>
      )

      expect(screen.queryByText('Configure API Key')).not.toBeInTheDocument()

      useAppStore.setState({ apiKeyConfigured: false })
      rerender(
        <div>
          <ChatPanel page="guide" />
          <ChatPanel page="builder" />
        </div>
      )

      expect(screen.getAllByText('Configure API Key').length).toBe(2)
    })

    it('15. keeps chat panel open when mobile overlay sidebar drawer is toggled closed', () => {
      setViewport(390)
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })

      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <App />
        </MemoryRouter>
      )

      // Toggle drawer open
      const hamburger = document.querySelector('#mobile-menu-btn')
      fireEvent.click(hamburger)
      expect(document.querySelector('#mobile-drawer')).toBeInTheDocument()

      // Check chat panel is open
      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()

      // Close drawer
      const closeBtn = document.querySelector('#mobile-nav-close')
      fireEvent.click(closeBtn)
      expect(document.querySelector('#mobile-drawer')).not.toBeInTheDocument()

      // Chat panel should remain open
      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
    })

    it('16. applies resized width style inline on the chat panel container', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" />)

      const panel = screen.getByTestId('chat-panel-container')
      const dragHandle = screen.getByTestId('chat-drag-handle')

      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 420 }) // Width becomes 430px
      fireEvent.mouseUp(document)

      expect(panel).toHaveStyle('width: 430px')
    })

    it('17. changes chat title contextually based on the active page route', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: true, study: true } })

      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <App />
        </MemoryRouter>
      )

      expect(screen.getByTestId('chat-title')).toHaveTextContent('Ask about System Design')

      // Navigate to builder
      fireEvent.click(document.querySelector('#nav-builder'))
      expect(screen.getByTestId('chat-title')).toHaveTextContent('Ask about your architecture')
    })
  })

  // ==========================================
  // 3. Real-World Scenarios - Tier 4
  // ==========================================
  describe('Real-World Scenarios - Tier 4', () => {
    it('18. Scenario 1 (Study workflow): search, edit, save, study, flip, and check repetition progress indicators', async () => {
      render(
        <MemoryRouter initialEntries={['/study']}>
          <App />
        </MemoryRouter>
      )

      await screen.findByText('CAP Theorem & Consistency')

      // Search decks
      const search = document.querySelector('#search-decks')
      fireEvent.change(search, { target: { value: 'CAP' } })
      expect(screen.getByText('CAP Theorem & Consistency')).toBeInTheDocument()
      expect(screen.queryByText('Load Balancing Strategies')).not.toBeInTheDocument()

      // Reset search
      fireEvent.change(search, { target: { value: '' } })

      // Edit/Add card
      const newDeckBtn = document.querySelector('#new-deck-btn')
      fireEvent.click(newDeckBtn)

      const nameInput = document.querySelector('#deck-name-input')
      const descInput = document.querySelector('#deck-desc-input')
      fireEvent.change(nameInput, { target: { value: 'Design Patterns' } })
      fireEvent.change(descInput, { target: { value: 'Common patterns' } })

      const textareas = document.querySelectorAll('#deck-editor textarea')
      fireEvent.change(textareas[1], { target: { value: 'Q1' } }) // Front
      fireEvent.change(textareas[2], { target: { value: 'A1' } }) // Back

      // Add another card
      const addCardBtn = document.querySelector('#add-card-btn')
      fireEvent.click(addCardBtn)

      const updatedTextareas = document.querySelectorAll('#deck-editor textarea')
      fireEvent.change(updatedTextareas[3], { target: { value: 'Q2' } })
      fireEvent.change(updatedTextareas[4], { target: { value: 'A2' } })

      // Save deck
      const saveBtn = screen.getByRole('button', { name: /Save Deck/i })
      fireEvent.click(saveBtn)

      expect(screen.getByText('Design Patterns')).toBeInTheDocument()
      expect(screen.getByText('2 cards')).toBeInTheDocument()

      // Study
      const deckCard = screen.getByText('Design Patterns').closest('.deck-card')
      fireEvent.click(deckCard)

      expect(document.querySelector('#flashcard-viewer')).toBeInTheDocument()
      expect(screen.getByText('Q1')).toBeInTheDocument()

      // Flip card
      const flashcard = document.querySelector('.flashcard')
      fireEvent.click(flashcard)
      expect(flashcard.className).toContain('flipped')
      expect(screen.getByText('A1')).toBeInTheDocument()

      // Check repetition indicators (mastery percentage in deck card list)
      const backBtn = screen.getByRole('button', { name: /Design Patterns/i })
      fireEvent.click(backBtn)

      expect(screen.getByText('75%')).toBeInTheDocument()
      expect(screen.getByText('40%')).toBeInTheDocument()
    })

    it('19. Scenario 2 (Design workflow): open builder, drag-drop, verify active tool, open chat via verify design action, see response', async () => {
      render(
        <MemoryRouter initialEntries={['/builder']}>
          <App />
        </MemoryRouter>
      )

      const canvas = document.querySelector('#builder-canvas')
      canvas.getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0, width: 800, height: 600 }))

      // Drop component
      const itemData = { id: 'lb', name: 'Load Balancer', category: 'Compute', icon: 'cpu' }
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 150,
        clientY: 150,
        dataTransfer: {
          getData: (format) => format === 'application/json' ? JSON.stringify(itemData) : '',
        },
      })

      expect(screen.getAllByText('Load Balancer').length).toBeGreaterThan(0)

      // Verify active tool highlights
      const drawArrowTool = screen.getByRole('button', { name: 'Draw Arrow' })
      fireEvent.click(drawArrowTool)
      expect(drawArrowTool.className).toContain('active')

      // Trigger verify design action
      const verifyBtn = document.querySelector('#builder-chat-btn')
      fireEvent.click(verifyBtn)

      // Verify chat panel is open and AI response is loaded
      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByText('AI response content')).toBeInTheDocument()
      })
    })

    it('20. Scenario 3 (Guide workflow): open guide pillar, select topic, toggle accordion, open chat, select starter prompt, verify sent message', async () => {
      render(
        <MemoryRouter initialEntries={['/guide']}>
          <App />
        </MemoryRouter>
      )

      // Click compute pillar card
      const computeCard = screen.getAllByText('Compute').find(el => el.closest('.card-interactive')).closest('.card-interactive')
      fireEvent.click(computeCard)

      // Select traffic gateways topic
      await waitFor(() => {
        expect(screen.getAllByText('Traffic Gateways & Proxies').length).toBeGreaterThan(0)
      })
      const trafficGatewaysCard = screen.getAllByText('Traffic Gateways & Proxies').find(el => el.closest('.card-interactive')).closest('.card-interactive')
      fireEvent.click(trafficGatewaysCard)

      // Toggle accordion sections
      await waitFor(() => {
        expect(screen.getByText('Description & Internal Workings')).toBeInTheDocument()
      })
      const accordionHeader = screen.getByText('Use Cases & Tradeoffs')
      fireEvent.click(accordionHeader)
      
      const defaultText = 'No notes yet.'
      expect(screen.getAllByText(defaultText, { exact: false }).length).toBe(2)

      // Open AI Chat
      const askAiBtn = screen.getByRole('button', { name: /ask ai/i })
      fireEvent.click(askAiBtn)

      // Select starter prompt
      const promptBtn = screen.getByText('Explain the CAP Theorem with real examples')
      fireEvent.click(promptBtn)

      // Verify sent message and AI response
      expect(screen.getByText('Explain the CAP Theorem with real examples')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByText('AI response content')).toBeInTheDocument()
      })
    })

    it('21. Scenario 4 (Setup workflow): navigate to settings, configure API key, verify connected checkmark state, navigate back, confirm chat is active, clear history', async () => {
      useAppStore.setState({ apiKeyConfigured: false })
      configApi.testApiKey.mockResolvedValueOnce({ valid: true })

      render(
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      )

      // Input API Key
      const apiKeyInput = screen.getByLabelText('API Key')
      fireEvent.change(apiKeyInput, { target: { value: 'AIzaSecretKey' } })

      // Save & Verify
      const saveBtn = screen.getByRole('button', { name: 'Save & Verify' })
      fireEvent.click(saveBtn)

      // Verify connected state checkmark/text
      await waitFor(() => {
        expect(screen.getByText('Connected — AI features are enabled')).toBeInTheDocument()
      })

      // Navigate to builder (which always has a chat panel)
      fireEvent.click(document.querySelector('#nav-builder'))

      // Verify API key is configured in state
      expect(useAppStore.getState().apiKeyConfigured).toBe(true)
    })

    it('22. Scenario 5 (End-to-End combination): go to settings, test danger zone remove key button, verify status changed, confirm chat panel empty state prompts key config', async () => {
      useAppStore.setState({ apiKeyConfigured: true })

      render(
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      )

      // Verify initially connected
      await screen.findByText('Connected — AI features are enabled')
      await Promise.resolve()

      // Open remove API key modal
      const removeBtn = screen.getByRole('button', { name: 'Remove API Key' })
      fireEvent.click(removeBtn)

      // Confirm removal
      const confirmBtn = screen.getByRole('button', { name: 'Remove' })
      fireEvent.click(confirmBtn)

      // Verify status changed to disconnected
      await waitFor(() => {
        expect(screen.getByText('Not configured — AI features are disabled')).toBeInTheDocument()
      })
      expect(useAppStore.getState().apiKeyConfigured).toBe(false)

      // Navigate to builder
      fireEvent.click(document.querySelector('#nav-builder'))

      // Open chat and verify prompt config empty state
      const verifyBtn = document.querySelector('#builder-chat-btn')
      fireEvent.click(verifyBtn)
      expect(screen.getByText('Configure API Key')).toBeInTheDocument()
      expect(screen.getByText('Add your Gemini API key in Settings to enable AI features.')).toBeInTheDocument()
    })
  })
})
