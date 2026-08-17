import { useState } from 'react'
import { ShieldCheck, ShieldAlert, Sparkles, Loader2, AlertTriangle, Info, AlertOctagon } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import { calculatorApi } from '../../utils/api'
import {
  formatCount,
  formatBytes,
  formatBytesPerSec,
  formatBitrate,
} from '../../utils/bote'

const SEVERITY_META = {
  critical: { icon: AlertOctagon, color: 'var(--color-error)', bg: 'var(--color-error-subtle)' },
  warning: { icon: AlertTriangle, color: 'var(--color-warning)', bg: 'var(--color-warning-subtle)' },
  info: { icon: Info, color: 'var(--color-info)', bg: 'var(--color-info-subtle)' },
}

/**
 * "Audit My Math" — sends the current inputs and computed results to the
 * AI and renders a structured critique: verdict, ranked findings, and
 * real-world factors the estimate omits.
 */
export default function AuditPanel({ estimates, scenario }) {
  const selectedModel = useAppStore((s) => s.model)
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const addToast = useAppStore((s) => s.addToast)

  const [isAuditing, setIsAuditing] = useState(false)
  const [audit, setAudit] = useState(null)

  const runAudit = async () => {
    if (isAuditing) return
    setIsAuditing(true)
    setAudit(null)
    try {
      const result = await calculatorApi.audit({
        scenario: { id: scenario.id, name: scenario.name, description: scenario.description },
        inputs: estimates.inputs,
        results: {
          avgWriteQps: formatCount(estimates.avgWriteQps),
          avgReadQps: formatCount(estimates.avgReadQps),
          peakTotalQps: formatCount(estimates.peakTotalQps),
          ingestionRate: formatBytesPerSec(estimates.ingestRateBytesPerSec),
          storagePerYear: formatBytes(estimates.storagePerYearBytes),
          retainedWithReplication: formatBytes(estimates.replicatedRetainedBytes),
          workingSetCache: formatBytes(estimates.cacheBytes),
          cacheNodes: estimates.cacheNodes,
          peakIngress: formatBitrate(estimates.ingressBps),
          peakEgress: formatBitrate(estimates.egressBps),
          appServers: estimates.appServers,
          dbShards: estimates.dbShards,
        },
        model: selectedModel,
      })
      setAudit(result)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Audit failed. Check your AI settings.' })
    } finally {
      setIsAuditing(false)
    }
  }

  return (
    <div className="calc-audit" id="calc-audit">
      <div className="calc-audit-head">
        <div className="calc-group-title" style={{ margin: 0 }}>AI Sanity Check</div>
        <button
          className="btn btn-primary btn-sm"
          onClick={runAudit}
          disabled={isAuditing || !apiKeyConfigured}
          title={apiKeyConfigured ? `Audit this estimate against "${scenario.name}"` : 'Configure an AI API key in Settings first'}
          id="calc-audit-btn"
        >
          {isAuditing ? <Loader2 size={14} className="spin" /> : <Sparkles size={14} />}
          {isAuditing ? 'Auditing…' : 'Audit My Math'}
        </button>
      </div>

      {!audit && !isAuditing && (
        <p className="calc-audit-empty">
          One click sends your assumptions and results to the AI, which checks them against
          the <strong>{scenario.name}</strong> scenario for omitted real-world factors —
          index overhead, compression, replication lag buffers, CDN offload, and more.
        </p>
      )}

      {audit && (
        <div className="calc-audit-result">
          <div className={`calc-audit-verdict ${audit.verdict}`}>
            {audit.verdict === 'sound'
              ? <ShieldCheck size={16} />
              : <ShieldAlert size={16} />}
            <span>{audit.verdict === 'sound' ? 'Estimate holds up' : 'Worth revisiting'}</span>
          </div>
          <p className="calc-audit-summary">{audit.summary}</p>

          {audit.findings?.length > 0 && (
            <div className="calc-audit-findings">
              {audit.findings.map((f, idx) => {
                const meta = SEVERITY_META[f.severity] || SEVERITY_META.info
                const Icon = meta.icon
                return (
                  <div key={idx} className="calc-audit-finding" style={{ background: meta.bg }}>
                    <div className="calc-audit-finding-head" style={{ color: meta.color }}>
                      <Icon size={13} />
                      <span className="calc-audit-area">{f.area}</span>
                      <span className="calc-audit-severity">{f.severity}</span>
                    </div>
                    <div className="calc-audit-finding-body">{f.finding}</div>
                    <div className="calc-audit-finding-fix">→ {f.suggestion}</div>
                  </div>
                )
              })}
            </div>
          )}

          {audit.omittedFactors?.length > 0 && (
            <div className="calc-audit-omitted">
              <div className="calc-audit-omitted-title">Factors this estimate ignores</div>
              <ul>
                {audit.omittedFactors.map((factor, idx) => (
                  <li key={idx}>{factor}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
