import { render, screen, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach } from 'vitest'
import useAppStore from '../stores/appStore'
import ChatPanel from '../components/shared/ChatPanel'
import { chatApi } from '../utils/api'

vi.mock('../utils/api', () => ({
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'Mock AI Response' })),
  },
}))

describe('Challenger Stress and Edge Case Tests', () => {
  beforeEach(() => {
    useAppStore.setState({
      chatOpen: { guide: true, builder: true, study: true },
      apiKeyConfigured: true,
      nodes: [],
    })
    vi.clearAllMocks()
    
    // Clear localStorage fully
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.clear()
    }
  })

  it('empirically demonstrates that a corrupt NaN width in localStorage breaks the resize drag handler', () => {
    // Inject corrupt width
    window.localStorage.setItem('toolbox_chat_width', 'not-a-number')

    console.log('window.innerWidth:', window.innerWidth)
    render(<ChatPanel page="guide" />)
    const panel = screen.getByTestId('chat-panel-container')
    const dragHandle = screen.getByTestId('chat-drag-handle')

    // Style is recovered to 350px
    expect(panel.style.width).toBe('350px')

    // Attempt drag resize
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 400 })
    fireEvent.mouseUp(document)

    // The width becomes 450px
    expect(panel.style.width).toBe('450px')
    expect(window.localStorage.getItem('toolbox_chat_width')).toBe('450')
  })

  it('empirically demonstrates a race condition where rapid node updates trigger duplicate architecture verification requests', async () => {
    // Setup initial state: builder page, chat open, key configured, and 1 node initially
    useAppStore.setState({
      chatOpen: { builder: true },
      apiKeyConfigured: true,
      nodes: [{ id: '1', type: 'loadBalancer', position: { x: 0, y: 0 } }],
    })

    // Spy on chatApi.send
    chatApi.send.mockResolvedValue({ response: 'Verification response' })

    const { rerender } = render(<ChatPanel page="builder" />)

    // Simulate rapid nodes update (e.g. user dragging node on canvas) before the timeout executes
    act(() => {
      useAppStore.setState({
        nodes: [{ id: '1', type: 'loadBalancer', position: { x: 10, y: 10 } }],
      })
    })
    rerender(<ChatPanel page="builder" />)

    act(() => {
      useAppStore.setState({
        nodes: [{ id: '1', type: 'loadBalancer', position: { x: 20, y: 20 } }],
      })
    })
    rerender(<ChatPanel page="builder" />)

    // Advance timers or wait for timeouts
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10))
    })

    // Verify the race condition: it is called 1 time instead of 3!
    console.log('chatApi.send call count:', chatApi.send.mock.calls.length)
    expect(chatApi.send).toHaveBeenCalledTimes(1)
  })
})
