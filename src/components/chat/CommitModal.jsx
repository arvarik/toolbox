import { useState, useEffect } from 'react'
import { GitCommit, Check, Loader2, X, Sparkles, Eye, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import { chatApi } from '../../utils/api'
import useAppStore from '../../stores/appStore'

/**
 * CommitModal — Intelligent session-to-guide commit.
 *
 * Flow:
 * 1. Opens → immediately starts analyzing the conversation with Gemini
 * 2. Gemini identifies which guide sections were discussed
 * 3. For each section, reconciles session content with existing guide content
 * 4. Shows a preview with toggles per section
 * 5. User confirms → batch saves all enabled sections
 *
 * @param {boolean} open
 * @param {Function} onClose
 * @param {Array} messages - Full message history from LearningChat
 * @param {Object} topicContext - { pillarId, topicId, topicName }
 * @param {Function} onCommitSuccess - Called after a successful commit
 */
export default function CommitModal({ open, onClose, messages = [], topicContext, onCommitSuccess }) {
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)

  // Phase: 'analyzing' | 'preview' | 'saving' | 'done' | 'error'
  const [phase, setPhase] = useState('analyzing')
  const [errorMsg, setErrorMsg] = useState('')
  const [updates, setUpdates] = useState([]) // Array of section updates from the API
  const [enabledSections, setEnabledSections] = useState(new Set()) // Which sections to commit
  const [expandedSections, setExpandedSections] = useState(new Set()) // Which previews are expanded
  const [savedCount, setSavedCount] = useState(0)

  // Auto-analyze when the modal opens
  useEffect(() => {
    if (!open || !topicContext?.pillarId) return

    let cancelled = false

    const analyze = async () => {
      setPhase('analyzing')
      setErrorMsg('')
      setUpdates([])
      setEnabledSections(new Set())
      setExpandedSections(new Set())
      setSavedCount(0)

      try {
        const result = await chatApi.commitAnalyze({
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
          pillarId: topicContext.pillarId,
          topicId: topicContext.topicId,
          topicName: topicContext.topicName,
          model: selectedModel,
        })

        if (cancelled) return

        if (!result.updates || result.updates.length === 0) {
          setPhase('error')
          setErrorMsg('No guide sections were identified from this conversation. Try having a more in-depth discussion about specific topics before committing.')
          return
        }

        setUpdates(result.updates)
        // Enable all sections by default
        setEnabledSections(new Set(result.updates.map((u) => u.sectionId)))
        // Expand the first section
        if (result.updates.length > 0) {
          setExpandedSections(new Set([result.updates[0].sectionId]))
        }
        setPhase('preview')
      } catch (err) {
        if (!cancelled) {
          setPhase('error')
          setErrorMsg(err.message || 'Failed to analyze session.')
        }
      }
    }

    analyze()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, topicContext?.pillarId, topicContext?.topicId])

  if (!open) return null

  const toggleSection = (sectionId) => {
    setEnabledSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const toggleExpand = (sectionId) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) next.delete(sectionId)
      else next.add(sectionId)
      return next
    })
  }

  const handleSave = async () => {
    const toSave = updates.filter((u) => enabledSections.has(u.sectionId))
    if (toSave.length === 0) return

    setPhase('saving')
    try {
      const result = await chatApi.commitSave({
        pillarId: topicContext.pillarId,
        topicId: topicContext.topicId,
        updates: toSave.map((u) => ({ sectionId: u.sectionId, content: u.newContent })),
      })
      setSavedCount(result.savedCount || toSave.length)
      setPhase('done')
      addToast({
        type: 'success',
        message: `Committed ${result.savedCount || toSave.length} section${toSave.length !== 1 ? 's' : ''} to "${topicContext.topicName}" guide`,
      })
      onCommitSuccess?.(topicContext)
      setTimeout(onClose, 1500)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save.' })
      setPhase('preview')
    }
  }

  const enabledCount = enabledSections.size

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && phase !== 'saving') onClose() }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: 780,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
        id="commit-modal"
      >
        {/* ── Header ── */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <GitCommit size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>Commit to Guide</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                {topicContext?.topicName || 'Unknown topic'}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} disabled={phase === 'saving'}>
            <X size={16} />
          </button>
        </div>

        {/* ── Analyzing Phase ── */}
        {phase === 'analyzing' && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-10)',
            minHeight: 280,
          }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'var(--color-accent-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto var(--space-4)',
              }}>
                <Sparkles size={24} style={{ color: 'var(--color-accent)', animation: 'pulse 1.5s ease-in-out infinite' }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>
                Analyzing Your Session
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', maxWidth: 320, margin: '0 auto', lineHeight: 1.6 }}>
                AI is reading through your conversation, identifying which guide sections were covered, and reconciling with existing content…
              </div>
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Loader2 size={20} style={{ color: 'var(--color-accent)', animation: 'spin 1s linear infinite' }} />
              </div>
            </div>
          </div>
        )}

        {/* ── Error Phase ── */}
        {phase === 'error' && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-8)',
            minHeight: 240,
          }}>
            <div style={{ textAlign: 'center', maxWidth: 400 }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'rgba(239,68,68,0.12)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto var(--space-3)',
              }}>
                <AlertCircle size={22} style={{ color: '#ef4444' }} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: 'var(--space-2)' }}>
                Nothing to Commit
              </div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                {errorMsg}
              </div>
              <button className="btn btn-secondary" style={{ marginTop: 'var(--space-4)' }} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}

        {/* ── Done Phase ── */}
        {phase === 'done' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-8)' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{
                width: 56, height: 56, borderRadius: '50%',
                background: 'rgba(34,197,94,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto var(--space-3)',
              }}>
                <Check size={28} style={{ color: '#22c55e' }} />
              </div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Committed!</div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginTop: 'var(--space-1)' }}>
                {savedCount} section{savedCount !== 1 ? 's' : ''} saved to {topicContext?.topicName}
              </div>
            </div>
          </div>
        )}

        {/* ── Preview Phase ── */}
        {(phase === 'preview' || phase === 'saving') && (
          <>
            <div style={{
              padding: 'var(--space-3) var(--space-6)',
              borderBottom: '1px solid var(--color-border)',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              flexShrink: 0,
              background: 'var(--color-bg-secondary)',
            }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                <strong style={{ color: 'var(--color-text-primary)' }}>{updates.length}</strong> section{updates.length !== 1 ? 's' : ''} identified
                {' · '}
                <strong style={{ color: 'var(--color-accent)' }}>{enabledCount}</strong> enabled for commit
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: '11px', padding: '3px 8px' }}
                  onClick={() => {
                    if (enabledCount === updates.length) {
                      setEnabledSections(new Set())
                    } else {
                      setEnabledSections(new Set(updates.map((u) => u.sectionId)))
                    }
                  }}
                >
                  {enabledCount === updates.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>

            {/* Section cards */}
            <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4) var(--space-6)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {updates.map((update) => {
                  const isEnabled = enabledSections.has(update.sectionId)
                  const isExpanded = expandedSections.has(update.sectionId)

                  return (
                    <div
                      key={update.sectionId}
                      style={{
                        borderRadius: 'var(--radius-lg)',
                        border: `1px solid ${isEnabled ? 'var(--color-accent)' : 'var(--color-border)'}`,
                        background: isEnabled ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
                        overflow: 'hidden',
                        transition: 'all 0.2s ease',
                        opacity: isEnabled ? 1 : 0.6,
                      }}
                    >
                      {/* Section header */}
                      <div
                        style={{
                          display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                          padding: 'var(--space-3) var(--space-4)',
                          cursor: 'pointer',
                        }}
                        onClick={() => toggleExpand(update.sectionId)}
                      >
                        {/* Checkbox */}
                        <div
                          onClick={(e) => { e.stopPropagation(); toggleSection(update.sectionId) }}
                          style={{
                            width: 20, height: 20, flexShrink: 0,
                            border: `2px solid ${isEnabled ? 'var(--color-accent)' : 'var(--color-border)'}`,
                            borderRadius: 'var(--radius-sm)',
                            background: isEnabled ? 'var(--color-accent)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                          }}
                        >
                          {isEnabled && <Check size={12} color="white" />}
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{
                            fontWeight: 600, fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-primary)',
                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                          }}>
                            {update.sectionName}
                            <span style={{
                              fontSize: '10px', fontWeight: 600,
                              padding: '1px 6px', borderRadius: 'var(--radius-full)',
                              background: update.isNew ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
                              color: update.isNew ? '#22c55e' : '#3b82f6',
                            }}>
                              {update.isNew ? 'NEW' : 'MERGE'}
                            </span>
                          </div>
                          <div style={{
                            fontSize: '11px', color: 'var(--color-text-tertiary)',
                            marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {update.reason}
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
                          <Eye size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                          {isExpanded
                            ? <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                            : <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
                        </div>
                      </div>

                      {/* Expanded preview */}
                      {isExpanded && (
                        <div style={{
                          borderTop: '1px solid var(--color-border)',
                          padding: 'var(--space-4)',
                          maxHeight: 360,
                          overflow: 'auto',
                        }}>
                          <div style={{
                            background: 'var(--color-surface)',
                            borderRadius: 'var(--radius-md)',
                            padding: 'var(--space-4)',
                            border: '1px solid var(--color-border)',
                            fontSize: 'var(--text-sm)',
                            lineHeight: 'var(--leading-relaxed)',
                          }}>
                            <MarkdownRenderer content={update.newContent} />
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Footer */}
            <div style={{
              padding: 'var(--space-4) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end',
              alignItems: 'center', flexShrink: 0,
            }}>
              <button className="btn btn-secondary" onClick={onClose} disabled={phase === 'saving'}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleSave}
                disabled={phase === 'saving' || enabledCount === 0}
                id="confirm-commit-btn"
              >
                {phase === 'saving' ? (
                  <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving…</>
                ) : (
                  <><GitCommit size={14} /> Commit {enabledCount} Section{enabledCount !== 1 ? 's' : ''}</>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
