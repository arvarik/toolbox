import { useMemo, useState } from 'react'
import { RotateCcw, ChevronDown, Sigma } from 'lucide-react'
import useCalcStore from '../../stores/useCalcStore'
import {
  BOTE_INPUT_DEFS,
  SCENARIOS,
  computeEstimates,
  formatCount,
  formatBytes,
  formatBytesPerSec,
  formatBitrate,
  CACHE_NODE_RAM_GB,
} from '../../utils/bote'
import LatencyReference from './LatencyReference'
import AuditPanel from './AuditPanel'
import ExportMenu from './ExportMenu'

const SLIDER_STEPS = 200

/** Map a raw value to a slider position (log-aware). */
function valueToSlider(def, value) {
  if (!def.log) {
    return ((value - def.min) / (def.max - def.min)) * SLIDER_STEPS
  }
  const lo = def.logFloor ?? 1
  if (value < lo) return 0
  const p = Math.log(value / lo) / Math.log(def.max / lo)
  return Math.max(0, Math.min(1, p)) * SLIDER_STEPS
}

/** Map a slider position back to a value, rounded to friendly numbers. */
function sliderToValue(def, pos) {
  const p = pos / SLIDER_STEPS
  if (!def.log) {
    const raw = def.min + p * (def.max - def.min)
    return roundNice(raw)
  }
  if (p <= 0) return def.min
  const lo = def.logFloor ?? 1
  return roundNice(lo * Math.pow(def.max / lo, p))
}

function roundNice(v) {
  if (v >= 100) {
    const mag = Math.pow(10, Math.floor(Math.log10(v)) - 1)
    return Math.round(v / mag) * mag
  }
  if (v >= 10) return Math.round(v)
  return Math.round(v * 10) / 10
}

/** One labeled input with a numeric field plus a (log) slider. */
function InputRow({ def, value, onChange }) {
  const [draft, setDraft] = useState(null)

  const commitDraft = () => {
    if (draft !== null) {
      onChange(def.key, draft)
      setDraft(null)
    }
  }

  return (
    <div className="calc-input-row" title={def.help}>
      <div className="calc-input-head">
        <label className="calc-input-label" htmlFor={`calc-${def.key}`}>{def.label}</label>
        <div className="calc-input-value">
          <input
            id={`calc-${def.key}`}
            className="calc-input-field"
            type="number"
            inputMode="decimal"
            min={def.min}
            max={def.max}
            value={draft !== null ? draft : value}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => { if (e.key === 'Enter') commitDraft() }}
          />
          <span className="calc-input-unit">{def.unit}</span>
        </div>
      </div>
      <div className="calc-slider-row">
        <input
          type="range"
          className="calc-slider"
          min={0}
          max={SLIDER_STEPS}
          value={valueToSlider(def, value)}
          onChange={(e) => onChange(def.key, sliderToValue(def, Number(e.target.value)))}
          aria-label={def.label}
        />
        {value >= 1000 && <span className="calc-slider-echo">{formatCount(value)}</span>}
      </div>
    </div>
  )
}

/** One result metric: value, label, and the formula that produced it. */
function Stat({ label, value, formula, hint, accent }) {
  return (
    <div className={`calc-stat${accent ? ' accent' : ''}`} title={hint || ''}>
      <div className="calc-stat-label">{label}</div>
      <div className="calc-stat-value">{value}</div>
      {formula && <div className="calc-stat-formula">{formula}</div>}
    </div>
  )
}

/**
 * The Back-of-the-Envelope sandbox: inputs on the left, live results on
 * the right, latency reference and AI audit below. Used by both the full
 * /calculator page and the global quick-access modal (`compact`).
 */
export default function CalculatorSandbox({ compact = false }) {
  const inputs = useCalcStore((s) => s.inputs)
  const scenarioId = useCalcStore((s) => s.scenarioId)
  const setInput = useCalcStore((s) => s.setInput)
  const applyScenario = useCalcStore((s) => s.applyScenario)
  const reset = useCalcStore((s) => s.reset)
  const latencyBudget = useCalcStore((s) => s.latencyBudget)

  const [advancedOpen, setAdvancedOpen] = useState(false)

  const est = useMemo(() => computeEstimates(inputs), [inputs])
  const scenario = SCENARIOS.find((s) => s.id === scenarioId) || SCENARIOS[0]

  const grouped = useMemo(() => ({
    traffic: BOTE_INPUT_DEFS.filter((d) => d.group === 'traffic'),
    data: BOTE_INPUT_DEFS.filter((d) => d.group === 'data'),
    advanced: BOTE_INPUT_DEFS.filter((d) => d.group === 'advanced'),
  }), [])

  const i = est.inputs

  return (
    <div className={`calc-sandbox${compact ? ' compact' : ''}`} id="calc-sandbox">
      {/* Scenario presets + actions */}
      <div className="calc-toolbar">
        <div className="calc-scenarios" role="group" aria-label="Scenario presets">
          {SCENARIOS.map((sc) => (
            <button
              key={sc.id}
              className={`calc-scenario-chip${sc.id === scenarioId ? ' active' : ''}`}
              onClick={() => applyScenario(sc.id)}
              title={sc.description}
              id={`calc-scenario-${sc.id}`}
            >
              <span aria-hidden="true">{sc.emoji}</span> {sc.name}
            </button>
          ))}
        </div>
        <div className="calc-actions">
          <button className="btn btn-ghost btn-sm" onClick={reset} title="Reset all inputs to defaults">
            <RotateCcw size={13} /> Reset
          </button>
          <ExportMenu results={est} scenario={scenario} latencyBudget={latencyBudget} />
        </div>
      </div>

      <div className="calc-body">
        {/* ── Inputs ── */}
        <div className="calc-inputs">
          <div className="calc-section-title">Traffic Shape</div>
          {grouped.traffic.map((def) => (
            <InputRow key={def.key} def={def} value={inputs[def.key]} onChange={setInput} />
          ))}

          <div className="calc-section-title">Data & Durability</div>
          {grouped.data.map((def) => (
            <InputRow key={def.key} def={def} value={inputs[def.key]} onChange={setInput} />
          ))}

          <button
            className="calc-advanced-toggle"
            onClick={() => setAdvancedOpen(!advancedOpen)}
            aria-expanded={advancedOpen}
            id="calc-advanced-toggle"
          >
            <ChevronDown size={14} style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--duration-fast)' }} />
            Advanced assumptions
          </button>
          {advancedOpen && grouped.advanced.map((def) => (
            <InputRow key={def.key} def={def} value={inputs[def.key]} onChange={setInput} />
          ))}
        </div>

        {/* ── Results ── */}
        <div className="calc-results" aria-live="polite">
          <div className="calc-group">
            <div className="calc-group-title">Traffic</div>
            <div className="calc-group-grid">
              <Stat
                label="Avg Write QPS"
                value={formatCount(est.avgWriteQps)}
                formula={`${formatCount(i.dau)} × ${formatCount(i.requestsPerUser)} ÷ 86,400 ÷ (${formatCount(i.readRatio)}+1)`}
                hint="Write QPS drives database write capacity and WAL/commit throughput."
              />
              <Stat
                label="Avg Read QPS"
                value={formatCount(est.avgReadQps)}
                formula={`write QPS × ${formatCount(i.readRatio)}`}
                hint="Read QPS decides your caching strategy and replica count."
              />
              <Stat
                label={`Peak QPS (${i.peakMultiplier}×)`}
                value={formatCount(est.peakTotalQps)}
                formula={`(${formatCount(est.avgTotalQps)} avg) × ${i.peakMultiplier}`}
                hint="Size load balancers and autoscaling for peak, not average."
                accent
              />
            </div>
          </div>

          <div className="calc-group">
            <div className="calc-group-title">Storage</div>
            <div className="calc-group-grid">
              <Stat
                label="Ingestion Rate"
                value={formatBytesPerSec(est.ingestRateBytesPerSec)}
                formula={`${formatCount(est.writesPerDay)} writes/day × ${formatBytes(est.avgTransferBytes)}`}
                hint="Sustained write bandwidth your storage tier must absorb."
              />
              <Stat
                label="Storage / Day"
                value={formatBytes(est.ingestPerDayBytes)}
                formula="writes/day × avg size"
              />
              <Stat
                label="Storage / Year"
                value={formatBytes(est.storagePerYearBytes)}
                formula="daily × 365 (raw, 1 copy)"
              />
              <Stat
                label={`${i.retentionYears}-Year × ${i.replicationFactor} Replicas`}
                value={formatBytes(est.replicatedRetainedBytes)}
                formula={`year × ${i.retentionYears} × ${i.replicationFactor}${i.overheadPercent > 0 ? ` × ${(1 + i.overheadPercent / 100).toFixed(2)} overhead` : ''}`}
                hint="The number to say out loud in the interview."
                accent
              />
            </div>
          </div>

          <div className="calc-group">
            <div className="calc-group-title">Cache & Memory</div>
            <div className="calc-group-grid">
              <Stat
                label={`Working-Set Cache (${i.cachePercent}%)`}
                value={formatBytes(est.cacheBytes)}
                formula={`${i.cachePercent}% × ${formatBytes(est.dailyReadVolumeBytes)} daily reads`}
                hint="RAM for the Redis/Memcached tier under the 80/20 rule."
                accent
              />
              <Stat
                label="Cache Nodes"
                value={`≈ ${formatCount(est.cacheNodes)}`}
                formula={`÷ ${CACHE_NODE_RAM_GB} GB nodes @ 75% usable`}
              />
            </div>
          </div>

          <div className="calc-group">
            <div className="calc-group-title">Bandwidth (peak)</div>
            <div className="calc-group-grid">
              <Stat
                label="Ingress"
                value={formatBitrate(est.ingressBps)}
                formula={`${formatCount(est.peakWriteQps)} write QPS × ${formatBytes(est.avgTransferBytes)} × 8`}
              />
              <Stat
                label="Egress"
                value={formatBitrate(est.egressBps)}
                formula={`${formatCount(est.peakReadQps)} read QPS × ${formatBytes(est.avgTransferBytes)} × 8`}
                hint="Media-heavy egress usually moves to a CDN — the audit will flag it."
              />
            </div>
          </div>

          <div className="calc-group">
            <div className="calc-group-title">Hardware</div>
            <div className="calc-group-grid">
              <Stat
                label="App Servers"
                value={`≈ ${formatCount(est.appServers)}`}
                formula={`${formatCount(est.peakTotalQps)} peak ÷ (${formatCount(i.qpsPerServer)} × ${i.utilizationPercent}%)`}
                hint="Peak QPS over per-node capacity at target CPU saturation."
                accent
              />
              <Stat
                label="DB Shards"
                value={`≈ ${formatCount(est.dbShards)}`}
                formula={`${formatBytes(est.rawRetainedBytes)} ÷ ${i.storagePerShardTB} TB/shard`}
              />
            </div>
          </div>

          <AuditPanel estimates={est} scenario={scenario} />
        </div>
      </div>

      {/* ── Reference: latency sheet, powers of two, budget composer ── */}
      {!compact && (
        <div className="calc-reference-wrap">
          <div className="calc-section-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Sigma size={14} /> Numbers Every Engineer Should Know
          </div>
          <LatencyReference />
        </div>
      )}
    </div>
  )
}
