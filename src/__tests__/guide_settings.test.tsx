import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import GuidePage from '../pages/GuidePage'
import SettingsPage from '../pages/SettingsPage'
import useAppStore from '../stores/appStore'
import useKitStore, { type KitDetailItem } from '../stores/useKitStore'

const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configUpdate: vi.fn(),
  testApiKey: vi.fn(),
  guideProgress: vi.fn(),
  guideGetForTopic: vi.fn(),
  guideExportUrl: vi.fn(() => '/api/guide/export'),
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
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'AI response' })),
    stream: vi.fn(async () => 'AI response'),
  },
  guideContentApi: {
    progress: (...args: unknown[]) => mocks.guideProgress(...args),
    getForTopic: (...args: unknown[]) => mocks.guideGetForTopic(...args),
    getSection: vi.fn(() => Promise.resolve({})),
    upsert: vi.fn(() => Promise.resolve({})),
    clear: vi.fn(() => Promise.resolve({})),
    exportUrl: () => mocks.guideExportUrl(),
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

describe('Guide & Settings Comprehensive Test Suite', () => {
  beforeEach(() => {
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: false,
      toasts: [],
    })
    useKitStore.setState({
      kits: [],
      activeKitSlug: null,
      activeKit: null,
      kitCache: {},
      isLoadingList: false,
      isLoadingActive: false,
    })

    mocks.configGet.mockReset()
    mocks.configUpdate.mockReset()
    mocks.testApiKey.mockReset()
    mocks.guideProgress.mockReset()
    mocks.guideGetForTopic.mockReset()

    mocks.configGet.mockResolvedValue({ api_key_configured: false })
    mocks.configUpdate.mockResolvedValue({ success: true })
    mocks.testApiKey.mockResolvedValue({ valid: true })
    mocks.guideProgress.mockResolvedValue({})
    mocks.guideGetForTopic.mockResolvedValue({})

    setViewport(1024)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('Guide Page', () => {
    it('1. renders welcome page and clicking a quick start button navigates to the pillar page', async () => {
      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Routes>
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/guide/:pillarId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      expect(screen.getByText('System Design Guide')).toBeInTheDocument()
      expect(screen.getByText(/Your authoritative library of system design knowledge/i)).toBeInTheDocument()

      const computeCard = screen.getAllByText('Compute').find((el) => el.closest('.blueprint-pillar-card'))
      expect(computeCard).toBeDefined()
      fireEvent.click(computeCard!)

      await waitFor(() => {
        expect(screen.getByText('Compute & Infrastructure')).toBeInTheDocument()
        expect(screen.getByText('Select a topic below to view its study blueprint.')).toBeInTheDocument()
      })
    })

    it('2. opens Ask AI chat panel with empty default input and accepts typed questions', () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      fireEvent.click(screen.getByRole('button', { name: /ask ai/i }))
      const chatInput = screen.getByPlaceholderText<HTMLInputElement | HTMLTextAreaElement>(/Ask about this component/i)
      expect(chatInput.value).toBe('')

      fireEvent.change(chatInput, { target: { value: 'explain load balancers' } })
      expect(chatInput.value).toBe('explain load balancers')
    })

    it('3. renders topic accordion headers, expands multiple sections concurrently, and collapses on re-click', async () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      expect(screen.getAllByText('Traffic Gateways & Proxies').length).toBeGreaterThan(0)
      expect(screen.getByText('Description & Internal Workings')).toBeInTheDocument()
      expect(screen.getByText('Use Cases & Tradeoffs')).toBeInTheDocument()
      expect(screen.getByText('Scaling Estimates & Mechanisms')).toBeInTheDocument()
      expect(screen.getByText('Availability & Reliability')).toBeInTheDocument()
      expect(screen.getByText('Deployment & APIs')).toBeInTheDocument()

      const defaultTextRegex = /No notes yet/
      await waitFor(() => {
        expect(screen.getAllByText(defaultTextRegex).length).toBe(1)
      })

      fireEvent.click(screen.getByText('Use Cases & Tradeoffs'))
      expect(screen.getAllByText(defaultTextRegex).length).toBe(2)

      fireEvent.click(screen.getByText('Scaling Estimates & Mechanisms'))
      expect(screen.getAllByText(defaultTextRegex).length).toBe(3)

      fireEvent.click(screen.getByText('Description & Internal Workings'))
      expect(screen.getAllByText(defaultTextRegex).length).toBe(2)
    })

    it('4. topic detail parameters load and update view details accordingly', () => {
      render(
        <MemoryRouter initialEntries={['/guide/data-storage/relational-oltp']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      expect(screen.getAllByText('Relational Databases (OLTP)').length).toBeGreaterThan(0)
      expect(screen.getByText('Pillar 2: Storage')).toBeInTheDocument()
    })

    it('5. handles invalid topic or pillar IDs gracefully', () => {
      const { unmount } = render(
        <MemoryRouter initialEntries={['/guide/invalid-pillar-id']}>
          <Routes>
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/guide/:pillarId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )
      expect(screen.getByText('System Design Guide')).toBeInTheDocument()
      unmount()

      render(
        <MemoryRouter initialEntries={['/guide/compute/invalid-topic-id']}>
          <Routes>
            <Route path="/guide/:pillarId" element={<GuidePage />} />
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )
      expect(screen.getByText('Compute & Infrastructure')).toBeInTheDocument()
      expect(screen.getByText('Select a topic below to view its study blueprint.')).toBeInTheDocument()
    })

    it('6. renders cleanly in mobile viewport and triggers chat scroll behavior when open on desktop', () => {
      setViewport(390)
      const mobileRender = render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )
      expect(document.querySelector('.guide-layout') || document.querySelector('#guide-page')).toBeInTheDocument()
      mobileRender.unmount()

      const scrollIntoViewMock = vi.fn()
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock
      setViewport(1024)
      useAppStore.setState({ chatOpen: { chat: false, guide: true, builder: false, study: false } })

      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      expect(scrollIntoViewMock).toHaveBeenCalled()
    })
  })

  describe('Settings Page', () => {
    it('7. renders settings sections, layout grids, and API key input wrapper contracts', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
      expect(screen.getByPlaceholderText('sk-ant-...')).toBeInTheDocument()
      expect(screen.getAllByRole('button', { name: 'Save & Verify' }).length).toBeGreaterThanOrEqual(1)
      expect(screen.getByRole('heading', { name: 'Data Management' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()

      const apiKeyInput = screen.getByPlaceholderText<HTMLInputElement>('AIza...')
      expect(apiKeyInput.value).toBe('')
      expect(apiKeyInput.className).toContain('input')
      expect(apiKeyInput.closest('.api-key-input-wrapper')).toBeInTheDocument()

      const pageWrapper = document.querySelector('#settings-page')
      expect(pageWrapper).not.toBeNull()
      expect(pageWrapper!.className).toContain('page-wrapper')
      expect(document.querySelectorAll('.settings-section').length).toBeGreaterThanOrEqual(3)
      expect(document.querySelectorAll('.settings-field').length).toBeGreaterThanOrEqual(1)
      expect(document.querySelectorAll('.divider-h').length).toBeGreaterThanOrEqual(2)
    })

    it('8. disables Save & Verify for empty/whitespace input, verifies valid keys, and updates status pill', async () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const statusPills = screen.getAllByText('Not configured').map((el) => el.closest('.status-pill'))
      expect(statusPills[0]?.classList.contains('disconnected')).toBe(true)

      const apiKeyInput = screen.getByPlaceholderText<HTMLInputElement>('AIza...')
      const saveButtons = screen.getAllByRole('button', { name: 'Save & Verify' })

      fireEvent.change(apiKeyInput, { target: { value: '' } })
      expect(saveButtons[0]).toBeDisabled()

      fireEvent.change(apiKeyInput, { target: { value: '   ' } })
      expect(saveButtons[0]).toBeDisabled()

      mocks.testApiKey.mockResolvedValueOnce({ valid: true })
      fireEvent.change(apiKeyInput, { target: { value: 'AIzaMockValidKey' } })
      expect(saveButtons[0]).not.toBeDisabled()
      fireEvent.click(saveButtons[0])

      expect(mocks.testApiKey).toHaveBeenCalledWith('AIzaMockValidKey', 'gemini')

      await waitFor(() => {
        const connectedPill = screen.getByText('Connected').closest('.status-pill')
        expect(connectedPill?.classList.contains('connected')).toBe(true)
      })
    })

    it('9. renders provider remove button and supports both cancel and confirm removal flows', async () => {
      mocks.configGet.mockResolvedValue({
        api_key_configured: true,
        api_keys_configured: { gemini: true, claude: false },
      })
      useAppStore.setState({ apiKeyConfigured: true })

      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const removeBtn = await screen.findByRole('button', { name: 'Remove Gemini Key' })
      expect(removeBtn.className).toContain('btn-ghost')
      expect(removeBtn.style.color).toBe('var(--color-error)')

      // Cancel keeps the key connected
      fireEvent.click(removeBtn)
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(screen.getByRole('button', { name: 'Remove Gemini Key' })).toBeInTheDocument()

      // Confirm removes the key
      fireEvent.click(removeBtn)
      fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: 'Remove Gemini Key' })).not.toBeInTheDocument()
        expect(screen.queryByText('Connected')).not.toBeInTheDocument()
      })
    })

    it('10. scopes Export Guide (.md) download URL to ?kit=<slug> when a custom Kit is active', () => {
      const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
      const skeleton = structuredClone(SYSTEM_DESIGN_KIT_SKELETON)
      skeleton.identity = { ...skeleton.identity, slug: 'distributed-rust', name: 'Distributed Rust' }
      const customKit: KitDetailItem = {
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
        capabilities: skeleton.capabilities,
        deckCount: 0,
        cardCount: 0,
        dueCount: 0,
        newCount: 0,
        reviewedCount: 0,
        masteryPercent: 0,
        guideFilledCount: 0,
        guideTotalCount: 5,
        archivedNotesCount: 0,
        drillCount: 0,
        skeleton,
      }
      useKitStore.setState({
        kits: [customKit],
        activeKitSlug: 'distributed-rust',
        activeKit: customKit,
        kitCache: { 'distributed-rust': customKit },
      })

      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      fireEvent.click(screen.getByRole('button', { name: /Export Guide \(\.md\)/i }))
      expect(openSpy).toHaveBeenCalledWith('/api/guide/export?kit=distributed-rust', '_blank')
      openSpy.mockRestore()
    })
  })
})
