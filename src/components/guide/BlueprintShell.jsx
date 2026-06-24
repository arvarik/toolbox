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
  useEffect(() => {
    if (!pillarId) {
      guideContentApi.progress()
        .then((data) => setProgress(data || {}))
        .catch(() => setProgress({}))
    }
  }, [pillarId])

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

  const clearSection = async (sectionId) => {
    try {
      await guideContentApi.clear(pillarId, topicId, sectionId)
      setSectionContent((prev) => {
        const next = { ...prev }
        delete next[sectionId]
        return next
      })
      addToast({ type: 'info', message: 'Section cleared' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to clear' })
    }
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
      <div className="page-wrapper" style={{ padding: isMobile ? 'var(--space-4) var(--space-3)' : 'var(--space-8)', maxWidth: 960, margin: '0 auto' }}>
        {/* Hero header */}
        <div style={{ marginBottom: 'var(--space-8)', textAlign: 'center' }}>
          <div style={{
            width: 56, height: 56, borderRadius: 'var(--radius-xl)',
            background: 'var(--color-accent-subtle)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto var(--space-4)',
          }}>
            <BookOpen size={28} style={{ color: 'var(--color-accent)' }} />
          </div>
          <h1 className="page-title" style={{ fontSize: 'var(--text-3xl)', marginBottom: 'var(--space-2)' }}>
            System Design Guide
          </h1>
          <p className="page-description" style={{ maxWidth: 520, margin: '0 auto', fontSize: 'var(--text-sm)' }}>
            Your authoritative library of system design knowledge across seven pillars.
            Study through chat, then commit insights here for reference.
          </p>
        </div>

        {/* Overall progress card */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-xl)',
          padding: 'var(--space-6)',
          marginBottom: 'var(--space-8)',
        }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            marginBottom: 'var(--space-4)',
          }}>
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
          <div style={{
            height: 6, background: 'var(--color-bg-tertiary)',
            borderRadius: 'var(--radius-full)', overflow: 'hidden',
            marginBottom: 'var(--space-4)',
          }}>
            <div style={{
              height: '100%',
              width: `${overallPercent}%`,
              background: 'linear-gradient(90deg, var(--color-accent), var(--color-teal))',
              borderRadius: 'var(--radius-full)',
              transition: 'width 0.6s ease',
            }} />
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
        <div style={{ marginBottom: 'var(--space-4)' }}>
          <div style={{
            fontSize: 'var(--text-xs)', fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: 'var(--tracking-wide)',
            color: 'var(--color-text-tertiary)',
            marginBottom: 'var(--space-4)',
          }}>
            Pillars
          </div>
        </div>

        <div className="guide-grid">
          {pillarStats.map((p) => (
            <div
              key={p.id}
              className="card card-interactive"
              onClick={() => navigate(`/guide/${p.id}`)}
              style={{ 
                display: 'flex', 
                flexDirection: 'column', 
                padding: 'var(--space-5)', 
                position: 'relative', 
                overflow: 'hidden',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = p.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 4px 12px ${p.color}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                marginBottom: 'var(--space-4)',
              }}>
                <div
                  style={{
                    width: 40, height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: `${p.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Cpu size={20} style={{ color: p.color }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {p.shortName}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                    {p.topics.length} topics
                  </div>
                </div>
              </div>

              {/* Progress Section */}
              <div style={{ marginTop: 'auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontSize: '11px', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                    {p.percent === 100 ? 'Complete' : 'Progress'}
                  </span>
                  <span style={{ fontSize: '11px', color: p.percent > 0 ? p.color : 'var(--color-text-tertiary)', fontWeight: 600 }}>
                    {p.filled}/{p.total}
                  </span>
                </div>
                <div style={{
                  height: 4, background: 'var(--color-bg-tertiary)',
                  borderRadius: 'var(--radius-full)', overflow: 'hidden',
                }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.max(p.percent, 0)}%`,
                    background: p.color,
                    borderRadius: 'var(--radius-full)',
                    transition: 'width 0.4s ease',
                  }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── Pillar selected but no topic ──────────────────────────────────────────
  if (!topic) {
    return (
      <div className="page-wrapper" style={{ padding: isMobile ? 'var(--space-4) var(--space-3)' : 'var(--space-8)' }}>
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
              className="card card-interactive"
              onClick={() => navigate(`/guide/${pillar.id}/${t.id}`)}
              style={{ 
                cursor: 'pointer',
                display: 'flex', 
                flexDirection: 'column', 
                padding: 'var(--space-5)', 
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-xl)',
                transition: 'all 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = pillar.color;
                e.currentTarget.style.transform = 'translateY(-2px)';
                e.currentTarget.style.boxShadow = `0 4px 12px ${pillar.color}15`;
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--color-border)';
                e.currentTarget.style.transform = 'translateY(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div
                  style={{
                    width: 40, height: 40,
                    borderRadius: 'var(--radius-md)',
                    background: `${pillar.color}15`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Cpu size={20} style={{ color: pillar.color }} />
                </div>
                <div>
                  <div style={{ fontSize: 'var(--text-md)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
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
    <div className="page-wrapper" style={{ padding: isMobile ? 'var(--space-4) var(--space-3)' : 'var(--space-8)' }}>
      {/* Topic header */}
      <div style={{ marginBottom: 'var(--space-8)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
          <span
            className="badge"
            style={{ background: `${pillar.color}20`, color: pillar.color }}
          >
            Pillar {pillar.number}: {pillar.shortName}
          </span>
        </div>
        <h1 className="page-title">{topic.name}</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
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
                  style={{
                    width: isMobile ? 28 : 40, height: isMobile ? 28 : 40,
                    borderRadius: 'var(--radius-md)',
                    background: hasContent ? `${pillar.color}15` : 'var(--color-accent-subtle)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    transition: 'background var(--duration-fast)',
                  }}
                >
                  <Icon size={isMobile ? 14 : 18} style={{ color: hasContent ? pillar.color : 'var(--color-accent)' }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {/* Section header */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                    <h3
                      style={{ fontSize: 'var(--text-md)', fontWeight: 600, cursor: 'pointer', flex: 1, margin: 0 }}
                      onClick={() => toggleSection(section.id)}
                    >
                      {section.name}
                    </h3>

                    {/* Status badge */}
                    {!isLoadingContent && (
                      <span style={{
                        fontSize: '10px', fontWeight: 600, padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: hasContent ? 'rgba(34,197,94,0.12)' : 'var(--color-bg-tertiary)',
                        color: hasContent ? '#22c55e' : 'var(--color-text-tertiary)',
                        whiteSpace: 'nowrap',
                      }}>
                        {hasContent ? '✓ Filled' : 'Empty'}
                      </span>
                    )}

                    {/* Edit / Clear actions — only when content exists and not editing */}
                    {hasContent && !isEditing && (
                      <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
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
                        className="btn btn-ghost btn-sm"
                        onClick={() => startEdit(section.id)}
                        title="Add notes manually"
                        style={{ fontSize: '11px', color: 'var(--color-text-tertiary)' }}
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
                        style={{
                          width: '100%',
                          padding: 'var(--space-3)',
                          background: 'var(--color-bg-secondary)',
                          border: '1px solid var(--color-accent)',
                          borderRadius: 'var(--radius-md)',
                          color: 'var(--color-text-primary)',
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--text-xs)',
                          lineHeight: 1.6,
                          resize: 'vertical',
                          outline: 'none',
                        }}
                      />
                      <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', justifyContent: 'flex-end' }}>
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
                        <div style={{
                          height: 60,
                          background: 'var(--color-bg-hover)',
                          borderRadius: 'var(--radius-md)',
                          animation: 'pulse 1.5s ease-in-out infinite',
                        }} />
                      ) : hasContent ? (
                        <div
                          className="blueprint-content"
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-secondary)',
                            lineHeight: 'var(--leading-relaxed)',
                            padding: 'var(--space-4)',
                            background: 'var(--color-bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                          }}
                        >
                          <MarkdownRenderer content={committed.content} />
                          {committed.committedAt && (
                            <div style={{
                              marginTop: 'var(--space-3)',
                              paddingTop: 'var(--space-2)',
                              borderTop: '1px solid var(--color-border)',
                              fontSize: '10px',
                              color: 'var(--color-text-tertiary)',
                            }}>
                              Last updated {new Date(committed.committedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div
                          style={{
                            fontSize: 'var(--text-sm)',
                            color: 'var(--color-text-tertiary)',
                            lineHeight: 'var(--leading-relaxed)',
                            padding: 'var(--space-4)',
                            background: 'var(--color-bg-tertiary)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px dashed var(--color-border)',
                            minHeight: 60,
                          }}
                        >
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
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: 'var(--space-3)',
                      background: 'var(--color-bg-secondary)',
                      border: '1px solid var(--color-accent)',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text-primary)',
                      fontFamily: 'var(--font-mono)',
                      fontSize: '14px',
                      lineHeight: 1.6,
                      resize: 'vertical',
                      outline: 'none',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-2)', justifyContent: 'flex-end' }}>
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
