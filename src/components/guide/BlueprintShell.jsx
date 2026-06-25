import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Cpu, Scale, TrendingUp, Shield, Box,
  Radio, Target, Link, SlidersHorizontal,
  AlertTriangle, DollarSign, Layers, GitBranch, Filter, RefreshCw,
  Edit3, Save, X, Trash2, BookOpen, Sparkles,
} from 'lucide-react'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import FlashcardReviewModal from '../shared/FlashcardReviewModal'
import Skeleton from '../shared/Skeleton'
import PullToRefresh from '../shared/PullToRefresh'
import { PILLARS, BLUEPRINT_SECTIONS } from '../../utils/constants'
import { guideContentApi, chatApi } from '../../utils/api'
import useAppStore from '../../stores/appStore'
import useIsMobile from '../../hooks/useIsMobile'

const EMPTY_ARRAY = []

const iconMap = {
  cpu: Cpu,
  scale: Scale,
  'trending-up': TrendingUp,
  shield: Shield,
  box: Box,
  radio: Radio,
  target: Target,
  link: Link,
  'sliders-horizontal': SlidersHorizontal,
  puzzle: Box,
  'alert-triangle': AlertTriangle,
  'dollar-sign': DollarSign,
  layers: Layers,
  'git-branch': GitBranch,
  filter: Filter,
  'refresh-cw': RefreshCw,
}

/**
 * Blueprint content shell — displays section structure for a selected topic.
 * When a section has committed content it renders the markdown; otherwise shows a placeholder.
 * Each section can be edited in-place via a simple textarea.
 */
export default function BlueprintShell() {
  const { pillarId, topicId } = useParams()
  const navigate = useNavigate()
  const addToast = useAppStore((s) => s.addToast)

  const pillar = PILLARS.find((p) => p.id === pillarId)
  const topic = pillar?.topics.find((t) => t.id === topicId)
  const sections = BLUEPRINT_SECTIONS[pillarId] || EMPTY_ARRAY

  const [expandedSections, setExpandedSections] = useState(() => {
    return sections.length > 0 ? { [sections[0].id]: true } : {}
  })
  const [prevTopicId, setPrevTopicId] = useState(topicId)

  // Progress data for library landing page: { 'pillarId__topicId__sectionId': true }
  const [progress, setProgress] = useState({})

  // Content per sectionId: { content: string, committedAt: string | null }
  const [sectionContent, setSectionContent] = useState({})
  const [isLoadingContent, setIsLoadingContent] = useState(false)

  // Edit mode state
  const [editingSection, setEditingSection] = useState(null) // sectionId or null
  const [editDraft, setEditDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isMobile = useIsMobile()

  // Flashcards state
  const selectedModel = useAppStore((s) => s.model)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [generatedCards, setGeneratedCards] = useState([])
  const [isGeneratingCards, setIsGeneratingCards] = useState(false)

  // Reset when topic changes
  if (topicId !== prevTopicId) {
    setPrevTopicId(topicId)
    setExpandedSections(sections.length > 0 ? { [sections[0].id]: true } : {})
    setEditingSection(null)
  }

  // Fetch committed content when pillar+topic are selected
  const fetchContent = useCallback(() => {
    if (!pillarId || !topicId) return
    setIsLoadingContent(true)
    guideContentApi.getForTopic(pillarId, topicId)
      .then((data) => setSectionContent(data || {}))
      .catch(() => setSectionContent({}))
      .finally(() => setIsLoadingContent(false))
  }, [pillarId, topicId])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSectionContent({})
    fetchContent()
  }, [fetchContent])

  // Fetch progress map for the library landing page
  const fetchProgress = useCallback(async () => {
    try {
      const data = await guideContentApi.progress()
      setProgress(data || {})
    } catch {
      setProgress({})
    }
  }, [])

  useEffect(() => {
    if (!pillarId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchProgress()
    }
  }, [pillarId, fetchProgress])

  const toggleSection = (sectionId) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }))
  }

  const startEdit = (sectionId) => {
    const existing = sectionContent[sectionId]?.content || ''
    setEditDraft(existing)
    setEditingSection(sectionId)
  }

  const cancelEdit = () => {
    setEditingSection(null)
    setEditDraft('')
  }

  const saveEdit = async (sectionId) => {
    setIsSaving(true)
    try {
      await guideContentApi.upsert(pillarId, topicId, sectionId, editDraft)
      setSectionContent((prev) => ({
        ...prev,
        [sectionId]: { content: editDraft, committedAt: new Date().toISOString() },
      }))
      setEditingSection(null)
      setEditDraft('')
      addToast({ type: 'success', message: 'Section updated' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save' })
    } finally {
      setIsSaving(false)
    }
  }

  const clearSection = (sectionId) => {
    const oldContent = sectionContent[sectionId]
    
    // 1. Optimistic UI Update
    setSectionContent((prev) => {
      const next = { ...prev }
      delete next[sectionId]
      return next
    })

    // 2. Schedule API clear
    const actionId = `clear-section-${pillarId}-${topicId}-${sectionId}`
    useAppStore.getState().scheduleAction(actionId, async () => {
      try {
        await guideContentApi.clear(pillarId, topicId, sectionId)
      } catch (err) {
        useAppStore.getState().addToast({ type: 'error', message: err.message || 'Failed to clear' })
      }
    }, 5000)

    // 3. Show Undo Toast
    addToast({ 
      type: 'info', 
      message: 'Section cleared',
      action: {
        label: 'Undo',
        onClick: () => {
          if (useAppStore.getState().cancelAction(actionId)) {
            setSectionContent(prev => ({ ...prev, [sectionId]: oldContent }))
          }
        }
      }
    })
  }

  const handleGenerateFlashcards = async () => {
    // Build section-aware entries for tagged card generation
    const sectionEntries = sections
      .filter(s => sectionContent[s.id]?.content?.trim())
      .map(s => ({
        sectionId: s.id,
        sectionName: s.name,
        content: sectionContent[s.id].content,
      }))

    if (sectionEntries.length === 0) {
      addToast({ type: 'error', message: 'No content available to generate flashcards from.' })
      return
    }
    
    setIsGeneratingCards(true)
    try {
      const res = await chatApi.generateFlashcards({
        sections: sectionEntries,
        topicName: topic?.name,
        model: selectedModel,
        pillarId,
        topicId,
      })
      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({ type: 'info', message: 'No flashcards generated.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to generate flashcards' })
    } finally {
      setIsGeneratingCards(false)
    }
  }

  // ── No pillar selected — Library overview landing ───────────────────────────
  if (!pillar) {
    // Calculate per-pillar progress
    const pillarStats = PILLARS.map((p) => {
      const bpSections = BLUEPRINT_SECTIONS[p.id] || []
      const total = p.topics.length * bpSections.length
      const filled = p.topics.reduce((acc, t) => {
        return acc + bpSections.filter((s) => progress[`${p.id}__${t.id}__${s.id}`]).length
      }, 0)
      return { ...p, filled, total, percent: total > 0 ? Math.round((filled / total) * 100) : 0 }
    })

    const totalSections = pillarStats.reduce((a, p) => a + p.total, 0)
    const totalFilled = pillarStats.reduce((a, p) => a + p.filled, 0)
    const overallPercent = totalSections > 0 ? Math.round((totalFilled / totalSections) * 100) : 0

    return (
      <PullToRefresh onRefresh={fetchProgress}>
        <div className="page-wrapper blueprint-library-wrapper">
        {/* Hero header */}
        <div className="blueprint-library-hero">
          <div className="blueprint-hero-icon">
            <BookOpen size={28} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h1 className="page-title blueprint-hero-title">
            System Design Guide
          </h1>
          <p className="page-description blueprint-hero-desc">
            Your authoritative library of system design knowledge across seven pillars.
            Study through chat, then commit insights here for reference.
          </p>
        </div>

        {/* Overall progress card */}
        <div className="blueprint-progress-card">
          <div className="blueprint-progress-header">
            <div>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>
                Library Progress
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                {totalFilled} of {totalSections} sections filled across all pillars
              </div>
            </div>
            <div style={{
              fontSize: 'var(--text-2xl)', fontWeight: 700,
              color: overallPercent > 0 ? 'var(--color-accent)' : 'var(--color-text-tertiary)',
            }}>
              {overallPercent}%
            </div>
          </div>

          {/* Progress bar */}
          <div className="blueprint-progress-bar-bg">
            <div className="blueprint-progress-bar-fill" style={{ width: `${overallPercent}%` }} />
          </div>

          {/* CTA to chat */}
          <button
            className="btn btn-primary"
            style={{ width: '100%', justifyContent: 'center', fontSize: 'var(--text-sm)' }}
            onClick={() => navigate('/chat')}
          >
            <Sparkles size={15} />
            {totalFilled > 0 ? 'Continue Studying →' : 'Start Studying →'}
          </button>
        </div>

        {/* Pillar cards grid */}
        <div className="blueprint-pillar-list-header">
          Pillars
        </div>

        <div className="guide-grid">
          {pillarStats.map((p) => (
            <div
              key={p.id}
              className="blueprint-pillar-card"
              onClick={() => navigate(`/guide/${p.id}`)}
              style={{ '--dynamic-color': p.color }}
            >
              <div className="blueprint-pillar-card-header">
                <div className="blueprint-pillar-icon-wrap">
                  <Cpu size={20} className="blueprint-pillar-icon" />
                </div>
                <div style={{ flex: 1 }}>
                  <div className="blueprint-card-title">
                    {p.shortName}
                  </div>
                  <div className="blueprint-card-subtitle">
                    {p.topics.length} topics
                  </div>
                </div>
              </div>

              <div className="blueprint-card-progress-section">
                <div className="blueprint-card-progress-header">
                  <span className="blueprint-card-progress-label">
                    {p.percent === 100 ? 'Complete' : 'Progress'}
                  </span>
                  <span className="blueprint-card-progress-value" style={{ '--dynamic-color': p.percent > 0 ? p.color : 'var(--color-text-tertiary)' }}>
                    {p.filled}/{p.total}
                  </span>
                </div>
                <div className="blueprint-card-progress-bg">
                  <div className="blueprint-card-progress-fill" style={{ width: `${Math.max(p.percent, 0)}%`, '--dynamic-color': p.color }} />
                </div>
              </div>
            </div>
          ))}
        </div>
        </div>
      </PullToRefresh>
    )
  }

  // ── Pillar selected but no topic ──────────────────────────────────────────
  if (!topic) {
    return (
      <div className="page-wrapper blueprint-topic-wrapper">
        <div style={{ marginBottom: 'var(--space-6)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
            <span
              className="badge"
              style={{ background: `${pillar.color}20`, color: pillar.color }}
            >
              Pillar {pillar.number}
            </span>
          </div>
          <h1 className="page-title">{pillar.name}</h1>
          <p className="page-description">
            Select a topic below to view its study blueprint.
          </p>
        </div>

        <div className="guide-grid">
          {pillar.topics.map((t) => (
            <div
              key={t.id}
              className="blueprint-pillar-card"
              onClick={() => navigate(`/guide/${pillar.id}/${t.id}`)}
              style={{ '--dynamic-color': pillar.color }}
            >
              <div className="blueprint-pillar-card-header">
                <div className="blueprint-pillar-icon-wrap">
                  <Cpu size={20} className="blueprint-pillar-icon" />
                </div>
                <div>
                  <div className="blueprint-card-title" style={{ fontSize: 'var(--text-md)' }}>
                    {t.name}
                  </div>
                  <div className="blueprint-card-subtitle">
                    {sections.length} blueprint sections
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Full blueprint view for selected topic ────────────────────────────────
  return (
    <div className="page-wrapper blueprint-topic-wrapper">
      {/* Topic header */}
      <div className="blueprint-topic-header">
        <div className="blueprint-badge-wrap">
          <span
            className="badge blueprint-badge"
            style={{ '--dynamic-color': pillar.color }}
          >
            Pillar {pillar.number}: {pillar.shortName}
          </span>
        </div>
        <h1 className="page-title">{topic.name}</h1>
        <div className="blueprint-topic-actions">
          <p className="page-description" style={{ margin: 0 }}>
            Study blueprint — deep dive into every dimension of this component.
          </p>
          <button
            className="btn btn-secondary btn-sm"
            style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}
            onClick={handleGenerateFlashcards}
            disabled={isGeneratingCards}
          >
            {isGeneratingCards ? <Sparkles size={12} style={{ animation: 'pulse 1.5s infinite' }} /> : <Layers size={12} />}
            {isGeneratingCards ? 'Generating...' : 'Generate Flashcards'}
          </button>
          <button
            className="btn btn-primary btn-sm"
            style={{ fontSize: 'var(--text-xs)', color: 'var(--color-bg-primary)', whiteSpace: 'nowrap' }}
            onClick={() => navigate('/chat')}
          >
            <Sparkles size={12} />
            Study in Chat
          </button>
        </div>
      </div>

      <FlashcardReviewModal
        open={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        cards={generatedCards}
        topicName={topic.name}
        pillarId={pillarId}
        topicId={topicId}
      />

      {/* Blueprint sections */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {sections.map((section) => {
          const Icon = iconMap[section.icon] || Cpu
          const isExpanded = !!expandedSections[section.id]
          const committed = sectionContent[section.id]
          const hasContent = committed?.content && committed.content.trim().length > 0
          const isEditing = editingSection === section.id

          return (
            <div
              key={section.id}
              className="card"
              id={`blueprint-${section.id}`}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: isMobile ? 'var(--space-2)' : 'var(--space-4)' }}>
                <div
                  className="blueprint-section-icon-wrap"
                  style={{
                    width: isMobile ? 28 : 40, height: isMobile ? 28 : 40,
                    borderRadius: 'var(--radius-md)',
                    background: hasContent ? `color-mix(in srgb, ${pillar.color} 15%, transparent)` : 'var(--color-accent-subtle)',
                  }}
                >
                  <Icon size={isMobile ? 14 : 18} style={{ color: hasContent ? pillar.color : 'var(--color-accent)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Section header */}
                  <div className="blueprint-section-header-row">
                    <h3
                      className="blueprint-section-title"
                      onClick={() => toggleSection(section.id)}
                    >
                      {section.name}
                    </h3>

                    {/* Status badge */}
                    {!isLoadingContent && (
                      <span className={`blueprint-status-badge ${hasContent ? 'filled' : 'empty'}`}>
                        {hasContent ? '✓ Filled' : 'Empty'}
                      </span>
                    )}

                    {/* Edit / Clear actions — only when content exists and not editing */}
                    {hasContent && !isEditing && (
                      <div className="blueprint-edit-actions">
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => startEdit(section.id)}
                          title="Edit content"
                          style={{ width: 26, height: 26 }}
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          onClick={() => clearSection(section.id)}
                          title="Clear section"
                          style={{ width: 26, height: 26, color: 'var(--color-error)' }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}

                    {/* Edit action — when empty and not editing */}
                    {!hasContent && !isEditing && (
                      <button
                        className="btn btn-ghost btn-sm blueprint-add-notes-btn"
                        onClick={() => startEdit(section.id)}
                        title="Add notes manually"
                      >
                        <Edit3 size={11} />
                        Add notes
                      </button>
                    )}
                  </div>

                  {/* Edit mode textarea (Desktop) */}
                  {!isMobile && isEditing && (
                    <div style={{ marginTop: 'var(--space-2)' }}>
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={12}
                        placeholder="Write markdown notes for this section..."
                        className="blueprint-edit-textarea"
                      />
                      <div className="blueprint-edit-actions-bottom">
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={cancelEdit}
                          disabled={isSaving}
                        >
                          <X size={12} />
                          Cancel
                        </button>
                        <button
                          className="btn btn-primary btn-sm"
                          onClick={() => saveEdit(section.id)}
                          disabled={isSaving || !editDraft.trim()}
                        >
                          {isSaving ? <RefreshCw size={12} className="spin" /> : <Save size={12} />}
                          Save Notes
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Content display */}
                  {!isEditing && isExpanded && (
                    <div>
                      {isLoadingContent ? (
                        <div className="blueprint-content blueprint-content-box blueprint-content-text">
                          <Skeleton style={{ width: '60%', height: 24, marginBottom: 'var(--space-4)' }} />
                          <Skeleton style={{ width: '100%', height: 16, marginBottom: 'var(--space-2)' }} />
                          <Skeleton style={{ width: '95%', height: 16, marginBottom: 'var(--space-2)' }} />
                          <Skeleton style={{ width: '80%', height: 16 }} />
                        </div>
                      ) : hasContent ? (
                        <div className="blueprint-content blueprint-content-box blueprint-content-text">
                          <MarkdownRenderer content={committed.content} />
                          {committed.committedAt && (
                            <div className="blueprint-content-timestamp">
                              Last updated {new Date(committed.committedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="blueprint-content-box empty">
                          No notes yet. Start a learning session, then commit insights here, or click "Add notes" to write manually.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Edit mode textarea (Mobile - Full Width) */}
              {isMobile && isEditing && (
                <div style={{ marginTop: 'var(--space-3)', marginLeft: '-2px', marginRight: '-2px' }}>
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={14}
                    placeholder="Write markdown notes for this section..."
                    className="blueprint-edit-textarea blueprint-edit-textarea-mobile"
                  />
                  <div className="blueprint-edit-actions-bottom">
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={cancelEdit}
                      disabled={isSaving}
                    >
                      <X size={12} />
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => saveEdit(section.id)}
                      disabled={isSaving || !editDraft.trim()}
                    >
                      {isSaving ? <RefreshCw size={12} className="spin" /> : <Save size={12} />}
                      Save Notes
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
