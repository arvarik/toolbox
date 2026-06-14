import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import useAppStore from '../stores/appStore'
import ChatPanel from '../components/shared/ChatPanel'

const localStorageMock = (() => {
  let store = {}
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString()
    }),
    removeItem: vi.fn((key) => {
      delete store[key]
    }),
    clear: vi.fn(() => {
      store = {}
    }),
  }
})()

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  writable: true,
})

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

describe('Real ChatPanel Component Tests', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useAppStore.setState({
      chatOpen: { chat: false, guide: true, builder: true, study: true },
      apiKeyConfigured: true,
    })
  })

  it('verifies width dragging is bounded strictly between 300px and 600px', () => {
    render(<ChatPanel page="guide" />)
    const panel = screen.getByTestId('chat-panel-container')
    const dragHandle = screen.getByTestId('chat-drag-handle')

    // Initial width should be default (350px)
    expect(panel.style.width).toBe('350px')

    // Drag to resize smaller (move mouse to the right, deltaX > 0)
    // deltaX = 100 -> newWidth = 350 - 100 = 250px -> capped at 300px
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 600 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('300px')
    expect(window.localStorage.getItem('toolbox_chat_width')).toBe('300')

    // Drag to resize larger (move mouse to the left, deltaX < 0)
    // deltaX = -400 -> newWidth = 300 - (-400) = 700px -> capped at 600px
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 100 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('600px')
    expect(window.localStorage.getItem('toolbox_chat_width')).toBe('600')

    // Drag to intermediate value
    // deltaX = 100 -> newWidth = 600 - 100 = 500px
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 600 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('500px')
    expect(window.localStorage.getItem('toolbox_chat_width')).toBe('500')
  })

  it('verifies localStorage persistence works without losing history or leaking contexts', () => {
    // Set some initial history in localStorage
    const initialHistory = {
      guide: [{ role: 'user', content: 'Guide message' }],
      builder: [{ role: 'user', content: 'Builder message' }],
    }
    window.localStorage.setItem('toolbox_chat_history', JSON.stringify(initialHistory))

    // Render guide panel
    const { rerender } = render(<ChatPanel page="guide" />)
    expect(screen.getByText('Guide message')).toBeInTheDocument()
    expect(screen.queryByText('Builder message')).not.toBeInTheDocument()

    // Rerender with page="builder"
    rerender(<ChatPanel page="builder" />)
    expect(screen.getByText('Builder message')).toBeInTheDocument()
    expect(screen.queryByText('Guide message')).not.toBeInTheDocument()
  })

  it('verifies clear chat handles multiple sessions properly', () => {
    const initialHistory = {
      guide: [{ role: 'user', content: 'Guide message' }],
      builder: [{ role: 'user', content: 'Builder message' }],
    }
    window.localStorage.setItem('toolbox_chat_history', JSON.stringify(initialHistory))

    render(<ChatPanel page="builder" />)
    expect(screen.getByText('Builder message')).toBeInTheDocument()

    const clearBtn = screen.getByRole('button', { name: 'Clear conversation' })
    act(() => {
      fireEvent.click(clearBtn)
    })

    expect(screen.queryByText('Builder message')).not.toBeInTheDocument()

    const saved = JSON.parse(window.localStorage.getItem('toolbox_chat_history'))
    expect(saved.builder).toEqual([])
    expect(saved.guide).toEqual([{ role: 'user', content: 'Guide message' }])
  })
})
