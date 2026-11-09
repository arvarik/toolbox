import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit'
import CalculatorPage from '../pages/CalculatorPage'
import CalculatorModal from '../components/calculator/CalculatorModal'
import useCalcStore from '../stores/useCalcStore'
import useAppStore from '../stores/appStore'
import useKitStore, { type KitDetailItem } from '../stores/useKitStore'
import { defaultInputs } from '../utils/bote'

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el
}

function buildCustomKit(overrides: Partial<KitDetailItem['capabilities']> = {}): KitDetailItem {
  const skeleton = structuredClone(SYSTEM_DESIGN_KIT_SKELETON)
  skeleton.identity = {
    ...skeleton.identity,
    slug: 'quant-systems',
    name: 'Quant Systems',
  }
  skeleton.capabilities = {
    ...skeleton.capabilities,
    canvas: 'concept',
    calculator: true,
    ...overrides,
  }
  return {
    id: 'kit-quant-1',
    slug: 'quant-systems',
    name: 'Quant Systems',
    description: 'Low-latency trading infrastructure.',
    icon: '📈',
    color: '#10b981',
    status: 'ready',
    statusDetail: null,
    forkedFromSharedId: null,
    forkedVersion: 1,
    upstreamSlug: null,
    upstreamLatestVersion: null,
    hasUpstreamUpdate: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
    lastOpenedAt: null,
    pillarCount: skeleton.pillars.length,
    topicCount: 4,
    nodeCount: skeleton.graph.nodes.length,
    capabilities: skeleton.capabilities,
    deckCount: 0,
    cardCount: 0,
    dueCount: 0,
    newCount: 0,
    reviewedCount: 0,
    masteryPercent: 0,
    guideFilledCount: 0,
    guideTotalCount: 10,
    archivedNotesCount: 0,
    drillCount: 0,
    skeleton,
  }
}

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location-probe">{location.pathname}</div>
}

function renderPage() {
  return render(
    <MemoryRouter>
      <CalculatorPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useCalcStore.setState({ inputs: defaultInputs(), scenarioId: 'custom', latencyBudget: [] })
  useAppStore.setState({ calcModalOpen: false, toasts: [], nodes: [] })
  useKitStore.setState({
    kits: [],
    activeKitSlug: null,
    activeKit: null,
    kitCache: {},
    isLoadingList: false,
    isLoadingActive: false,
  })
})

describe('CalculatorPage', () => {
  it('renders all result groups with live values', () => {
    renderPage()
    expect(screen.getByText('BotE Calculator')).toBeInTheDocument()
    expect(screen.getByText('Avg Write QPS')).toBeInTheDocument()
    expect(screen.getByText('Ingestion Rate')).toBeInTheDocument()
    expect(screen.getByText(/Working-Set Cache/)).toBeInTheDocument()
    expect(screen.getByText('Ingress')).toBeInTheDocument()
    expect(screen.getByText('App Servers')).toBeInTheDocument()
    expect(screen.getByText('10.5')).toBeInTheDocument()
  })

  it('recalculates instantly when an input changes', () => {
    renderPage()
    const dauField = byId('calc-dau')
    fireEvent.change(dauField, { target: { value: '10000000' } })
    fireEvent.blur(dauField)
    expect(screen.getByText('105')).toBeInTheDocument()
  })

  it('shows zeros (not NaN) when DAU is zero', () => {
    renderPage()
    const dauField = byId('calc-dau')
    fireEvent.change(dauField, { target: { value: '0' } })
    fireEvent.blur(dauField)
    expect(document.body.textContent).not.toContain('NaN')
    expect(document.body.textContent).not.toContain('Infinity')
  })

  it('applies a scenario preset', () => {
    renderPage()
    fireEvent.click(byId('calc-scenario-url-shortener'))
    expect(useCalcStore.getState().scenarioId).toBe('url-shortener')
    expect(useCalcStore.getState().inputs.dau).toBe(10_000_000)
    expect(useCalcStore.getState().inputs.readRatio).toBe(100)
  })

  it('builds a latency budget from cheat-sheet clicks', () => {
    renderPage()
    fireEvent.click(byId('latency-az-rtt'))
    fireEvent.click(byId('latency-az-rtt'))
    fireEvent.click(byId('latency-nvme-read-4k'))
    expect(useCalcStore.getState().latencyBudget).toEqual([
      { id: 'az-rtt', count: 2 },
      { id: 'nvme-read-4k', count: 1 },
    ])
    expect(screen.getByText(/≈ 2.01 ms/)).toBeInTheDocument()
  })

  it('sanitizes garbage input instead of crashing', () => {
    renderPage()
    const dauField = byId('calc-dau')
    fireEvent.change(dauField, { target: { value: 'garbage' } })
    fireEvent.blur(dauField)
    expect(document.body.textContent).not.toContain('NaN')
  })

  it('suppresses CalculatorModal on /k/:slug/calculator and when capabilities.calculator is false, and routes full sandbox to /k/:slug/calculator', () => {
    const kit = buildCustomKit({ calculator: true })
    useKitStore.setState({
      kits: [kit],
      activeKitSlug: kit.slug,
      activeKit: kit,
      kitCache: { [kit.slug]: kit },
    })
    useAppStore.setState({ calcModalOpen: true })

    // Suppressed on /k/:slug/calculator
    const { unmount } = render(
      <MemoryRouter initialEntries={['/k/quant-systems/calculator']}>
        <Routes>
          <Route path="/k/:slug/calculator" element={<CalculatorModal />} />
        </Routes>
      </MemoryRouter>
    )
    expect(document.getElementById('calc-modal')).toBeNull()
    unmount()

    // Suppressed when capabilities.calculator === false
    const noCalcKit = buildCustomKit({ calculator: false })
    useKitStore.setState({
      kits: [noCalcKit],
      activeKitSlug: noCalcKit.slug,
      activeKit: noCalcKit,
      kitCache: { [noCalcKit.slug]: noCalcKit },
    })
    const disabledRender = render(
      <MemoryRouter initialEntries={['/k/quant-systems/chat']}>
        <Routes>
          <Route path="/k/:slug/chat" element={<CalculatorModal />} />
        </Routes>
      </MemoryRouter>
    )
    expect(document.getElementById('calc-modal')).toBeNull()
    disabledRender.unmount()

    // Active on /k/:slug/chat when calculator is enabled -> navigates to /k/:slug/calculator
    useKitStore.setState({
      kits: [kit],
      activeKitSlug: kit.slug,
      activeKit: kit,
      kitCache: { [kit.slug]: kit },
    })
    render(
      <MemoryRouter initialEntries={['/k/quant-systems/chat']}>
        <LocationProbe />
        <Routes>
          <Route path="/k/:slug/*" element={<CalculatorModal />} />
        </Routes>
      </MemoryRouter>
    )
    expect(byId('calc-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Open full sandbox'))
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/k/quant-systems/calculator')
  })

  it('routes ExportMenu actions with /k/:slug prefix and hides Canvas export when canvas capability is none', () => {
    const noCanvasKit = buildCustomKit({ canvas: 'none', calculator: true })
    useKitStore.setState({
      kits: [noCanvasKit],
      activeKitSlug: noCanvasKit.slug,
      activeKit: noCanvasKit,
      kitCache: { [noCanvasKit.slug]: noCanvasKit },
    })

    render(
      <MemoryRouter initialEntries={['/k/quant-systems/calculator']}>
        <LocationProbe />
        <Routes>
          <Route path="/k/:slug/*" element={<CalculatorPage />} />
        </Routes>
      </MemoryRouter>
    )

    fireEvent.click(byId('calc-export-btn'))
    expect(document.getElementById('calc-export-canvas-btn')).toBeNull()

    fireEvent.click(screen.getByRole('menuitem', { name: /Send to Chat/i }))
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/k/quant-systems/chat')
  })
})
