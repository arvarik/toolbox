import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { KitSkeletonV1 } from '../../shared/kits/kitSkeleton'
import Layout from '../components/layout/Layout'
import GuidePage from '../pages/GuidePage'
import LibraryHomePage from '../pages/LibraryHomePage'
import NewKitStudioPage from '../pages/NewKitStudioPage'
import useKitStore, { getActiveKitSlugForRequest } from '../stores/useKitStore'
import { makeTestKit, resetKitStore } from './testHelpers'

const compilerMocks = vi.hoisted(() => ({
  uploadSources: vi.fn(),
  ingestUrlOrText: vi.fn(() =>
    Promise.resolve({
      sources: [
        {
          stagedId: 'staged-url-1',
          kind: 'url' as const,
          title: 'Raft Extended Paper',
          url: 'https://raft.github.io/raft.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 42000,
          wordCount: 6400,
          excerpt: 'Raft consensus algorithm...',
          safeBasename: 'raft.pdf',
        },
      ],
    }),
  ),
  deleteSource: vi.fn(() => Promise.resolve({ ok: true })),
  calibrate: vi.fn(),
  compile: vi.fn(),
  refine: vi.fn(),
  commit: vi.fn(),
  getSeedStatus: vi.fn(),
  expandKit: vi.fn(),
}))

const apiMocks = vi.hoisted(() => ({
  kitsList: vi.fn(),
  kitsGet: vi.fn(),
}))

vi.mock('../utils/compilerApi', () => ({
  compilerApi: compilerMocks,
  default: compilerMocks,
}))

vi.mock('../utils/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/api')>()
  return {
    ...actual,
    configApi: {
      ...actual.configApi,
      get: vi.fn(() => Promise.resolve({ api_key_configured: true })),
      getAvailableModels: vi.fn(() => Promise.resolve({ groups: [], providers: [] })),
    },
    studySessionsApi: {
      list: vi.fn(() => Promise.resolve([{ date: '2026-04-08', count: 8 }])),
    },
    guideContentApi: {
      ...actual.guideContentApi,
      progress: vi.fn(() => Promise.resolve({ ownership__borrowing__mechanics: true })),
      getForTopic: vi.fn(() =>
        Promise.resolve({
          mechanics: { content: 'Single mutable XOR shared borrows.', committedAt: '2026-04-08T10:00:00Z' },
        }),
      ),
    },
    kitsApi: {
      ...actual.kitsApi,
      list: (...args: unknown[]) => apiMocks.kitsList(...args),
      get: (...args: unknown[]) => apiMocks.kitsGet(...args),
      touch: vi.fn(() => Promise.resolve({ ok: true })),
      getArchivedNotes: vi.fn(() =>
        Promise.resolve({
          notes: [
            {
              pillarId: 'legacy-async',
              topicId: 'futures-01',
              sectionId: 'overview',
              content: 'Preserved retired Futures 0.1 notes',
              committedAt: '2026-04-01T00:00:00Z',
            },
          ],
        }),
      ),
    },
  }
})

function buildRustKit() {
  return makeTestKit({
    id: 'kit-rust-1',
    slug: 'distributed-rust',
    name: 'Distributed Rust',
    icon: '🦀',
    color: '#f97316',
    forkedFromSharedId: 'shared-rust-1',
    forkedVersion: 1,
    upstreamSlug: 'distributed-rust',
    upstreamLatestVersion: 2,
    hasUpstreamUpdate: true,
    dueCount: 4,
    cardCount: 12,
    archivedNotesCount: 1,
    capabilities: { canvas: 'concept', calculator: false, webResearchDefault: false, enableSvgDiagrams: true },
    mutateSkeleton: (s) => {
      s.pillars = [
        {
          id: 'ownership',
          number: 1,
          name: 'Ownership & Borrow Checking',
          shortName: 'Ownership',
          color: '#f97316',
          topics: [{ id: 'borrowing', name: 'Borrow Rules' }],
          sections: [
            { id: 'mechanics', name: 'Borrow Mechanics', icon: 'cpu', promptHint: 'Rules', ownershipRule: 'Mechanics' },
            { id: 'pitfalls', name: 'Aliasing Pitfalls', icon: 'alert-triangle', promptHint: 'Pitfalls', ownershipRule: 'Pitfalls' },
          ],
        },
      ]
      s.graph = {
        nodes: [{ id: 'ownership-node', name: 'Ownership', pillarId: 'ownership', topicId: 'borrowing', summary: 'Single owner', keywords: [], components: [] }],
        edges: [],
        tracks: [],
      }
    },
  })
}

describe('Multi-Kit Workspace, Archived Notes & New Kit Studio (/new)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetKitStore()
  })

  it('renders LibraryHomePage Cross-Kit SRS Triage Bar, upstream update badge, and live Seeding… progress pill', async () => {
    const rustKit = buildRustKit()
    const seedingKit = makeTestKit({
      id: 'kit-raft-1',
      slug: 'raft-storage-engines',
      name: 'Raft & Storage Engines',
      status: 'seeding',
      statusDetail: 'Seeding Pillar 2/4: Replication…',
    })
    apiMocks.kitsList.mockResolvedValue({ kits: [rustKit, seedingKit] })

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<LibraryHomePage />} />
          </Routes>
        </MemoryRouter>,
      )
    })

    expect(await screen.findByText('Distributed Rust')).toBeInTheDocument()
    expect(screen.getByTestId('cross-kit-review-btn')).toHaveTextContent('Review 4 Due Cards')
    expect(screen.getByText(/Update v2 available/i)).toBeInTheDocument()
    expect(screen.getByTestId('kit-seeding-pill-raft-storage-engines')).toHaveTextContent(
      'Seeding Pillar 2/4: Replication…',
    )
  })

  it('swaps Guide skeleton, sets X-Toolbox-Kit slug, gates Sidebar capabilities, and opens Archived Notes drawer on /k/:slug/guide', async () => {
    const rustKit = buildRustKit()
    apiMocks.kitsList.mockResolvedValue({ kits: [rustKit] })
    apiMocks.kitsGet.mockImplementation((slug: string) =>
      Promise.resolve({ kit: slug === 'distributed-rust' ? rustKit : null }),
    )

    await act(async () => {
      render(
        <MemoryRouter initialEntries={['/k/distributed-rust/guide/ownership/borrowing']}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/k/:slug/guide/:pillarId/:topicId" element={<GuidePage />} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
    })

    await waitFor(() => expect(screen.getAllByText('Borrow Rules').length).toBeGreaterThan(0))
    expect(getActiveKitSlugForRequest()).toBe('distributed-rust')
    expect(screen.getByText('Borrow Mechanics')).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /concept map/i })).toHaveAttribute('href', '/k/distributed-rust/canvas')
    expect(screen.queryByRole('link', { name: /calculator/i })).not.toBeInTheDocument()
    expect(document.getElementById('guide-calc-btn')).toBeNull()

    const drawer = await screen.findByTestId('archived-notes-drawer')
    expect(drawer).toHaveTextContent('Archived Notes (1)')
    fireEvent.click(screen.getByRole('button', { name: /archived notes \(1\)/i }))
    expect(await screen.findByText('Preserved retired Futures 0.1 notes')).toBeInTheDocument()
  })

  it('supports URL ingestion, interactive Pillar addition, and Chat Refine in NewKitStudioPage (/new)', async () => {
    const draftKit = makeTestKit({
      id: 'kit-raft-1',
      slug: 'raft-storage-engines',
      name: 'Raft & Storage Engines',
      status: 'seeding',
      mutateSkeleton: (s) => {
        s.pillars = s.pillars.slice(0, 1)
        s.bibliography = [{ title: 'Raft Extended Paper', url: 'https://raft.github.io/raft.pdf' }]
      },
    })
    compilerMocks.calibrate.mockResolvedValue({
      calibration: {
        suggestedTitle: draftKit.name,
        suggestedIcon: '⚓',
        suggestedDescription: draftKit.description,
        suggestedCapabilities: draftKit.capabilities,
        dimensions: [
          {
            id: 'goal',
            label: 'Primary Goal',
            question: 'What outcome matters most?',
            options: ['Deep mental models', 'Hands-on Rust engine build'],
            recommended: 'Deep mental models',
          },
        ],
      },
      stagedSources: [],
    })
    compilerMocks.compile.mockResolvedValue({
      skeleton: draftKit.skeleton,
      pool: {
        entries: [{ id: 'S1', kind: 'url' as const, title: 'Raft Extended Paper', url: 'https://raft.github.io/raft.pdf', note: 'URL', excerpt: 'Raft...' }],
        gapCheckQueries: [],
      },
      citedSourceIds: ['S1'],
      dagRepair: { initialCyclicSccCount: 0, llmRepairAttempted: false, tieBreakerDroppedCount: 0 },
      stagedSources: [],
    })
    compilerMocks.refine.mockImplementation((payload: { skeleton: KitSkeletonV1 }) =>
      Promise.resolve({
        skeleton: {
          ...payload.skeleton,
          identity: { ...payload.skeleton.identity, name: 'Raft, ReadIndex & LSM Engines' },
        },
        citedSourceIds: ['S1'],
        dagRepair: { initialCyclicSccCount: 0, llmRepairAttempted: false, tieBreakerDroppedCount: 0 },
      }),
    )
    compilerMocks.commit.mockResolvedValue({ kit: draftKit, jobId: 'job-1', committedSourceIds: ['src-1'] })

    render(
      <MemoryRouter initialEntries={['/new']}>
        <Routes>
          <Route path='/new' element={<NewKitStudioPage />} />
          <Route path='/k/:slug/guide' element={<div data-testid='dest-guide-view'>Arrived</div>} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.change(screen.getByTestId('studio-topic-input'), { target: { value: 'Raft Consensus' } })
    fireEvent.change(screen.getByTestId('studio-url-input'), { target: { value: 'https://raft.github.io/raft.pdf' } })
    fireEvent.click(screen.getByTestId('studio-add-url-btn'))
    expect(await screen.findByText(/\[S1\] Raft Extended Paper/i)).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('studio-calibrate-btn'))
    expect(await screen.findByText('What outcome matters most?')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('studio-compile-btn'))
    expect(await screen.findByTestId('studio-blueprint-editor')).toBeInTheDocument()
    expect(screen.getByText('Acyclic DAG Verified')).toBeInTheDocument()

    fireEvent.click(screen.getByTestId('studio-add-pillar-btn'))
    expect(screen.getByDisplayValue('New Pillar 2')).toBeInTheDocument()

    fireEvent.change(screen.getByTestId('studio-refine-input'), { target: { value: 'Add ReadIndex' } })
    fireEvent.click(screen.getByTestId('studio-refine-btn'))
    await waitFor(() => expect(screen.getByDisplayValue('Raft, ReadIndex & LSM Engines')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('studio-commit-btn'))
    expect(await screen.findByTestId('dest-guide-view')).toBeInTheDocument()
    expect(useKitStore.getState().activeKitSlug).toBe('raft-storage-engines')
  })
})
