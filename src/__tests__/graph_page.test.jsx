import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import GraphPage from '../pages/GraphPage'

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

vi.mock('../utils/api', () => ({
  graphApi: {
    get: vi.fn(() => Promise.resolve(graphFixture)),
    getNode: vi.fn(() => Promise.resolve(nodeDetailFixture)),
    nodeSession: vi.fn(() => Promise.resolve({ cards: [], nodeName: 'HTTP & REST APIs' })),
    trackSession: vi.fn(() => Promise.resolve({ cards: [], trackName: 'Senior Distributed Systems' })),
  },
  flashcardsApi: { review: vi.fn() },
  chatApi: { evaluateInterceptor: vi.fn() },
  configApi: { get: vi.fn(() => Promise.resolve({})), getAvailableModels: vi.fn(() => Promise.resolve({ groups: [] })) },
}))

function renderPage() {
  return render(
    <MemoryRouter>
      <GraphPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GraphPage', () => {
  it('renders nodes with health colors and the legend counts', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-client-server')).toBeInTheDocument()
    })
    expect(document.getElementById('graph-node-http-rest')).toBeInTheDocument()
    expect(document.getElementById('graph-node-load-balancing')).toBeInTheDocument()
    // Legend renders health buckets ("Mastered" also appears as a filter button)
    expect(screen.getAllByText('Mastered').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Decayed / Fragile')).toBeInTheDocument()
  })

  it('filters nodes by readiness', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-client-server')).toBeInTheDocument()
    })
    fireEvent.click(document.getElementById('graph-filter-mastered'))
    expect(document.getElementById('graph-node-client-server').classList.contains('filtered-out')).toBe(false)
    expect(document.getElementById('graph-node-http-rest').classList.contains('filtered-out')).toBe(true)

    fireEvent.click(document.getElementById('graph-filter-ready'))
    expect(document.getElementById('graph-node-load-balancing').classList.contains('filtered-out')).toBe(false)
    expect(document.getElementById('graph-node-client-server').classList.contains('filtered-out')).toBe(true)
  })

  it('filters nodes by search term', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-client-server')).toBeInTheDocument()
    })
    fireEvent.change(document.getElementById('graph-search'), { target: { value: 'load bal' } })
    expect(document.getElementById('graph-node-load-balancing').classList.contains('filtered-out')).toBe(false)
    expect(document.getElementById('graph-node-http-rest').classList.contains('filtered-out')).toBe(true)
  })

  it('opens the slide-over panel with deep links on node click', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-node-http-rest')).toBeInTheDocument()
    })
    fireEvent.click(document.getElementById('graph-node-http-rest'))
    await waitFor(() => {
      expect(document.getElementById('graph-node-panel')).toBeInTheDocument()
    })
    // Guide deep link
    expect(screen.getByText(/Guide: Request-Response Protocols/)).toBeInTheDocument()
    // Prerequisite and dependent links
    expect(screen.getByText('Learn first')).toBeInTheDocument()
    expect(screen.getByText('Unlocks')).toBeInTheDocument()
    // Linked card
    expect(screen.getByText('What is REST?')).toBeInTheDocument()
  })

  it('activates a learning track with numbered study order', async () => {
    renderPage()
    await waitFor(() => {
      expect(document.getElementById('graph-track-select')).toBeInTheDocument()
    })
    fireEvent.change(document.getElementById('graph-track-select'), {
      target: { value: 'senior-distributed' },
    })
    expect(document.getElementById('graph-track-ribbon')).toBeInTheDocument()
    expect(screen.getByText('Start Track Session')).toBeInTheDocument()
    // Nodes outside the track dim out
    expect(document.getElementById('graph-node-load-balancing').classList.contains('filtered-out')).toBe(true)
  })
})
