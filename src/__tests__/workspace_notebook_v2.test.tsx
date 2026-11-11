import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommitModal from '../components/chat/CommitModal'
import Layout from '../components/layout/Layout'
import Sidebar from '../components/layout/Sidebar'
import SearchDialog from '../components/shared/SearchDialog'
import TaskWorkingBar from '../components/shared/TaskWorkingBar'
import ChatPage from '../pages/ChatPage'
import GuidePage from '../pages/GuidePage'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import useKitStore from '../stores/useKitStore'
import { makeTestKit, resetKitStore } from './testHelpers'

const apiMocks = vi.hoisted(() => ({
  kitsList: vi.fn(),
  listDogears: vi.fn(),
  toggleDogear: vi.fn(),
  listHighlights: vi.fn(),
  createHighlight: vi.fn(),
  updateHighlight: vi.fn(),
  deleteHighlight: vi.fn(),
  putResume: vi.fn(),
  getResume: vi.fn(),
  commitAnalyze: vi.fn(),
  commitSave: vi.fn(),
  searchQuery: vi.fn(),
  sessionsList: vi.fn(),
  sessionsCreate: vi.fn(),
  chatStream: vi.fn(),
  guideProgress: vi.fn(),
  guideGetForTopic: vi.fn(),
  decksList: vi.fn(),
  decksCreate: vi.fn(),
  flashcardsCreate: vi.fn(),
}))

vi.mock('../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/api')>()
  return {
    ...actual,
    configApi: {
      ...actual.configApi,
      get: vi.fn(() => Promise.resolve({ api_keys_configured: { gemini: true } })),
      getAvailableModels: vi.fn(() => Promise.resolve({ groups: [], providers: [] })),
    },
    chatApi: {
      ...actual.chatApi,
      stream: (...args: unknown[]) => apiMocks.chatStream(...args),
      commitAnalyze: (...args: unknown[]) => apiMocks.commitAnalyze(...args),
      commitSave: (...args: unknown[]) => apiMocks.commitSave(...args),
      getSessions: (...args: unknown[]) => apiMocks.sessionsList(...args),
      saveSession: (...args: unknown[]) => apiMocks.sessionsCreate(...args),
      deleteSession: vi.fn(() => Promise.resolve({ ok: true })),
      migrateBulk: vi.fn(() => Promise.resolve({ migrated: 0 })),
      checkDuplicates: vi.fn(() => Promise.resolve({ duplicates: [] })),
    },
    decksApi: {
      ...actual.decksApi,
      list: (...args: unknown[]) => apiMocks.decksList(...args),
      create: (...args: unknown[]) => apiMocks.decksCreate(...args),
    },
    flashcardsApi: {
      ...actual.flashcardsApi,
      create: (...args: unknown[]) => apiMocks.flashcardsCreate(...args),
    },
    searchApi: {
      query: (...args: unknown[]) => apiMocks.searchQuery(...args),
    },
    kitsApi: {
      ...actual.kitsApi,
      list: (...args: unknown[]) => apiMocks.kitsList(...args),
      touch: vi.fn(() => Promise.resolve({ ok: true })),
    },
    guideContentApi: {
      ...actual.guideContentApi,
      progress: (...args: unknown[]) => apiMocks.guideProgress(...args),
      getForTopic: (...args: unknown[]) => apiMocks.guideGetForTopic(...args),
      listDogears: (...args: unknown[]) => apiMocks.listDogears(...args),
      toggleDogear: (...args: unknown[]) => apiMocks.toggleDogear(...args),
      listHighlights: (...args: unknown[]) => apiMocks.listHighlights(...args),
      createHighlight: (...args: unknown[]) => apiMocks.createHighlight(...args),
      updateHighlight: (...args: unknown[]) => apiMocks.updateHighlight(...args),
      deleteHighlight: (...args: unknown[]) => apiMocks.deleteHighlight(...args),
      putResume: (...args: unknown[]) => apiMocks.putResume(...args),
      getResume: (...args: unknown[]) => apiMocks.getResume(...args),
    },
  }
})

describe('v2 3-Pane Study Workspace, Navigation Chrome & Living Notebook', () => {
  const originalInnerWidth = window.innerWidth

  beforeEach(() => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ suggestions: ['Compare L4 vs L7 load balancers'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 })
    resetKitStore()
    useAppStore.setState({
      toasts: [],
      searchOpen: false,
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
    })
    useCommitStore.getState().closeCompletely()

    apiMocks.kitsList.mockResolvedValue({ kits: [] })
    apiMocks.listDogears.mockResolvedValue([
      {
        pillarId: 'compute',
        topicId: 'traffic-gateways',
        sectionId: '',
        createdAt: '2026-11-10T00:00:00Z',
      },
    ])
    apiMocks.toggleDogear.mockResolvedValue({ dogeared: true, createdAt: '2026-11-10T00:00:00Z' })
    apiMocks.listHighlights.mockResolvedValue([
      {
        id: 'hl-saved-1',
        pillarId: 'compute',
        topicId: 'traffic-gateways',
        sectionId: 'description',
        quote: 'Layer 7 reverse proxies',
        prefix: '',
        suffix: ' route HTTP',
        color: 'amber',
        note: 'Core gateway routing',
        cardId: null,
        createdAt: '2026-11-10T00:00:00Z',
        updatedAt: null,
      },
    ])
    apiMocks.createHighlight.mockResolvedValue({
      id: 'hl-created',
      pillarId: 'compute',
      topicId: 'traffic-gateways',
      sectionId: 'description',
      quote: 'consistent hashing',
      prefix: '',
      suffix: '',
      color: 'amber',
      note: '',
      cardId: null,
      createdAt: '2026-11-10T00:00:00Z',
      updatedAt: null,
    })
    apiMocks.updateHighlight.mockResolvedValue({
      id: 'hl-saved-1',
      cardId: 'card-linked-1',
    })
    apiMocks.deleteHighlight.mockResolvedValue({ ok: true })
    apiMocks.putResume.mockResolvedValue({
      resume: {
        pillarId: 'compute',
        topicId: 'traffic-gateways',
        sectionId: '',
        updatedAt: '2026-11-10T10:00:00Z',
      },
    })
    apiMocks.getResume.mockResolvedValue({
      resume: {
        pillarId: 'compute',
        topicId: 'traffic-gateways',
        sectionId: '',
        updatedAt: '2026-11-10T10:00:00Z',
      },
    })
    apiMocks.guideProgress.mockResolvedValue({
      'compute__traffic-gateways__description': true,
    })
    apiMocks.guideGetForTopic.mockResolvedValue({
      description: {
        content: 'Layer 7 reverse proxies route HTTP traffic using consistent hashing rings.',
        committedAt: '2026-11-10T10:00:00Z',
      },
    })
    apiMocks.decksList.mockResolvedValue([
      { id: 'deck-tg', name: 'Traffic Gateways & Proxies' },
    ])
    apiMocks.decksCreate.mockResolvedValue({ id: 'deck-tg', name: 'Traffic Gateways & Proxies' })
    apiMocks.flashcardsCreate.mockResolvedValue({ id: 'card-linked-1' })
    apiMocks.sessionsList.mockResolvedValue({})
    apiMocks.sessionsCreate.mockResolvedValue({ ok: true })
    apiMocks.chatStream.mockImplementation(
      async (_msgs: unknown, onChunk?: (text: string) => void) => {
        onChunk?.('Kit explains L7 termination clearly.')
        return 'Kit explains L7 termination clearly.'
      },
    )
    apiMocks.commitAnalyze.mockResolvedValue({
      updates: [
        {
          sectionId: 'description',
          sectionName: 'Description & Internal Workings',
          isNew: false,
          reason: 'Added L7 connection multiplexing details.',
          existingContent: 'Layer 7 reverse proxies route HTTP traffic.',
          newContent:
            'Layer 7 reverse proxies route HTTP traffic.\nConnection multiplexing pools backend TCP sockets.',
        },
      ],
    })
    apiMocks.commitSave.mockResolvedValue({ savedCount: 1 })
    apiMocks.searchQuery.mockResolvedValue({
      guideContent: [],
      flashcards: [],
      boards: [],
      decks: [],
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: originalInnerWidth,
    })
    localStorage.removeItem('toolbox_chat_quote')
  })

  it('renders 3-pane ChatPage with right Notebook Inspector, docks section quotes, and runs CommitModal + TaskWorkingBar', async () => {
    const sysKit = makeTestKit({
      slug: 'system-design',
      name: 'System Design',
      dogearCount: 1,
      lastGuideRef: { pillarId: 'compute', topicId: 'traffic-gateways', sectionId: '' },
    })
    resetKitStore(sysKit)
    useKitStore.setState({ kits: [sysKit], activeKitSlug: 'system-design' })

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/k/system-design/chat']}>
          <Routes>
            <Route
              path="/k/:slug/chat"
              element={
                <>
                  <ChatPage />
                  <CommitModal />
                  <TaskWorkingBar />
                </>
              }
            />
          </Routes>
        </MemoryRouter>,
      )
    })

    // Right Notebook Inspector is open on 1440px desktop
    const inspector = screen.getByTestId('chat-notebook-inspector')
    expect(inspector).toBeInTheDocument()
    expect(within(inspector).getByText('Guide Companion')).toBeInTheDocument()

    // Select a topic in Left Curriculum Spine -> loads Guide notes into Right Inspector
    fireEvent.click(screen.getByText('Start Here').closest('button')!)
    expect(await within(inspector).findByText('Open Guide')).toBeInTheDocument()
    expect(await within(inspector).findByText(/Layer 7 reverse proxies/i)).toBeInTheDocument()

    // Click "Ask Kit" in Right Inspector -> docks quote pill into center InvitingComposer
    const askKitButtons = within(inspector).getAllByRole('button', { name: /Ask Kit/i })
    fireEvent.click(askKitButtons[0])
    expect(await screen.findByTestId('learning-chat-quote')).toHaveTextContent(
      /Layer 7 reverse proxies/i,
    )

    // Switch Right Inspector to Updates tab
    const inspectorTabs = within(inspector).getByRole('tablist', {
      name: 'Notebook inspector tabs',
    })
    fireEvent.click(within(inspectorTabs).getByRole('tab', { name: /Updates/i }))
    expect(within(inspector).getByText('Synthesize Guide Notes')).toBeInTheDocument()

    // Open CommitModal via useCommitStore, inspect positional LCS diff, minimize via Escape, restore & save
    await act(async () => {
      useCommitStore.getState().startAnalysis(
        [
          { role: 'user', content: 'How does L7 pooling work?' },
          { role: 'ai', content: 'L7 proxies multiplex backend TCP connections.' },
        ],
        {
          pillarId: 'compute',
          topicId: 'traffic-gateways',
          topicName: 'Traffic Gateways & Load Balancing',
        },
      )
    })

    expect(await screen.findByText('Added L7 connection multiplexing details.')).toBeInTheDocument()

    const diffBtn = screen.getByRole('button', { name: /Show diff/i })
    fireEvent.click(diffBtn)
    expect(
      screen.getAllByText(/Connection multiplexing pools backend TCP sockets/i).length,
    ).toBeGreaterThanOrEqual(2)

    // Press Escape to minimize CommitModal into TaskWorkingBar and restore it
    fireEvent.keyDown(window, { key: 'Escape' })
    const workingBar = await screen.findByRole('button', { name: /Review updates/i })
    expect(workingBar).toBeInTheDocument()
    fireEvent.click(workingBar)

    fireEvent.click(document.getElementById('confirm-commit-btn')!)
    await waitFor(() => expect(apiMocks.commitSave).toHaveBeenCalledTimes(1))
  })

  it('renders Living Textbook Notebook dogears, highlights, Make Card review modal linkage, and reading resume', async () => {
    const sysKit = makeTestKit({ slug: 'system-design', name: 'System Design' })
    resetKitStore(sysKit)

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/k/system-design/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/k/:slug/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    // Automatic reading resume recorded + highlights rendered inside HighlightableProse
    await waitFor(() =>
      expect(apiMocks.putResume).toHaveBeenCalledWith('compute', 'traffic-gateways'),
    )
    expect(await screen.findByText(/“Layer 7 reverse proxies”/)).toBeInTheDocument()

    // Click "Make flashcard from highlight" chip -> opens FlashcardReviewModal -> saves & links cardId
    fireEvent.click(screen.getByLabelText('Make flashcard from highlight'))
    const saveAllBtn = await screen.findByRole('button', { name: /Save 1 Card/i })
    fireEvent.click(saveAllBtn)
    await waitFor(() =>
      expect(apiMocks.updateHighlight).toHaveBeenCalledWith('hl-saved-1', {
        cardId: 'card-linked-1',
      }),
    )

    // Toggle PillarNav filter between All and Dogeared
    const navFilter = screen.getByRole('tablist', { name: 'Filter guide pages' })
    fireEvent.click(within(navFilter).getByRole('tab', { name: /Dogeared/i }))
    expect(screen.getAllByText('Traffic Gateways & Proxies').length).toBeGreaterThan(0)
    fireEvent.click(within(navFilter).getByRole('tab', { name: 'All' }))

    // Toggle a dogear corner on the textbook sheet
    const dogearBtns = screen.getAllByRole('button', {
      name: /^(Dogear this page|Remove page dogear)$/i,
    })
    fireEvent.click(dogearBtns[0])
    await waitFor(() => expect(apiMocks.toggleDogear).toHaveBeenCalled())
  })

  it('switches Kits via ActiveKitSwitcher, clears activeKitSlug on unprefixed routes, and closes SearchDialog on Escape', async () => {
    const sysKit = makeTestKit({ id: 'k1', slug: 'system-design', name: 'System Design' })
    const rustKit = makeTestKit({ id: 'k2', slug: 'distributed-rust', name: 'Distributed Rust' })
    apiMocks.kitsList.mockResolvedValue({ kits: [sysKit, rustKit] })
    resetKitStore(rustKit)
    useKitStore.setState({ kits: [sysKit, rustKit], activeKitSlug: 'distributed-rust' })

    function LocationProbe() {
      return <div data-testid="loc-probe">{useLocation().pathname}</div>
    }
    let searchClosed = false

    const { unmount } = render(
      <MemoryRouter initialEntries={['/k/system-design/guide']}>
        <LocationProbe />
        <Sidebar />
        <SearchDialog
          open={true}
          onClose={() => {
            searchClosed = true
          }}
        />
      </MemoryRouter>,
    )

    const kitTrigger = screen.getByRole('button', { name: /Active Study Kit/i })
    fireEvent.click(kitTrigger)
    const listbox = await screen.findByRole('listbox')
    fireEvent.click(within(listbox).getByText('Distributed Rust'))
    expect(screen.getByTestId('loc-probe')).toHaveTextContent('/k/distributed-rust/guide')

    const dialog = document.getElementById('search-dialog')!
    expect(within(dialog).getAllByText(/Component Library/i).length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(searchClosed).toBe(true)
    unmount()

    // Navigating Layout to unprefixed /settings clears activeKitSlug so ⌘/ never builds broken hybrid URLs
    useKitStore.setState({ kits: [sysKit, rustKit], activeKitSlug: 'distributed-rust' })
    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/settings']}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/settings" element={<div>Settings Page</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
    })
    await waitFor(() => expect(useKitStore.getState().activeKitSlug).toBeNull())
  })
})
