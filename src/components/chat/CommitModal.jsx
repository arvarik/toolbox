import { useEffect } from 'react'
import { GitCommit, Check, Loader2, X, Sparkles, Eye, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import { chatApi } from '../../utils/api'
import useAppStore from '../../stores/appStore'
import useCommitStore from '../../stores/useCommitStore'
import { BLUEPRINT_SECTIONS } from '../../utils/constants'

/**
 * CommitModal — Intelligent session-to-guide commit.
 * 
 * Modified to use global useCommitStore so background processes can run 
 * when minimized into the TaskWorkingBar.
 */
export default function CommitModal() {
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)
  
  const { 
    isOpen, 
    phase, 
    errorMsg, 
    updates, 
    enabledSections, 
    expandedSections, 
    savedCount,
    messages,
    topicContext,
    closeCompletely,
    setMinimized,
    setPhase,
    setError,
    setUpdatesResult,
    mergeUpdatesResult,
    setEnabledSections,
    setExpandedSections,
    setSavedCount
  } = useCommitStore()

  const analyze = async (targetSectionIds = []) => {
    const callId = Date.now()
    useCommitStore.setState({ currentCallId: callId })
    setPhase('analyzing')

    try {
      const payload = {
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        pillarId: topicContext.pillarId,
        topicId: topicContext.topicId,
        topicName: topicContext.topicName,
        model: selectedModel,
      }
      if (targetSectionIds.length > 0) {
        payload.targetSectionIds = targetSectionIds
      }

      const result = await chatApi.commitAnalyze(payload)

      if (callId !== useCommitStore.getState().currentCallId) return

      if (!result.updates || result.updates.length === 0) {
        if (targetSectionIds.length === 0) {
          setUpdatesResult([], new Set(), new Set())
        } else {
          setError('Failed to generate content for the selected sections.')
        }
        return
      }

      if (targetSectionIds.length > 0) {
        mergeUpdatesResult(result.updates, targetSectionIds)
      } else {
        const initialEnabled = new Set(result.updates.map((u) => u.sectionId))
        const initialExpanded = result.updates.length > 0 ? new Set([result.updates[0].sectionId]) : new Set()
        setUpdatesResult(result.updates, initialEnabled, initialExpanded)
      }
    } catch (err) {
      if (callId !== useCommitStore.getState().currentCallId) return
      setError(err.message || 'Failed to analyze session.')
    }
  }

  // Auto-analyze when opened and in 'idle' phase
  // Note: we track if we just opened a new request
  useEffect(() => {
    if (isOpen && phase === 'idle' && topicContext?.pillarId) {
      const timer = setTimeout(() => {
        analyze()
      }, 0)

      return () => {
        clearTimeout(timer)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, phase, topicContext?.pillarId, topicContext?.topicId])

  if (!isOpen) return null

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
      const count = result.savedCount || toSave.length
      setSavedCount(count)
      setPhase('done')
      addToast({
        type: 'success',
        message: `Committed ${count} section${toSave.length !== 1 ? 's' : ''} to "${topicContext.topicName}" guide`,
      })
      
      // Dispatch custom event to update sidebar
      window.dispatchEvent(new Event('guide-progress-updated'))
      
      setTimeout(closeCompletely, 1500)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save.' })
      setPhase('preview')
    }
  }

  const enabledCount = enabledSections.size
  const allSections = topicContext ? (BLUEPRINT_SECTIONS[topicContext.pillarId] || []) : []
  const updateMap = new Map(updates.map(u => [u.sectionId, u]))
  const identifiedIds = new Set(updates.map(u => u.sectionId))
  const requiresReanalysis = Array.from(enabledSections).some(id => !identifiedIds.has(id))

  const handleCloseOrMinimize = () => {
    if (phase === 'analyzing' || phase === 'saving' || phase === 'preview') {
      setMinimized(true)
    } else {
      closeCompletely()
    }
  }

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
      onClick={(e) => { if (e.target === e.currentTarget && phase !== 'saving') handleCloseOrMinimize() }}
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
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <button className="btn btn-ghost btn-icon" onClick={handleCloseOrMinimize}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── Analyzing Phase ── */}
        {phase === 'analyzing' && (
          <div style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 'var(--space-10)',
            minHeight: 280,
          }}>
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
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
              <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'center' }}>
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
              <button className="btn btn-secondary" style={{ marginTop: 'var(--space-4)' }} onClick={closeCompletely}>
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
                    if (enabledCount === allSections.length) {
                      setEnabledSections(new Set())
                    } else {
                      setEnabledSections(new Set(allSections.map((s) => s.id)))
                    }
                  }}
                >
                  {enabledCount === allSections.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            </div>

            {/* Section cards */}
            <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4) var(--space-6)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                {allSections.map((sec) => {
                  const update = updateMap.get(sec.id)
                  const isEnabled = enabledSections.has(sec.id)
                  const isExpanded = expandedSections.has(sec.id)
                  const isIdentified = !!update

                  return (
                    <div
                      key={sec.id}
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
                          cursor: isIdentified ? 'pointer' : 'default',
                        }}
                        onClick={() => { if (isIdentified) toggleExpand(sec.id) }}
                      >
                        {/* Checkbox */}
                        <div
                          onClick={(e) => { e.stopPropagation(); toggleSection(sec.id) }}
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
                            {sec.name}
                            {isIdentified ? (
                              <span style={{
                                fontSize: '10px', fontWeight: 600,
                                padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                background: update.isNew ? 'rgba(34,197,94,0.15)' : 'rgba(59,130,246,0.15)',
                                color: update.isNew ? '#22c55e' : '#3b82f6',
                              }}>
                                {update.isNew ? 'NEW' : 'MERGE'}
                              </span>
                            ) : (
                              <span style={{
                                fontSize: '10px', fontWeight: 600,
                                padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                background: 'rgba(156,163,175,0.15)',
                                color: '#9ca3af',
                              }}>
                                MISSING
                              </span>
                            )}
                          </div>
                          <div style={{
                            fontSize: '11px', color: 'var(--color-text-tertiary)',
                            marginTop: 2,
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                          }}>
                            {isIdentified ? update.reason : 'Select to force analysis of this section'}
                          </div>
                        </div>

                        {isIdentified && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)', flexShrink: 0 }}>
                            <Eye size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                            {isExpanded
                              ? <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                              : <ChevronRight size={14} style={{ color: 'var(--color-text-tertiary)' }} />}
                          </div>
                        )}
                      </div>

                      {/* Expanded preview */}
                      {isExpanded && isIdentified && (
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
              <button className="btn btn-secondary" onClick={closeCompletely} disabled={phase === 'saving'}>
                Cancel
              </button>
              {requiresReanalysis ? (
                <button
                  className="btn btn-primary"
                  onClick={() => analyze(Array.from(enabledSections))}
                  disabled={phase === 'saving' || enabledCount === 0}
                  id="confirm-commit-btn"
                >
                  <Sparkles size={14} /> Re-Analyze Selected
                </button>
              ) : (
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
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
