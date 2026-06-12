import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import SettingsPage from '../pages/SettingsPage'
import BuilderPage from '../pages/BuilderPage'
import StudyPage from '../pages/StudyPage'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'
import { configApi, boardsApi, decksApi } from '../utils/api'

// Mock the API endpoints
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
      cards: []
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
      get: vi.fn(),
      update: vi.fn(),
      testApiKey: vi.fn(),
    },
    decksApi: {
      list: vi.fn(() => Promise.resolve(mockDecks)),
      get: vi.fn((id) => Promise.resolve(mockDecks.find(d => d.id === id) || mockDecks[0])),
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
      stream: vi.fn(async (data, onChunk) => {
        const text = 'AI response'
        if (onChunk) onChunk(text)
        return text
      }),
    },
    studySessionsApi: {
      list: vi.fn(() => Promise.resolve([])),
    },
  }
})

describe('Challenger Phase 2 Adversarial Stress Tests', () => {
  let originalLocalStorage

  beforeEach(() => {
    originalLocalStorage = window.localStorage
    useAppStore.setState({
      sidebarCollapsed: false,
      chatOpen: { guide: false, builder: false, study: false },
      apiKeyConfigured: false,
      toasts: [],
      nodes: [],
    })
    vi.clearAllMocks()

    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  afterEach(() => {
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
  })

  it('asserts that removing API key persists to backend and is retained on mount/reload', async () => {
    // 1. Simulate key already stored in backend
    configApi.get.mockResolvedValue({ gemini_api_key: 'AIza...', api_key_configured: true })
    useAppStore.setState({ apiKeyConfigured: true })

    const { rerender } = render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )

    // Verify UI shows connected
    expect(screen.getByText('Connected — AI features are enabled')).toBeInTheDocument()

    // 2. Click Remove API Key
    const removeBtn = screen.getByRole('button', { name: 'Remove API Key' })
    fireEvent.click(removeBtn)

    // Confirm in modal
    const confirmBtn = screen.getByRole('button', { name: 'Remove' })
    fireEvent.click(confirmBtn)

    // State becomes disconnected in frontend store
    await waitFor(() => {
      expect(useAppStore.getState().apiKeyConfigured).toBe(false)
      expect(screen.getByText('Not configured — AI features are disabled')).toBeInTheDocument()
    })

    // Assert that API call was made to backend configApi.update to clear the key
    expect(configApi.update).toHaveBeenCalledWith({ gemini_api_key: '' })

    // 3. Re-render/remount to simulate page reload or page navigation back to settings
    // Simulate that configApi.get now returns api_key_configured: false (since it was deleted)
    configApi.get.mockResolvedValue({ gemini_api_key: '', api_key_configured: false })

    rerender(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(useAppStore.getState().apiKeyConfigured).toBe(false)
      expect(screen.getByText('Not configured — AI features are disabled')).toBeInTheDocument()
    })
  })

  it('empirically demonstrates that data management buttons (import/export) are completely unimplemented', () => {
    render(
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    )

    const exportBtn = screen.getByRole('button', { name: 'Export All Data' })
    const importBtn = screen.getByRole('button', { name: 'Import Data' })

    // Trigger clicks
    fireEvent.click(exportBtn)
    fireEvent.click(importBtn)

    // There should be no side effects, no API calls, and no store updates.
    // Confirm no toast message was triggered (normally an import/export action would notify or download a file).
    expect(useAppStore.getState().toasts.length).toBe(0)
  })

  it('asserts that BuilderPage whiteboard saves integrate with the backend API', async () => {
    boardsApi.list.mockResolvedValue([])
    const mockSavedBoard = { id: 'uuid-1234', name: 'Untitled Board', data: { nodes: [] } }
    boardsApi.create.mockResolvedValue(mockSavedBoard)

    render(
      <MemoryRouter>
        <BuilderPage />
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(boardsApi.list).toHaveBeenCalled()
    })

    const saveBtn = screen.getByRole('button', { name: 'Save' })
    
    // Click save
    fireEvent.click(saveBtn)

    // Assert that boardsApi.create was called to persist the board to SQLite database
    await waitFor(() => {
      expect(boardsApi.create).toHaveBeenCalledWith({
        name: 'Untitled Board',
        data: { nodes: [], edges: [] }
      })
    })
  })

  it('asserts that StudyPage decks/flashcards saves integrate with the backend API', async () => {
    decksApi.list.mockResolvedValue([])
    const mockCreatedDeck = { id: 'deck-uuid-123', name: 'Adversarial Test Deck', description: '' }
    decksApi.create.mockResolvedValue(mockCreatedDeck)

    render(
      <MemoryRouter>
        <StudyPage />
      </MemoryRouter>
    )

    // Trigger adding a new deck
    const newDeckBtn = screen.getByRole('button', { name: 'New Deck' })
    fireEvent.click(newDeckBtn)

    // Type name
    const deckNameInput = screen.getByPlaceholderText('e.g., Caching Strategies')
    fireEvent.change(deckNameInput, { target: { value: 'Adversarial Test Deck' } })

    const saveDeckBtn = screen.getByRole('button', { name: 'Save Deck' })
    fireEvent.click(saveDeckBtn)

    // Assert that decksApi is called to persist the deck to the backend database
    await waitFor(() => {
      expect(decksApi.create).toHaveBeenCalledWith({
        name: 'Adversarial Test Deck',
        description: '',
        color_index: 0,
        tags: ''
      })
    })
  })

  it('demonstrates that a corrupted non-array string in localStorage history does NOT cause ChatPanel render crash', () => {
    // 1. Inject malformed non-array history into localStorage
    window.localStorage.setItem('toolbox_chat_history', JSON.stringify({
      guide: 'malformed-string'
    }))

    useAppStore.setState({
      chatOpen: { guide: true },
      apiKeyConfigured: true,
    })

    // The messages array becomes a string in the old buggy version. In corrected version it defaults to array safely.
    expect(() => render(<ChatPanel page="guide" />)).not.toThrow()
    expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
  })

  it('demonstrates that Zustand store toasts addition ID collision does NOT occur under rapid additions', () => {
    // Mock Date.now to return the same timestamp
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456789)

    const addToast = useAppStore.getState().addToast
    const removeToast = useAppStore.getState().removeToast

    // Add two toasts rapidly in the same tick/millisecond
    act(() => {
      addToast({ type: 'success', message: 'Toast 1' })
      addToast({ type: 'error', message: 'Toast 2' })
    })

    const toasts = useAppStore.getState().toasts
    expect(toasts.length).toBe(2)
    // Both toasts MUST have distinct, unique IDs
    expect(toasts[0].id).not.toBe(toasts[1].id)

    // Remove one toast
    act(() => {
      removeToast(toasts[0].id)
    })

    // Since they have unique IDs, only one is removed! The toast store still has 1 item.
    expect(useAppStore.getState().toasts.length).toBe(1)
    expect(useAppStore.getState().toasts[0].message).toBe('Toast 2')

    nowSpy.mockRestore()
  })
})
