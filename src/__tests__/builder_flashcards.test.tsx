import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import BuilderPage from '../pages/BuilderPage'
import StudyPage from '../pages/StudyPage'
import useAppStore from '../stores/appStore'
import useKitStore from '../stores/useKitStore'
import FlashcardView from '../components/study/FlashcardView'
import BoardList from '../components/builder/BoardList'
import { readStoreNodes } from '../components/builder/boardModel'

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
    cards: [
      {
        id: 'c1',
        front: 'What is the CAP Theorem?',
        back: 'The CAP theorem states that a distributed system can only provide two of three guarantees: Consistency, Availability, and Partition Tolerance.',
      },
    ],
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
    cards: [],
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
    cards: [],
  },
]

const mocks = vi.hoisted(() => ({
  decksList: vi.fn(),
  decksGet: vi.fn(),
  decksCreate: vi.fn(),
  decksUpdate: vi.fn(),
  decksDelete: vi.fn(),
  boardsList: vi.fn(),
  boardsGet: vi.fn(),
  boardsCreate: vi.fn(),
  chatStream: vi.fn(),
}))

vi.mock('../utils/api', () => ({
  configApi: {
    get: vi.fn(() => Promise.resolve({ api_key_configured: true })),
    update: vi.fn(() => Promise.resolve({ success: true })),
    testApiKey: vi.fn(() => Promise.resolve({ valid: true })),
  },
  decksApi: {
    list: (...args: unknown[]) => mocks.decksList(...args),
    get: (...args: unknown[]) => mocks.decksGet(...args),
    create: (...args: unknown[]) => mocks.decksCreate(...args),
    update: (...args: unknown[]) => mocks.decksUpdate(...args),
    delete: (...args: unknown[]) => mocks.decksDelete(...args),
  },
  flashcardsApi: {
    list: vi.fn(() => Promise.resolve([])),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  boardsApi: {
    list: (...args: unknown[]) => mocks.boardsList(...args),
    get: (...args: unknown[]) => mocks.boardsGet(...args),
    create: (...args: unknown[]) => mocks.boardsCreate(...args),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
    rename: vi.fn(() => Promise.resolve({})),
    reorder: vi.fn(() => Promise.resolve([])),
  },
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'AI response content' })),
    stream: (...args: unknown[]) => mocks.chatStream(...args),
  },
  studySessionsApi: {
    list: vi.fn(() => Promise.resolve([])),
  },
  kitsApi: {
    list: vi.fn(() => Promise.resolve({ kits: [] })),
    get: vi.fn(() => Promise.resolve(null)),
  },
}))

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Missing ${selector}`)
  return el
}

describe('Builder and Flashcards Comprehensive Test Suite', () => {
  let activeMockDecks: typeof MOCK_DECKS

  beforeEach(() => {
    activeMockDecks = structuredClone(MOCK_DECKS)
    window.innerWidth = 1024
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: true,
      toasts: [],
      nodes: [],
      edges: [],
    })
    useKitStore.setState({
      kits: [],
      activeKitSlug: null,
      activeKit: null,
      kitCache: {},
      isLoadingList: false,
      isLoadingActive: false,
    })

    mocks.decksList.mockImplementation(() => Promise.resolve([...activeMockDecks]))
    mocks.decksGet.mockImplementation((id: unknown) =>
      Promise.resolve(activeMockDecks.find((d) => d.id === id) || activeMockDecks[0])
    )
    mocks.decksCreate.mockImplementation((data: unknown) => {
      const payload = data as { name?: string; description?: string; tags?: string; color_index?: number }
      const created = {
        id: 'deck-created',
        name: payload.name || 'Untitled',
        description: payload.description || '',
        color_index: payload.color_index ?? 0,
        card_count: 2,
        tags: payload.tags || '',
        last_studied: 'Never studied',
        progress: 0,
        cards: [],
      }
      activeMockDecks = [...activeMockDecks, created]
      return Promise.resolve(created)
    })
    mocks.decksUpdate.mockImplementation((id: unknown, data: unknown) =>
      Promise.resolve({ id, ...(data as Record<string, unknown>) })
    )
    mocks.decksDelete.mockImplementation((id: unknown) => {
      activeMockDecks = activeMockDecks.filter((d) => d.id !== id)
      return Promise.resolve({})
    })
    mocks.boardsList.mockResolvedValue([])
    mocks.boardsGet.mockResolvedValue({})
    mocks.boardsCreate.mockResolvedValue({ id: 'board-created', name: 'Untitled Board' })
    mocks.chatStream.mockImplementation(async (_data: unknown, onChunk?: (chunk: string) => void) => {
      const text = 'AI response content'
      onChunk?.(text)
      return text
    })

    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Builder Page Tests', () => {
    it('1. renders canvas, toolbox, toolbar actions, and React Flow chrome', () => {
      render(<MemoryRouter><BuilderPage /></MemoryRouter>)

      expect(document.querySelector('#builder-toolbox') || document.querySelector('.builder-toolbox')).toBeInTheDocument()
      expect(screen.getByText('Components')).toBeInTheDocument()
      expect(document.querySelector('#builder-canvas') || document.querySelector('.builder-canvas')).toBeInTheDocument()

      expect(screen.getByText('Estimate')).toBeInTheDocument()
      expect(screen.getByText('Templates')).toBeInTheDocument()
      expect(screen.getByText('Export')).toBeInTheDocument()
      expect(screen.getByText('Save')).toBeInTheDocument()
      expect(screen.getByText('Verify Design')).toBeInTheDocument()

      expect(document.querySelector('.react-flow')).toBeInTheDocument()
      expect(document.querySelector('.react-flow__controls')).toBeInTheDocument()
      expect(document.querySelector('.react-flow__minimap')).toBeInTheDocument()
      expect(document.querySelector('.react-flow__background')).toBeInTheDocument()
    })

    it('2. places dropped nodes onto canvas and shared store with numeric coordinates, and supports removal', () => {
      render(<MemoryRouter><BuilderPage /></MemoryRouter>)

      const canvas = q('#builder-canvas')
      const originalRect = canvas.getBoundingClientRect
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, x: 10, y: 20, toJSON: () => ({}),
      }))

      const cacheItem = { id: 'cache', name: 'Cache (Redis)', category: 'Storage', icon: 'zap' }
      const workerItem = { id: 'worker', name: 'Background Worker', category: 'Compute', icon: 'cog' }

      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 170,
        clientY: 130,
        dataTransfer: {
          getData: (format: string) => (format === 'application/json' ? JSON.stringify(cacheItem) : ''),
        },
      })
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 250,
        clientY: 220,
        dataTransfer: {
          getData: (format: string) => (format === 'application/json' ? JSON.stringify(workerItem) : ''),
        },
      })

      expect(screen.getAllByText('Cache (Redis)').find((el) => el.closest('#builder-canvas'))).toBeTruthy()
      expect(canvas.textContent).toContain('Background Worker')

      const stored = readStoreNodes(useAppStore.getState()).find((n) => n.data?.name === 'Cache (Redis)')
      expect(stored).toBeDefined()
      expect(stored!.type).toBe('component')
      expect(stored!.data.category).toBe('Storage')
      expect(Number.isFinite(stored!.position.x)).toBe(true)
      expect(Number.isFinite(stored!.position.y)).toBe(true)

      const removeButtons = screen.getAllByLabelText('Remove node')
      expect(removeButtons.length).toBe(2)
      fireEvent.click(removeButtons[0])
      fireEvent.click(removeButtons[1])

      expect(canvas.textContent).not.toContain('Cache (Redis)')
      expect(canvas.textContent).not.toContain('Background Worker')
      expect(canvas.textContent).toContain('Drag components from the toolbox to start designing')

      canvas.getBoundingClientRect = originalRect
    })

    it('3. creates and switches board tabs and renders responsive BoardList', async () => {
      const { unmount } = render(<MemoryRouter><BuilderPage /></MemoryRouter>)

      expect(await screen.findByText('Untitled Board')).toBeInTheDocument()
      fireEvent.click(q('#new-board-btn'))
      expect(screen.getByText('Board 2')).toBeInTheDocument()
      expect(document.querySelectorAll('.board-tab:not(.board-tab-add)').length).toBe(2)

      const firstTab = screen.getByText('Untitled Board').closest('.board-tab')
      expect(firstTab).not.toBeNull()
      fireEvent.click(firstTab!)
      expect(firstTab).toHaveClass('active')
      unmount()

      window.innerWidth = 375
      const manyBoards = Array.from({ length: 15 }, (_, i) => ({
        id: `board-${i}`,
        name: `Board tab #${i + 1}`,
      }))
      render(
        <MemoryRouter>
          <BoardList
            boards={manyBoards}
            activeId="board-0"
            onSelect={vi.fn()}
            onNew={vi.fn()}
            onRename={vi.fn()}
            onDelete={vi.fn()}
          />
        </MemoryRouter>
      )
      expect(q('#board-list')).toHaveClass('board-list-bar')
      for (const board of manyBoards) {
        expect(screen.getByText(board.name)).toBeInTheDocument()
      }
    })

    it('4. opens chat panel when Verify Design is clicked on an empty canvas', () => {
      render(<MemoryRouter><BuilderPage /></MemoryRouter>)
      expect(screen.getByText('Drag components from the toolbox to start designing')).toBeInTheDocument()

      fireEvent.click(q('#builder-chat-btn'))
      expect(useAppStore.getState().chatOpen.builder).toBe(true)
      expect(screen.getAllByText('Ask about your architecture')[0]).toBeInTheDocument()
    })

    it('5. clears previous Kit nodes immediately when switching between /k/:slug/builder Kits', async () => {
      function KitSwitcher() {
        const navigate = useNavigate()
        return (
          <button onClick={() => navigate('/k/kit-b/builder')} data-testid="switch-builder-kit">
            Switch Kit
          </button>
        )
      }

      render(
        <MemoryRouter initialEntries={['/k/kit-a/builder']}>
          <KitSwitcher />
          <Routes>
            <Route path="/k/:slug/builder" element={<BuilderPage />} />
          </Routes>
        </MemoryRouter>
      )

      await screen.findByText('Untitled Board')
      const canvas = q('#builder-canvas')
      canvas.getBoundingClientRect = vi.fn(() => ({
        left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600, x: 0, y: 0, toJSON: () => ({}),
      }))
      fireEvent.drop(canvas, {
        preventDefault: vi.fn(),
        clientX: 140,
        clientY: 140,
        dataTransfer: {
          getData: (format: string) =>
            format === 'application/json'
              ? JSON.stringify({ id: 'cdn', name: 'Kit A CDN', category: 'Storage', icon: 'globe' })
              : '',
        },
      })
      expect(readStoreNodes(useAppStore.getState()).some((n) => n.data?.name === 'Kit A CDN')).toBe(true)

      mocks.boardsList.mockResolvedValueOnce([{ id: 'board-kit-b', name: 'Kit B Board' }])
      fireEvent.click(screen.getByTestId('switch-builder-kit'))

      // Kit A's dropped node is immediately purged on Kit switch
      expect(readStoreNodes(useAppStore.getState()).some((n) => n.data?.name === 'Kit A CDN')).toBe(false)
      expect(await screen.findByText('Kit B Board')).toBeInTheDocument()
    })
  })

  describe('Flashcards Page Tests', () => {
    it('6. renders deck grid, AI generate button, card counts, recency, and mastery progress bars', async () => {
      render(<MemoryRouter><StudyPage /></MemoryRouter>)

      await screen.findByText('CAP Theorem & Consistency')
      expect(q('.deck-grid')).toBeInTheDocument()
      expect(screen.getByText('Load Balancing Strategies')).toBeInTheDocument()
      expect(screen.getByText('Database Scaling Patterns')).toBeInTheDocument()

      expect(screen.getByText('12 cards')).toBeInTheDocument()
      expect(screen.getByText('8 cards')).toBeInTheDocument()
      expect(screen.getByText('15 cards')).toBeInTheDocument()
      expect(screen.getByText('2 days ago')).toBeInTheDocument()
      expect(screen.getByText('Yesterday')).toBeInTheDocument()
      expect(screen.getAllByText('Never studied').length).toBeGreaterThanOrEqual(1)

      const aiBtn = q('#study-chat-btn')
      expect(aiBtn).toHaveClass('btn', 'btn-ai-generate')
      expect(aiBtn.querySelector('svg')).toBeInTheDocument()

      const progressBars = document.querySelectorAll<HTMLElement>('.deck-card div[style*="height: 100%"]')
      expect(progressBars.length).toBe(3)
      const widths = Array.from(progressBars).map((el) => el.style.width)
      expect(widths).toEqual(expect.arrayContaining(['75%', '40%', '0%']))
    })

    it('7. filters decks by search query and shows empty search results state', async () => {
      render(<MemoryRouter><StudyPage /></MemoryRouter>)
      await screen.findByText('CAP Theorem & Consistency')

      const searchInput = q<HTMLInputElement>('#search-decks')
      fireEvent.change(searchInput, { target: { value: 'CAP' } })
      expect(screen.getByText('CAP Theorem & Consistency')).toBeInTheDocument()
      expect(screen.queryByText('Load Balancing Strategies')).not.toBeInTheDocument()

      fireEvent.change(searchInput, { target: { value: 'xyz123abc' } })
      expect(screen.getByText('No results')).toBeInTheDocument()
      expect(screen.getByText(/No decks match/)).toBeInTheDocument()
    })

    it('8. flips study cards, handles empty decks, and wraps long multilingual card text', async () => {
      const { unmount } = render(<MemoryRouter><StudyPage /></MemoryRouter>)
      await screen.findByText('CAP Theorem & Consistency')

      fireEvent.click(screen.getByText('CAP Theorem & Consistency').closest('.deck-card')!)
      expect(q('#flashcard-viewer')).toBeInTheDocument()

      const card = q('.flashcard')
      expect(card.className).not.toContain('flipped')
      expect(screen.getByText('What is the CAP Theorem?')).toBeInTheDocument()

      fireEvent.click(card)
      expect(card.className).toContain('flipped')
      expect(screen.getByText(/guarantees: Consistency, Availability/i)).toBeInTheDocument()
      unmount()

      const emptyView = render(
        <MemoryRouter>
          <FlashcardView cards={[]} deckName="Empty Deck" onBack={vi.fn()} />
        </MemoryRouter>
      )
      expect(screen.getByText('No cards in this deck yet.')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Back to Decks/i })).toBeInTheDocument()
      emptyView.unmount()

      const veryLongFront = 'This is a very long question designed to test how text wrapping behaves in the flashcard view component when the front text is exceptionally lengthy.'
      const veryLongBack = 'This is a very long answer that also needs to wrap properly. इवेंट हैंडलर और स्टाइल रूल्स को सुनिश्चित करना होगा कि लंबे वाक्यों वाले उत्तर भी ठीक से दिखाई दें।'
      render(
        <MemoryRouter>
          <FlashcardView cards={[{ id: 'long-1', front: veryLongFront, back: veryLongBack }]} deckName="Long Deck" onBack={vi.fn()} />
        </MemoryRouter>
      )
      expect(screen.getByText(veryLongFront)).toHaveClass('flashcard-text')
      fireEvent.click(q('.flashcard'))
      expect(screen.getByText(veryLongBack)).toHaveClass('flashcard-text')
    })

    it('9. handles AI chat stream errors, deck deletion confirmation, and deck editor creation', async () => {
      mocks.chatStream.mockRejectedValueOnce(new Error('Invalid Input / Missing Key'))
      render(<MemoryRouter><StudyPage /></MemoryRouter>)

      await screen.findByText('CAP Theorem & Consistency')

      // AI error alert
      fireEvent.click(q('#study-chat-btn'))
      fireEvent.change(q('#chat-input-study'), { target: { value: 'Generate invalid' } })
      fireEvent.click(screen.getByLabelText('Send message'))
      await waitFor(() => {
        expect(screen.getAllByText(/Error: Invalid Input \/ Missing Key/i)[0]).toBeInTheDocument()
      })

      // Delete first deck
      fireEvent.click(screen.getAllByTitle('Delete')[0])
      expect(screen.getByText(/Are you sure you want to delete/i)).toBeInTheDocument()
      const confirmDeleteBtn = screen
        .getAllByRole('button', { name: 'Delete' })
        .find((el) => el.classList.contains('btn-primary'))
      fireEvent.click(confirmDeleteBtn!)
      await waitFor(() => {
        expect(screen.queryByText('CAP Theorem & Consistency')).not.toBeInTheDocument()
      })

      // Create new deck in DeckEditor
      fireEvent.click(q('#new-deck-btn'))
      expect(q('#deck-editor')).toBeInTheDocument()
      fireEvent.change(q('#deck-name-input'), { target: { value: 'New Custom Deck' } })
      fireEvent.change(q('#deck-desc-input'), { target: { value: 'Custom Description' } })

      const textareas = document.querySelectorAll<HTMLTextAreaElement>('#deck-editor textarea')
      fireEvent.change(textareas[1], { target: { value: 'Q1' } })
      fireEvent.change(textareas[2], { target: { value: 'A1' } })

      fireEvent.click(q('#add-card-btn'))
      const textareasAfter = document.querySelectorAll<HTMLTextAreaElement>('#deck-editor textarea')
      fireEvent.change(textareasAfter[3], { target: { value: 'Q2' } })
      fireEvent.change(textareasAfter[4], { target: { value: 'A2' } })

      fireEvent.click(screen.getByRole('button', { name: /Save Deck/i }))
      await waitFor(() => {
        expect(screen.getByText('New Custom Deck')).toBeInTheDocument()
      })
      expect(screen.getByText('Custom Description')).toBeInTheDocument()
      expect(screen.getByText('2 cards')).toBeInTheDocument()
    })

    it('10. clears decks to empty state when switching to a 0-deck /k/:slug/study Kit instead of retaining stale decks', async () => {
      function KitSwitcher() {
        const navigate = useNavigate()
        return (
          <button onClick={() => navigate('/k/empty-kit/study')} data-testid="switch-study-kit">
            Switch Study Kit
          </button>
        )
      }

      render(
        <MemoryRouter initialEntries={['/k/sys-kit/study']}>
          <KitSwitcher />
          <Routes>
            <Route path="/k/:slug/study" element={<StudyPage />} />
          </Routes>
        </MemoryRouter>
      )

      expect(await screen.findByText('CAP Theorem & Consistency')).toBeInTheDocument()

      // Next Kit returns [] from decksApi.list()
      mocks.decksList.mockResolvedValueOnce([])
      fireEvent.click(screen.getByTestId('switch-study-kit'))

      await waitFor(() => {
        expect(screen.queryByText('CAP Theorem & Consistency')).not.toBeInTheDocument()
        expect(screen.getByText('No flashcard decks yet')).toBeInTheDocument()
      })
    })
  })
})
