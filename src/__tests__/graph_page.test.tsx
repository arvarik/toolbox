import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import GraphPage from '../pages/GraphPage'
import useKitStore from '../stores/useKitStore'

const graphFixture = {
  nodes: [
    {
      id: 'client-server', name: 'Client-Server Model', pillarId: 'network-protocols',
      pillarName: 'Network & API Protocols', pillarColor: '#60a5fa', topicId: 'request-response',
      summary: 'Base pattern.', health: 'mastered', strength: 1,
      counts: { total: 2, new: 0, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 2 },
      ready: false, locked: false,
    },
    {
      id: 'http-rest', name: 'HTTP & REST APIs', pillarId: 'network-protocols',
      pillarName: 'Network & API Protocols', pillarColor: '#60a5fa', topicId: 'request-response',
      summary: 'Verbs and status codes.', health: 'due', strength: 0.5,
      counts: { total: 3, new: 1, learning: 1, lapsed: 0, due: 1, maturing: 0, mastered: 0 },
      ready: false, locked: false,
    },
    {
      id: 'load-balancing', name: 'Load Balancing', pillarId: 'compute',
      pillarName: 'Compute & Infrastructure', pillarColor: '#818cf8', topicId: 'traffic-gateways',
      summary: 'Spread traffic.', health: 'unseen', strength: 0,
      counts: { total: 0, new: 0, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 0 },
      ready: true, locked: false,
    },
  ],
  edges: [
    { from: 'client-server', to: 'http-rest' },
    { from: 'http-rest', to: 'load-balancing' },
  ],
  tracks: [
    {
      id: 'senior-distributed', name: 'Senior Distributed Systems', emoji: '🧠',
      description: 'Deep end.', nodeIds: ['client-server', 'http-rest'], nodeCount: 2, masteredCount: 1,
    },
  ],
  stats: { mastered: 1, due: 1, decayed: 0, unseen: 1 },
  remediationCount: 0,
}

const nodeDetailFixture = {
  node: {
    id: 'http-rest', name: 'HTTP & REST APIs', pillarId: 'network-protocols',
    pillarName: 'Network & API Protocols', topicId: 'request-response',
    summary: 'Verbs and status codes.', health: 'due', strength: 0.5,
    counts: { total: 3 }, ready: false, locked: false, unsatisfiedPrereqs: [],
    keywords: [], components: [],
  },
  cards: [
    { id: 'c1', deck_id: 'd1', deckName: 'Protocols', front: 'What is REST?', state: 2, ease_factor: 2.5, interval: 10, next_review: null, due: true, remediation: false },
  ],
  prereqs: [{ id: 'client-server', name: 'Client-Server Model', health: 'mastered', strength: 1 }],
  dependents: [{ id: 'load-balancing', name: 'Load Balancing', health: 'unseen', strength: 0 }],
  guide: { pillarId: 'network-protocols', topicId: 'request-response', topicName: 'Request-Response Protocols', filledSections: 2 },
  boards: [],
}

const mocks = vi.hoisted(() => ({
  graphGet: vi.fn(),
  graphGetNode: vi.fn(),
}))

vi.mock('../utils/api', () => ({
  graphApi: {
    get: (...args: unknown[]) => mocks.graphGet(...args),
    getNode: (...args: unknown[]) => mocks.graphGetNode(...args),
    nodeSession: vi.fn(() => Promise.resolve({ cards: [], nodeName: 'HTTP & REST APIs' })),
    trackSession: vi.fn(() => Promise.resolve({ cards: [], trackName: 'Senior Distributed Systems' })),
  },
  flashcardsApi: { review: vi.fn() },
  chatApi: { evaluateInterceptor: vi.fn() },
  configApi: { get: vi.fn(() => Promise.resolve({})), getAvailableModels: vi.fn(() => Promise.resolve({ groups: [] })) },
}))

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el
}

function renderPage() {
  return render(
    <MemoryRouter>
      <GraphPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.graphGet.mockResolvedValue(graphFixture)
  mocks.graphGetNode.mockResolvedValue(nodeDetailFixture)
  useKitStore.setState({
    kits: [],
    activeKitSlug: null,
    activeKit: null,
    kitCache: {},
    isLoadingList: false,
    isLoadingActive: false,
  })
})

describe('GraphPage', () => {
  it('renders nodes with health colors and the legend counts', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-client-server')).toBeInTheDocument()
    })
    expect(byId('graph-node-http-rest')).toBeInTheDocument()
    expect(byId('graph-node-load-balancing')).toBeInTheDocument()
    expect(screen.getAllByText('Mastered').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Decayed / Fragile')).toBeInTheDocument()
  })

  it('filters nodes by readiness', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-client-server')).toBeInTheDocument()
    })
    fireEvent.click(byId('graph-filter-mastered'))
    expect(byId('graph-node-client-server').classList.contains('filtered-out')).toBe(false)
    expect(byId('graph-node-http-rest').classList.contains('filtered-out')).toBe(true)

    fireEvent.click(byId('graph-filter-ready'))
    expect(byId('graph-node-load-balancing').classList.contains('filtered-out')).toBe(false)
    expect(byId('graph-node-client-server').classList.contains('filtered-out')).toBe(true)
  })

  it('filters nodes by search term', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-client-server')).toBeInTheDocument()
    })
    fireEvent.change(byId('graph-search'), { target: { value: 'load bal' } })
    expect(byId('graph-node-load-balancing').classList.contains('filtered-out')).toBe(false)
    expect(byId('graph-node-http-rest').classList.contains('filtered-out')).toBe(true)
  })

  it('opens the slide-over panel with deep links on node click', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-http-rest')).toBeInTheDocument()
    })
    fireEvent.click(byId('graph-node-http-rest'))
    await waitFor(() => {
      expect(document.getElementById('graph-node-panel')).toBeInTheDocument()
    })
    expect(screen.getByText(/Guide: Request-Response Protocols/)).toBeInTheDocument()
    expect(screen.getByText('Learn first')).toBeInTheDocument()
    expect(screen.getByText('Unlocks')).toBeInTheDocument()
    expect(screen.getByText('What is REST?')).toBeInTheDocument()
  })

  it('activates a learning track with numbered study order', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-track-select')).toBeInTheDocument()
    })
    fireEvent.change(byId('graph-track-select'), {
      target: { value: 'senior-distributed' },
    })
    expect(byId('graph-track-ribbon')).toBeInTheDocument()
    expect(screen.getByText('Start Track Session')).toBeInTheDocument()
    expect(byId('graph-node-load-balancing').classList.contains('filtered-out')).toBe(true)
  })

  it('resets selected node, track filter, and search state when switching between /k/:slug/graph Kits', async () => {
    function KitSwitcher() {
      const navigate = useNavigate()
      return (
        <button onClick={() => navigate('/k/rust-kit/graph')} data-testid="switch-kit-btn">
          Switch Kit
        </button>
      )
    }

    const rustGraphFixture = {
      nodes: [
        {
          id: 'borrow-checker', name: 'Borrow Checker', pillarId: 'ownership',
          pillarName: 'Ownership', pillarColor: '#f97316', topicId: 'lifetimes',
          summary: 'Aliasing XOR mutability.', health: 'unseen', strength: 0,
          counts: { total: 0, new: 0, learning: 0, lapsed: 0, due: 0, maturing: 0, mastered: 0 },
          ready: true, locked: false,
        },
      ],
      edges: [],
      tracks: [],
      stats: { mastered: 0, due: 0, decayed: 0, unseen: 1 },
      remediationCount: 0,
    }

    render(
      <MemoryRouter initialEntries={['/k/sys-kit/graph']}>
        <KitSwitcher />
        <Routes>
          <Route path="/k/:slug/graph" element={<GraphPage />} />
        </Routes>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(document.getElementById('graph-node-http-rest')).toBeInTheDocument()
    })

    // Select a node, apply a search query, and activate a track in Kit A
    fireEvent.click(byId('graph-node-http-rest'))
    await waitFor(() => {
      expect(document.getElementById('graph-node-panel')).toBeInTheDocument()
    })
    fireEvent.change(byId('graph-search'), { target: { value: 'http' } })
    fireEvent.change(byId('graph-track-select'), { target: { value: 'senior-distributed' } })
    expect(document.getElementById('graph-track-ribbon')).toBeInTheDocument()

    // Switch to Kit B while GraphPage stays mounted
    mocks.graphGet.mockResolvedValueOnce(rustGraphFixture)
    fireEvent.click(screen.getByTestId('switch-kit-btn'))

    await waitFor(() => {
      expect(document.getElementById('graph-node-borrow-checker')).toBeInTheDocument()
    })
    expect(document.getElementById('graph-node-panel')).toBeNull()
    expect(document.getElementById('graph-track-ribbon')).toBeNull()
    expect((byId('graph-search') as HTMLInputElement).value).toBe('')
  })
})
