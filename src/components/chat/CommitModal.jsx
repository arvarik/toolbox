import { useState, useEffect } from 'react'
import { GitCommit, Check, ChevronRight, ChevronDown, Loader2, X, Sparkles } from 'lucide-react'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../utils/constants'
import { chatApi, guideContentApi } from '../../utils/api'
import useAppStore from '../../stores/appStore'

/**
 * CommitModal — lets the user select AI message excerpts from a learning session,
 * pick a target blueprint section, and commit a Gemini-summarized version to the guide.
 *
 * @param {boolean} open
 * @param {Function} onClose
 * @param {Array} messages - Full message history from LearningChat
 * @param {Function} onCommitSuccess - Called after a successful commit
 */
export default function CommitModal({ open, onClose, messages = [], onCommitSuccess }) {
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)

  // All AI messages as selectable excerpts (default: last 10 AI msgs selected)
  const aiMessages = messages
    .map((m, i) => ({ ...m, originalIndex: i }))
    .filter((m) => m.role === 'ai' && m.content.trim().length > 0)

  const defaultSelected = new Set(
    aiMessages.slice(-10).map((m) => m.originalIndex)
  )

  const [selectedMsgs, setSelectedMsgs] = useState(defaultSelected)
  const [expandedPillars, setExpandedPillars] = useState({})
  const [selectedTarget, setSelectedTarget] = useState(null) // { pillarId, topicId, sectionId, sectionName, topicName }
  const [phase, setPhase] = useState('select') // 'select' | 'summarizing' | 'preview' | 'saving' | 'done'
  const [previewContent, setPreviewContent] = useState('')

  // Reset state when modal opens
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedMsgs(
        new Set(aiMessages.slice(-10).map((m) => m.originalIndex))
      )
      setExpandedPillars({})
      setSelectedTarget(null)
      setPhase('select')
      setPreviewContent('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  const toggleMsg = (idx) => {
    setSelectedMsgs((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const togglePillar = (pillarId) => {
    setExpandedPillars((prev) => ({ ...prev, [pillarId]: !prev[pillarId] }))
  }

  const selectTarget = (pillarId, topicId, sectionId, sectionName, topicName) => {
    setSelectedTarget({ pillarId, topicId, sectionId, sectionName, topicName })
  }

  const handleSummarize = async () => {
    if (!selectedTarget || selectedMsgs.size === 0) return
    setPhase('summarizing')

    const excerpts = aiMessages
      .filter((m) => selectedMsgs.has(m.originalIndex))
      .map((m) => m.content)

    try {
      const result = await chatApi.summarize({
        excerpts,
        sectionId: selectedTarget.sectionId,
        sectionName: selectedTarget.sectionName,
        topicName: selectedTarget.topicName,
        model: selectedModel,
      })
      setPreviewContent(result.content)
      setPhase('preview')
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Summarization failed' })
      setPhase('select')
    }
  }

  const handleCommit = async () => {
    setPhase('saving')
    try {
      await guideContentApi.upsert(
        selectedTarget.pillarId,
        selectedTarget.topicId,
        selectedTarget.sectionId,
        previewContent
      )
      setPhase('done')
      addToast({ type: 'success', message: `Committed to "${selectedTarget.sectionName}"` })
      onCommitSuccess?.(selectedTarget)
      setTimeout(onClose, 1200)
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to commit' })
      setPhase('preview')
    }
  }

  const selectedCount = selectedMsgs.size
  const canProceed = selectedCount > 0 && selectedTarget !== null

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
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: 920,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
        id="commit-modal"
      >
        {/* Modal Header */}
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
                Select excerpts and a target section, then let AI summarize
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {/* Done state */}
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
                Notes saved to {selectedTarget?.sectionName}
              </div>
            </div>
          </div>
        )}

        {/* Preview phase */}
        {(phase === 'preview' || phase === 'saving') && (
          <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                Preview for <strong style={{ color: 'var(--color-text-primary)' }}>{selectedTarget?.topicName}</strong> →{' '}
                <strong style={{ color: 'var(--color-accent)' }}>{selectedTarget?.sectionName}</strong>
              </div>
            </div>
            <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-6)' }}>
              <div style={{
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-6)',
                border: '1px solid var(--color-border)',
                fontSize: 'var(--text-sm)',
                lineHeight: 'var(--leading-relaxed)',
              }}>
                <MarkdownRenderer content={previewContent} />
              </div>
            </div>
            <div style={{
              padding: 'var(--space-4) var(--space-6)',
              borderTop: '1px solid var(--color-border)',
              display: 'flex', gap: 'var(--space-3)', justifyContent: 'flex-end',
              flexShrink: 0,
            }}>
              <button className="btn btn-secondary" onClick={() => setPhase('select')} disabled={phase === 'saving'}>
                ← Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCommit}
                disabled={phase === 'saving'}
                id="confirm-commit-btn"
              >
                {phase === 'saving' ? (
                  <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</>
                ) : (
                  <><Check size={14} /> Save to Guide</>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Select phase */}
        {(phase === 'select' || phase === 'summarizing') && (
          <>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', minHeight: 0 }}>
              {/* Left: Message selection */}
              <div style={{
                flex: 1, overflow: 'auto',
                padding: 'var(--space-4) var(--space-5)',
                borderRight: '1px solid var(--color-border)',
              }}>
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                    AI Responses ({selectedCount} selected)
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    Choose which responses to include in the summary
                  </div>
                </div>

                {aiMessages.length === 0 ? (
                  <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', padding: 'var(--space-4) 0' }}>
                    No AI messages yet. Start a learning session first.
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {aiMessages.map((msg) => {
                      const isSelected = selectedMsgs.has(msg.originalIndex)
                      const preview = msg.content.slice(0, 120).trim() + (msg.content.length > 120 ? '…' : '')
                      return (
                        <div
                          key={msg.originalIndex}
                          onClick={() => toggleMsg(msg.originalIndex)}
                          style={{
                            padding: 'var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            border: `1px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                            background: isSelected ? 'var(--color-accent-subtle)' : 'var(--color-bg-secondary)',
                            cursor: 'pointer',
                            transition: 'all var(--duration-fast)',
                            display: 'flex',
                            gap: 'var(--space-2)',
                            alignItems: 'flex-start',
                          }}
                        >
                          <div style={{
                            width: 18, height: 18, flexShrink: 0, marginTop: 1,
                            border: `2px solid ${isSelected ? 'var(--color-accent)' : 'var(--color-border)'}`,
                            borderRadius: 'var(--radius-sm)',
                            background: isSelected ? 'var(--color-accent)' : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                            {isSelected && <Check size={11} color="white" />}
                          </div>
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                            {preview}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Right: Section picker */}
              <div style={{ width: 320, overflow: 'auto', padding: 'var(--space-4) var(--space-5)', flexShrink: 0 }}>
                <div style={{ marginBottom: 'var(--space-3)' }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', marginBottom: 'var(--space-1)' }}>
                    Target Section
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                    Where should these notes go in the guide?
                  </div>
                </div>

                {PILLARS.map((pillar) => {
                  const isExpanded = expandedPillars[pillar.id]
                  return (
                    <div key={pillar.id} style={{ marginBottom: 'var(--space-1)' }}>
                      <button
                        onClick={() => togglePillar(pillar.id)}
                        style={{
                          width: '100%', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                          padding: 'var(--space-2) var(--space-2)',
                          background: 'none', border: 'none', cursor: 'pointer',
                          borderRadius: 'var(--radius-sm)',
                          color: 'var(--color-text-primary)',
                          fontSize: 'var(--text-xs)', fontWeight: 600,
                        }}
                      >
                        <span style={{
                          width: 18, height: 18, borderRadius: 'var(--radius-sm)', flexShrink: 0,
                          background: `${pillar.color}20`, color: pillar.color,
                          fontSize: '10px', fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>{pillar.number}</span>
                        <span style={{ flex: 1, textAlign: 'left' }}>{pillar.shortName}</span>
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      </button>

                      {isExpanded && (
                        <div style={{ paddingLeft: 'var(--space-5)' }}>
                          {pillar.topics.map((topic) => {
                            const sections = BLUEPRINT_SECTIONS[pillar.id] || []
                            return (
                              <div key={topic.id} style={{ marginBottom: 'var(--space-1)' }}>
                                <div style={{
                                  fontSize: '11px', fontWeight: 600,
                                  color: 'var(--color-text-secondary)',
                                  padding: 'var(--space-1) var(--space-2)',
                                }}>
                                  {topic.name}
                                </div>
                                {sections.map((section) => {
                                  const isTarget = selectedTarget?.pillarId === pillar.id &&
                                    selectedTarget?.topicId === topic.id &&
                                    selectedTarget?.sectionId === section.id
                                  return (
                                    <button
                                      key={section.id}
                                      onClick={() => selectTarget(pillar.id, topic.id, section.id, section.name, topic.name)}
                                      style={{
                                        width: '100%', textAlign: 'left',
                                        padding: '4px var(--space-2)',
                                        background: isTarget ? 'var(--color-accent-subtle)' : 'none',
                                        border: 'none', cursor: 'pointer',
                                        borderRadius: 'var(--radius-sm)',
                                        color: isTarget ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
                                        fontSize: '11px',
                                        fontWeight: isTarget ? 600 : 400,
                                        display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                                      }}
                                    >
                                      {isTarget && <Check size={10} />}
                                      {section.name}
                                    </button>
                                  )
                                })}
                              </div>
                            )
                          })}
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
              display: 'flex', gap: 'var(--space-3)', justifyContent: 'space-between',
              alignItems: 'center', flexShrink: 0,
            }}>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                {selectedTarget
                  ? <><strong style={{ color: 'var(--color-text-primary)' }}>{selectedTarget.topicName}</strong> → {selectedTarget.sectionName}</>
                  : 'Select a target section on the right'}
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button className="btn btn-secondary" onClick={onClose} disabled={phase === 'summarizing'}>
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  onClick={handleSummarize}
                  disabled={!canProceed || phase === 'summarizing'}
                  id="summarize-btn"
                >
                  {phase === 'summarizing' ? (
                    <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Summarizing...</>
                  ) : (
                    <><Sparkles size={14} /> Summarize & Preview</>
                  )}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

