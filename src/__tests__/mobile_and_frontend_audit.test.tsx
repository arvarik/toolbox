import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommitModal from '../components/chat/CommitModal'
import LearningChat from '../components/chat/LearningChat'
import GraphCanvas, { type GraphNodeItem } from '../components/graph/GraphCanvas'
import NodePanel from '../components/graph/NodePanel'
import ChatPanel from '../components/shared/ChatPanel'
import { DogearCorner, HighlightableProse } from '../components/ui/NotebookPrimitives'
import ChatPage from '../pages/ChatPage'
import ReviewPage from '../pages/ReviewPage'
import useAppStore from '../stores/appStore'
import useCommitStore from '../stores/useCommitStore'
import { chatApi } from '../utils/api'
import { makeTestKit, resetKitStore, sseStreamResponse } from './testHelpers'

describe('Mobile UX Overhaul & Frontend 2x2 Performance/Stability Audit', () => {
  const applyViewport = (width: number, coarsePointer = width < 768) => {
    window.innerWidth = width
    window.matchMedia = vi.fn().mockImplementation((query: string) => {
      let matches = false
      if (query.includes('pointer: coarse')) {
        matches = coarsePointer
      } else if (query.includes('prefers-reduced-motion')) {
        matches = false
      } else if (query.includes('max-width') || query.includes('768') || query.includes('640')) {
        matches = width < 768
      } else {
        matches = width >= 768
      }
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
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    useAppStore.getState().resetWorkspaceState()
    useCommitStore.getState().closeCompletely()
    resetKitStore()
    applyViewport(375, true)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('supports touch selectionchange in HighlightableProse with coarse-pointer below-selection placement and horizontal clamping', () => {
    vi.useFakeTimers()
    const onAddHighlight = vi.fn()
    const onAskKit = vi.fn()

    const { container } = render(
      <HighlightableProse
        highlights={[
          {
            id: 'hl-existing',
            quote: 'consistent hashing ring',
            color: 'amber',
            note: 'Key idea',
          },
        ]}
        onAddHighlight={onAddHighlight}
        onAskKit={onAskKit}
      >
        <p data-testid="sample-prose">
          Partition keys map onto a consistent hashing ring with bounded load.
        </p>
      </HighlightableProse>,
    )

    const rootEl = container.firstElementChild as HTMLElement
    vi.spyOn(rootEl, 'getBoundingClientRect').mockReturnValue({
      left: 12,
      top: 80,
      right: 300,
      bottom: 400,
      width: 288,
      height: 320,
      x: 12,
      y: 80,
      toJSON: () => ({}),
    })

    const proseNode = screen.getByTestId('sample-prose').firstChild as Text
    const fakeRange = {
      commonAncestorContainer: proseNode,
      startContainer: proseNode,
      endContainer: proseNode,
      startOffset: 55,
      endOffset: 67,
      cloneContents: () => document.createDocumentFragment(),
      getBoundingClientRect: () => ({
        left: 280,
        top: 140,
        right: 310,
        bottom: 162,
        width: 30,
        height: 22,
        x: 280,
        y: 140,
        toJSON: () => ({}),
      }),
    } as unknown as Range

    const removeAllRanges = vi.fn()
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      toString: () => 'bounded load',
      getRangeAt: () => fakeRange,
      removeAllRanges,
    } as unknown as Selection)

    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(200)
    })

    const toolbar = screen.getByTestId('highlight-selection-toolbar')
    expect(toolbar).toBeInTheDocument()
    // Coarse pointer places toolbar BELOW selection (162 - 80 + 8 = 90px) to avoid OS callout overlap
    expect(toolbar.style.top).toBe('90px')
    // Right-edge selection is horizontally clamped inside the 288px narrow container (288 - 112 = 176px)
    expect(parseFloat(toolbar.style.left)).toBeLessThanOrEqual(176)

    // Simulate a 500ms touch press (>=180ms debounce) where pointerdown collapses window.getSelection()
    const hlBtn = screen.getByRole('button', { name: 'Highlight' })
    fireEvent.pointerDown(hlBtn)
    fireEvent.touchStart(hlBtn)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      toString: () => '',
      removeAllRanges,
    } as unknown as Selection)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(500)
    })
    // Toolbar MUST remain mounted while finger is still down so subsequent click fires cleanly
    expect(screen.getByTestId('highlight-selection-toolbar')).toBeInTheDocument()
    fireEvent.pointerUp(hlBtn)
    fireEvent.touchEnd(hlBtn)
    fireEvent.click(hlBtn)
    expect(onAddHighlight).toHaveBeenCalledWith(
      'bounded load',
      'amber',
      expect.any(String),
      expect.any(String),
    )
    expect(removeAllRanges).toHaveBeenCalled()

    // Touch-friendly highlight chip tray actions work cleanly
    fireEvent.click(screen.getByRole('button', { name: 'Ask Kit about highlight' }))
    expect(onAskKit).toHaveBeenCalledWith('consistent hashing ring')
  })

  it('renders 44x44px mobile DogearCorner and ReviewPage 4-button Anki bar + unclipped recall scratchpad', async () => {
    const onToggle = vi.fn()
    const { unmount } = render(
      <DogearCorner folded={false} onToggle={onToggle} testId="dogear-btn" />,
    )
    const dogear = screen.getByTestId('dogear-btn')
    expect(dogear.className).toContain('h-11')
    expect(dogear.className).toContain('w-11')
    fireEvent.click(dogear)
    expect(onToggle).toHaveBeenCalledTimes(1)
    unmount()

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/decks/all/cards/due')) {
        return new Response(
          JSON.stringify([
            {
              id: 'card-1',
              deck_id: 'deck-1',
              front: 'What guarantees linearizability in Raft?',
              back: 'Quorum intersection across leader election and log replication.',
              kit_slug: 'system-design',
              kit_name: 'System Design',
              srs_previews: { again: '1m', hard: '6m', good: '1d', easy: '4d' },
            },
            {
              id: 'card-2',
              deck_id: 'deck-1',
              front: 'Define idempotency key.',
              back: 'Client-generated token deduplicating retried writes.',
              kit_slug: 'system-design',
              kit_name: 'System Design',
              srs_previews: { again: '1m', hard: '5m', good: '10m', easy: '4d' },
            },
          ]),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/review')) {
        return new Response(
          JSON.stringify({ id: 'card-1', state: 2, stability: 4.2, difficulty: 5.1 }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ kits: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    render(
      <MemoryRouter initialEntries={['/review']}>
        <ReviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('review-card-front')).toHaveTextContent(
      'What guarantees linearizability in Raft?',
    )

    fireEvent.click(screen.getByTestId('review-scratchpad-toggle'))
    const scratchpad = screen.getByTestId('review-scratchpad-input')
    expect(scratchpad.className).toContain('resize-y')
    expect(scratchpad.className).toContain('text-[16px]')
    fireEvent.change(scratchpad, { target: { value: 'Majority quorum overlap' } })

    fireEvent.click(screen.getByTestId('reveal-answer-btn'))
    expect(screen.getByTestId('review-scratchpad-note')).toHaveTextContent(
      'Majority quorum overlap',
    )

    const againBtn = screen.getByTestId('grade-btn-again')
    const easyBtn = screen.getByTestId('grade-btn-easy')
    expect(againBtn.parentElement?.className).toContain('grid-cols-4')
    expect(easyBtn.className).toContain('min-h-[54px]')

    fireEvent.click(screen.getByTestId('grade-btn-good'))
    expect(await screen.findByTestId('review-card-front')).toHaveTextContent(
      'Define idempotency key.',
    )
    expect(screen.getByTestId('review-scratchpad-input')).toHaveValue('')
  })

  it('switches mobile ChatPage cleanly between Topics sheet, Chat, and Context Notes sheet without per-token parent spam', async () => {
    const kit = makeTestKit({ slug: 'rust-kit', name: 'Rust Systems' })
    resetKitStore(kit)

    let guideTopicFetches = 0
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/guide-content/progress')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/guide-content/dogears')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/guide-content/resume')) {
        return new Response(JSON.stringify({ resume: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/guide-content/')) {
        guideTopicFetches += 1
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/chat/sessions')) {
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      if (url.includes('/chat/stream')) {
        return sseStreamResponse([
          'data: {"text":"Chunk one "}\n\n',
          'data: {"text":"Chunk two "}\n\n',
          'data: {"text":"Chunk three."}\n\n',
          'data: [DONE]\n\n',
        ])
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    render(
      <MemoryRouter initialEntries={['/k/rust-kit/chat']}>
        <Routes>
          <Route path="/k/:kitSlug/chat" element={<ChatPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const topicsBtn = await screen.findByTestId('mobile-chat-topics-btn')
    fireEvent.click(topicsBtn)
    const topicsSheet = await screen.findByTestId('mobile-chat-topics-sheet')
    expect(topicsSheet).toBeInTheDocument()

    // Expand second pillar in curriculum spine and select its first topic inside the sheet
    const secondPillar = kit.skeleton.pillars[1] ?? kit.skeleton.pillars[0]
    fireEvent.click(await within(topicsSheet).findByText(secondPillar.shortName))
    const targetTopic = secondPillar.topics[0]
    fireEvent.click(await within(topicsSheet).findByText(targetTopic.name))
    await waitFor(() => {
      expect(screen.queryByTestId('mobile-chat-topics-sheet')).not.toBeInTheDocument()
    })

    // Stream multi-chunk SSE message and verify guide-content fetches don't spike per chunk
    const composer = document.getElementById('learning-chat-input') as HTMLTextAreaElement
    expect(composer).toBeTruthy()
    await waitFor(() => expect(guideTopicFetches).toBeGreaterThanOrEqual(1))
    const baselineTopicFetches = guideTopicFetches

    fireEvent.change(composer, { target: { value: 'Explain ownership invariants' } })
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false })

    expect(await screen.findByText(/Chunk one Chunk two Chunk three\./)).toBeInTheDocument()
    expect(guideTopicFetches).toBe(baselineTopicFetches)

    // Open mobile Context Notes bottom-sheet and verify Commit Session to Guide is reachable
    fireEvent.click(screen.getByTestId('chat-notebook-toggle'))
    const notesSheet = await screen.findByTestId('chat-notebook-inspector')
    expect(notesSheet).toBeInTheDocument()

    fireEvent.click(within(notesSheet).getByRole('tab', { name: /Updates/i }))
    expect(within(notesSheet).getByTestId('inspector-commit-btn')).toBeInTheDocument()
  })

  it('flushes trailing non-newline SSE chunks and cancels/releases stream reader lock on AbortController abort', async () => {
    const encoder = new TextEncoder()

    // 1. Trailing non-newline SSE payload is flushed before completion
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode('data: {"text":"Hello "}\n\ndata: {"text":"world"}'))
            controller.close()
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      ),
    )

    const snapshots: string[] = []
    const finalText = await chatApi.stream({ message: 'hi' }, (t) => snapshots.push(t))
    expect(finalText).toBe('Hello world')
    expect(snapshots[snapshots.length - 1]).toBe('Hello world')

    // 2. Aborting mid-stream cancels reader and releases lock cleanly
    const cancelSpy = vi.fn().mockResolvedValue(undefined)
    const releaseLockSpy = vi.fn()
    const abortCtrl = new AbortController()

    let readCount = 0
    const mockBody = {
      getReader: () => ({
        read: async () => {
          readCount += 1
          if (readCount === 1) {
            return {
              done: false,
              value: encoder.encode('data: {"text":"partial"}\n\n'),
            }
          }
          abortCtrl.abort()
          throw new DOMException('Aborted', 'AbortError')
        },
        cancel: cancelSpy,
        releaseLock: releaseLockSpy,
      }),
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      body: mockBody,
    } as unknown as Response)

    await expect(
      chatApi.stream({ message: 'abort test' }, () => {}, undefined, abortCtrl.signal),
    ).rejects.toThrow(/Abort/i)
    expect(cancelSpy).toHaveBeenCalledTimes(1)
    expect(releaseLockSpy).toHaveBeenCalledTimes(1)
  })

  it('cleans up CommitModal post-commit timer on unmount and hides GraphCanvas MiniMap on mobile while rendering NodePanel bottom-sheet', async () => {
    vi.useFakeTimers()
    useCommitStore.setState({
      isOpen: true,
      isMinimized: false,
      phase: 'preview',
      topicContext: {
        pillarId: 'foundations',
        topicId: 'cap-theorem',
        topicName: 'CAP Theorem',
      },
      updates: [
        {
          sectionId: 'overview',
          sectionName: 'Overview',
          newContent: 'Updated summary',
          existingContent: '',
          reason: 'Refined overview',
          isNew: true,
        },
      ],
      enabledSections: new Set(['overview']),
    })

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true, savedCount: 1 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const { unmount } = render(<CommitModal />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Commit 1 Section/i }))
    })
    unmount()

    // Re-open store in idle analysis state before 1500ms elapses; unmounted CommitModal timer must NOT close it
    useCommitStore.getState().startAnalysis(
      [{ role: 'user', content: 'New session' }],
      { pillarId: 'foundations', topicId: 'raft', topicName: 'Raft' },
    )
    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(useCommitStore.getState().isOpen).toBe(true)
    expect(useCommitStore.getState().topicContext?.topicId).toBe('raft')
    vi.useRealTimers()

    // GraphCanvas hides MiniMap on 375px mobile viewport and NodePanel renders mobile sheet
    const sampleNodes: GraphNodeItem[] = [
      {
        id: 'cap-theorem',
        name: 'CAP Theorem',
        pillarId: 'foundations',
        summary: 'Consistency, Availability, Partition tolerance',
        health: 'mastered',
        strength: 0.85,
      },
    ]

    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          node: sampleNodes[0],
          cards: [],
          prereqs: [],
          dependents: [],
          guide: null,
          boards: [],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    applyViewport(375, true)
    const { container } = render(
      <MemoryRouter>
        <div>
          <GraphCanvas
            nodes={sampleNodes}
            edges={[]}
            visibleIds={null}
            trackOrder={null}
            selectedId="cap-theorem"
            onSelect={vi.fn()}
          />
          <NodePanel
            nodeId="cap-theorem"
            onClose={vi.fn()}
            onSelectNode={vi.fn()}
            onStartSession={vi.fn()}
            refreshKey={0}
          />
        </div>
      </MemoryRouter>,
    )

    expect(container.querySelector('.react-flow__minimap')).toBeNull()
    const panel = await screen.findByRole('complementary', { name: 'Concept details' })
    expect(panel).toHaveAttribute('id', 'graph-node-panel')
    expect(await screen.findByRole('heading', { name: 'CAP Theorem' })).toBeInTheDocument()
  })

  it('keeps LearningChat #flashcard-popup mounted across >=300ms touch/mouse press when selection collapses and cleans up ChatPanel CopyButton timers on unmount', async () => {
    const kit = makeTestKit({ slug: 'sys-kit', name: 'Systems' })
    resetKitStore(kit)

    let generatedText: string | null = null
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      if (url.includes('/chat/sessions')) {
        return new Response(
          JSON.stringify({
            'sess-1': {
              id: 'sess-1',
              name: 'Consensus Session',
              createdAt: 1000,
              updatedAt: 2000,
              messages: [
                {
                  role: 'assistant',
                  content: 'Linearizability requires strict quorum intersection across replicas.',
                  timestamp: 1500,
                },
              ],
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/chat/generate-flashcards')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { text?: string }
        generatedText = body.text ?? null
        return new Response(
          JSON.stringify({ cards: [{ front: 'What does linearizability require?', back: 'Quorum intersection.' }] }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    })

    const { unmount: unmountChat } = render(
      <MemoryRouter>
        <LearningChat activeTopic={null} routeKitSlug="sys-kit" />
      </MemoryRouter>,
    )

    const msgContainer = await screen.findByText(/Linearizability requires strict quorum intersection/i)
    vi.useFakeTimers()

    const fakeRange = {
      getBoundingClientRect: () => ({
        left: 60,
        top: 200,
        right: 260,
        bottom: 224,
        width: 200,
        height: 24,
        x: 60,
        y: 200,
        toJSON: () => ({}),
      }),
    } as unknown as Range

    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: msgContainer.firstChild ?? msgContainer,
      toString: () => 'Linearizability requires strict quorum intersection',
      getRangeAt: () => fakeRange,
      removeAllRanges: vi.fn(),
    } as unknown as Selection)

    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(350)
    })

    const popup = document.getElementById('flashcard-popup')
    expect(popup).not.toBeNull()
    const makeBtn = within(popup as HTMLElement).getByRole('button', { name: /Make Flashcard/i })

    // Verify desktop mousedown calls preventDefault() so selection is preserved
    const downEvt = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    makeBtn.dispatchEvent(downEvt)
    expect(downEvt.defaultPrevented).toBe(true)

    // Verify a 500ms touch press (>=300ms debounce) with collapsed selection does NOT unmount #flashcard-popup
    fireEvent.pointerDown(makeBtn)
    fireEvent.touchStart(makeBtn)
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      toString: () => '',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)
    act(() => {
      document.dispatchEvent(new Event('selectionchange'))
      vi.advanceTimersByTime(500)
    })
    expect(document.getElementById('flashcard-popup')).not.toBeNull()

    vi.useRealTimers()
    fireEvent.pointerUp(makeBtn)
    fireEvent.touchEnd(makeBtn)
    fireEvent.click(makeBtn)

    await waitFor(() => {
      expect(generatedText).toBe('Linearizability requires strict quorum intersection')
    })
    unmountChat()

    // Verify ChatPanel CopyButton cleans up its 2000ms reset timer on unmount without throwing
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })

    useAppStore.setState({ chatOpen: { guide: true }, apiKeyConfigured: true })
    const { unmount: unmountPanel } = render(
      <MemoryRouter initialEntries={['/k/sys-kit/guide']}>
        <ChatPanel
          page="guide"
          context="Context"
          initialMessages={[{ role: 'ai', content: 'Saved assistant note' }]}
        />
      </MemoryRouter>,
    )
    const copyBtn = await screen.findByRole('button', { name: 'Copy to clipboard' })
    await act(async () => {
      fireEvent.click(copyBtn)
    })
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument()
    unmountPanel()
  })
})
