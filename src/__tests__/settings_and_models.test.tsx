import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Sidebar from '../components/layout/Sidebar'
import { McpSettingsSection } from '../components/settings/McpSettingsSection'
import GuidePage from '../pages/GuidePage'
import SettingsPage from '../pages/SettingsPage'
import useAppStore from '../stores/appStore'
import { authApi } from '../utils/authApi'
import { makeTestKit, resetKitStore } from './testHelpers'

const mocks = vi.hoisted(() => ({
  configGet: vi.fn(),
  configUpdate: vi.fn(),
  testApiKey: vi.fn(),
  getAvailableModels: vi.fn(),
  refreshModels: vi.fn(),
  endpointsList: vi.fn(),
  endpointsCreate: vi.fn(),
  endpointsDelete: vi.fn(),
  endpointsTest: vi.fn(),
  guideProgress: vi.fn(),
  guideGetForTopic: vi.fn(),
}))

vi.mock('../utils/api', () => ({
  configApi: {
    get: (...args: unknown[]) => mocks.configGet(...args),
    update: (...args: unknown[]) => mocks.configUpdate(...args),
    testApiKey: (...args: unknown[]) => mocks.testApiKey(...args),
    getAvailableModels: (...args: unknown[]) => mocks.getAvailableModels(...args),
    refreshModels: (...args: unknown[]) => mocks.refreshModels(...args),
  },
  endpointsApi: {
    list: (...args: unknown[]) => mocks.endpointsList(...args),
    create: (...args: unknown[]) => mocks.endpointsCreate(...args),
    update: vi.fn(() => Promise.resolve({})),
    delete: (...args: unknown[]) => mocks.endpointsDelete(...args),
    test: (...args: unknown[]) => mocks.endpointsTest(...args),
    refreshModels: vi.fn(() => Promise.resolve({ models: [] })),
  },
  guideContentApi: {
    progress: (...args: unknown[]) => mocks.guideProgress(...args),
    getForTopic: (...args: unknown[]) => mocks.guideGetForTopic(...args),
    getSection: vi.fn(() => Promise.resolve({})),
    upsert: vi.fn(() => Promise.resolve({})),
    clear: vi.fn(() => Promise.resolve({})),
    exportUrl: () => '/api/guide/export',
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

const GEMINI_GROUP = {
  provider: { id: 'gemini', name: 'Google Gemini', color: '#4285F4' },
  models: [
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', description: 'Fast', family: 'Flash' },
    { id: 'gemini-3.1-pro', name: 'Gemini 3.1 Pro', description: 'Smart', family: 'Pro' },
  ],
}

const CUSTOM_GROUP = {
  provider: { id: 'custom:ep-1', name: 'Homelab Ollama', color: '#8B5CF6', isCustom: true },
  models: [
    { id: 'custom:ep-1:llama3.2:3b', name: 'Llama3.2 3b', description: 'Served by Homelab Ollama', family: null },
  ],
}

function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector)
  if (!el) throw new Error(`Missing ${selector}`)
  return el
}

async function renderSettled(ui: ReactNode) {
  let result!: ReturnType<typeof render>
  await act(async () => {
    result = render(ui)
  })
  return result
}

beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    model: 'gemini-3.5-flash',
    toasts: [],
    sidebarCollapsed: false,
    apiKeyConfigured: false,
    chatOpen: { chat: false, guide: false, builder: false, study: false },
  })
  useAppStore.getState().applyModelGroups([])
  resetKitStore()

  mocks.configGet.mockResolvedValue({ api_key_configured: false, api_keys_configured: { gemini: false, claude: false, openai: false } })
  mocks.configUpdate.mockResolvedValue({ success: true })
  mocks.getAvailableModels.mockResolvedValue({ groups: [], providers: [] })
  mocks.testApiKey.mockResolvedValue({ valid: true, modelsDiscovered: 3 })
  mocks.refreshModels.mockResolvedValue({ groups: [], providers: [], errors: {}, refreshed: [] })
  mocks.endpointsList.mockResolvedValue([])
  mocks.endpointsCreate.mockResolvedValue({ id: 'ep-1', name: 'Ollama', models: [] })
  mocks.endpointsDelete.mockResolvedValue({ success: true })
  mocks.endpointsTest.mockResolvedValue({ ok: true, modelCount: 2 })
  mocks.guideProgress.mockResolvedValue({})
  mocks.guideGetForTopic.mockResolvedValue({})
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Settings, Guide Fallbacks, Model Catalog & MCP Snippets', () => {
  it('enforces safe active-model fallback invariants in appStore.applyModelGroups', () => {
    useAppStore.setState({ model: 'gemini-3.1-pro' })
    useAppStore.getState().applyModelGroups([GEMINI_GROUP])
    expect(useAppStore.getState().model).toBe('gemini-3.1-pro')

    useAppStore.setState({ model: 'claude-opus-4-8' })
    useAppStore.getState().applyModelGroups([GEMINI_GROUP])
    expect(useAppStore.getState().model).toBe('gemini-3.5-flash')

    useAppStore.setState({ model: 'claude-opus-4-8' })
    useAppStore.getState().applyModelGroups([])
    expect(useAppStore.getState().model).toBe('claude-opus-4-8')

    useAppStore.setState({ model: 'gemini-3.5-flash' })
    useAppStore.getState().applyModelGroups([CUSTOM_GROUP])
    expect(useAppStore.getState().model).toBe('custom:ep-1:llama3.2:3b')
  })

  it('handles invalid Guide pillar/topic IDs gracefully and expands/collapses multiple accordion sections concurrently', async () => {
    const badPillar = await renderSettled(
      <MemoryRouter initialEntries={['/guide/invalid-pillar-id']}>
        <Routes>
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/guide/:pillarId" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('System Design Guide')).toBeInTheDocument()
    badPillar.unmount()

    const badTopic = await renderSettled(
      <MemoryRouter initialEntries={['/guide/compute/invalid-topic-id']}>
        <Routes>
          <Route path="/guide/:pillarId" element={<GuidePage />} />
          <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByText('Compute & Infrastructure')).toBeInTheDocument()
    expect(screen.getByText('Select a topic below to view its study blueprint.')).toBeInTheDocument()
    badTopic.unmount()

    await renderSettled(
      <MemoryRouter initialEntries={['/guide/compute/traffic-gateways']}>
        <Routes>
          <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
        </Routes>
      </MemoryRouter>,
    )
    await waitFor(() => expect(screen.getAllByText(/No notes yet/).length).toBe(1))
    fireEvent.click(screen.getByText('Use Cases & Tradeoffs'))
    expect(screen.getAllByText(/No notes yet/).length).toBe(2)
    fireEvent.click(screen.getByText('Scaling Estimates & Mechanisms'))
    expect(screen.getAllByText(/No notes yet/).length).toBe(3)
    fireEvent.click(screen.getByText('Description & Internal Workings'))
    expect(screen.getAllByText(/No notes yet/).length).toBe(2)
  })

  it('validates provider API keys, handles cancel/confirm key removal, and scopes Export Guide (.md) to ?kit=<slug>', async () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => null)
    resetKitStore(makeTestKit({ slug: 'distributed-rust', name: 'Distributed Rust' }))

    const { container, unmount } = await renderSettled(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    const geminiInput = q<HTMLInputElement>(container, '#gemini-api-key-input')
    const geminiCard = q(container, '#provider-card-gemini')
    const saveBtn = within(geminiCard).getByText('Save & Verify')

    fireEvent.change(geminiInput, { target: { value: '   ' } })
    expect(saveBtn).toBeDisabled()

    mocks.testApiKey.mockRejectedValueOnce(new Error('Invalid API key'))
    fireEvent.change(geminiInput, { target: { value: 'bad-key' } })
    fireEvent.click(saveBtn)
    await waitFor(() => expect(within(geminiCard).getByText('Error')).toBeInTheDocument())
    expect(within(geminiCard).queryByText('Connected')).not.toBeInTheDocument()

    mocks.testApiKey.mockResolvedValueOnce({ valid: true, modelsDiscovered: 3 })
    fireEvent.change(geminiInput, { target: { value: 'AIzaMockValidKey' } })
    fireEvent.click(saveBtn)
    expect(mocks.testApiKey).toHaveBeenCalledWith('AIzaMockValidKey', 'gemini')
    await waitFor(() => expect(within(geminiCard).getByText('Connected')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: /Export Guide \(\.md\)/i }))
    expect(openSpy).toHaveBeenCalledWith('/api/guide/export?kit=distributed-rust', '_blank')
    unmount()

    mocks.configGet.mockResolvedValue({ api_key_configured: true, api_keys_configured: { gemini: true, claude: false, openai: false } })
    useAppStore.setState({ apiKeyConfigured: true })
    await renderSettled(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    const removeBtn = await screen.findByRole('button', { name: 'Remove Gemini Key' })
    fireEvent.click(removeBtn)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Remove Gemini Key' })).toBeInTheDocument()

    fireEvent.click(removeBtn)
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Remove Gemini Key' })).not.toBeInTheDocument())
  })

  it('manages BYOM custom endpoints (Ollama preset, test without save, masked key display, delete)', async () => {
    mocks.endpointsList.mockResolvedValue([
      {
        id: 'ep-1',
        name: 'Homelab Ollama',
        baseUrl: 'http://10.0.0.5:11434/v1',
        apiKeyMasked: '••••abcd',
        hasApiKey: true,
        models: [{ id: 'custom:ep-1:llama3.2:3b' }, { id: 'custom:ep-1:qwen2.5' }],
      },
    ])

    const { container } = await renderSettled(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Homelab Ollama')).toBeInTheDocument()
    expect(screen.getByText(/••••abcd/)).toBeInTheDocument()
    expect(screen.getByText('2 models')).toBeInTheDocument()

    const section = q(container, '#custom-endpoints-section')
    fireEvent.click(within(section).getByText('Add Custom Endpoint'))
    fireEvent.change(q(container, '#endpoint-url-input'), { target: { value: 'http://localhost:1234/v1' } })
    fireEvent.click(within(section).getByText('Test Connection'))
    await waitFor(() =>
      expect(mocks.endpointsTest).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:1234/v1',
        apiKey: '',
        endpointId: undefined,
      }),
    )
    expect(mocks.endpointsCreate).not.toHaveBeenCalled()

    fireEvent.click(within(section).getByText('Ollama'))
    expect(q<HTMLInputElement>(container, '#endpoint-url-input').value).toBe('http://localhost:11434/v1')
    fireEvent.click(within(section).getByText('Save & Verify'))
    await waitFor(() =>
      expect(mocks.endpointsCreate).toHaveBeenCalledWith({
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
      }),
    )

    fireEvent.click(screen.getByLabelText('Remove Homelab Ollama'))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mocks.endpointsDelete).toHaveBeenCalledWith('ep-1'))
  })

  it('refreshes model catalog, filters ModelPicker search, switches active model, and handles empty model catalog', async () => {
    mocks.refreshModels.mockResolvedValueOnce({
      groups: [GEMINI_GROUP, CUSTOM_GROUP],
      providers: [],
      errors: {},
      refreshed: ['gemini'],
    })

    const settingsRender = await renderSettled(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>,
    )
    expect(screen.getByText(/No models available yet/i)).toBeInTheDocument()

    fireEvent.click(q(settingsRender.container, '#refresh-models-btn'))
    await waitFor(() => expect(useAppStore.getState().availableModels).toEqual([GEMINI_GROUP, CUSTOM_GROUP]))
    mocks.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })

    fireEvent.click(await screen.findByRole('button', { name: /change model/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    fireEvent.change(within(dialog).getByPlaceholderText('Search models…'), { target: { value: 'llama' } })
    expect(within(dialog).getByText('Llama3.2 3b')).toBeInTheDocument()
    expect(within(dialog).queryByText('Gemini 3.5 Flash')).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('Search models…'), { target: { value: 'zzz' } })
    expect(within(dialog).getByText(/No models match/)).toBeInTheDocument()
    settingsRender.unmount()

    useAppStore.getState().applyModelGroups([])
    mocks.getAvailableModels.mockResolvedValue({ groups: [], providers: [] })
    const emptySidebar = await renderSettled(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    fireEvent.click(q(emptySidebar.container, '#model-picker-trigger'))
    const emptyDialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    expect(within(emptyDialog).getByText('No models yet')).toBeInTheDocument()
    emptySidebar.unmount()

    mocks.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    useAppStore.getState().applyModelGroups([GEMINI_GROUP, CUSTOM_GROUP])
    const filledSidebar = await renderSettled(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>,
    )
    fireEvent.click(q(filledSidebar.container, '#model-picker-trigger'))
    const switchDialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    fireEvent.click(within(switchDialog).getByText('Llama3.2 3b'))
    expect(useAppStore.getState().model).toBe('custom:ep-1:llama3.2:3b')
  })

  it('interpolates minted read-write and read-only tbk_ tokens into MCP client snippets', async () => {
    const createTokenSpy = vi
      .spyOn(authApi, 'createToken')
      .mockResolvedValueOnce({
        id: 'tok-rw-1',
        name: 'Claude Code',
        token: 'tbk_live_rw_abcdef',
        tokenPrefix: 'tbk_live_rw_',
        expiresAt: null,
        readOnly: false,
      })
      .mockResolvedValueOnce({
        id: 'tok-ro-2',
        name: 'Cursor RO',
        token: 'tbk_live_ro_999888',
        tokenPrefix: 'tbk_live_ro_',
        expiresAt: null,
        readOnly: true,
      })

    render(<McpSettingsSection />)
    expect(screen.getByTestId('mcp-snippet-claude-code').textContent).toContain('<YOUR_TBK_TOKEN>')

    const nameInput = screen.getByLabelText('MCP token name')
    fireEvent.change(nameInput, { target: { value: 'Claude Code' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate MCP Token/i }))
    await waitFor(() => expect(createTokenSpy).toHaveBeenCalledWith({ name: 'Claude Code', readOnly: false }))
    await waitFor(() =>
      expect(screen.getByTestId('mcp-snippet-json').textContent).toContain('Bearer tbk_live_rw_abcdef'),
    )

    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.change(nameInput, { target: { value: 'Cursor RO' } })
    fireEvent.click(screen.getByRole('button', { name: /Generate MCP Token/i }))
    await waitFor(() => expect(createTokenSpy).toHaveBeenCalledWith({ name: 'Cursor RO', readOnly: true }))
    await waitFor(() =>
      expect(screen.getByTestId('mcp-snippet-claude-code').textContent).toContain('Bearer tbk_live_ro_999888'),
    )
  })
})
