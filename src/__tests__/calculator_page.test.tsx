import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import CalculatorPage from '../pages/CalculatorPage'
import CalculatorModal from '../components/calculator/CalculatorModal'
import useCalcStore from '../stores/useCalcStore'
import useAppStore from '../stores/appStore'
import { defaultInputs } from '../utils/bote'
import { makeTestKit, resetKitStore } from './testHelpers'

function byId(id: string): HTMLElement {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing #${id}`)
  return el
}

function LocationProbe() {
  return <div data-testid="location-probe">{useLocation().pathname}</div>
}

beforeEach(() => {
  useCalcStore.setState({ inputs: defaultInputs(), scenarioId: 'custom', latencyBudget: [] })
  useAppStore.setState({ calcModalOpen: false, toasts: [], nodes: [] })
  resetKitStore()
})

describe('CalculatorPage & CalculatorModal', () => {
  it('builds a latency budget from cheat-sheet clicks and guards zero/garbage DAU against NaN/Infinity', () => {
    render(
      <MemoryRouter>
        <CalculatorPage />
      </MemoryRouter>,
    )

    fireEvent.click(byId('latency-az-rtt'))
    fireEvent.click(byId('latency-az-rtt'))
    fireEvent.click(byId('latency-nvme-read-4k'))
    expect(useCalcStore.getState().latencyBudget).toEqual([
      { id: 'az-rtt', count: 2 },
      { id: 'nvme-read-4k', count: 1 },
    ])
    expect(screen.getByText(/≈ 2.01 ms/)).toBeInTheDocument()

    const dauField = byId('calc-dau')
    for (const bad of ['0', 'garbage']) {
      fireEvent.change(dauField, { target: { value: bad } })
      fireEvent.blur(dauField)
      expect(document.body.textContent).not.toContain('NaN')
      expect(document.body.textContent).not.toContain('Infinity')
    }
  })

  it('suppresses CalculatorModal on /k/:slug/calculator or when calculator=false, and routes sandbox to /k/:slug/calculator', () => {
    const kit = makeTestKit({ slug: 'quant-systems', name: 'Quant Systems', capabilities: { canvas: 'concept', calculator: true } })
    resetKitStore(kit)
    useAppStore.setState({ calcModalOpen: true })

    const onCalcRoute = render(
      <MemoryRouter initialEntries={['/k/quant-systems/calculator']}>
        <Routes>
          <Route path="/k/:slug/calculator" element={<CalculatorModal />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(document.getElementById('calc-modal')).toBeNull()
    onCalcRoute.unmount()

    resetKitStore(makeTestKit({ slug: 'quant-systems', capabilities: { calculator: false } }))
    const disabledRender = render(
      <MemoryRouter initialEntries={['/k/quant-systems/chat']}>
        <Routes>
          <Route path="/k/:slug/chat" element={<CalculatorModal />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(document.getElementById('calc-modal')).toBeNull()
    disabledRender.unmount()

    resetKitStore(kit)
    render(
      <MemoryRouter initialEntries={['/k/quant-systems/chat']}>
        <LocationProbe />
        <Routes>
          <Route path="/k/:slug/*" element={<CalculatorModal />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(byId('calc-modal')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Open full sandbox'))
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/k/quant-systems/calculator')
  })

  it('routes ExportMenu actions with /k/:slug prefix and hides Canvas export when canvas=none', () => {
    resetKitStore(makeTestKit({ slug: 'quant-systems', capabilities: { canvas: 'none', calculator: true } }))

    render(
      <MemoryRouter initialEntries={['/k/quant-systems/calculator']}>
        <LocationProbe />
        <Routes>
          <Route path="/k/:slug/*" element={<CalculatorPage />} />
        </Routes>
      </MemoryRouter>,
    )

    fireEvent.click(byId('calc-export-btn'))
    expect(document.getElementById('calc-export-canvas-btn')).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: /Send to Chat/i }))
    expect(screen.getByTestId('location-probe')).toHaveTextContent('/k/quant-systems/chat')
  })
})
