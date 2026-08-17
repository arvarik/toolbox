import { useState } from 'react'
import { Plus, Minus, Trash2, Clock3, Binary, ListPlus } from 'lucide-react'
import useCalcStore from '../../stores/useCalcStore'
import {
  LATENCY_NUMBERS,
  POWERS_OF_TWO,
  HANDY_CONSTANTS,
  formatLatency,
  sumLatencyBudget,
} from '../../utils/bote'

const TIER_COLORS = {
  cpu: 'var(--color-accent)',
  memory: 'var(--color-teal)',
  disk: 'var(--color-warning)',
  network: 'var(--color-info)',
}

/** Reference SLOs the budget total is compared against. */
const BUDGET_MARKS = [
  { label: 'Instant (100 ms)', ns: 100e6 },
  { label: 'Typical API SLO (200 ms)', ns: 200e6 },
  { label: 'Patience limit (1 s)', ns: 1e9 },
]

/**
 * The interactive latency cheat sheet. Clicking a row adds that constant
 * to the Latency Budget composer — the "click-to-apply" mechanic that
 * lets users assemble an end-to-end latency estimate for a request path.
 */
export default function LatencyReference() {
  const [tab, setTab] = useState('latency')
  const latencyBudget = useCalcStore((s) => s.latencyBudget)
  const addLatencyItem = useCalcStore((s) => s.addLatencyItem)
  const setLatencyCount = useCalcStore((s) => s.setLatencyCount)
  const clearLatencyBudget = useCalcStore((s) => s.clearLatencyBudget)

  const totalNs = sumLatencyBudget(latencyBudget)
  const sloMark = BUDGET_MARKS[1]
  const budgetShare = Math.min(1, totalNs / sloMark.ns)

  return (
    <div className="latency-reference" id="latency-reference">
      <div className="latency-tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === 'latency'}
          className={`latency-tab${tab === 'latency' ? ' active' : ''}`}
          onClick={() => setTab('latency')}
        >
          <Clock3 size={13} /> Latency Numbers
        </button>
        <button
          role="tab"
          aria-selected={tab === 'powers'}
          className={`latency-tab${tab === 'powers' ? ' active' : ''}`}
          onClick={() => setTab('powers')}
        >
          <Binary size={13} /> Powers of Two
        </button>
      </div>

      <div className="latency-panels">
        {tab === 'latency' && (
          <div className="latency-table" role="list">
            <div className="latency-table-hint">
              Click a row to add it to the latency budget →
            </div>
            {LATENCY_NUMBERS.map((row) => (
              <button
                key={row.id}
                role="listitem"
                className="latency-row"
                onClick={() => addLatencyItem(row.id)}
                title={`Add "${row.label}" to the latency budget`}
                id={`latency-${row.id}`}
              >
                <span className="latency-dot" style={{ background: TIER_COLORS[row.tier] }} />
                <span className="latency-label">{row.label}</span>
                <span className="latency-bar-track">
                  {/* log-scale bar: 0.5 ns → 150 ms spans ~8.5 orders of magnitude */}
                  <span
                    className="latency-bar"
                    style={{
                      width: `${Math.max(2, (Math.log10(row.ns / 0.5) / Math.log10(150e6 / 0.5)) * 100)}%`,
                      background: TIER_COLORS[row.tier],
                    }}
                  />
                </span>
                <span className="latency-value">{formatLatency(row.ns)}</span>
                <ListPlus size={13} className="latency-add-icon" />
              </button>
            ))}
          </div>
        )}

        {tab === 'powers' && (
          <div className="powers-grid">
            <table className="powers-table">
              <thead>
                <tr><th>Power</th><th>Approx</th><th>Exact</th><th>Unit</th></tr>
              </thead>
              <tbody>
                {POWERS_OF_TWO.map((row) => (
                  <tr key={row.power}>
                    <td className="mono">2^{row.power}</td>
                    <td>{row.approx}</td>
                    <td className="mono">{row.exact}</td>
                    <td>{row.unit}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="handy-constants">
              {HANDY_CONSTANTS.map((c) => (
                <div key={c.label} className="handy-constant">
                  <span>{c.label}</span>
                  <span className="mono">{c.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Budget composer */}
        <div className="latency-budget" id="latency-budget">
          <div className="latency-budget-head">
            <span className="calc-group-title" style={{ margin: 0 }}>Latency Budget</span>
            {latencyBudget.length > 0 && (
              <button className="btn btn-ghost btn-sm" onClick={clearLatencyBudget} title="Clear budget">
                <Trash2 size={12} /> Clear
              </button>
            )}
          </div>

          {latencyBudget.length === 0 ? (
            <p className="latency-budget-empty">
              Compose a request path: click latency rows to stack them up.
              Example: 1 cross-AZ round trip + 2 NVMe reads + 1 RAM pass.
            </p>
          ) : (
            <>
              {latencyBudget.map((item) => {
                const ref = LATENCY_NUMBERS.find((l) => l.id === item.id)
                if (!ref) return null
                return (
                  <div key={item.id} className="latency-budget-item">
                    <div className="latency-budget-stepper">
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setLatencyCount(item.id, item.count - 1)}
                        aria-label={`Remove one ${ref.label}`}
                      >
                        <Minus size={12} />
                      </button>
                      <span className="latency-budget-count">{item.count}×</span>
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={() => setLatencyCount(item.id, item.count + 1)}
                        aria-label={`Add one ${ref.label}`}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span className="latency-budget-label">{ref.label}</span>
                    <span className="latency-value">{formatLatency(ref.ns * item.count)}</span>
                  </div>
                )
              })}
              <div className="latency-budget-total">
                <span>Total</span>
                <span className="latency-budget-total-value">≈ {formatLatency(totalNs)}</span>
              </div>
              <div className="latency-budget-slo">
                <div className="latency-budget-slo-track">
                  <div
                    className="latency-budget-slo-fill"
                    style={{
                      width: `${budgetShare * 100}%`,
                      background: totalNs > sloMark.ns ? 'var(--color-error)' : 'var(--color-success)',
                    }}
                  />
                </div>
                <span className="latency-budget-slo-label">
                  {totalNs > sloMark.ns
                    ? `Over the ${sloMark.label.toLowerCase()}`
                    : `${Math.round(budgetShare * 100)}% of the ${sloMark.label.toLowerCase()}`}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
