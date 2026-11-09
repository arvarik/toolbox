import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import GuidedDrillWorkspace from '../components/drills/GuidedDrillWorkspace'
import DrillsPage from '../pages/DrillsPage'
import FeynmanPage from '../pages/FeynmanPage'
import KitPathPage from '../pages/KitPathPage'
import ReviewPage from '../pages/ReviewPage'
import useAppStore from '../stores/appStore'
import { makeTestKit, resetKitStore } from './testHelpers'

const mocks = vi.hoisted(() => ({
  graphGet: vi.fn(),
  dueAll: vi.fn(),
  reviewCard: vi.fn(),
  drillsList: vi.fn(),
  drillsGenerate: vi.fn(),
  drillsSubmit: vi.fn(),
  getChallenge: vi.fn(),
  submitChallenge: vi.fn(),
  feynmanEvaluate: vi.fn(),
}))

vi.mock('../utils/api', () => ({
  graphApi: {
    get: (...args: unknown[]) => mocks.graphGet(...args),
    nodeCards: vi.fn(() => Promise.resolve([])),
    trackCards: vi.fn(() => Promise.resolve([])),
  },
  flashcardsApi: {
    dueAll: (...args: unknown[]) => mocks.dueAll(...args),
    review: (...args: unknown[]) => mocks.reviewCard(...args),
  },
  chatApi: {
    send: vi.fn(() => Promise.resolve({ response: 'ok' })),
    stream: vi.fn(async () => 'ok'),
  },
  kitsApi: {
    list: vi.fn(() => Promise.resolve({ kits: [] })),
    get: vi.fn(() => Promise.resolve(null)),
  },
}))

vi.mock('../utils/pedagogyApi', () => ({
  drillsApi: {
    list: (...args: unknown[]) => mocks.drillsList(...args),
    generate: (...args: unknown[]) => mocks.drillsGenerate(...args),
    submit: (...args: unknown[]) => mocks.drillsSubmit(...args),
    getChallenge: (...args: unknown[]) => mocks.getChallenge(...args),
    submitChallenge: (...args: unknown[]) => mocks.submitChallenge(...args),
  },
  feynmanApi: {
    evaluate: (...args: unknown[]) => mocks.feynmanEvaluate(...args),
  },
}))

const zeroCounts = { total: 2, new: 0, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 0 }

describe('Ordered Mastery Path, Attempt-Gated Drills, Grounded Feynman & Cross-Kit Review', () => {
  beforeEach(() => {
    useAppStore.setState({
      model: 'gemini-2.5-flash',
      toasts: [],
      nodes: [],
      edges: [],
      srsVersion: 0,
      chatOpen: { chat: false, guide: false, builder: false, study: false },
    })
    resetKitStore()
  })

  it('renders KitPathPage seeding banner, Learning Track transitive filter, and ChallengeNodeModal pass celebration', async () => {
    const rustDetail = makeTestKit({
      id: 'kit-rust-1',
      slug: 'distributed-rust',
      name: 'Distributed Rust',
      status: 'seeding',
      statusDetail: 'Generating scenario drills (2/3 pillars)…',
      capabilities: { canvas: 'concept', calculator: false },
      mutateSkeleton: (s) => {
        s.pillars = [
          {
            id: 'ownership',
            number: 1,
            name: 'Ownership & Borrowing',
            shortName: 'Ownership',
            color: '#f97316',
            sections: [{ id: 'mechanics', name: 'Borrow Mechanics', icon: 'cpu', promptHint: '', ownershipRule: '' }],
            topics: [
              { id: 'move-semantics', name: 'Move Semantics', summary: 'Single owner.' },
              { id: 'lifetimes', name: 'Non-Lexical Lifetimes', summary: 'CFG borrow spans.' },
            ],
          },
        ]
        s.graph = {
          nodes: [
            { id: 'moves', name: 'Move Semantics', pillarId: 'ownership', topicId: 'move-semantics', summary: 'Affine moves.', keywords: [], components: [] },
            { id: 'borrows', name: 'Aliasing XOR Mutability', pillarId: 'ownership', topicId: 'move-semantics', summary: 'Exclusive mutability.', keywords: [], components: [] },
            { id: 'nll', name: 'Non-Lexical Lifetimes', pillarId: 'ownership', topicId: 'lifetimes', summary: 'CFG spans.', keywords: [], components: [] },
          ],
          edges: [
            { from: 'moves', to: 'borrows' },
            { from: 'borrows', to: 'nll' },
          ],
          tracks: [{ id: 'borrow-mastery', name: 'Borrow Checker Deep Dive', emoji: '🦀', description: 'Moves to borrows.', targets: ['borrows'] }],
        }
      },
    })
    resetKitStore(rustDetail)

    mocks.graphGet.mockResolvedValue({
      nodes: [
        { id: 'moves', name: 'Move Semantics', pillarId: 'ownership', pillarName: 'Ownership & Borrowing', pillarColor: '#f97316', topicId: 'move-semantics', summary: 'Affine moves.', health: 'mastered', strength: 0.94, counts: { ...zeroCounts, mastered: 2 }, ready: true, locked: false },
        { id: 'borrows', name: 'Aliasing XOR Mutability', pillarId: 'ownership', pillarName: 'Ownership & Borrowing', pillarColor: '#f97316', topicId: 'move-semantics', summary: 'Borrows.', health: 'unseen', strength: 0, counts: { ...zeroCounts, new: 2, due: 1 }, ready: true, locked: false },
        { id: 'nll', name: 'Non-Lexical Lifetimes', pillarId: 'ownership', pillarName: 'Ownership & Borrowing', pillarColor: '#f97316', topicId: 'lifetimes', summary: 'CFG spans.', health: 'unseen', strength: 0, counts: { ...zeroCounts, new: 2 }, ready: false, locked: true },
      ],
      edges: rustDetail.skeleton.graph.edges,
      tracks: [],
      stats: { mastered: 1, due: 0, decayed: 0, unseen: 2 },
      remediationCount: 0,
    })
    mocks.drillsList.mockResolvedValue([])
    mocks.getChallenge.mockResolvedValue({
      nodeId: 'nll',
      nodeName: 'Non-Lexical Lifetimes',
      pillarId: 'ownership',
      topicId: 'lifetimes',
      drill: { id: 'drill-nll-hard', nodeId: 'nll', difficulty: 3, prompt: 'Explain NLL live range.', hints: [], rubricPoints: ['CFG live range'] },
      feynmanPrompt: 'Explain Non-Lexical Lifetimes from first principles.',
    })
    mocks.submitChallenge.mockResolvedValue({
      nodeId: 'nll',
      drillId: 'drill-nll-hard',
      pass: true,
      score: 0.91,
      assisted: false,
      masteryEligible: true,
      extractedClaims: ['NLL ends a borrow at its final control-flow read/write.'],
      factualOrLogicalErrors: [],
      unexplainedJargon: [],
      rubricChecks: [{ point: 'CFG live range', met: true, evidenceOrGap: 'Accurate.' }],
      socraticFollowUp: 'How do Drop impls interact with NLL?',
      constructiveFeedback: 'Crisp derivation.',
      graduatedCardIds: ['card-nll-1', 'card-nll-2'],
      committedSectionId: 'mechanics',
      implicit_credit_count: 2,
      implicitCredit: { updatedCardIds: ['card-move-1', 'card-borrow-1'], nodesCredited: ['moves', 'borrows'] },
    })

    render(
      <MemoryRouter initialEntries={['/k/distributed-rust']}>
        <Routes>
          <Route path="/k/:slug" element={<KitPathPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('kit-seeding-banner')).toHaveTextContent('Generating scenario drills (2/3 pillars)…')
    expect(screen.getByTestId('path-node-status-moves')).toHaveTextContent('Mastered')
    expect(screen.getByTestId('path-node-status-borrows')).toHaveTextContent('Ready / Unlocked')
    expect(screen.getByTestId('path-node-status-nll')).toHaveTextContent('Locked')

    fireEvent.click(screen.getByTestId('track-chip-borrow-mastery'))
    expect(screen.getByTestId('path-node-moves')).toBeInTheDocument()
    expect(screen.getByTestId('path-node-borrows')).toBeInTheDocument()
    expect(screen.queryByTestId('path-node-nll')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('track-chip-borrow-mastery'))
    fireEvent.click(screen.getByTestId('challenge-node-btn-nll'))

    expect(await screen.findByTestId('challenge-node-modal')).toBeInTheDocument()
    expect(mocks.getChallenge).toHaveBeenCalledWith('nll', 'gemini-2.5-flash')

    fireEvent.change(screen.getByTestId('challenge-drill-input'), {
      target: { value: 'Under NLL, a reference borrow region spans only up to its last use in the MIR CFG.' },
    })
    fireEvent.change(screen.getByTestId('challenge-feynman-input'), {
      target: { value: 'The compiler releases the borrow right after the last line that reads the reference.' },
    })
    fireEvent.click(screen.getByTestId('submit-challenge-btn'))

    expect(await screen.findByTestId('challenge-pass-celebration')).toBeInTheDocument()
    expect(screen.getByTestId('challenge-graduated-cards')).toHaveTextContent('2 cards → stability = 21d')
    expect(screen.getByTestId('challenge-fire-credit')).toHaveTextContent('+2 prerequisite cards credited')
    expect(screen.getByTestId('challenge-committed-section')).toHaveTextContent('Committed → mechanics')
  })

  it('enforces 30-char & 20s-timer Hint 1 gates, Assisted Mode on Hint 3, error/jargon/remediation callouts, and Unassisted Variant generation', async () => {
    mocks.drillsList.mockResolvedValue([
      {
        id: 'drill-quorum-1',
        nodeId: 'quorums',
        nodeName: 'Quorum Consensus',
        pillarId: 'distributed-mechanics',
        topicId: 'replication-strategies',
        difficulty: 2,
        prompt: 'Given $N = 5$ replicas, choose $R$ and $W$ for strong consistency.',
        hints: ['Recall R + W overlap.', 'Keep R + W > 5.', 'Set W = 4, R = 2.'],
        workedSolution: 'W = 3, R = 3 or W = 4, R = 2.',
        rubricPoints: ['States R + W > N'],
        source: 'ai',
        attemptCount: 0,
        bestScore: null,
        mastered: false,
      },
    ])
    mocks.drillsSubmit.mockResolvedValue({
      attemptId: 'att-1',
      drillId: 'drill-quorum-1',
      nodeId: 'quorums',
      score: 0.78,
      pass: true,
      assisted: true,
      masteryEligible: false,
      hintsUsed: 3,
      viewedWorkedSolution: false,
      extractedClaims: ['R + W > 5 guarantees overlap.'],
      factualOrLogicalErrors: ['Claimed W=5 tolerates 1 replica crash on writes.'],
      unexplainedJargon: ['anti-entropy'],
      rubricChecks: [{ point: 'States R + W > N', met: true, evidenceOrGap: 'Wrote R + W > 5.' }],
      socraticFollowUp: 'How many replicas can fail if W = 5?',
      constructiveFeedback: 'Watch write availability when W = N.',
      remediation: [{ cardId: 'rem-1', nodeId: 'replication-lag', nodeName: 'Replication Lag', front: 'Write availability when W=N?', reason: 'Missed bound' }],
    })
    mocks.drillsGenerate.mockResolvedValue({
      id: 'drill-quorum-variant-2',
      nodeId: 'quorums',
      nodeName: 'Quorum Consensus',
      pillarId: 'distributed-mechanics',
      topicId: 'replication-strategies',
      difficulty: 2,
      prompt: 'Fresh Variant: With $N = 7$ across 3 AZs, survive an AZ outage.',
      hints: ['2-3 per AZ.', '4 survive.', 'R=4, W=4.'],
      workedSolution: 'Use R=4, W=4.',
      rubricPoints: ['Survives AZ loss'],
      source: 'ai',
      attemptCount: 0,
      bestScore: null,
      mastered: false,
    })

    const { unmount } = render(
      <MemoryRouter initialEntries={['/k/system-design/drills?node=quorums']}>
        <Routes>
          <Route path="/k/:slug/drills" element={<DrillsPage />} />
        </Routes>
      </MemoryRouter>,
    )

    const hint1Btn = await screen.findByTestId('reveal-hint-1-btn')
    expect(hint1Btn).toBeDisabled()

    const scratchpad = screen.getByTestId('drill-scratchpad')
    fireEvent.change(scratchpad, { target: { value: '   too short   ' } })
    expect(hint1Btn).toBeDisabled()

    fireEvent.change(scratchpad, {
      target: { value: 'By Pigeonhole Principle we require R + W > 5 so read and write sets intersect.' },
    })
    expect(hint1Btn).not.toBeDisabled()

    fireEvent.click(hint1Btn)
    fireEvent.click(screen.getByTestId('reveal-hint-2-btn'))
    fireEvent.click(screen.getByTestId('reveal-hint-3-btn'))
    expect(screen.getByTestId('live-assisted-pill')).toHaveTextContent('Assisted Mode')

    fireEvent.click(screen.getByTestId('submit-drill-btn'))
    expect(await screen.findByTestId('rubric-assisted-badge')).toBeInTheDocument()
    expect(mocks.drillsSubmit).toHaveBeenCalledWith('drill-quorum-1', expect.objectContaining({ hintsUsed: 3, viewedWorkedSolution: false }))
    expect(screen.getByTestId('factual-errors-callout')).toHaveTextContent('Claimed W=5 tolerates 1 replica crash')
    expect(screen.getByTestId('unexplained-jargon-box')).toHaveTextContent('anti-entropy')
    expect(screen.getByTestId('remediation-queue-callout')).toHaveTextContent('Replication Lag')

    fireEvent.click(screen.getByTestId('generate-unassisted-variant-btn'))
    await waitFor(() => expect(mocks.drillsGenerate).toHaveBeenCalledWith(expect.objectContaining({ nodeId: 'quorums', difficulty: 2 })))
    expect(await screen.findByText(/With \$N = 7\$ across 3 AZs/i)).toBeInTheDocument()
    unmount()

    // 20-second countdown gate unlocks Hint 1 even with 0 scratchpad characters
    vi.useFakeTimers()
    try {
      render(
        <MemoryRouter>
          <GuidedDrillWorkspace
            drill={{
              id: 'drill-timer-1',
              kitId: 'kit-sys',
              nodeId: 'consensus',
              nodeName: 'Raft Consensus',
              difficulty: 1,
              prompt: 'Why does Raft randomize election timeouts?',
              hints: ['Split votes.', 'Timers.', '150-300ms.'],
              workedSolution: 'Breaks symmetry.',
              rubricPoints: ['Split-vote avoidance'],
              seedKey: null,
              createdAt: '2026-09-01T00:00:00Z',
              attemptCount: 0,
              bestScore: null,
              mastered: false,
              lastAttemptAt: null,
            }}
          />
        </MemoryRouter>,
      )
      const timerHintBtn = screen.getByTestId('reveal-hint-1-btn')
      expect(timerHintBtn).toBeDisabled()
      act(() => {
        vi.advanceTimersByTime(19_000)
      })
      expect(timerHintBtn).toBeDisabled()
      act(() => {
        vi.advanceTimersByTime(1_000)
      })
      expect(timerHintBtn).not.toBeDisabled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('evaluates FeynmanPage against anti-sycophancy rubric and routes Socratic Chat draft via sessionStorage', async () => {
    mocks.feynmanEvaluate.mockResolvedValue({
      conceptName: 'CAP Theorem',
      nodeId: 'cap-theorem',
      pillarId: 'distributed-mechanics',
      topicId: 'consistency-models',
      score: 0.52,
      pass: false,
      extractedClaims: ['CA systems work across WANs.'],
      factualOrLogicalErrors: ['Network partitions (P) are inevitable in distributed systems.'],
      unexplainedJargon: ['split-brain'],
      rubricChecks: [{ point: 'Explains P inevitability', met: false, evidenceOrGap: 'Treated P as optional.' }],
      socraticFollowUp: 'Can Ethernet guarantee zero packet loss?',
      constructiveFeedback: 'Choose between C and A during a partition.',
    })

    render(
      <MemoryRouter initialEntries={['/k/system-design/feynman?node=cap-theorem']}>
        <Routes>
          <Route path="/k/:slug/feynman" element={<FeynmanPage />} />
          <Route path="/k/:slug/chat" element={<div data-testid="kit-chat-dest">Chat Loaded</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByTestId('feynman-explanation-input'), {
      target: { value: 'Just pick Consistency and Availability and disable network partitions to avoid split-brain.' },
    })
    fireEvent.click(document.getElementById('feynman-analyze-btn')!)

    expect(await screen.findByTestId('rubric-fail-badge')).toHaveTextContent('Needs Revision')
    expect(screen.getByTestId('factual-errors-callout')).toHaveTextContent('Network partitions (P) are inevitable')

    fireEvent.click(screen.getByTestId('feynman-practice-chat-btn'))
    expect(await screen.findByTestId('kit-chat-dest')).toBeInTheDocument()
    expect(sessionStorage.getItem('toolbox_chat_draft')).toContain('CAP & PACELC')
  })

  it('runs unified Cross-Kit FSRS-6 daily queue with Space/number hotkeys, FIRe credit pill, and completion summary', async () => {
    mocks.dueAll.mockResolvedValue([
      {
        id: 'card-rust-1',
        deck_id: 'deck-rust',
        front: 'State **Aliasing XOR Mutability**.',
        back: 'Either many `&T` borrows or a single `&mut T` borrow.',
        deckName: 'Ownership Core',
        kit_slug: 'distributed-rust',
        kit_name: 'Distributed Rust',
        kit_icon: '🦀',
        kit_color: '#f97316',
        stability: 8.5,
        difficulty: 4.2,
        last_reviewed: new Date().toISOString(),
        srs_previews: { again: '1m', hard: '3d', good: '11d', easy: '24d' },
      },
      {
        id: 'card-sys-1',
        deck_id: 'deck-sys',
        front: 'When do quorums overlap?',
        back: 'Whenever $R + W > N$.',
        deckName: 'Consensus',
        kit_slug: 'system-design',
        kit_name: 'System Design',
        kit_icon: '🏗️',
        kit_color: '#006a91',
        stability: 12.0,
        difficulty: 5.0,
        last_reviewed: new Date().toISOString(),
      },
    ])
    mocks.reviewCard
      .mockResolvedValueOnce({ id: 'card-rust-1', deck_id: 'deck-rust', state: 2, stability: 19.4, difficulty: 4.0, implicit_credit_count: 3 })
      .mockResolvedValueOnce({ id: 'card-sys-1', deck_id: 'deck-sys', state: 2, stability: 26.1, difficulty: 4.8, implicit_credit_count: 0 })

    render(
      <MemoryRouter initialEntries={['/review']}>
        <Routes>
          <Route path="/review" element={<ReviewPage />} />
          <Route path="/" element={<div data-testid="library-home-dest">Library</div>} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText(/Distributed Rust/i)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    expect(await screen.findByText(/single/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: '3' })
    await waitFor(() => expect(mocks.reviewCard).toHaveBeenCalledWith('deck-rust', 'card-rust-1', 4, 'medium'))

    expect(await screen.findByTestId('review-fire-credit-pill')).toHaveTextContent('+3 prerequisite cards stabilized')
    expect(screen.getByText(/System Design/i)).toBeInTheDocument()

    fireEvent.keyDown(window, { key: ' ', code: 'Space' })
    fireEvent.keyDown(window, { key: '4' })

    expect(await screen.findByTestId('review-completion-summary')).toBeInTheDocument()
    expect(screen.getByTestId('summary-fire-credits')).toHaveTextContent('+3')
    fireEvent.click(screen.getByTestId('return-library-btn'))
    expect(await screen.findByTestId('library-home-dest')).toBeInTheDocument()
  })
})
