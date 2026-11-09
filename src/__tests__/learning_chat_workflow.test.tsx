import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import App from '../App'
import ChatPage from '../pages/ChatPage'
import CommitModal from '../components/chat/CommitModal'
import LearningChat from '../components/chat/LearningChat'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import useKitStore, { type KitDetailItem } from '../stores/useKitStore'

const MOCK_DECKS = [
  {
    id: 'deck-1',
    name: 'CAP Theorem & Consistency',
    description: 'CAP Theorem description',
    color_index: 0,
    card_count: 12,
    tags: 'Storage',
    last_studied: '2 days ago',
    progress: 75,
    cards: [{ id: 'c1', front: 'What is the CAP Theorem?', back: 'Consistency, Availability, Partition Tolerance.' }],
  },
]

const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configUpdate: vi.fn(),
  testApiKey: vi.fn(),
  chatStream: vi.fn(),
  generateConceptMap: vi.fn(),
  getSessions: vi.fn(),
  saveSession: vi.fn(),
  deleteSession: vi.fn(),
  migrateBulk: vi.fn(),
}))

vi.mock('../utils/api', () => ({
  configApi: {
    get: (...args: unknown[]) => mocks.configGet(...args),
    update: (...args: unknown[]) => mocks.configUpdate(...args),
    testApiKey: (...args: unknown[]) => mocks.testApiKey(...args),
    getAvailableModels: vi.fn(() => Promise.resolve({ groups: [], providers: [] })),
    refreshModels: vi.fn(() => Promise.resolve({ groups: [], providers: [], errors: {} })),
  },
  endpointsApi: {
    list: vi.fn(() => Promise.resolve([])),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({ success: true })),
    test: vi.fn(() => Promise.resolve({ ok: true, modelCount: 0 })),
    refreshModels: vi.fn(() => Promise.resolve({ models: [] })),
  },
  decksApi: {
    list: vi.fn(() => Promise.resolve(MOCK_DECKS)),
    get: vi.fn(() => Promise.resolve(MOCK_DECKS[0])),
    create: vi.fn((data: Record<string, unknown>) => Promise.resolve({ id: 'deck-created', ...data })),
    update: vi.fn((id: string, data: Record<string, unknown>) => Promise.resolve({ id, ...data })),
    delete: vi.fn(() => Promise.resolve({})),
  },
  flashcardsApi: {
    list: vi.fn(() => Promise.resolve([])),
    due: vi.fn(() => Promise.resolve([])),
    dueAll: vi.fn(() => Promise.resolve([])),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  boardsApi: {
    list: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve({})),
    create: vi.fn(() => Promise.resolve({ id: 'board-1', name: 'Untitled Board' })),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'AI response content' })),
    stream: (...args: unknown[]) => mocks.chatStream(...args),
    generateConceptMap: (...args: unknown[]) => mocks.generateConceptMap(...args),
    getSessions: (...args: unknown[]) => mocks.getSessions(...args),
    saveSession: (...args: unknown[]) => mocks.saveSession(...args),
    deleteSession: (...args: unknown[]) => mocks.deleteSession(...args),
    migrateBulk: (...args: unknown[]) => mocks.migrateBulk(...args),
    commitAnalyze: vi.fn(() => Promise.resolve({ updates: [] })),
    commitSave: vi.fn(() => Promise.resolve({ savedCount: 0 })),
  },
  guideContentApi: {
    progress: vi.fn(() => Promise.resolve({})),
    getForTopic: vi.fn(() => Promise.resolve({})),
    getSection: vi.fn(() => Promise.resolve({})),
    upsert: vi.fn(() => Promise.resolve({})),
    clear: vi.fn(() => Promise.resolve({})),
    listArchived: vi.fn(() => Promise.resolve({ notes: [] })),
  },
  studySessionsApi: {
    list: vi.fn(() => Promise.resolve([])),
  },
  systemApi: {
    stats: vi.fn(() => Promise.resolve({ guideCount: 0, flashcardsCount: 0, boardsCount: 0, cachedStartersCount: 0 })),
    clearCache: vi.fn(() => Promise.resolve({ success: true })),
    exportDbUrl: vi.fn(() => '#'),
  },
  profileApi: {
    get: vi.fn(() => Promise.resolve({ profileText: '' })),
    update: vi.fn(() => Promise.resolve({ success: true })),
  },
  kitsApi: {
    list: vi.fn(() => Promise.resolve({ kits: [] })),
    get: vi.fn(() => Promise.resolve(null)),
  },
}))

function setViewport(width: number) {
  window.innerWidth = width
  window.matchMedia = vi.fn().mockImplementation((query: string) => {
    const isMobile = width < 768
    const matches =
      query.includes('max-width') ||
      query.includes('width <') ||
      query.includes('width <=') ||
      query.includes('768') ||
      query.includes('640')
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

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Missing ${selector}`)
  return el
}

describe('ChatPanel, LearningChat & Cross-Feature Chat Workflows', () => {
  let serverSessions: Record<string, unknown>

  beforeEach(() => {
    serverSessions = {}
    window.localStorage?.clear()
    window.HTMLElement.prototype.scrollIntoView = vi.fn()

    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: true,
      model: 'gemini-3.5-flash',
      toasts: [],
      nodes: [],
      edges: [],
    })
    useCommitStore.getState().closeCompletely()
    useKitStore.setState({
      kits: [],
      activeKitSlug: null,
      activeKit: null,
      kitCache: {},
      isLoadingList: false,
      isLoadingActive: false,
    })

    mocks.configGet.mockResolvedValue({
      api_key_configured: true,
      api_keys_configured: { gemini: true, claude: false },
    })
    mocks.configUpdate.mockResolvedValue({ success: true })
    mocks.testApiKey.mockResolvedValue({ valid: true })

    mocks.chatStream.mockImplementation(async (_data: unknown, onChunk?: (chunk: string) => void) => {
      const text = 'AI response content'
      onChunk?.(text)
      return text
    })
    mocks.generateConceptMap.mockResolvedValue({
      response: '```mermaid\ngraph TD\nA-->B\n```',
    })
    mocks.getSessions.mockImplementation(() => Promise.resolve({ ...serverSessions }))
    mocks.saveSession.mockImplementation((session: { id: string }) => {
      serverSessions[session.id] = session
      return Promise.resolve({})
    })
    mocks.deleteSession.mockImplementation((id: string) => {
      delete serverSessions[id]
      return Promise.resolve({})
    })
    mocks.migrateBulk.mockImplementation((sessions: Record<string, unknown>) => {
      serverSessions = { ...serverSessions, ...sessions }
      return Promise.resolve({})
    })

    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
    })

    setViewport(1024)
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  describe('ChatPanel Core & Edge Workflows', () => {
    it('1. renders markdown formatting, copies AI responses, and clears conversation history', () => {
      const markdownMsg = [
        { role: 'user', content: 'Clear me' },
        { role: 'ai', content: '### AI Title\nThis is **bold content** and here is code:\n```const test = 123;```' },
      ]
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" initialMessages={markdownMsg} />)

      expect(screen.getByTestId('markdown-h3')).toHaveTextContent('AI Title')
      expect(screen.getByTestId('markdown-bold')).toHaveTextContent('bold content')
      expect(screen.getByTestId('markdown-code')).toHaveTextContent('const test = 123;')

      fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(markdownMsg[1].content)

      fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
      expect(screen.queryByText('Clear me')).not.toBeInTheDocument()
      expect(screen.getByText('Type a question below to get started.')).toBeInTheDocument()
    })

    it('2. adapts contextual starter prompts and empty states to page and apiKeyConfigured state', () => {
      useAppStore.setState({
        chatOpen: { chat: false, guide: true, builder: true, study: true },
        apiKeyConfigured: true,
      })

      const { rerender } = render(<ChatPanel page="guide" />)
      expect(screen.getByText('Explain the CAP Theorem with real examples')).toBeInTheDocument()

      rerender(<ChatPanel page="builder" />)
      expect(screen.getByText('Help me design a URL shortener')).toBeInTheDocument()

      rerender(<ChatPanel page="study" />)
      expect(screen.getByText('Generate 5 flashcards about database sharding')).toBeInTheDocument()

      useAppStore.setState({ apiKeyConfigured: false })
      rerender(
        <div>
          <ChatPanel page="guide" />
          <ChatPanel page="builder" />
        </div>
      )
      expect(screen.getAllByText('Configure API Key').length).toBe(2)
    })

    it('3. resizes panel width via drag handle within [300px, 600px] bounds', () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })
      render(<ChatPanel page="guide" />)

      const panel = screen.getByTestId('chat-panel-container')
      const dragHandle = screen.getByTestId('chat-drag-handle')
      expect(panel.style.width).toBe('350px')

      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 420 })
      fireEvent.mouseUp(document)
      expect(panel).toHaveStyle('width: 430px')

      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 700 })
      fireEvent.mouseUp(document)
      expect(panel.style.width).toBe('300px')

      fireEvent.mouseDown(dragHandle, { clientX: 500 })
      fireEvent.mouseMove(document, { clientX: 100 })
      fireEvent.mouseUp(document)
      expect(panel.style.width).toBe('600px')
    })

    it('4. validates input, handles long messages, shows loading indicator, and surfaces stream errors', async () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })

      let resolveStream!: (text: string) => void
      mocks.chatStream.mockImplementationOnce(
        (_data: unknown, onChunk?: (chunk: string) => void) =>
          new Promise<string>((resolve) => {
            resolveStream = (text: string) => {
              onChunk?.(text)
              resolve(text)
            }
          })
      )

      render(<ChatPanel page="guide" />)
      const sendBtn = screen.getByRole('button', { name: 'Send message' })
      const chatInput = screen.getByPlaceholderText('Ask a question...')

      expect(sendBtn).toBeDisabled()
      fireEvent.change(chatInput, { target: { value: '   ' } })
      expect(sendBtn).toBeDisabled()

      const longMessage = 'A'.repeat(5000)
      fireEvent.change(chatInput, { target: { value: longMessage } })
      expect(sendBtn).not.toBeDisabled()
      fireEvent.click(sendBtn)

      expect(screen.getByText(longMessage)).toBeInTheDocument()
      expect(screen.getByTestId('chat-loading')).toBeInTheDocument()

      resolveStream('Finished loading')
      await waitFor(() => {
        expect(screen.queryByTestId('bounced-dots')).not.toBeInTheDocument()
      })

      mocks.chatStream.mockRejectedValueOnce(new Error('Rate limit exceeded'))
      fireEvent.change(chatInput, { target: { value: 'Fail test' } })
      fireEvent.click(sendBtn)
      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Error: Rate limit exceeded')
      })
    })
  })

  describe('LearningChat & Multi-Kit Session Workflows', () => {
    it('5. switches persona via PersonaPicker and applies updated persona instructions on new session stream', async () => {
      render(<LearningChat />)

      fireEvent.click(
        screen.getByText('Explain consistent hashing with a concrete example and when I should use it')
      )
      await waitFor(() => {
        expect(mocks.chatStream).toHaveBeenCalledTimes(1)
        const firstArgs = mocks.chatStream.mock.calls[0][0] as { context: string }
        expect(firstArgs.context).toContain('Socratic questioning')
      })

      fireEvent.click(screen.getByTitle('Change AI Persona'))
      fireEvent.click(screen.getByText('Strict'))

      fireEvent.click(q('#session-picker-btn'))
      fireEvent.click(screen.getByText('New Session'))

      fireEvent.click(
        screen.getByText('Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale')
      )
      await waitFor(() => {
        expect(mocks.chatStream).toHaveBeenCalledTimes(2)
        const secondArgs = mocks.chatStream.mock.calls[1][0] as { context: string }
        expect(secondArgs.context).toContain('highly demanding, intense, and strict')
      })
    })

    it('6. generates a Mermaid concept map from More Actions and opens CommitModal from ChatPage', async () => {
      const testSessionId = 'session-topic-1'
      const testSession = {
        id: testSessionId,
        name: 'Traffic Gateways Study',
        pillarId: 'compute',
        topicId: 'traffic-gateways',
        topicName: 'Traffic Gateways & Proxies',
        createdAt: new Date().toISOString(),
        messages: [
          { id: '1', role: 'user', content: 'How do L4 and L7 load balancers differ?' },
          { id: '2', role: 'ai', content: 'L4 operates at transport layer; L7 inspects HTTP.' },
          { id: '3', role: 'user', content: 'When should I terminate TLS at L7?' },
          { id: '4', role: 'ai', content: 'When routing by path/header or offloading certs.' },
        ],
      }
      window.localStorage.setItem('toolbox_learning_sessions', JSON.stringify({ [testSessionId]: testSession }))
      window.localStorage.setItem('toolbox_learning_current', testSessionId)

      render(
        <MemoryRouter initialEntries={['/chat']}>
          <ChatPage />
          <CommitModal />
        </MemoryRouter>
      )

      const moreActionsBtn = await screen.findByTitle('More Actions')
      fireEvent.click(moreActionsBtn)
      fireEvent.click(await screen.findByText(/Generate Map/))

      await waitFor(() => {
        expect(mocks.generateConceptMap).toHaveBeenCalledTimes(1)
        expect(screen.getByText(/Here's a concept map summarizing what we just discussed/i)).toBeInTheDocument()
        expect(document.querySelector('.mermaid-wrapper') || screen.queryByText(/graph TD/)).toBeTruthy()
      })

      // Commit to Guide button is enabled for topic-linked sessions and opens CommitModal
      const commitBtn = q<HTMLButtonElement>('#commit-to-guide-btn')
      expect(commitBtn).not.toBeDisabled()
      fireEvent.click(commitBtn)
      await waitFor(() => {
        expect(document.getElementById('commit-modal')).toBeInTheDocument()
      })
    })

    it('7. attaches X-Toolbox-Kit on /api/chat/starters and isolates localStorage sessions per Kit without cross-Kit leakage', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ suggestions: ['Explain ownership transfer in Rust'] }),
      })
      vi.stubGlobal('fetch', fetchMock)

      // Seed a System Design session in default localStorage
      const sysSession = {
        id: 'sys-session-1',
        name: 'System Design CAP Chat',
        createdAt: new Date().toISOString(),
        messages: [{ id: 'm1', role: 'user', content: 'System Design secret message' }],
      }
      window.localStorage.setItem('toolbox_learning_sessions', JSON.stringify({ 'sys-session-1': sysSession }))
      window.localStorage.setItem('toolbox_learning_current', 'sys-session-1')

      const rustSkeleton = structuredClone(SYSTEM_DESIGN_KIT_SKELETON)
      rustSkeleton.identity = { ...rustSkeleton.identity, slug: 'distributed-rust', name: 'Distributed Rust' }
      rustSkeleton.pillars = [
        {
          id: 'ownership',
          number: 1,
          name: 'Ownership & Borrowing',
          shortName: 'Ownership',
          color: '#f97316',
          sections: [
            {
              id: 'mechanics',
              name: 'Borrow Mechanics',
              icon: 'cpu',
              promptHint: 'Explain aliasing XOR mutability.',
              ownershipRule: 'Owns core borrow rules.',
            },
          ],
          topics: [
            {
              id: 'move-semantics',
              name: 'Move Semantics',
              summary: 'Affine ownership transfer.',
            },
          ],
        },
      ]
      const rustKit: KitDetailItem = {
        id: 'kit-rust-1',
        slug: 'distributed-rust',
        name: 'Distributed Rust',
        description: 'Rust concurrency',
        icon: '🦀',
        color: '#f97316',
        status: 'ready',
        statusDetail: null,
        forkedFromSharedId: null,
        forkedVersion: 1,
        upstreamSlug: null,
        upstreamLatestVersion: null,
        hasUpstreamUpdate: false,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
        lastOpenedAt: null,
        pillarCount: 1,
        topicCount: 1,
        nodeCount: 1,
        capabilities: rustSkeleton.capabilities,
        deckCount: 0,
        cardCount: 0,
        dueCount: 0,
        newCount: 0,
        reviewedCount: 0,
        masteryPercent: 0,
        guideFilledCount: 0,
        guideTotalCount: 1,
        archivedNotesCount: 0,
        drillCount: 0,
        skeleton: rustSkeleton,
      }
      useCommitStore.getState().closeCompletely()
    useKitStore.setState({
        kits: [rustKit],
        activeKitSlug: 'distributed-rust',
        activeKit: rustKit,
        kitCache: { 'distributed-rust': rustKit },
      })

      function KitChatRouter() {
        const navigate = useNavigate()
        return (
          <>
            <button
              data-testid="open-rust-topic"
              onClick={() => navigate('/k/distributed-rust/chat')}
            >
              Stay in Rust
            </button>
            <Routes>
              <Route
                path="/k/:slug/chat"
                element={
                  <LearningChat
                    routeKitSlug="distributed-rust"
                    activeTopic={{
                      pillar: rustSkeleton.pillars[0],
                      topic: rustSkeleton.pillars[0].topics[0],
                    }}
                  />
                }
              />
            </Routes>
          </>
        )
      }

      render(
        <MemoryRouter initialEntries={['/k/distributed-rust/chat']}>
          <KitChatRouter />
        </MemoryRouter>
      )

      // 1) System Design localStorage session did NOT leak or bulk-migrate into Distributed Rust
      await waitFor(() => {
        expect(mocks.getSessions).toHaveBeenCalled()
      })
      expect(screen.queryByText('System Design secret message')).not.toBeInTheDocument()
      expect(mocks.migrateBulk).not.toHaveBeenCalled()

      // 2) Topic starter fetch attached X-Toolbox-Kit: distributed-rust
      await waitFor(() => {
        expect(fetchMock).toHaveBeenCalled()
      })
      const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
      expect((init.headers as Record<string, string>)['X-Toolbox-Kit']).toBe('distributed-rust')
      expect(await screen.findByText('Explain ownership transfer in Rust')).toBeInTheDocument()
    })
  })

  describe('App Cross-Route & End-to-End Workflows', () => {
    it('8. updates contextual ChatPanel title/starters across routes, keeps per-page history independent, and survives mobile drawer toggle', async () => {
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: true, study: true } })
      const { unmount } = render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <App />
        </MemoryRouter>
      )

      expect(await screen.findByTestId('chat-title')).toHaveTextContent('Ask about System Design')
      expect(await screen.findByText('Explain the CAP Theorem with real examples')).toBeInTheDocument()

      const chatInput = await screen.findByPlaceholderText('Ask about this component...')
      fireEvent.change(chatInput, { target: { value: 'Persistent guide message' } })
      fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
      expect(screen.getByText('Persistent guide message')).toBeInTheDocument()

      fireEvent.click(q('#nav-builder'))
      await waitFor(() => {
        expect(screen.getByTestId('chat-title')).toHaveTextContent('Ask about your architecture')
      })
      expect(await screen.findByText('Help me design a URL shortener')).toBeInTheDocument()
      expect(screen.queryByText('Persistent guide message')).not.toBeInTheDocument()
      unmount()

      // Mobile drawer open/close leaves open ChatPanel untouched
      setViewport(390)
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <App />
        </MemoryRouter>
      )
      fireEvent.click(q('#mobile-menu-btn'))
      expect(q('#mobile-drawer')).toBeInTheDocument()
      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
      fireEvent.click(q('#mobile-nav-close'))
      expect(document.querySelector('#mobile-drawer')).toBeNull()
      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
    })

    it('9. Builder Verify Design workflow sends architecture nodes to AI chat and renders response', async () => {
      render(
        <MemoryRouter initialEntries={['/builder']}>
          <App />
        </MemoryRouter>
      )

      await screen.findByText('Untitled Board')
      const canvas = q('#builder-canvas')
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
      }))

      const itemData = { id: 'lb', name: 'Load Balancer', category: 'Compute', icon: 'cpu' }
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 150,
        clientY: 150,
        dataTransfer: {
          getData: (format: string) => (format === 'application/json' ? JSON.stringify(itemData) : ''),
        },
      })

      expect(screen.getAllByText('Load Balancer').length).toBeGreaterThan(0)
      fireEvent.click(q('#builder-chat-btn'))

      expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
      await waitFor(() => {
        expect(screen.getByText('AI response content')).toBeInTheDocument()
      })
    })

    it('10. Guide pillar -> topic -> Ask AI starter prompt and Settings key connect/disconnect propagate to Builder chat', async () => {
      const guideRender = render(
        <MemoryRouter initialEntries={['/guide']}>
          <App />
        </MemoryRouter>
      )

      const computeCard = screen
        .getAllByText('Compute')
        .find((el) => el.closest('.blueprint-pillar-card'))!
        .closest('.blueprint-pillar-card')!
      fireEvent.click(computeCard)

      await waitFor(() => {
        expect(screen.getAllByText('Traffic Gateways & Proxies').length).toBeGreaterThan(0)
      })
      const gatewayCard = screen
        .getAllByText('Traffic Gateways & Proxies')
        .find((el) => el.closest('.blueprint-pillar-card'))!
        .closest('.blueprint-pillar-card')!
      fireEvent.click(gatewayCard)

      await screen.findByText('Description & Internal Workings')
      fireEvent.click(screen.getByRole('button', { name: /ask ai/i }))
      fireEvent.click(screen.getByText('Explain the CAP Theorem with real examples'))
      await waitFor(() => {
        expect(screen.getByText('AI response content')).toBeInTheDocument()
      })
      guideRender.unmount()

      // Settings remove key -> Builder Verify Design prompts Configure API Key
      useAppStore.setState({ apiKeyConfigured: true })
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <App />
        </MemoryRouter>
      )

      await screen.findByText('Connected')
      fireEvent.click(screen.getByRole('button', { name: 'Remove Gemini Key' }))
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
      await waitFor(() => {
        expect(screen.queryByText('Connected')).not.toBeInTheDocument()
      })

      fireEvent.click(q('#nav-builder'))
      fireEvent.click(await screen.findByRole('button', { name: /Verify Design/i }))
      await waitFor(() => {
        expect(screen.getByText('Configure API Key')).toBeInTheDocument()
      })
    })
  })
})
