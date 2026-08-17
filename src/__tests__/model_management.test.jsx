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
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
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
    const { container } = render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    const input = container.querySelector('#openai-api-key-input')
    fireEvent.change(input, { target: { value: 'sk-valid' } })

    const card = container.querySelector('#provider-card-openai')
    fireEvent.click(within(card).getByText('Save & Verify'))

    await waitFor(() => {
      expect(configApi.testApiKey).toHaveBeenCalledWith('sk-valid', 'openai')
    })
    await waitFor(() => {
      expect(within(card).getByText('Connected')).toBeInTheDocument()
    })
  })

  it('shows a connection error pill and does not mark connected for invalid keys', async () => {
    configApi.testApiKey.mockRejectedValueOnce(new Error('Invalid API key'))
    const { container } = render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    const input = container.querySelector('#gemini-api-key-input')
    fireEvent.change(input, { target: { value: 'bad-key' } })

    const card = container.querySelector('#provider-card-gemini')
    fireEvent.click(within(card).getByText('Save & Verify'))

    await waitFor(() => {
      expect(within(card).getByText('Error')).toBeInTheDocument()
    })
    expect(within(card).queryByText('Connected')).not.toBeInTheDocument()
  })
})

describe('settings page — custom endpoints (BYOM)', () => {
  it('adds an endpoint using the Ollama preset', async () => {
    const { container } = render(<MemoryRouter><SettingsPage /></MemoryRouter>)
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
    const { container } = render(<MemoryRouter><SettingsPage /></MemoryRouter>)
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
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)

    expect(await screen.findByText('Homelab Ollama')).toBeInTheDocument()
    expect(screen.getByText(/••••abcd/)).toBeInTheDocument()
    expect(screen.getByText('2 models')).toBeInTheDocument()
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
    render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    await screen.findByText('Homelab Ollama')

    fireEvent.click(screen.getByLabelText('Remove Homelab Ollama'))
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }))
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
    const { container } = render(<MemoryRouter><SettingsPage /></MemoryRouter>)
    fireEvent.click(container.querySelector('#refresh-models-btn'))

    await waitFor(() => expect(configApi.refreshModels).toHaveBeenCalled())
    await waitFor(() => {
      expect(useAppStore.getState().availableModels).toEqual([GEMINI_GROUP])
    })
  })

  it('shows the active model card and opens the picker with grouped models', async () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    const { container } = render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )

    // Active model card reflects the current selection
    await waitFor(() => {
      expect(container.querySelector('#active-model-card')).not.toBe(null)
    })
    const card = container.querySelector('#active-model-card')
    expect(within(card).getByText('Gemini 3.5 Flash')).toBeInTheDocument()

    // Open the picker — models appear grouped under provider headers with family chips
    fireEvent.click(screen.getByRole('button', { name: /change model/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    expect(within(dialog).getByText('Google Gemini')).toBeInTheDocument()
    expect(within(dialog).getByText('Homelab Ollama')).toBeInTheDocument()
    expect(within(dialog).getByText('Gemini 3.1 Pro')).toBeInTheDocument()
    expect(within(dialog).getByText('Pro')).toBeInTheDocument()
    expect(within(dialog).getByText('Llama3.2 3b')).toBeInTheDocument()
  })

  it('filters models with the picker search', async () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    fireEvent.click(await screen.findByRole('button', { name: /change model/i }))
    const dialog = await screen.findByRole('dialog', { name: 'Select AI model' })

    fireEvent.change(within(dialog).getByPlaceholderText('Search models…'), { target: { value: 'llama' } })
    expect(within(dialog).getByText('Llama3.2 3b')).toBeInTheDocument()
    expect(within(dialog).queryByText('Gemini 3.5 Flash')).not.toBeInTheDocument()

    fireEvent.change(within(dialog).getByPlaceholderText('Search models…'), { target: { value: 'zzz' } })
    expect(within(dialog).getByText(/No models match/)).toBeInTheDocument()
  })

  it('shows an encouraging empty state when nothing is configured', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )
    expect(
      screen.getByText('No models available yet. Add an API key or a custom endpoint above to unlock AI features.')
    ).toBeInTheDocument()
  })
})

describe('sidebar — model picker', () => {
  it('shows the active model on the trigger and groups models by provider', async () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    useAppStore.setState({ availableModels: [GEMINI_GROUP, CUSTOM_GROUP] })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )

    const trigger = container.querySelector('#model-picker-trigger')
    expect(trigger).not.toBe(null)
    expect(within(trigger).getByText('Gemini 3.5 Flash')).toBeInTheDocument()

    fireEvent.click(trigger)
    const dialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    expect(within(dialog).getByText('Google Gemini')).toBeInTheDocument()
    expect(within(dialog).getByText('Homelab Ollama')).toBeInTheDocument()
  })

  it('switches the global model from the picker', async () => {
    configApi.getAvailableModels.mockResolvedValue({ groups: [GEMINI_GROUP, CUSTOM_GROUP], providers: [] })
    useAppStore.setState({ availableModels: [GEMINI_GROUP, CUSTOM_GROUP] })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    fireEvent.click(container.querySelector('#model-picker-trigger'))
    const dialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    fireEvent.click(within(dialog).getByText('Llama3.2 3b'))

    expect(useAppStore.getState().model).toBe('custom:ep-1:llama3.2:3b')
    // Picker closes after selection
    expect(screen.queryByRole('dialog', { name: 'Select AI model' })).not.toBeInTheDocument()
  })

  it('guides the user to Settings when no models are configured', async () => {
    useAppStore.setState({ availableModels: [] })
    const { container } = render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    )
    fireEvent.click(container.querySelector('#model-picker-trigger'))
    const dialog = await screen.findByRole('dialog', { name: 'Select AI model' })
    expect(within(dialog).getByText('No models yet')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /set up providers/i })).toBeInTheDocument()
  })
})
