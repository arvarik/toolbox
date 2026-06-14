import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import GuidePage from '../pages/GuidePage'
import SettingsPage from '../pages/SettingsPage'
import useAppStore from '../stores/appStore'
import { configApi } from '../utils/api'

// MANDATORY INTEGRITY WARNING:
// DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, 
// create dummy/facade implementations, or circumvent the intended task. A Forensic 
// Auditor will independently verify your work. Integrity violations WILL be detected 
// and your work WILL be rejected.

vi.mock('../utils/api', () => ({
  configApi: {
    get: vi.fn(),
    update: vi.fn(),
    testApiKey: vi.fn(),
  },
  decksApi: {
    list: vi.fn(() => Promise.resolve([])),
    get: vi.fn(() => Promise.resolve({})),
    create: vi.fn(() => Promise.resolve({})),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({})),
  },
  flashcardsApi: {
    list: vi.fn(() => Promise.resolve([])),
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
    send: vi.fn(() => Promise.resolve({ response: 'AI response' })),
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
}))

describe('Guide & Settings Comprehensive Test Suite', () => {
  // Helper to set viewport width and mock matchMedia
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
    // Reset Zustand store state
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
      apiKeyConfigured: false,
      toasts: [],
    })

    // Reset API key configuration mock results
    configApi.get.mockReset()
    configApi.update.mockReset()
    configApi.testApiKey.mockReset()

    configApi.get.mockResolvedValue({ api_key_configured: false })
    configApi.update.mockResolvedValue({ success: true })
    configApi.testApiKey.mockResolvedValue({ valid: true })

    // Default to desktop view
    setViewport(1024)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ==========================================
  // Part 1: Guide Page (10 Tests)
  // ==========================================

  describe('Guide Page', () => {
    // Tier 1: 5 tests

    it('1. renders welcome page and clicking a quick start button navigates to the pillar page', async () => {
      render(
        <MemoryRouter initialEntries={['/guide']}>
          <Routes>
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/guide/:pillarId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      // Check for welcome page components
      expect(screen.getByText('System Design Guide')).toBeInTheDocument()
      expect(
        screen.getByText(
          /Your authoritative library of system design knowledge/i
        )
      ).toBeInTheDocument()

      // Find the card for Compute and click it
      const computeCard = screen.getAllByText('Compute').find(el => el.closest('.card-interactive'))
      expect(computeCard).toBeInTheDocument()

      fireEvent.click(computeCard)

      // Should navigate and load Pillar topic selection page
      await waitFor(() => {
        expect(screen.getByText('Compute & Infrastructure')).toBeInTheDocument()
        expect(screen.getByText('Select a topic below to view its study blueprint.')).toBeInTheDocument()
      })
    })

    it('2. typing in inputs on the Guide page works correctly', () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      // Click Ask AI button to open the chat panel
      const askAiBtn = screen.getByRole('button', { name: /ask ai/i })
      fireEvent.click(askAiBtn)

      const chatInput = screen.getByPlaceholderText(/Ask about this component/i)
      fireEvent.change(chatInput, { target: { value: 'explain load balancers' } })
      expect(chatInput.value).toBe('explain load balancers')
    })

    it('3. renders correct topic accordion headers when active topic route loads', () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      // Page header is shown for the loaded topic
      expect(screen.getAllByText('Traffic Gateways & Proxies').length).toBeGreaterThan(0)

      // Accordion headers are rendered for the compute pillar
      expect(screen.getByText('Description & Internal Workings')).toBeInTheDocument()
      expect(screen.getByText('Use Cases & Tradeoffs')).toBeInTheDocument()
      expect(screen.getByText('Scaling Estimates & Mechanisms')).toBeInTheDocument()
      expect(screen.getByText('Availability & Reliability')).toBeInTheDocument()
      expect(screen.getByText('Deployment & APIs')).toBeInTheDocument()
    })

    it('4. clicking accordion headers expands and collapses sections', async () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      const defaultTextRegex = /No notes yet/

      // Wait for the async content to resolve and show the empty state
      await waitFor(() => {
        const contentElements = screen.getAllByText(defaultTextRegex)
        expect(contentElements.length).toBe(1)
      })

      // Click second section header to expand it
      const secondHeader = screen.getByText('Use Cases & Tradeoffs')
      fireEvent.click(secondHeader)

      // Both should now be expanded
      expect(screen.getAllByText(defaultTextRegex).length).toBe(2)

      // Collapse the first section
      const firstHeader = screen.getByText('Description & Internal Workings')
      fireEvent.click(firstHeader)

      // Only second section should be expanded now
      expect(screen.getAllByText(defaultTextRegex).length).toBe(1)
    })

    it('5. topic detail parameters load and update view details accordingly', () => {
      render(
        <MemoryRouter initialEntries={['/guide/data-storage/relational-oltp']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      // Heading and breadcrumbs should display the correct data storage information
      expect(screen.getAllByText('Relational Databases (OLTP)').length).toBeGreaterThan(0)
      expect(screen.getByText('Pillar 2: Storage')).toBeInTheDocument()
    })

    // Tier 2: 5 tests

    it('6. handles empty welcome search query cleanly', () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      // Click Ask AI button to open chat panel
      const askAiBtn = screen.getByRole('button', { name: /ask ai/i })
      fireEvent.click(askAiBtn)

      // Verify the chat input is empty by default
      const chatInput = screen.getByPlaceholderText(/Ask about this component/i)
      expect(chatInput.value).toBe('')
    })

    it('7. permits accordion to expand multiple sections concurrently', async () => {
      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      const defaultTextRegex = /No notes yet/

      // Wait for async content to resolve
      await waitFor(() => {
        expect(screen.getAllByText(defaultTextRegex).length).toBe(1)
      })

      // Open second section
      fireEvent.click(screen.getByText('Use Cases & Tradeoffs'))
      expect(screen.getAllByText(defaultTextRegex).length).toBe(2)

      // Open third section
      fireEvent.click(screen.getByText('Scaling Estimates & Mechanisms'))
      expect(screen.getAllByText(defaultTextRegex).length).toBe(3)
    })

    it('8. handles invalid topic or pillar IDs gracefully', () => {
      // 1. Invalid pillar ID should redirect/render the welcome screen
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

      // 2. Valid pillar but invalid topic should render the pillar topic selection grid
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

    it('9. stacks and scales correctly in mobile layout views', () => {
      setViewport(390)

      render(
        <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
          <Routes>
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          </Routes>
        </MemoryRouter>
      )

      const pageContainer = document.querySelector('.guide-layout') || document.querySelector('#guide-page')
      expect(pageContainer).toBeInTheDocument()
    })

    it('10. verifies scroll mock functions are called on expand actions', () => {
      const scrollIntoViewMock = vi.fn()
      window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock

      // Open guide chat panel to trigger scroll behavior
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

  // ==========================================
  // Part 2: Settings Page (10 Tests)
  // ==========================================

  describe('Settings Page', () => {
    // Tier 1: 5 tests

    it('11. renders settings page components correctly', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
      expect(screen.getByLabelText('API Key')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Save & Verify' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'Data Management' })).toBeInTheDocument()
      expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    })

    it('12. allows typing into the API key input', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const apiKeyInput = screen.getByLabelText('API Key')
      expect(apiKeyInput.value).toBe('')

      fireEvent.change(apiKeyInput, { target: { value: 'AIzaSecretKey123' } })
      expect(apiKeyInput.value).toBe('AIzaSecretKey123')
    })

    it('13. clicking save calls mock endpoint and updates store state', async () => {
      configApi.testApiKey.mockResolvedValueOnce({ valid: true })

      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const apiKeyInput = screen.getByLabelText('API Key')
      const saveButton = screen.getByRole('button', { name: 'Save & Verify' })

      fireEvent.change(apiKeyInput, { target: { value: 'AIzaMockValidKey' } })
      fireEvent.click(saveButton)

      expect(configApi.testApiKey).toHaveBeenCalledWith('AIzaMockValidKey')

      await waitFor(() => {
        expect(useAppStore.getState().apiKeyConfigured).toBe(true)
        expect(screen.getByText('Connected — AI features are enabled')).toBeInTheDocument()
      })
    })

    it('14. disconnect action clears store and local states', async () => {
      configApi.get.mockResolvedValue({ api_key_configured: true })
      useAppStore.setState({ apiKeyConfigured: true })

      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const removeButton = screen.getByRole('button', { name: 'Remove API Key' })
      fireEvent.click(removeButton)

      // Confirm in modal
      const confirmButton = screen.getByRole('button', { name: 'Remove' })
      fireEvent.click(confirmButton)

      await waitFor(() => {
        expect(useAppStore.getState().apiKeyConfigured).toBe(false)
        expect(screen.getByText('Not configured — AI features are disabled')).toBeInTheDocument()
      })
    })

    it('15. renders dangerous remove action details accurately', () => {
      configApi.get.mockResolvedValue({ api_key_configured: true })
      useAppStore.setState({ apiKeyConfigured: true })

      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      expect(screen.getByText('Danger Zone')).toBeInTheDocument()
      expect(screen.getByText('Permanently remove your saved credentials.')).toBeInTheDocument()

      const removeBtn = screen.getByRole('button', { name: 'Remove API Key' })
      expect(removeBtn.className).toContain('btn-ghost')
      expect(removeBtn.style.color).toBe('var(--color-error)')
    })

    // Tier 2: 5 tests

    it('16. danger zone confirm/cancel buttons trigger correct events', async () => {
      configApi.get.mockResolvedValue({ api_key_configured: true })
      useAppStore.setState({ apiKeyConfigured: true })

      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const removeBtn = screen.getByRole('button', { name: 'Remove API Key' })

      // Cancel flow
      fireEvent.click(removeBtn)
      const cancelBtn = screen.getByRole('button', { name: 'Cancel' })
      fireEvent.click(cancelBtn)
      expect(useAppStore.getState().apiKeyConfigured).toBe(true)

      // Confirm flow
      fireEvent.click(removeBtn)
      const confirmBtn = screen.getByRole('button', { name: 'Remove' })
      fireEvent.click(confirmBtn)

      await waitFor(() => {
        expect(useAppStore.getState().apiKeyConfigured).toBe(false)
      })
    })

    it('17. API key input styling validates full-width layout classes', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const apiKeyInput = screen.getByLabelText('API Key')
      expect(apiKeyInput.className).toContain('input')

      const wrapper = apiKeyInput.closest('.api-key-input-wrapper')
      expect(wrapper).toBeInTheDocument()
    })

    it('18. validation displays correct alert style classes for success and failure', async () => {
      const { rerender } = render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      // Disconnected state
      let statusContainer = screen.getByText('Not configured — AI features are disabled').closest('.api-key-status')
      expect(statusContainer.classList.contains('disconnected')).toBe(true)
      expect(statusContainer.classList.contains('connected')).toBe(false)

      // Mock Success validation
      configApi.testApiKey.mockResolvedValueOnce({ valid: true })
      const apiKeyInput = screen.getByLabelText('API Key')
      const saveButton = screen.getByRole('button', { name: 'Save & Verify' })

      fireEvent.change(apiKeyInput, { target: { value: 'successful-key' } })
      fireEvent.click(saveButton)

      await waitFor(() => {
        statusContainer = screen.getByText('Connected — AI features are enabled').closest('.api-key-status')
        expect(statusContainer.classList.contains('connected')).toBe(true)
        expect(statusContainer.classList.contains('disconnected')).toBe(false)
      })

      // Mock Failure validation
      useAppStore.setState({ apiKeyConfigured: false })
      configApi.testApiKey.mockResolvedValueOnce({ valid: false })

      rerender(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      fireEvent.change(apiKeyInput, { target: { value: 'failed-key' } })
      fireEvent.click(saveButton)

      await waitFor(() => {
        statusContainer = screen.getByText('Not configured — AI features are disabled').closest('.api-key-status')
        expect(statusContainer.classList.contains('disconnected')).toBe(true)
        expect(statusContainer.classList.contains('connected')).toBe(false)
      })
    })

    it('19. layout grids match defined alignment contracts', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const pageWrapper = document.querySelector('#settings-page')
      expect(pageWrapper).toBeInTheDocument()
      expect(pageWrapper.className).toContain('page-wrapper')

      const sections = document.querySelectorAll('.settings-section')
      expect(sections.length).toBeGreaterThanOrEqual(3)

      const fields = document.querySelectorAll('.settings-field')
      expect(fields.length).toBeGreaterThanOrEqual(1)

      const dividers = document.querySelectorAll('.divider-h')
      expect(dividers.length).toBeGreaterThanOrEqual(2)
    })

    it('20. empty input submissions produce correct disabled/error states', () => {
      render(
        <MemoryRouter>
          <SettingsPage />
        </MemoryRouter>
      )

      const apiKeyInput = screen.getByLabelText('API Key')
      const saveButton = screen.getByRole('button', { name: 'Save & Verify' })

      // Empty input
      fireEvent.change(apiKeyInput, { target: { value: '' } })
      expect(saveButton).toBeDisabled()

      // Spaces-only input
      fireEvent.change(apiKeyInput, { target: { value: '   ' } })
      expect(saveButton).toBeDisabled()

      // Characters input
      fireEvent.change(apiKeyInput, { target: { value: 'AIza' } })
      expect(saveButton).not.toBeDisabled()
    })
  })
})
