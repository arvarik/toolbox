import { useNavigate } from 'react-router-dom'
import {
  ShieldCheck, AlertOctagon, AlertTriangle, Info, CheckCircle2,
  MessageSquare
} from 'lucide-react'
import Modal from '../shared/Modal'

const SEVERITY_CONFIG = {
  critical: {
    label: 'Critical',
    icon: AlertOctagon,
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.1)',
    border: 'rgba(239, 68, 68, 0.25)',
  },
  warning: {
    label: 'Warning',
    icon: AlertTriangle,
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.1)',
    border: 'rgba(245, 158, 11, 0.25)',
  },
  info: {
    label: 'Suggestion',
    icon: Info,
    color: '#60a5fa',
    bg: 'rgba(96, 165, 250, 0.1)',
    border: 'rgba(96, 165, 250, 0.25)',
  },
}

export default function ArchitectureAuditModal({ open, onClose, audit }) {
  const navigate = useNavigate()

  if (!open || !audit) return null

  const { score, rating, color, findings, passes, stats } = audit

  const handleConsultAi = () => {
    try {
      const findingSummaries = findings.map(
        (f) => `• [${f.severity.toUpperCase()}] ${f.title}: ${f.message}\n  Recommendation: ${f.recommendation}`
      ).join('\n\n')

      sessionStorage.setItem(
        'toolbox_chat_draft',
        `I ran the Architecture Linter on my system design whiteboard. My Architecture Health Score is ${score}/100 (${rating}).\n\nHere are the findings:\n${findingSummaries || 'No critical issues found.'}\n\nPlease review these tradeoffs and suggest concrete architectural patterns to improve resilience.`
      )
      window.dispatchEvent(new CustomEvent('toolbox-chat-draft'))
      onClose()
      navigate('/chat')
    } catch {
      onClose()
      navigate('/chat')
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Architecture Audit & Linter">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {/* Score Banner */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: 'var(--space-4) var(--space-5)',
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-lg)',
          border: '1px solid var(--color-border)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
            <div style={{
              width: 54,
              height: 54,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: `${color}15`,
              border: `2px solid ${color}`,
              color: color,
              fontSize: 'var(--text-lg)',
              fontWeight: 800,
            }}>
              {score}
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                {rating}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                {stats.totalNodes} components · {stats.totalEdges} data edges
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
            {stats.criticalCount > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444'
              }}>
                {stats.criticalCount} Critical
              </span>
            )}
            {stats.warningCount > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'rgba(245, 158, 11, 0.15)', color: '#f59e0b'
              }}>
                {stats.warningCount} Warnings
              </span>
            )}
            {stats.infoCount > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)', fontWeight: 700, padding: '3px 8px', borderRadius: 'var(--radius-full)',
                background: 'rgba(96, 165, 250, 0.15)', color: '#60a5fa'
              }}>
                {stats.infoCount} Suggestions
              </span>
            )}
          </div>
        </div>

        {/* Findings List */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxHeight: 320, overflowY: 'auto' }}>
          {findings.length === 0 && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(34, 197, 94, 0.1)',
              border: '1px solid rgba(34, 197, 94, 0.25)',
              color: 'var(--color-success)',
            }}>
              <ShieldCheck size={20} />
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                Clean architecture! No critical antipatterns or single points of failure detected.
              </div>
            </div>
          )}

          {findings.map((f) => {
            const meta = SEVERITY_CONFIG[f.severity] || SEVERITY_CONFIG.info
            const IconComponent = meta.icon

            return (
              <div
                key={f.id}
                style={{
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-md)',
                  background: meta.bg,
                  border: `1px solid ${meta.border}`,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <IconComponent size={16} color={meta.color} />
                    <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                      {f.title}
                    </span>
                  </div>
                  <span style={{
                    fontSize: '10px',
                    fontWeight: 800,
                    textTransform: 'uppercase',
                    color: meta.color,
                    letterSpacing: '0.05em',
                  }}>
                    {meta.label}
                  </span>
                </div>

                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                  {f.message}
                </div>

                <div style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-primary)',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'var(--space-1)',
                  background: 'rgba(255, 255, 255, 0.03)',
                  padding: '6px 10px',
                  borderRadius: 'var(--radius-sm)',
                }}>
                  <span style={{ color: meta.color, fontWeight: 700 }}>Fix:</span>
                  <span>{f.recommendation}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Passed Best Practices */}
        {passes.length > 0 && (
          <div>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 'var(--space-2)' }}>
              Verified Best Practices ({passes.length})
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {passes.map((p, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: 'var(--color-success)' }}>
                  <CheckCircle2 size={13} style={{ flexShrink: 0 }} />
                  <span>{p}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingTop: 'var(--space-4)',
          borderTop: '1px solid var(--color-border)',
        }}>
          <button className="btn btn-secondary btn-sm" onClick={onClose}>
            Close
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={handleConsultAi}
            id="audit-consult-ai-btn"
          >
            <MessageSquare size={14} /> Consult AI on Architecture
          </button>
        </div>
      </div>
    </Modal>
  )
}
