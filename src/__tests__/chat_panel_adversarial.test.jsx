import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import useAppStore from '../stores/appStore'
import ChatPanel from '../components/shared/ChatPanel'
import { chatApi } from '../utils/api'

// Mock the API responses
vi.mock('../utils/api', () => ({
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'Mock AI Response' })),
    stream: vi.fn(async (data, onChunk) => {
      const text = 'Mock AI Response'
      if (onChunk) onChunk(text)
      return text
    }),
  },
}))

describe('Adversarial & Edge Case Tests for ChatPanel', () => {
  let originalLocalStorage
  let originalClipboard

  beforeEach(() => {
    // Save original references
    originalLocalStorage = window.localStorage
    originalClipboard = navigator.clipboard

    // Clear localStorage to prevent leakages between tests
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        window.localStorage.clear()
      } catch {
        // Ignore in case mock throws
      }
    }

    // Reset Zustand store state
    useAppStore.setState({
      chatOpen: { guide: true, builder: true, study: true },
      apiKeyConfigured: true,
    })
    
    // Clear mocks
    vi.clearAllMocks()
  })

  afterEach(() => {
    // Restore original globals
    Object.defineProperty(window, 'localStorage', {
      value: originalLocalStorage,
      writable: true,
      configurable: true,
    })
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      writable: true,
      configurable: true,
    })
  })

  it('handles window.localStorage throwing errors (e.g. disabled third-party storage)', async () => {
    // Mock localStorage to throw on any access
    const localStorageMock = {
      getItem: vi.fn().mockImplementation(() => {
        throw new Error('SecurityError: Sandbox restriction')
      }),
      setItem: vi.fn().mockImplementation(() => {
        throw new Error('SecurityError: Sandbox restriction')
      }),
      removeItem: vi.fn().mockImplementation(() => {
        throw new Error('SecurityError: Sandbox restriction')
      }),
      clear: vi.fn().mockImplementation(() => {
        throw new Error('SecurityError: Sandbox restriction')
      }),
    }
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    })

    // Component should render successfully without throwing
    expect(() => render(<ChatPanel page="guide" />)).not.toThrow()

    // It should display empty state if history fails to load
    expect(screen.getByText('Ask about system design')).toBeInTheDocument()

    // Sending a message should work and not crash when trying to save
    const chatInput = screen.getByPlaceholderText('Ask a question...')
    fireEvent.change(chatInput, { target: { value: 'Test message when storage blocked' } })

    const sendBtn = screen.getByRole('button', { name: 'Send message' })
    chatApi.stream.mockResolvedValueOnce('Success response')

    await act(async () => {
      fireEvent.click(sendBtn)
    })

    await waitFor(() => {
      expect(screen.getByText('Success response')).toBeInTheDocument()
    })
  })

  it('handles corrupt/malformed values in localStorage gracefully', () => {
    const store = {
      toolbox_chat_history: 'invalid-json-string{]!',
      toolbox_chat_width: 'not-a-number',
    }
    const localStorageMock = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => {
        store[key] = value.toString()
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
    }
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
      configurable: true,
    })

    // Component should render successfully without throwing
    expect(() => render(<ChatPanel page="guide" />)).not.toThrow()

    // Panel style width is filtered by jsdom/browser as empty string since NaNpx is invalid css width, but is recovered to 350px
    const panel = screen.getByTestId('chat-panel-container')
    expect(panel.style.width).toBe('350px')
  })

  it('prevents double sending when multiple clicks are made rapidly while loading', async () => {
    let resolvePromise
    chatApi.stream.mockImplementationOnce((data, onChunk) => new Promise((resolve) => {
      resolvePromise = (val) => {
        const text = typeof val === 'string' ? val : val.response
        if (onChunk) onChunk(text)
        resolve(text)
      }
    }))

    render(<ChatPanel page="guide" />)
    const chatInput = screen.getByPlaceholderText('Ask a question...')
    fireEvent.change(chatInput, { target: { value: 'Rapid clicks test' } })

    const sendBtn = screen.getByRole('button', { name: 'Send message' })
    
    // First click
    await act(async () => {
      fireEvent.click(sendBtn)
    })
    
    // Immediately click again
    await act(async () => {
      fireEvent.click(sendBtn)
    })

    expect(chatApi.stream).toHaveBeenCalledTimes(1)

    // Resolve the promise
    await act(async () => {
      resolvePromise({ response: 'Response for rapid click' })
    })
  })

  it('falls back to textarea execution when navigator.clipboard.writeText rejects', async () => {
    const messages = [{ role: 'ai', content: 'Fallback copy content' }]
    render(<ChatPanel page="guide" initialMessages={messages} />)

    // Setup Clipboard that rejects
    Object.defineProperty(navigator, 'clipboard', {
      value: {
        writeText: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
      writable: true,
      configurable: true,
    })

    // Define execCommand on document if it doesn't exist
    if (typeof document.execCommand !== 'function') {
      Object.defineProperty(document, 'execCommand', {
        value: vi.fn(() => true),
        writable: true,
        configurable: true,
      })
    }

    const execCommandSpy = vi.spyOn(document, 'execCommand')

    const copyBtn = screen.getByRole('button', { name: 'Copy to clipboard' })
    
    await act(async () => {
      fireEvent.click(copyBtn)
    })

    // The component should have caught the clipboard rejection and fallback to document.execCommand
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Fallback copy content')
    expect(execCommandSpy).toHaveBeenCalledWith('copy')

    execCommandSpy.mockRestore()
  })

  it('renders correctly with null or empty values for optional parameters', () => {
    // Render with missing properties
    expect(() => render(
      <ChatPanel 
        page="guide" 
        title={undefined} 
        placeholder={undefined} 
        initialMessages={undefined} 
        context={undefined} 
      />
    )).not.toThrow()

    expect(screen.getByText('Ask AI')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Ask a question...')).toBeInTheDocument()
  })
})
