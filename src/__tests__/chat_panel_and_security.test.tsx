import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import ChatPanel from '../components/shared/ChatPanel'
import SearchDialog from '../components/shared/SearchDialog'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import useKitStore from '../stores/useKitStore'
import type { KitDetailItem } from '../stores/useKitStore'
import { ApiError, chatApi, getActiveKitHeaders } from '../utils/api'

function sseStreamResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk))
      }
      controller.close()
    },
  })
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function makeKit(slug: string, name: string, canvas: 'architecture' | 'concept' = 'concept'): KitDetailItem {
  const capabilities = {
    ...SYSTEM_DESIGN_KIT_SKELETON.capabilities,
    canvas,
    calculator: false,
  }
  return {
    id: `kit-${slug}`,
    slug,
    name,
    description: `${name} description`,
    icon: '📘',
    color: '#6366f1',
    status: 'ready',
    statusDetail: null,
    forkedFromSharedId: null,
    forkedVersion: null,
    upstreamSlug: null,
    upstreamLatestVersion: null,
    hasUpstreamUpdate: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    lastOpenedAt: null,
    pillarCount: 1,
    topicCount: 1,
    nodeCount: 1,
    capabilities,
    deckCount: 0,
    cardCount: 0,
    dueCount: 0,
    newCount: 0,
    reviewedCount: 0,
    masteryPercent: 0,
    guideFilledCount: 0,
    guideTotalCount: 1,
    archivedNotesCount: 0,
    drillCount: 0,
    skeleton: {
      ...SYSTEM_DESIGN_KIT_SKELETON,
      identity: { ...SYSTEM_DESIGN_KIT_SKELETON.identity, slug, name },
      capabilities,
    },
  }
}

describe('ChatPanel, SSE Streaming, XSS Safety & Multi-Kit Store Isolation', () => {
  let originalLocalStorage: Storage
  let originalClipboard: Clipboard

  beforeEach(() => {
    originalLocalStorage = window.localStorage
    originalClipboard = navigator.clipboard
    window.history.pushState({}, '', '/')
    try {
      window.localStorage.clear()
    } catch {
      // Ignore if mocked
    }
    useKitStore.setState({ kits: [], activeKitSlug: null, activeKit: null, kitCache: {} })
    ;(globalThis as { __toolboxActiveKitSlug?: string | null }).__toolboxActiveKitSlug = null
    useAppStore.getState().resetWorkspaceState()
    useAppStore.setState({
      chatOpen: { chat: false, guide: true, builder: true, study: true },
      apiKeyConfigured: true,
    })
    useCommitStore.getState().closeCompletely()
  })

  afterEach(() => {
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
    window.history.pushState({}, '', '/')
    vi.restoreAllMocks()
  })

  it('parses split SSE frames, tool indicators, X-Toolbox-Kit headers, and 401 unauthorized events', async () => {
    window.history.pushState({}, '', '/k/rust-kit/guide')
    expect(getActiveKitHeaders()).toEqual({ 'X-Toolbox-Kit': 'rust-kit' })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      sseStreamResponse([
        'data: {"tool":"lookup_notes"}\n\n',
        'data: {"text":"Hello ',
        'borrow checker"}\n\ndata: [DONE]\n\n',
      ]),
    )

    const tools: string[] = []
    const chunks: string[] = []
    const full = await chatApi.stream(
      { message: 'Explain lifetimes' },
      (partial) => chunks.push(partial),
      (tool) => tools.push(tool),
    )

    expect(tools).toEqual(['lookup_notes'])
    expect(full).toContain('⚙️ lookup_notes')
    expect(full).toContain('Hello borrow checker')
    expect(chunks.at(-1)).toBe(full)
    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/chat/stream',
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Toolbox-Kit': 'rust-kit' }),
      }),
    )

    // Verify 401 dispatches toolbox:unauthorized and throws structured ApiError
    const unauthSpy = vi.fn()
    window.addEventListener('toolbox:unauthorized', unauthSpy)
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: { message: 'Session expired', code: 'UNAUTHENTICATED' } }),
        { status: 401, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(chatApi.stream({ message: 'Ping' }, () => {})).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'UNAUTHENTICATED',
    })
    expect(new ApiError('Forbidden', 403, 'FORBIDDEN')).toBeInstanceOf(Error)
    expect(unauthSpy).toHaveBeenCalledTimes(1)
    window.removeEventListener('toolbox:unauthorized', unauthSpy)
  })

  it('aborts in-flight stream on Stop button or unmount without error alert, and retries on failure', async () => {
    let capturedSignal: AbortSignal | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementationOnce((_input, init) => {
      capturedSignal = init?.signal ?? undefined
      return new Promise<Response>((_resolve, reject) => {
        capturedSignal?.addEventListener('abort', () => {
          const abortErr = new Error('Aborted')
          abortErr.name = 'AbortError'
          reject(abortErr)
        })
      })
    })

    const { unmount } = render(<ChatPanel page="guide" />)
    fireEvent.change(screen.getByPlaceholderText('Ask a question...'), {
      target: { value: 'Stream cancellation test' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    const stopBtn = await screen.findByRole('button', { name: /stop generating/i })
    fireEvent.click(stopBtn)

    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    // Failure -> role="alert" -> Retry recovers cleanly
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Upstream quota exceeded' }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(sseStreamResponse(['data: {"text":"Recovered response"}\n\ndata: [DONE]\n\n']))

    fireEvent.change(screen.getByPlaceholderText('Ask a question...'), {
      target: { value: 'Retryable question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Upstream quota exceeded')

    const retryButtons = screen.getAllByRole('button', { name: 'Retry this prompt' })
    fireEvent.click(retryButtons[retryButtons.length - 1])

    await waitFor(() => {
      expect(screen.getByText('Recovered response')).toBeInTheDocument()
    })

    // Unmount during active stream aborts cleanly
    let unmountSignal: AbortSignal | undefined
    fetchSpy.mockImplementationOnce((_input, init) => {
      unmountSignal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    fireEvent.change(screen.getByPlaceholderText('Ask a question...'), {
      target: { value: 'Unmount stream' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    unmount()
    expect(unmountSignal?.aborted).toBe(true)
  })

  it('neutralizes XSS payloads and unsafe SVG attributes while highlighting code via PrismLight', () => {
    const adversarialMarkdown = [
      'Safe heading',
      '<script>window.__pwned = true</script>',
      '<img src="x" onerror="window.__pwned = true" />',
      '[Click me](javascript:alert(1))',
      '```svg\n<svg viewBox="0 0 20 20" onload="alert(1)"><script>evil()</script><rect width="10" height="10" onclick="evil()" /></svg>\n```',
      '```ts\nconst x: number = 42\n```',
    ].join('\n\n')

    const { container } = render(
      <ChatPanel page="guide" initialMessages={[{ role: 'ai', content: adversarialMarkdown }]} />,
    )

    expect(container.querySelector('script')).toBeNull()
    expect(container.querySelector('[onerror]')).toBeNull()
    expect(container.querySelector('[onload]')).toBeNull()
    expect(container.querySelector('[onclick]')).toBeNull()
    const link = screen.queryByRole('link', { name: 'Click me' })
    if (link) {
      expect(link.getAttribute('href') ?? '').not.toMatch(/^javascript:/i)
    }
    expect(container.textContent).toContain('const x: number = 42')
  })

  it('clamps width resize between [300px, 600px] and recovers from corrupt NaN width in localStorage', () => {
    window.localStorage.setItem('toolbox_chat_width', 'not-a-number')
    render(<ChatPanel page="guide" />)

    const panel = screen.getByTestId('chat-panel-container')
    const dragHandle = screen.getByTestId('chat-drag-handle')
    expect(panel.style.width).toBe('350px')

    // Recover from corrupt initial localStorage on first drag: 350 - (400 - 500) = 450px
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 400 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('450px')
    expect(window.localStorage.getItem('toolbox_chat_width')).toBe('450')

    // Clamp min at 300px
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 800 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('300px')

    // Clamp max at 600px
    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 100 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('600px')
  })

  it('survives throwing/corrupt localStorage and isolates chat history per page and per Kit', async () => {
    // 1. Corrupt JSON & non-array page history do not crash
    window.localStorage.setItem('toolbox_chat_history', 'invalid-json-string{]!')
    const { unmount: unmountCorrupt } = render(<ChatPanel page="guide" />)
    expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
    unmountCorrupt()

    window.localStorage.setItem('toolbox_chat_history', JSON.stringify({ guide: 'malformed-string' }))
    const { unmount: unmountNonArray } = render(<ChatPanel page="guide" />)
    expect(screen.getByText('Ask about system design')).toBeInTheDocument()
    unmountNonArray()

    // 2. Per-page & per-Kit isolation + scoped Clear conversation
    window.localStorage.setItem(
      'toolbox_chat_history',
      JSON.stringify({
        guide: [{ role: 'user', content: 'Legacy guide msg' }],
        builder: [{ role: 'user', content: 'Legacy builder msg' }],
        'rust-kit:guide': [{ role: 'user', content: 'Rust kit msg' }],
        'ml-kit:guide': [{ role: 'user', content: 'ML kit msg' }],
      }),
    )

    const { rerender, unmount: unmountScoped } = render(<ChatPanel page="builder" />)
    expect(screen.getByText('Legacy builder msg')).toBeInTheDocument()
    expect(screen.queryByText('Legacy guide msg')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear conversation' }))
    const afterClear = JSON.parse(window.localStorage.getItem('toolbox_chat_history') ?? '{}') as Record<
      string,
      unknown[]
    >
    expect(afterClear.builder).toEqual([])
    expect(afterClear.guide).toHaveLength(1)

    act(() => {
      useKitStore.getState().setActiveKitDirect(makeKit('rust-kit', 'Rust Kit'))
    })
    rerender(<ChatPanel page="guide" />)
    expect(screen.getByText('Rust kit msg')).toBeInTheDocument()
    expect(screen.queryByText('ML kit msg')).not.toBeInTheDocument()

    act(() => {
      useKitStore.getState().setActiveKitDirect(makeKit('ml-kit', 'ML Kit'))
    })
    rerender(<ChatPanel page="guide" />)
    expect(screen.getByText('ML kit msg')).toBeInTheDocument()
    expect(screen.queryByText('Rust kit msg')).not.toBeInTheDocument()
    unmountScoped()

    // 3. Throwing SecurityError localStorage still renders and streams
    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('SecurityError')
      }),
      setItem: vi.fn(() => {
        throw new Error('SecurityError')
      }),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    }
    Object.defineProperty(window, 'localStorage', {
      value: throwingStorage,
      writable: true,
      configurable: true,
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      sseStreamResponse(['data: {"text":"Streamed without storage"}\n\ndata: [DONE]\n\n']),
    )

    act(() => {
      useKitStore.getState().setActiveKitDirect(null)
    })
    render(<ChatPanel page="guide" />)
    fireEvent.change(screen.getByPlaceholderText('Ask a question...'), {
      target: { value: 'Blocked storage question' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    expect(await screen.findByText('Streamed without storage')).toBeInTheDocument()
  })

  it('prevents double-send, debounces rapid builder node updates, falls back on clipboard error, and defaults optional props', async () => {
    let releaseStream: (() => void) | undefined
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          releaseStream = () =>
            resolve(sseStreamResponse(['data: {"text":"Single response"}\n\ndata: [DONE]\n\n']))
        }),
    )

    const { unmount } = render(
      <ChatPanel
        page="guide"
        title={undefined}
        placeholder={undefined}
        initialMessages={undefined}
        context={undefined}
      />,
    )
    expect(screen.getByText('Ask AI')).toBeInTheDocument()

    const input = screen.getByPlaceholderText('Ask a question...')
    fireEvent.change(input, { target: { value: 'Rapid click' } })
    const sendBtn = screen.getByRole('button', { name: 'Send message' })
    fireEvent.click(sendBtn)
    fireEvent.click(sendBtn)
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    await act(async () => {
      releaseStream?.()
    })
    expect(await screen.findByText('Single response')).toBeInTheDocument()

    // Clipboard fallback via document.execCommand('copy')
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('Permission denied')) },
      writable: true,
      configurable: true,
    })
    if (typeof document.execCommand !== 'function') {
      Object.defineProperty(document, 'execCommand', {
        value: vi.fn(() => true),
        writable: true,
        configurable: true,
      })
    }
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }))
    await waitFor(() => {
      expect(execSpy).toHaveBeenCalledWith('copy')
    })
    unmount()

    // Rapid builder canvas node updates debounce auto-verify to 1 stream request
    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(sseStreamResponse(['data: {"text":"Verified"}\n\ndata: [DONE]\n\n']))
    useAppStore.setState({
      nodes: [{ id: '1', type: 'loadBalancer', position: { x: 0, y: 0 } }],
    })

    const { rerender } = render(<ChatPanel page="builder" />)
    act(() => {
      useAppStore.setState({ nodes: [{ id: '1', type: 'loadBalancer', position: { x: 10, y: 10 } }] })
    })
    rerender(<ChatPanel page="builder" />)
    act(() => {
      useAppStore.setState({ nodes: [{ id: '1', type: 'loadBalancer', position: { x: 20, y: 20 } }] })
    })
    rerender(<ChatPanel page="builder" />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prevents toast ID collisions, clears canvas/commit state across Kit switches, and scopes SearchDialog to active Kit', async () => {
    // 1. Monotonic toast IDs under identical Date.now()
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456789)
    act(() => {
      useAppStore.getState().addToast({ type: 'success', message: 'Toast 1' })
      useAppStore.getState().addToast({ type: 'error', message: 'Toast 2' })
    })
    const toasts = useAppStore.getState().toasts
    expect(toasts).toHaveLength(2)
    expect(toasts[0].id).not.toBe(toasts[1].id)
    act(() => {
      useAppStore.getState().removeToast(toasts[0].id)
    })
    expect(useAppStore.getState().toasts.map((t) => t.message)).toEqual(['Toast 2'])
    nowSpy.mockRestore()

    // 2. Cross-Kit switch clears canvas nodes/edges and active CommitModal state
    act(() => {
      useKitStore.getState().setActiveKitDirect(makeKit('rust-kit', 'Rust Kit'))
      useAppStore.setState({
        nodes: [{ id: 'n1', data: { name: 'Kit A Node' } }],
        edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
      })
      useCommitStore.getState().startAnalysis([{ role: 'user', content: 'Kit A draft' }], null)
    })
    const prevCallId = useCommitStore.getState().currentCallId

    act(() => {
      useKitStore.getState().setActiveKitDirect(makeKit('ml-kit', 'ML Kit'))
    })
    expect(useAppStore.getState().nodes).toEqual([])
    expect(useAppStore.getState().edges).toEqual([])
    expect(useCommitStore.getState().isOpen).toBe(false)
    expect(useCommitStore.getState().currentCallId).toBeGreaterThan(prevCallId)

    // 3. SearchDialog scopes navigation paths and X-Toolbox-Kit header to active /k/:slug
    window.history.pushState({}, '', '/k/ml-kit/guide')
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          guideContent: [],
          flashcards: [],
          boards: [{ id: 'b1', name: 'Gradient Descent Map' }],
          decks: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    function PathProbe() {
      const loc = useLocation()
      return <div data-testid="current-path">{loc.pathname}</div>
    }

    render(
      <MemoryRouter initialEntries={['/k/ml-kit/guide']}>
        <SearchDialog open onClose={() => {}} />
        <PathProbe />
      </MemoryRouter>,
    )

    const searchInput = screen.getByPlaceholderText(/search topics, notes, flashcards/i)
    fireEvent.change(searchInput, { target: { value: 'Gradient' } })

    const boardHit = await screen.findByText('Gradient Descent Map')
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining('/api/search?q=Gradient'),
      expect.objectContaining({
        headers: expect.objectContaining({ 'X-Toolbox-Kit': 'ml-kit' }),
      }),
    )

    fireEvent.click(boardHit)
    expect(screen.getByTestId('current-path')).toHaveTextContent('/k/ml-kit/canvas')
  })
})
