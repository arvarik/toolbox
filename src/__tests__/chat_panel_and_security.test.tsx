import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommitModal from '../components/chat/CommitModal'
import LearningChat from '../components/chat/LearningChat'
import ChatPanel from '../components/shared/ChatPanel'
import SearchDialog from '../components/shared/SearchDialog'
import ChatPage from '../pages/ChatPage'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import useKitStore from '../stores/useKitStore'
import { ApiError, chatApi, getActiveKitHeaders } from '../utils/api'
import { makeTestKit, resetKitStore, sseStreamResponse } from './testHelpers'

describe('ChatPanel, LearningChat, SSE Streaming, XSS Safety & Multi-Kit Isolation', () => {
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
    resetKitStore()
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

    fireEvent.click(await screen.findByRole('button', { name: /stop generating/i }))
    await waitFor(() => {
      expect(capturedSignal?.aborted).toBe(true)
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

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

    expect(await screen.findByRole('alert')).toHaveTextContent('Upstream quota exceeded')
    const retryButtons = screen.getAllByRole('button', { name: 'Retry this prompt' })
    fireEvent.click(retryButtons[retryButtons.length - 1])
    await waitFor(() => expect(screen.getByText('Recovered response')).toBeInTheDocument())

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

    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 400 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('450px')
    expect(window.localStorage.getItem('toolbox_chat_width')).toBe('450')

    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 800 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('300px')

    fireEvent.mouseDown(dragHandle, { clientX: 500 })
    fireEvent.mouseMove(document, { clientX: 100 })
    fireEvent.mouseUp(document)
    expect(panel.style.width).toBe('600px')
  })

  it('survives throwing/corrupt localStorage and isolates chat history per page and per Kit', async () => {
    window.localStorage.setItem('toolbox_chat_history', 'invalid-json-string{]!')
    const { unmount: unmountCorrupt } = render(<ChatPanel page="guide" />)
    expect(screen.getByTestId('chat-panel-container')).toBeInTheDocument()
    unmountCorrupt()

    window.localStorage.setItem('toolbox_chat_history', JSON.stringify({ guide: 'malformed-string' }))
    const { unmount: unmountNonArray } = render(<ChatPanel page="guide" />)
    expect(screen.getByText('Ask about system design')).toBeInTheDocument()
    unmountNonArray()

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

    act(() => useKitStore.getState().setActiveKitDirect(makeTestKit({ slug: 'rust-kit', name: 'Rust Kit' })))
    rerender(<ChatPanel page="guide" />)
    expect(screen.getByText('Rust kit msg')).toBeInTheDocument()
    expect(screen.queryByText('ML kit msg')).not.toBeInTheDocument()

    act(() =>
      useKitStore
        .getState()
        .setActiveKitDirect(makeTestKit({ slug: 'ml-kit', name: 'ML Kit', capabilities: { canvas: 'concept' } })),
    )
    rerender(<ChatPanel page="guide" />)
    expect(screen.getByText('ML kit msg')).toBeInTheDocument()
    expect(screen.queryByText('Rust kit msg')).not.toBeInTheDocument()
    unmountScoped()

    Object.defineProperty(window, 'localStorage', {
      value: {
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
      },
      writable: true,
      configurable: true,
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      sseStreamResponse(['data: {"text":"Streamed without storage"}\n\ndata: [DONE]\n\n']),
    )

    act(() => useKitStore.getState().setActiveKitDirect(null))
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
      <ChatPanel page="guide" title={undefined} placeholder={undefined} initialMessages={undefined} context={undefined} />,
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
    await waitFor(() => expect(execSpy).toHaveBeenCalledWith('copy'))
    unmount()

    fetchSpy.mockClear()
    fetchSpy.mockResolvedValue(sseStreamResponse(['data: {"text":"Verified"}\n\ndata: [DONE]\n\n']))
    useAppStore.setState({ nodes: [{ id: '1', type: 'loadBalancer', position: { x: 0, y: 0 } }] })

    const { rerender } = render(<ChatPanel page="builder" />)
    act(() => useAppStore.setState({ nodes: [{ id: '1', type: 'loadBalancer', position: { x: 10, y: 10 } }] }))
    rerender(<ChatPanel page="builder" />)
    act(() => useAppStore.setState({ nodes: [{ id: '1', type: 'loadBalancer', position: { x: 20, y: 20 } }] }))
    rerender(<ChatPanel page="builder" />)

    await act(async () => {
      await new Promise((r) => setTimeout(r, 15))
    })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })

  it('prevents toast ID collisions, clears canvas/commit state across Kit switches, and scopes SearchDialog to active Kit', async () => {
    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(123456789)
    act(() => {
      useAppStore.getState().addToast({ type: 'success', message: 'Toast 1' })
      useAppStore.getState().addToast({ type: 'error', message: 'Toast 2' })
    })
    const toasts = useAppStore.getState().toasts
    expect(toasts).toHaveLength(2)
    expect(toasts[0].id).not.toBe(toasts[1].id)
    act(() => useAppStore.getState().removeToast(toasts[0].id))
    expect(useAppStore.getState().toasts.map((t) => t.message)).toEqual(['Toast 2'])
    nowSpy.mockRestore()

    act(() => {
      useKitStore.getState().setActiveKitDirect(makeTestKit({ slug: 'rust-kit', name: 'Rust Kit' }))
      useAppStore.setState({
        nodes: [{ id: 'n1', data: { name: 'Kit A Node' } }],
        edges: [{ id: 'e1', source: 'n1', target: 'n1' }],
      })
      useCommitStore.getState().startAnalysis([{ role: 'user', content: 'Kit A draft' }], null)
    })
    const prevCallId = useCommitStore.getState().currentCallId

    act(() =>
      useKitStore
        .getState()
        .setActiveKitDirect(makeTestKit({ slug: 'ml-kit', name: 'ML Kit', capabilities: { canvas: 'concept' } })),
    )
    expect(useAppStore.getState().nodes).toEqual([])
    expect(useAppStore.getState().edges).toEqual([])
    expect(useCommitStore.getState().isOpen).toBe(false)
    expect(useCommitStore.getState().currentCallId).toBeGreaterThan(prevCallId)

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
      return <div data-testid="current-path">{useLocation().pathname}</div>
    }

    render(
      <MemoryRouter initialEntries={['/k/ml-kit/guide']}>
        <SearchDialog open onClose={() => {}} />
        <PathProbe />
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByPlaceholderText(/search topics, notes, flashcards/i), {
      target: { value: 'Gradient' },
    })
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

  it('switches LearningChat persona instructions, generates Mermaid concept map + CommitModal, and isolates per-Kit sessions without migrateBulk leakage', async () => {
    const streamSpy = vi
      .spyOn(chatApi, 'stream')
      .mockImplementation(async (_data, onChunk) => {
        onChunk?.('Socratic reply')
        return 'Socratic reply'
      })
    const conceptMapSpy = vi
      .spyOn(chatApi, 'generateConceptMap')
      .mockResolvedValue({ response: 'graph TD\n  A[Client] --> B[Gateway]' })
    const getSessionsSpy = vi.spyOn(chatApi, 'getSessions').mockResolvedValue({})
    vi.spyOn(chatApi, 'saveSession').mockResolvedValue({ success: true })
    const migrateBulkSpy = vi.spyOn(chatApi, 'migrateBulk').mockResolvedValue({ success: true, count: 0 })
    vi.spyOn(chatApi, 'commitAnalyze').mockResolvedValue({ updates: [] })

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      new Response(JSON.stringify({ suggestions: ['Explain ownership transfer in Rust'] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    // 1. PersonaPicker switches persona context instructions across sessions
    const personaRender = await act(async () => render(<LearningChat />))
    fireEvent.click(screen.getByText('Explain consistent hashing with a concrete example and when I should use it'))
    await waitFor(() => {
      expect(streamSpy).toHaveBeenCalledTimes(1)
      expect((streamSpy.mock.calls[0][0] as { context: string }).context).toContain('Socratic questioning')
    })

    fireEvent.click(screen.getByTitle('Change AI Persona'))
    fireEvent.click(screen.getByText('Strict'))
    fireEvent.click(document.querySelector('#session-picker-btn')!)
    fireEvent.click(screen.getByText('New Session'))
    fireEvent.click(screen.getByText('Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale'))
    await waitFor(() => {
      expect(streamSpy).toHaveBeenCalledTimes(2)
      expect((streamSpy.mock.calls[1][0] as { context: string }).context).toContain('highly demanding, intense, and strict')
    })
    personaRender.unmount()

    // 2. Mermaid concept map from More Actions + CommitModal on topic-linked ChatPage
    const testSessionId = 'session-topic-1'
    const testSession = {
      id: testSessionId,
      name: 'Traffic Gateways Study',
      pillarId: 'compute',
      topicId: 'traffic-gateways',
      topicName: 'Traffic Gateways & Proxies',
      createdAt: new Date().toISOString(),
      messages: [
        { id: '1', role: 'user' as const, content: 'How do L4 and L7 load balancers differ?' },
        { id: '2', role: 'ai' as const, content: 'L4 operates at transport layer; L7 inspects HTTP.' },
        { id: '3', role: 'user' as const, content: 'When should I terminate TLS at L7?' },
        { id: '4', role: 'ai' as const, content: 'When routing by path/header or offloading certs.' },
      ],
    }
    getSessionsSpy.mockResolvedValueOnce({ [testSessionId]: testSession })
    window.localStorage.setItem('toolbox_learning_sessions', JSON.stringify({ [testSessionId]: testSession }))
    window.localStorage.setItem('toolbox_learning_current', testSessionId)

    const chatPageRender = await act(async () =>
      render(
        <MemoryRouter initialEntries={['/chat']}>
          <ChatPage />
          <CommitModal />
        </MemoryRouter>,
      ),
    )

    fireEvent.click(await screen.findByTitle('More Actions'))
    fireEvent.click(await screen.findByText(/Generate Map/))
    await waitFor(() => {
      expect(conceptMapSpy).toHaveBeenCalledTimes(1)
      expect(screen.getByText(/Here's a concept map summarizing what we just discussed/i)).toBeInTheDocument()
    })

    const commitBtn = document.querySelector<HTMLButtonElement>('#commit-to-guide-btn')!
    expect(commitBtn).not.toBeDisabled()
    fireEvent.click(commitBtn)
    await waitFor(() => expect(document.getElementById('commit-modal')).toBeInTheDocument())
    chatPageRender.unmount()

    // 3. Per-Kit session isolation & X-Toolbox-Kit header on /api/chat/starters
    window.localStorage.setItem(
      'toolbox_learning_sessions',
      JSON.stringify({
        'sys-session-1': {
          id: 'sys-session-1',
          name: 'System Design CAP Chat',
          createdAt: new Date().toISOString(),
          messages: [{ id: 'm1', role: 'user', content: 'System Design secret message' }],
        },
      }),
    )
    window.localStorage.setItem('toolbox_learning_current', 'sys-session-1')
    getSessionsSpy.mockClear()
    migrateBulkSpy.mockClear()
    fetchSpy.mockClear()

    const rustKit = makeTestKit({
      id: 'kit-rust-1',
      slug: 'distributed-rust',
      name: 'Distributed Rust',
      mutateSkeleton: (s) => {
        s.pillars = [
          {
            id: 'ownership',
            number: 1,
            name: 'Ownership & Borrowing',
            shortName: 'Ownership',
            color: '#f97316',
            sections: [{ id: 'mechanics', name: 'Borrow Mechanics', icon: 'cpu', promptHint: '', ownershipRule: '' }],
            topics: [{ id: 'move-semantics', name: 'Move Semantics', summary: 'Affine transfer.' }],
          },
        ]
      },
    })
    useCommitStore.getState().closeCompletely()
    resetKitStore(rustKit)

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/k/distributed-rust/chat']}>
          <Routes>
            <Route
              path="/k/:slug/chat"
              element={
                <LearningChat
                  routeKitSlug="distributed-rust"
                  activeTopic={{
                    pillar: rustKit.skeleton.pillars[0],
                    topic: rustKit.skeleton.pillars[0].topics[0],
                  }}
                />
              }
            />
          </Routes>
        </MemoryRouter>,
      )
    })

    await waitFor(() => expect(getSessionsSpy).toHaveBeenCalled())
    expect(screen.queryByText('System Design secret message')).not.toBeInTheDocument()
    expect(migrateBulkSpy).not.toHaveBeenCalled()

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>)['X-Toolbox-Kit']).toBe('distributed-rust')
    expect(await screen.findByText('Explain ownership transfer in Rust')).toBeInTheDocument()
  })
})
