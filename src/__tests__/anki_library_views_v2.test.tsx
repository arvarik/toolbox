import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import FlashcardView from '../components/study/FlashcardView'
import ReviewPage from '../pages/ReviewPage'
import LibraryHomePage from '../pages/LibraryHomePage'
import SharedLibraryPage from '../pages/SharedLibraryPage'
import InterleavedPage from '../pages/InterleavedPage'
import FeynmanPage from '../pages/FeynmanPage'
import { makeTestKit, resetKitStore } from './testHelpers'

const apiMocks = vi.hoisted(() => ({
  dueAll: vi.fn(),
  reviewCard: vi.fn(),
  kitsList: vi.fn(),
  sharedList: vi.fn(),
  studySessionsList: vi.fn(),
}))

vi.mock('../utils/api', async () => {
  const actual = await vi.importActual<typeof import('../utils/api')>('../utils/api')
  return {
    ...actual,
    flashcardsApi: {
      ...actual.flashcardsApi,
      dueAll: (...args: unknown[]) => apiMocks.dueAll(...args),
      review: (...args: unknown[]) => apiMocks.reviewCard(...args),
    },
    kitsApi: {
      ...actual.kitsApi,
      list: (...args: unknown[]) => apiMocks.kitsList(...args),
    },
    sharedKitsApi: {
      ...actual.sharedKitsApi,
      list: (...args: unknown[]) => apiMocks.sharedList(...args),
    },
    studySessionsApi: {
      ...actual.studySessionsApi,
      list: (...args: unknown[]) => apiMocks.studySessionsList(...args),
    },
  }
})

describe('Pure Anki Review, Calm Library Shelf & Views v2', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    sessionStorage.clear()

    const defaultKit = makeTestKit()
    resetKitStore(defaultKit)

    apiMocks.dueAll.mockResolvedValue([])
    apiMocks.reviewCard.mockResolvedValue({
      id: 'c1',
      deck_id: 'd1',
      state: 2,
      stability: 14.2,
      difficulty: 4.5,
      implicit_credit_count: 1,
    })
    apiMocks.kitsList.mockResolvedValue({ kits: [defaultKit] })
    apiMocks.sharedList.mockResolvedValue({
      kits: [
        {
          id: 'pub-1',
          slug: 'system-design',
          name: 'System Design',
          description: 'Distributed architecture patterns.',
          icon: '',
          color: '#d97757',
          version: 2,
          authorName: 'Toolbox Official',
          isOfficial: true,
          forkCount: 42,
          pillarCount: 7,
          topicCount: 28,
          tags: ['distributed-systems', 'architecture'],
          alreadyForkedSlug: null,
          updatedAt: '2026-03-01T00:00:00Z',
        },
      ],
    })
    apiMocks.studySessionsList.mockResolvedValue([])
  })

  it('renders pure Anki ReviewPage with dueAll("all"), isolates Type answer keys, auto-focuses/clears on next card, and preserves #blueprint hash on Resume reading', async () => {
    apiMocks.dueAll.mockResolvedValueOnce([
      {
        id: 'c1',
        deck_id: 'd1',
        front: 'Define **linearizability**.',
        back: 'Real-time single-copy serializability.',
        kit_slug: 'system-design',
        kit_name: 'System Design',
        srs_previews: { again: '1m', hard: '3d', good: '10d', easy: '21d' },
      },
      {
        id: 'c2',
        deck_id: 'd1',
        front: 'Define **quorum intersection**.',
        back: 'R + W > N.',
        kit_slug: 'system-design',
        kit_name: 'System Design',
      },
    ])

    const reviewRender = render(
      <MemoryRouter initialEntries={['/review']}>
        <ReviewPage />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('review-card-front')).toBeInTheDocument()
    expect(apiMocks.dueAll).toHaveBeenCalledWith('all')
    expect(screen.queryByText(/Confidence before revealing/i)).toBeNull()

    // Toggle Type answer scratchpad: auto-focuses textarea, ignores Space/1 inside textarea, reveals on Enter
    fireEvent.click(screen.getByRole('button', { name: /Type answer/i }))
    const recallBox = screen.getByTestId('review-type-answer-input') as HTMLTextAreaElement
    expect(document.activeElement).toBe(recallBox)

    fireEvent.keyDown(recallBox, { key: ' ', code: 'Space' })
    fireEvent.keyDown(recallBox, { key: '1' })
    expect(screen.queryByTestId('review-card-back')).toBeNull()
    expect(apiMocks.reviewCard).not.toHaveBeenCalled()

    fireEvent.change(recallBox, {
      target: { value: 'Single atomic point between invocation and response' },
    })
    fireEvent.keyDown(recallBox, { key: 'Enter' })
    expect(await screen.findByTestId('review-card-back')).toBeInTheDocument()
    expect(screen.getByText(/Your recall:/i)).toBeInTheDocument()

    // Grade Good via key '3' -> advances to card 2 with empty, auto-focused textarea
    fireEvent.keyDown(window, { key: '3' })
    await waitFor(() =>
      expect(apiMocks.reviewCard).toHaveBeenCalledWith('d1', 'c1', 4, 'medium'),
    )
    const nextRecallBox = await screen.findByTestId('review-type-answer-input')
    expect(nextRecallBox).toHaveValue('')
    expect(document.activeElement).toBe(nextRecallBox)

    // Bare `?` toggles inline keyboard shortcuts reference alongside the Reveal Answer button
    fireEvent.keyDown(window, { key: '?' })
    expect(screen.getAllByText(/Reveal answer/i)).toHaveLength(2)
    reviewRender.unmount()

    // LibraryHomePage shows 1-click Resume reading link with #blueprint-<sectionId> hash + zero raw emojis
    const resumedKit = makeTestKit({
      id: 'k-resume',
      slug: 'distributed-rust',
      name: 'Distributed Rust',
      dogearCount: 3,
      archivedNotesCount: 2,
      lastGuideRef: {
        pillarId: 'ownership',
        topicId: 'borrowing',
        sectionId: 'tradeoffs',
        topicName: 'Borrow Rules',
      },
    })
    apiMocks.kitsList.mockResolvedValue({ kits: [resumedKit] })

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <LibraryHomePage />
        </MemoryRouter>,
      )
    })

    const resumeLink = await screen.findByTestId('kit-resume-link-distributed-rust')
    expect(resumeLink).toHaveAttribute(
      'href',
      '/k/distributed-rust/guide/ownership/borrowing#blueprint-tradeoffs',
    )
    expect(screen.getByTestId('cross-kit-review-btn')).toHaveAttribute(
      'href',
      '/k/distributed-rust',
    )
    expect(screen.getByText(/3 dogeared/i)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('📚')
    expect(document.body.textContent).not.toContain('📦')
  })

  it('prevents accidental Good-grading on double-Space and ignores Space/Enter on focused links/buttons in FlashcardView', () => {
    render(
      <MemoryRouter>
        <div>
          <a href="/library" data-testid="fc-nav-link">
            Library
          </a>
          <button type="button" data-testid="fc-aux-btn">
            Aux
          </button>
          <FlashcardView
            reviewMode
            deckId="d1"
            deckName="Consensus"
            cards={[
              {
                id: 'card-1',
                deck_id: 'd1',
                front: 'What is Raft leader completeness?',
                back: 'Any committed log entry is present in all future leaders.',
                srs_previews: { again: '1m', hard: '5m', good: '2d', easy: '7d' },
              },
            ]}
          />
        </div>
      </MemoryRouter>,
    )

    // #4: Enter on focused link and Space on focused button do NOT flip the card
    const link = screen.getByTestId('fc-nav-link')
    link.focus()
    const enterOnLink = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    link.dispatchEvent(enterOnLink)
    expect(enterOnLink.defaultPrevented).toBe(false)
    expect(screen.queryByTestId('grade-btn-good')).toBeNull()

    const btn = screen.getByTestId('fc-aux-btn')
    btn.focus()
    const spaceOnBtn = new KeyboardEvent('keydown', {
      key: ' ',
      code: 'Space',
      bubbles: true,
      cancelable: true,
    })
    btn.dispatchEvent(spaceOnBtn)
    expect(spaceOnBtn.defaultPrevented).toBe(false)
    expect(screen.queryByTestId('grade-btn-good')).toBeNull()

    // First Space on window reveals the answer; second Space MUST NOT call review API
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(screen.getByTestId('grade-btn-good')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(apiMocks.reviewCard).not.toHaveBeenCalled()
  })

  it('keeps FeynmanPage interim dictation separate from textarea edits so typing never duplicates spoken phrases', () => {
    let instance: {
      onresult: ((ev: { resultIndex: number; results: Array<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null
      start: () => void
      stop: () => void
    } | null = null

    const FakeSpeechRecognition = vi.fn(function () {
      const rec = {
        continuous: false,
        interimResults: false,
        onresult: null as typeof instance extends null ? never : NonNullable<typeof instance>['onresult'],
        onerror: null as (() => void) | null,
        onend: null as (() => void) | null,
        start: vi.fn(),
        stop: vi.fn(),
      }
      instance = rec
      return rec
    })

    const win = window as unknown as { SpeechRecognition?: unknown }
    const prevSR = win.SpeechRecognition
    win.SpeechRecognition = FakeSpeechRecognition
    try {
      render(
        <MemoryRouter initialEntries={['/feynman']}>
          <FeynmanPage />
        </MemoryRouter>,
      )

      fireEvent.click(screen.getByRole('button', { name: /Voice Record/i }))
      expect(instance).not.toBeNull()

      // Emit interim phrase while dictating
      act(() => {
        instance!.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: false, 0: { transcript: 'quorum overlap' } }],
        })
      })

      const textarea = screen.getByTestId('feynman-explanation-input') as HTMLTextAreaElement
      expect(textarea.value).toBe('')
      expect(screen.getByTestId('feynman-interim-transcript')).toHaveTextContent(
        'Listening: quorum overlap',
      )

      // User types into textarea during active interim dictation
      fireEvent.change(textarea, { target: { value: 'Note: ' } })
      expect(textarea.value).toBe('Note: ')

      // SpeechRecognition finalizes the interim phrase -> appended ONCE, zero duplication
      act(() => {
        instance!.onresult?.({
          resultIndex: 0,
          results: [{ isFinal: true, 0: { transcript: 'quorum overlap' } }],
        })
      })
      expect(textarea.value).toBe('Note: quorum overlap ')
      expect(screen.queryByTestId('feynman-interim-transcript')).toBeNull()
    } finally {
      win.SpeechRecognition = prevSR
    }
  })

  it('renders SharedLibraryPage tag/search filtering and InterleavedPage empty/review states cleanly', async () => {
    const sharedRender = render(
      <MemoryRouter initialEntries={['/shared']}>
        <SharedLibraryPage />
      </MemoryRouter>,
    )
    expect(
      await screen.findByRole('heading', { name: 'Shared Community Library' }),
    ).toBeInTheDocument()
    expect(await screen.findByTestId('shared-kit-system-design')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('📚')
    sharedRender.unmount()

    apiMocks.dueAll.mockResolvedValueOnce([])
    render(
      <MemoryRouter initialEntries={['/interleaved']}>
        <InterleavedPage />
      </MemoryRouter>,
    )
    expect(await screen.findByText(/All caught up/i)).toBeInTheDocument()
  })
})
