import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import CalculatorPage from '../pages/CalculatorPage'
import useCalcStore from '../stores/useCalcStore'
import { defaultInputs } from '../utils/bote'

function renderPage() {
  return render(
    <MemoryRouter>
      <CalculatorPage />
    </MemoryRouter>
  )
}

beforeEach(() => {
  useCalcStore.setState({ inputs: defaultInputs(), scenarioId: 'custom', latencyBudget: [] })
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
    // Reference default: 1M DAU × 10 req ÷ 86,400 ÷ 11 ≈ 10.5 write QPS
    expect(screen.getByText('10.5')).toBeInTheDocument()
  })

  it('recalculates instantly when an input changes', () => {
    renderPage()
    const dauField = document.getElementById('calc-dau')
    fireEvent.change(dauField, { target: { value: '10000000' } })
    fireEvent.blur(dauField)
    // 10× the DAU → 10× the write QPS
    expect(screen.getByText('105')).toBeInTheDocument()
  })

  it('shows zeros (not NaN) when DAU is zero', () => {
    renderPage()
    const dauField = document.getElementById('calc-dau')
    fireEvent.change(dauField, { target: { value: '0' } })
    fireEvent.blur(dauField)
    expect(document.body.textContent).not.toContain('NaN')
    expect(document.body.textContent).not.toContain('Infinity')
  })

  it('applies a scenario preset', () => {
    renderPage()
    fireEvent.click(document.getElementById('calc-scenario-url-shortener'))
    expect(useCalcStore.getState().scenarioId).toBe('url-shortener')
    expect(useCalcStore.getState().inputs.dau).toBe(10_000_000)
    expect(useCalcStore.getState().inputs.readRatio).toBe(100)
  })

  it('builds a latency budget from cheat-sheet clicks', () => {
    renderPage()
    fireEvent.click(document.getElementById('latency-az-rtt'))
    fireEvent.click(document.getElementById('latency-az-rtt'))
    fireEvent.click(document.getElementById('latency-nvme-read-4k'))
    const budget = useCalcStore.getState().latencyBudget
    expect(budget).toEqual([
      { id: 'az-rtt', count: 2 },
      { id: 'nvme-read-4k', count: 1 },
    ])
    // 2 × 1 ms + 10 µs ≈ 2.01 ms
    expect(screen.getByText(/≈ 2.01 ms/)).toBeInTheDocument()
  })

  it('sanitizes garbage input instead of crashing', () => {
    renderPage()
    const dauField = document.getElementById('calc-dau')
    fireEvent.change(dauField, { target: { value: 'garbage' } })
    fireEvent.blur(dauField)
    expect(document.body.textContent).not.toContain('NaN')
  })
})
