/**
 * Multi-provider model management tests:
 * - safe active-model fallback when providers/endpoints disappear
 * - settings page provider cards (Gemini, Claude, OpenAI)
 * - custom endpoint (BYOM) add/test/delete flows with presets
 * - manual "Refresh Models" catalog re-sync
 * - grouped model pickers (settings + sidebar) incl. custom endpoint groups
 */
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import SettingsPage from '../pages/SettingsPage'
import Sidebar from '../components/layout/Sidebar'
import useAppStore from '../stores/appStore'
import { configApi, endpointsApi } from '../utils/api'

vi.mock('../utils/api', () => ({
  configApi: {
    get: vi.fn(() => Promise.resolve({ api_keys_configured: { gemini: false, claude: false, openai: false } })),
    update: vi.fn(() => Promise.resolve({ success: true })),
    testApiKey: vi.fn(() => Promise.resolve({ valid: true, modelsDiscovered: 3 })),
    getAvailableModels: vi.fn(() => Promise.resolve({ groups: [], providers: [] })),
    refreshModels: vi.fn(() => Promise.resolve({ groups: [], providers: [], errors: {}, refreshed: [] })),
  },
  endpointsApi: {
    list: vi.fn(() => Promise.resolve([])),
    create: vi.fn(() => Promise.resolve({ id: 'ep-1', name: 'Ollama', models: [] })),
    update: vi.fn(() => Promise.resolve({})),
    delete: vi.fn(() => Promise.resolve({ success: true })),
    test: vi.fn(() => Promise.resolve({ ok: true, modelCount: 2 })),
    refreshModels: vi.fn(() => Promise.resolve({ models: [] })),
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
  guideContentApi: {
    exportUrl: vi.fn(() => '#'),
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

beforeEach(() => {
  useAppStore.setState({
    model: 'gemini-3.5-flash',
    availableModels: [],
    toasts: [],
    sidebarCollapsed: false,
  })
  // Re-establish default mock behavior (overrides from prior tests reset here)
  configApi.get.mockResolvedValue({ api_keys_configured: { gemini: false, claude: false, openai: false } })
  configApi.getAvailableModels.mockResolvedValue({ groups: [], providers: [] })
  configApi.testApiKey.mockResolvedValue({ valid: true, modelsDiscovered: 3 })
  configApi.refreshModels.mockResolvedValue({ groups: [], providers: [], errors: {}, refreshed: [] })
  endpointsApi.list.mockResolvedValue([])
})

describe('safe active-model fallback (appStore.applyModelGroups)', () => {
  it('keeps the active model when it is still available', () => {
    useAppStore.setState({ model: 'gemini-3.1-pro' })
    useAppStore.getState().applyModelGroups([GEMINI_GROUP])
    expect(useAppStore.getState().model).toBe('gemini-3.1-pro')
  })

  it('resets to the first available model when the active one disappears', () => {
    useAppStore.setState({ model: 'claude-opus-4-8' })
    useAppStore.getState().applyModelGroups([GEMINI_GROUP])
    expect(useAppStore.getState().model).toBe('gemini-3.5-flash')
  })

  it('keeps the pointer untouched when no models are configured at all', () => {
    useAppStore.setState({ model: 'claude-opus-4-8' })
    useAppStore.getState().applyModelGroups([])
    expect(useAppStore.getState().model).toBe('claude-opus-4-8')
  })

  it('falls back to a custom endpoint model when only an endpoint remains', () => {
    useAppStore.setState({ model: 'gemini-3.5-flash' })
    useAppStore.getState().applyModelGroups([CUSTOM_GROUP])
    expect(useAppStore.getState().model).toBe('custom:ep-1:llama3.2:3b')
  })
})

describe('settings page — provider key management', () => {
  it('renders cards for Gemini, Claude, and OpenAI with portal links', async () => {
    render(<SettingsPage />)
    expect(screen.getByText('Google Gemini')).toBeInTheDocument()
    expect(screen.getByText('Anthropic Claude')).toBeInTheDocument()
    expect(screen.getByText('OpenAI')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Google AI Studio' })).toHaveAttribute(
      'href', 'https://aistudio.google.com/apikey'
    )
    expect(screen.getByRole('link', { name: 'Anthropic Console' })).toHaveAttribute(
      'href', 'https://console.anthropic.com/settings/keys'
    )
    expect(screen.getByRole('link', { name: 'OpenAI Platform' })).toHaveAttribute(
      'href', 'https://platform.openai.com/api-keys'
    )
    await waitFor(() => expect(configApi.get).toHaveBeenCalled())
  })

  it('verifies a key before saving and reports discovered models', async () => {
    const { container } = render(<SettingsPage />)
    const input = container.querySelector('#openai-api-key-input')
    fireEvent.change(input, { target: { value: 'sk-valid' } })

    const section = input.closest('.settings-field').parentElement
    fireEvent.click(within(section).getByText('Save & Verify'))

    await waitFor(() => {
      expect(configApi.testApiKey).toHaveBeenCalledWith('sk-valid', 'openai')
    })
    await waitFor(() => {
      expect(within(section).getByText('Connected — AI features enabled')).toBeInTheDocument()
    })
  })

  it('shows a connection error and does not mark connected for invalid keys', async () => {
    configApi.testApiKey.mockRejectedValueOnce(new Error('Invalid API key'))
    const { container } = render(<SettingsPage />)
    const input = container.querySelector('#gemini-api-key-input')
    fireEvent.change(input, { target: { value: 'bad-key' } })

    const section = input.closest('.settings-field').parentElement
    fireEvent.click(within(section).getByText('Save & Verify'))

    await waitFor(() => {
      expect(
        within(section).getByText('Connection error — check your key and try again')
      ).toBeInTheDocument()
    })
    expect(within(section).queryByText('Connected — AI features enabled')).not.toBeInTheDocument()
  })
})

describe('settings page — custom endpoints (BYOM)', () => {
  it('adds an endpoint using the Ollama preset', async () => {
    const { container } = render(<SettingsPage />)
    const section = container.querySelector('#custom-endpoints-section')

    fireEvent.click(within(section).getByText('Add Custom Endpoint'))
    fireEvent.click(within(section).getByText('Ollama'))

    const urlInput = container.querySelector('#endpoint-url-input')
    expect(urlInput.value).toBe('http://localhost:11434/v1')

    fireEvent.click(within(section).getByText('Save & Verify'))
    await waitFor(() => {
      expect(endpointsApi.create).toHaveBeenCalledWith({
        name: 'Ollama',
        baseUrl: 'http://localhost:11434/v1',
        apiKey: '',
      })
    })
  })

  it('tests an endpoint without saving it', async () => {
    const { container } = render(<SettingsPage />)
    const section = container.querySelector('#custom-endpoints-section')

    fireEvent.click(within(section).getByText('Add Custom Endpoint'))
    fireEvent.change(container.querySelector('#endpoint-url-input'), {
      target: { value: 'http://localhost:1234/v1' },
    })
    fireEvent.click(within(section).getByText('Test Connection'))

    await waitFor(() => {
      expect(endpointsApi.test).toHaveBeenCalledWith({
        baseUrl: 'http://localhost:1234/v1',
        apiKey: '',
        endpointId: undefined,
      })
    })
    expect(endpointsApi.create).not.toHaveBeenCalled()
  })

  it('lists saved endpoints with masked keys and model counts', async () => {
    endpointsApi.list.mockResolvedValueOnce([
      {
        id: 'ep-1',
        name: 'Homelab Ollama',
        baseUrl: 'http://10.0.0.5:11434/v1',
        apiKeyMasked: '••••abcd',
        hasApiKey: true,
        models: [{ id: 'custom:ep-1:llama3.2:3b' }, { id: 'custom:ep-1:qwen2.5' }],
      },
    ])
    render(<SettingsPage />)

    expect(await screen.findByText('Homelab Ollama')).toBeInTheDocument()
    expect(screen.getByText(/••••abcd/)).toBeInTheDocument()
    expect(screen.getByText('2 models available')).toBeInTheDocument()
    // The raw key never appears anywhere
    expect(screen.queryByText(/sk-/)).not.toBeInTheDocument()
  })

  it('deletes an endpoint after confirmation', async () => {
    endpointsApi.list.mockResolvedValue([
      {
        id: 'ep-1',
        name: 'Homelab Ollama',
        baseUrl: 'http://10.0.0.5:11434/v1',
        apiKeyMasked: '',
        hasApiKey: false,
        models: [],
      },
    ])
    render(<SettingsPage />)
    await screen.findByText('Homelab Ollama')

    fireEvent.click(screen.getByLabelText('Remove Homelab Ollama'))
    fireEvent.click(await screen.findByText('Remove'))
    await waitFor(() => {
      expect(endpointsApi.delete).toHaveBeenCalledWith('ep-1')
    })
  })
})

describe('settings page — model catalog', () => {
  it('re-syncs catalogs via the Refresh Models button', async () => {
    configApi.refreshModels.mockResolvedValueOnce({
      groups: [GEMINI_GROUP],
      providers: [],
      errors: {},
      refreshed: ['gemini'],
    })
    const { container } = render(<SettingsPage />)
    fireEvent.click(container.querySelector('#refresh-models-btn'))

    await waitFor(() => expect(configApi.refreshModels).toHaveBeenCalled())
    await waitFor(() => {
      expect(useAppStore.getState().availableModels).toEqual([GEMINI_GROUP])
    })
  })

  it('groups models under provider headers with family labels', async () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    render(<SettingsPage />)

    expect(await screen.findByText('Gemini 3.5 Flash')).toBeInTheDocument()
    expect(screen.getByText('Flash')).toBeInTheDocument()
    expect(screen.getByText('Llama3.2 3b')).toBeInTheDocument()
    expect(screen.getAllByText('Homelab Ollama').length).toBeGreaterThan(0)
  })

  it('shows an encouraging empty state when nothing is configured', () => {
    render(<SettingsPage />)
    expect(
      screen.getByText('No models available yet. Add an API key or a custom endpoint above to unlock AI features.')
    ).toBeInTheDocument()
  })
})

describe('sidebar — grouped model picker', () => {
  it('groups models by provider including custom endpoints', () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    useAppStore.setState({ availableModels: [GEMINI_GROUP, CUSTOM_GROUP] })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    const select = container.querySelector('#sidebar-model-select')
    const groups = Array.from(select.querySelectorAll('optgroup')).map((g) => g.label)
    expect(groups).toEqual(['Google Gemini', 'Homelab Ollama'])

    const customOption = select.querySelector('option[value="custom:ep-1:llama3.2:3b"]')
    expect(customOption).not.toBe(null)
  })

  it('switches the global model from the sidebar', () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    useAppStore.setState({ availableModels: [GEMINI_GROUP, CUSTOM_GROUP] })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    fireEvent.change(container.querySelector('#sidebar-model-select'), {
      target: { value: 'custom:ep-1:llama3.2:3b' },
    })
    expect(useAppStore.getState().model).toBe('custom:ep-1:llama3.2:3b')
  })

  it('links to Settings when no models are configured', () => {
    useAppStore.setState({ availableModels: [] })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    expect(container.querySelector('#sidebar-model-select')).toBe(null)
    const emptyState = container.querySelector('#sidebar-model-empty-state')
    expect(emptyState).not.toBe(null)
    expect(emptyState.getAttribute('href')).toBe('/settings')
  })
})
