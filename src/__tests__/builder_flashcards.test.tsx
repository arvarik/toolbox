import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nodesForCard } from '../../shared/kits/kitSkeleton'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import BoardList from '../components/builder/BoardList'
import { readStoreNodes } from '../components/builder/boardModel'
import FlashcardView from '../components/study/FlashcardView'
import BuilderPage from '../pages/BuilderPage'
import StudyPage from '../pages/StudyPage'
import useAppStore from '../stores/appStore'
import { CURATED_STARTER_CARDS, STARTER_DECK_META, seedCuratedStarterDeck } from '../utils/starterDeck'
import { makeTestKit, resetKitStore } from './testHelpers'

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
    cards: [{ id: 'c1', front: 'What is the CAP Theorem?', back: 'Consistency, Availability, and Partition Tolerance.' }],
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
]

const mocks = vi.hoisted(() => ({
  decksList: vi.fn(),
  decksGet: vi.fn(),
  decksCreate: vi.fn(),
  decksDelete: vi.fn(),
  boardsList: vi.fn(),
  boardsCreate: vi.fn(),
  chatStream: vi.fn(),
  canvasCritique: vi.fn(),
}))

vi.mock('../utils/api', () => ({
  configApi: {
    get: vi.fn(() => Promise.resolve({ api_keys_configured: { gemini: true } })),
    update: vi.fn(() => Promise.resolve({ success: true })),
    testApiKey: vi.fn(() => Promise.resolve({ valid: true })),
  },
  decksApi: {
    list: (...args: unknown[]) => mocks.decksList(...args),
    get: (...args: unknown[]) => mocks.decksGet(...args),
    create: (...args: unknown[]) => mocks.decksCreate(...args),
    update: vi.fn((id: unknown, data: unknown) => Promise.resolve({ id, ...(data as Record<string, unknown>) })),
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
    get: vi.fn(() => Promise.resolve({})),
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
  studySessionsApi: { list: vi.fn(() => Promise.resolve([])) },
  kitsApi: { list: vi.fn(() => Promise.resolve({ kits: [] })), get: vi.fn(() => Promise.resolve(null)) },
}))

vi.mock('../utils/pedagogyApi', () => ({
  canvasCritiqueApi: {
    critique: (...args: unknown[]) => mocks.canvasCritique(...args),
  },
}))

function q<T extends Element = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector)
  if (!el) throw new Error(`Missing ${selector}`)
  return el
}

async function renderSettled(ui: ReactNode) {
  let out!: ReturnType<typeof render>
  await act(async () => {
    out = render(ui)
  })
  return out
}

describe('Builder Canvas, Concept Map Critique & Flashcard Decks', () => {
  let activeMockDecks: typeof MOCK_DECKS

  beforeEach(() => {
    activeMockDecks = structuredClone(MOCK_DECKS)
    useAppStore.setState({
      model: 'gemini-2.5-flash',
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: true,
      toasts: [],
      nodes: [],
      edges: [],
    })
    resetKitStore()

    mocks.decksList.mockImplementation(() => Promise.resolve([...activeMockDecks]))
    mocks.decksGet.mockImplementation((id: unknown) =>
      Promise.resolve(activeMockDecks.find((d) => d.id === id) || activeMockDecks[0]),
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
    mocks.decksDelete.mockImplementation((id: unknown) => {
      activeMockDecks = activeMockDecks.filter((d) => d.id !== id)
      return Promise.resolve({})
    })
    mocks.boardsList.mockResolvedValue([])
    mocks.boardsCreate.mockResolvedValue({ id: 'board-created', name: 'Untitled Board' })
    mocks.chatStream.mockImplementation(async (_data: unknown, onChunk?: (chunk: string) => void) => {
      onChunk?.('AI response content')
      return 'AI response content'
    })
  })

  it('syncs dropped Builder nodes with finite coordinates, purges nodes on /k/:slug/builder Kit switch, and renders 15-tab BoardList', async () => {
    function KitSwitcher() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/k/kit-b/builder')} data-testid="switch-builder-kit">Switch</button>
    }

    const { unmount } = await renderSettled(
      <MemoryRouter initialEntries={['/k/kit-a/builder']}>
        <KitSwitcher />
        <Routes>
          <Route path="/k/:slug/builder" element={<BuilderPage />} />
        </Routes>
      </MemoryRouter>,
    )

    await screen.findByText('Untitled Board')
    const canvas = q('#builder-canvas')
    canvas.getBoundingClientRect = vi.fn(() => ({
      left: 10, top: 20, right: 810, bottom: 620, width: 800, height: 600, x: 10, y: 20, toJSON: () => ({}),
    }))

    fireEvent.drop(canvas, {
      preventDefault: vi.fn(),
      clientX: 170,
      clientY: 130,
      dataTransfer: {
        getData: (format: string) =>
          format === 'application/json'
            ? JSON.stringify({ id: 'cache', name: 'Cache (Redis)', category: 'Storage', icon: 'zap' })
            : '',
      },
    })

    const stored = readStoreNodes(useAppStore.getState()).find((n) => n.data?.name === 'Cache (Redis)')
    expect(stored).toBeDefined()
    expect(Number.isFinite(stored!.position.x)).toBe(true)
    expect(Number.isFinite(stored!.position.y)).toBe(true)

    fireEvent.click(screen.getByLabelText('Remove node'))
    expect(readStoreNodes(useAppStore.getState())).toHaveLength(0)

    // Drop a Kit A node, then switch Kits -> immediately purged
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
    await act(async () => {
      fireEvent.click(screen.getByTestId('switch-builder-kit'))
    })
    expect(readStoreNodes(useAppStore.getState()).some((n) => n.data?.name === 'Kit A CDN')).toBe(false)
    expect(await screen.findByText('Kit B Board')).toBeInTheDocument()
    unmount()

    const manyBoards = Array.from({ length: 15 }, (_, i) => ({ id: `b-${i}`, name: `Board tab #${i + 1}` }))
    render(
      <MemoryRouter>
        <BoardList boards={manyBoards} activeId="b-0" onSelect={vi.fn()} onNew={vi.fn()} onRename={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Board tab #15')).toBeInTheDocument()
  })

  it('adapts BuilderPage to Concept-Map Kits, quick-adds custom nodes, and auto-saves before AI Rubric Critique', async () => {
    const rustKit = makeTestKit({
      id: 'kit-rust-1',
      slug: 'distributed-rust',
      name: 'Distributed Rust',
      capabilities: { canvas: 'concept', calculator: false },
      mutateSkeleton: (s) => {
        s.canvasConfig = {
          components: [],
          protocols: ['implies', 'prevents', 'example of'],
          templates: [],
          auditRubric: ['Verify aliasing XOR mutability propositions.'],
        }
      },
    })
    resetKitStore(rustKit)
    mocks.boardsCreate.mockResolvedValueOnce({ id: 'board-rust-saved', name: 'Untitled Concept Map' })
    mocks.canvasCritique.mockResolvedValueOnce({
      boardId: 'board-rust-saved',
      kitId: 'kit-rust-1',
      mode: 'concept',
      score: 0.88,
      pass: true,
      extractedClaims: ['Exclusive &mut T prevents data races.'],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [{ point: 'Verify aliasing XOR mutability propositions', met: true, evidenceOrGap: 'Accurate.' }],
      socraticFollowUp: 'Where does UnsafeCell fit?',
      constructiveFeedback: 'Strong Novakian concept map.',
    })

    await renderSettled(
      <MemoryRouter initialEntries={['/k/distributed-rust/canvas']}>
        <Routes>
          <Route path="/k/:slug/canvas" element={<BuilderPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('Concept Primitives')).toBeInTheDocument()
    expect(screen.queryByText('Estimate')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Linking phrase')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Custom concept name'), { target: { value: 'Exclusive &mut T' } })
    fireEvent.click(screen.getByLabelText('Add concept node'))
    expect(useAppStore.getState().nodes.some((n: { data?: { name?: string } }) => n.data?.name === 'Exclusive &mut T')).toBe(true)

    fireEvent.click(q('#builder-audit-btn'))
    expect(await screen.findByText('Concept Map Audit & AI Critique')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('run-ai-critique-btn'))
    await waitFor(() => {
      expect(mocks.boardsCreate).toHaveBeenCalledTimes(1)
      expect(mocks.canvasCritique).toHaveBeenCalledWith('board-rust-saved', expect.objectContaining({ model: 'gemini-2.5-flash' }))
    })
    expect(await screen.findByTestId('rubric-pass-badge')).toHaveTextContent('Passed Rubric')
  })

  it('filters decks, flips multilingual/empty FlashcardView, creates/deletes decks, and clears stale decks on 0-deck Kit switch', async () => {
    mocks.chatStream.mockRejectedValueOnce(new Error('Invalid Input / Missing Key'))

    function KitSwitcher() {
      const navigate = useNavigate()
      return <button onClick={() => navigate('/k/empty-kit/study')} data-testid="switch-study-kit">Switch Study Kit</button>
    }

    const { unmount } = await renderSettled(
      <MemoryRouter initialEntries={['/k/sys-kit/study']}>
        <KitSwitcher />
        <Routes>
          <Route path="/k/:slug/study" element={<StudyPage />} />
        </Routes>
      </MemoryRouter>,
    )
    await screen.findByText('CAP Theorem & Consistency')

    const searchInput = q<HTMLInputElement>('#search-decks')
    fireEvent.change(searchInput, { target: { value: 'xyz123abc' } })
    expect(screen.getByText('No results')).toBeInTheDocument()
    fireEvent.change(searchInput, { target: { value: '' } })

    fireEvent.click(q('#study-chat-btn'))
    fireEvent.change(q('#chat-input-study'), { target: { value: 'Generate invalid' } })
    fireEvent.click(screen.getByLabelText('Send message'))
    await waitFor(() => expect(screen.getAllByText(/Error: Invalid Input \/ Missing Key/i)[0]).toBeInTheDocument())

    fireEvent.click(screen.getAllByTitle('Delete')[0])
    const confirmDeleteBtn = screen.getAllByRole('button', { name: 'Delete' }).find((el) => el.classList.contains('btn-primary'))!
    fireEvent.click(confirmDeleteBtn)
    await waitFor(() => expect(screen.queryByText('CAP Theorem & Consistency')).not.toBeInTheDocument())

    fireEvent.click(q('#new-deck-btn'))
    fireEvent.change(q('#deck-name-input'), { target: { value: 'New Custom Deck' } })
    fireEvent.change(q('#deck-desc-input'), { target: { value: 'Custom Description' } })
    const textareas = document.querySelectorAll<HTMLTextAreaElement>('#deck-editor textarea')
    fireEvent.change(textareas[1], { target: { value: 'Q1' } })
    fireEvent.change(textareas[2], { target: { value: 'A1' } })
    fireEvent.click(screen.getByRole('button', { name: /Save Deck/i }))
    await waitFor(() => expect(screen.getByText('New Custom Deck')).toBeInTheDocument())

    // Switch to a 0-deck Kit -> clears stale decks
    mocks.decksList.mockResolvedValueOnce([])
    await act(async () => {
      fireEvent.click(screen.getByTestId('switch-study-kit'))
    })
    await waitFor(() => {
      expect(screen.queryByText('New Custom Deck')).not.toBeInTheDocument()
      expect(screen.getByText('No flashcard decks yet')).toBeInTheDocument()
    })
    unmount()

    // Empty & multilingual FlashcardView
    const emptyView = render(<MemoryRouter><FlashcardView cards={[]} deckName="Empty Deck" onBack={vi.fn()} /></MemoryRouter>)
    expect(screen.getByText('No cards in this deck yet.')).toBeInTheDocument()
    emptyView.unmount()

    const multiBack = 'लंबे वाक्यों वाले उत्तर भी ठीक से दिखाई दें।'
    render(<MemoryRouter><FlashcardView cards={[{ id: '1', front: 'Long Q', back: multiBack }]} deckName="Deck" onBack={vi.fn()} /></MemoryRouter>)
    fireEvent.click(q('.flashcard'))
    expect(screen.getByText(multiBack)).toHaveClass('flashcard-text')
  })

  it('seeds the curated starter deck: 15 complete cards that link to System Design graph nodes', async () => {
    expect(CURATED_STARTER_CARDS).toHaveLength(15)
    for (const card of CURATED_STARTER_CARDS) {
      expect(card.front).toBeTruthy()
      expect(card.back).toBeTruthy()
      expect(card.source_pillar_id).toBeTruthy()
      expect(card.source_topic_id).toBeTruthy()
      expect(nodesForCard(card, SYSTEM_DESIGN_KIT_SKELETON.graph.nodes).length).toBeGreaterThan(0)
    }

    const createDeck = vi.fn().mockResolvedValue({ id: 'deck-123', name: STARTER_DECK_META.name })
    const createCard = vi.fn().mockResolvedValue({ id: 'card-1' })
    const deck = await seedCuratedStarterDeck({ create: createDeck }, { create: createCard })
    expect(createDeck).toHaveBeenCalledWith(STARTER_DECK_META)
    expect(createCard).toHaveBeenCalledTimes(15)
    expect(deck.id).toBe('deck-123')
  })
})
