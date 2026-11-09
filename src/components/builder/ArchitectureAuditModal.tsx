import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  ShieldCheck, AlertOctagon, AlertTriangle, Info, CheckCircle2,
  MessageSquare, Sparkles, RefreshCw,
  type LucideIcon,
} from 'lucide-react'
import Modal from '../shared/Modal'
import RubricFeedbackCard from '../drills/RubricFeedbackCard'
import useAppStore from '../../stores/appStore'
import { useKitRoutePrefix } from '../../stores/useKitStore'
import { canvasCritiqueApi, type CanvasCritiqueResult } from '../../utils/pedagogyApi'
import type { AuditReport, AuditSeverity } from '../../utils/architectureLinter'
import type { PersistedBoardData } from './boardModel'

interface SeverityMeta {
  label: string
  icon: LucideIcon
  color: string
  bg: string
  border: string
}

const SEVERITY_CONFIG: Record<AuditSeverity, SeverityMeta> = {
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

export interface ArchitectureAuditModalProps {
  open: boolean
  onClose: () => void
  audit: AuditReport | null
  mode?: 'architecture' | 'concept'
  boardId: string | null
  onEnsureSavedBoard?: () => Promise<string | null>
  boardData?: PersistedBoardData
}

export default function ArchitectureAuditModal({
  open,
  onClose,
  audit,
  mode = 'architecture',
  boardId,
  onEnsureSavedBoard,
  boardData,
}: ArchitectureAuditModalProps) {
  const navigate = useNavigate()
  const prefix = useKitRoutePrefix()
  const model = useAppStore((s) => s.model)
  const isConcept = mode === 'concept'

  const [critiqueGoal, setCritiqueGoal] = useState('')
  const [critiqueLoading, setCritiqueLoading] = useState(false)
  const [critiqueError, setCritiqueError] = useState('')
  const [critiqueResult, setCritiqueResult] = useState<CanvasCritiqueResult | null>(null)
  const prevBoardIdRef = useRef<string | null>(boardId)

  useEffect(() => {
    const prev = prevBoardIdRef.current
    prevBoardIdRef.current = boardId
    // Preserve critique result when a local-* board is promoted to its saved server ID
    const promotedFromLocal =
      prev &&
      String(prev).startsWith('local-') &&
      boardId &&
      !String(boardId).startsWith('local-')
    if (!promotedFromLocal && prev !== boardId) {
      setCritiqueResult(null)
      setCritiqueError('')
    }
  }, [boardId])

  useEffect(() => {
    setCritiqueResult(null)
    setCritiqueError('')
  }, [mode])

  if (!open || !audit) return null

  const { score, rating, color, findings, passes, stats } = audit

  const handleRunAiCritique = async () => {
    if (critiqueLoading) return
    setCritiqueLoading(true)
    setCritiqueError('')
    try {
      let targetBoardId = boardId
      if ((!targetBoardId || String(targetBoardId).startsWith('local-')) && onEnsureSavedBoard) {
        targetBoardId = await onEnsureSavedBoard()
      }
      if (!targetBoardId || String(targetBoardId).startsWith('local-')) {
        throw new Error('Save the board first to run AI rubric critique.')
      }
      const res = await canvasCritiqueApi.critique(targetBoardId, {
        model: model || undefined,
        goal: critiqueGoal.trim() || undefined,
        data: boardData,
      })
      setCritiqueResult(res)
    } catch (err) {
      setCritiqueError(err instanceof Error ? err.message : 'Failed to run AI rubric critique')
    } finally {
      setCritiqueLoading(false)
    }
  }

  const handleConsultAi = () => {
    const targetPath = `${prefix}/chat`
    try {
      const findingSummaries = findings.map(
        (f) => `• [${f.severity.toUpperCase()}] ${f.title}: ${f.message}\n  Recommendation: ${f.recommendation}`
      ).join('\n\n')

      sessionStorage.setItem(
        'toolbox_chat_draft',
        isConcept
          ? `I ran the Concept Map Linter on my concept map. My Structural Score is ${score}/100 (${rating}).\n\nFindings:\n${findingSummaries || 'No structural issues found.'}\n\nPlease help me refine my propositions and test for subtle domain misconceptions.`
          : `I ran the Architecture Linter on my system design whiteboard. My Architecture Health Score is ${score}/100 (${rating}).\n\nHere are the findings:\n${findingSummaries || 'No critical issues found.'}\n\nPlease review these tradeoffs and suggest concrete architectural patterns to improve resilience.`
      )
      window.dispatchEvent(new CustomEvent('toolbox-chat-draft'))
      onClose()
      navigate(targetPath)
    } catch {
      onClose()
      navigate(targetPath)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isConcept ? 'Concept Map Audit & AI Critique' : 'Architecture Audit & Linter'}
      footer={null}
    >
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
                {isConcept
                  ? `${stats.totalNodes} concepts · ${stats.totalEdges} propositions`
                  : `${stats.totalNodes} components · ${stats.totalEdges} data edges`}
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
                {isConcept
                  ? 'Well-structured concept map! All propositions and nodes pass structural checks.'
                  : 'Clean architecture! No critical antipatterns or single points of failure detected.'}
              </div>
            </div>
          )}

          {findings.map((f) => {
            const meta = SEVERITY_CONFIG[f.severity]
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

        {/* Grounded AI Rubric Critique */}
        <div
          style={{
            padding: 'var(--space-4)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={14} style={{ color: 'var(--color-accent)' }} />
                Falsification-First AI Rubric Critique
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                Evaluates your {isConcept ? 'propositions & concept links' : 'system diagram'} against the active Kit rubric.
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void handleRunAiCritique()}
              disabled={critiqueLoading || stats.totalNodes === 0}
              data-testid="run-ai-critique-btn"
              id="run-ai-critique-btn"
            >
              {critiqueLoading ? <RefreshCw size={14} className="animate-spin" /> : <Sparkles size={14} />}
              {critiqueLoading ? 'Critiquing…' : 'AI Rubric Critique'}
            </button>
          </div>

          <input
            type="text"
            value={critiqueGoal}
            onChange={(e) => setCritiqueGoal(e.target.value)}
            placeholder={
              isConcept
                ? 'Optional goal (e.g., "Explain how Rust ownership prevents data races")…'
                : 'Optional target workload (e.g., "50k writes/sec multi-region checkout")…'
            }
            aria-label="Critique goal"
            style={{
              width: '100%',
              fontSize: 'var(--text-xs)',
              padding: '7px 10px',
              borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-surface)',
              color: 'var(--color-text-primary)',
            }}
          />

          {critiqueError && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-error, #ef4444)', fontWeight: 500 }}>
              {critiqueError}
            </div>
          )}

          {critiqueResult && (
            <RubricFeedbackCard
              result={critiqueResult}
              title={isConcept ? 'AI Concept-Map Rubric Critique' : 'AI Architecture Rubric Critique'}
            />
          )}
        </div>

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
            className="btn btn-ghost btn-sm"
            onClick={handleConsultAi}
            id="audit-consult-ai-btn"
          >
            <MessageSquare size={14} /> {isConcept ? 'Discuss Map in Chat' : 'Consult AI on Architecture'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
