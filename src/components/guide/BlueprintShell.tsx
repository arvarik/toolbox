import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router'
import {
  Cpu,
  Scale,
  TrendingUp,
  Shield,
  Box,
  Radio,
  Target,
  Link,
  SlidersHorizontal,
  AlertTriangle,
  DollarSign,
  Layers,
  GitBranch,
  Filter,
  RefreshCw,
  Edit3,
  Save,
  X,
  Trash2,
  BookOpen,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import type { SectionLens } from '../../../shared/kits/kitSkeleton'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import FlashcardReviewModal from '../shared/FlashcardReviewModal'
import Skeleton from '../shared/Skeleton'
import PullToRefresh from '../shared/PullToRefresh'
import { DomainGlyph, HighlightableProse, NotebookSheet, resolveKitGlyph } from '../ui'
import * as apiModule from '../../utils/api'
import {
  guideContentApi,
  chatApi,
  type GeneratedFlashcardDraft,
  type GuideDogearItem,
  type GuideHighlightItem,
  type HighlightColor,
} from '../../utils/api'
import useAppStore from '../../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'
import useIsMobile from '../../hooks/useIsMobile'

const EMPTY_SECTIONS: SectionLens[] = []

const iconMap: Record<string, LucideIcon> = {
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

interface CommittedSection {
  content: string
  committedAt: string | null
}

interface OptionalDeckApis {
  decksApi?: {
    list?: () => Promise<Array<{ id: string; name: string }>>
  }
  flashcardsApi?: {
    create?: (deckId: string, data: object) => Promise<unknown>
  }
}

function safeGetDeckApis(): OptionalDeckApis {
  const out: OptionalDeckApis = {}
  try {
    const mod = apiModule as unknown as OptionalDeckApis
    if ('decksApi' in mod) out.decksApi = mod.decksApi
    if ('flashcardsApi' in mod) out.flashcardsApi = mod.flashcardsApi
  } catch {
    // ignore partial mock errors
  }
  return out
}

function openGuideCompanionChat() {
  const state = useAppStore.getState() as unknown as {
    chatOpen?: Record<string, boolean>
    toggleChat?: (page: string) => void
    setChatOpen?: (page: string, open: boolean) => void
  }
  if (typeof state.setChatOpen === 'function') {
    state.setChatOpen('guide', true)
  } else if (!state.chatOpen?.guide && typeof state.toggleChat === 'function') {
    state.toggleChat('guide')
  }
}

export interface BlueprintShellProps {
  dogears?: GuideDogearItem[]
  onToggleDogear?: (pillarId: string, topicId: string, sectionId?: string) => void
  onAskKit?: (quote: string) => void
}

/**
 * Blueprint content shell — displays living textbook pages for a selected topic
 * with folded dogears, 3-ink highlights, and inline note editing.
 */
export default function BlueprintShell({
  dogears: controlledDogears,
  onToggleDogear: controlledToggleDogear,
  onAskKit: controlledAskKit,
}: BlueprintShellProps = {}) {
  const { pillarId, topicId } = useParams()
  const navigate = useNavigate()
  const addToast = useAppStore((s) => s.addToast)
  const { kitSlug, skeleton, pillars, sectionsByPillar } = useActiveKit()
  const prefix = useKitRoutePrefix()

  const pillar = pillars.find((p) => p.id === pillarId)
  const topic = pillar?.topics.find((t) => t.id === topicId)
  const sections = (pillarId && sectionsByPillar[pillarId]) || EMPTY_SECTIONS

  const contextKey = `${prefix}:${kitSlug ?? ''}:${pillarId ?? ''}:${topicId ?? ''}`
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>(() =>
    sections.length > 0 ? { [sections[0].id]: true } : {},
  )
  const [prevContextKey, setPrevContextKey] = useState(contextKey)

  // Progress data for library landing page: { 'pillarId__topicId__sectionId': true }
  const [progress, setProgress] = useState<Record<string, boolean>>({})

  // Content per sectionId
  const [sectionContent, setSectionContent] = useState<Record<string, CommittedSection>>({})
  const [isLoadingContent, setIsLoadingContent] = useState(false)

  // Highlights & fallback local dogears (when rendered standalone outside GuidePage)
  const [highlights, setHighlights] = useState<GuideHighlightItem[]>([])
  const [localDogears, setLocalDogears] = useState<GuideDogearItem[]>([])
  const effectiveDogears = controlledDogears ?? localDogears

  // Edit mode state
  const [editingSection, setEditingSection] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const isMobile = useIsMobile()

  // Flashcards state
  const selectedModel = useAppStore((s) => s.model)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [generatedCards, setGeneratedCards] = useState<GeneratedFlashcardDraft[]>([])
  const [isGeneratingCards, setIsGeneratingCards] = useState(false)

  // Reset expanded/edit state when Kit, pillar, or topic changes
  if (contextKey !== prevContextKey) {
    setPrevContextKey(contextKey)
    setExpandedSections(sections.length > 0 ? { [sections[0].id]: true } : {})
    setEditingSection(null)
  }

  // Fetch committed content when pillar+topic+Kit are selected
  const fetchContent = useCallback(() => {
    if (!pillarId || !topicId) return
    setIsLoadingContent(true)
    Promise.resolve(guideContentApi?.getForTopic?.(pillarId, topicId))
      .then((data) => setSectionContent((data as Record<string, CommittedSection>) || {}))
      .catch(() => setSectionContent({}))
      .finally(() => setIsLoadingContent(false))
  }, [pillarId, topicId])

  useEffect(() => {
    setSectionContent({})
    fetchContent()
    const onUpdated = () => fetchContent()
    window.addEventListener('guide-progress-updated', onUpdated)
    return () => window.removeEventListener('guide-progress-updated', onUpdated)
  }, [fetchContent, prefix, kitSlug])

  // Load 3-ink textbook highlights for the active topic
  useEffect(() => {
    if (!pillarId || !topicId) {
      setHighlights([])
      return
    }
    let active = true
    Promise.resolve(guideContentApi?.listHighlights?.(pillarId, topicId))
      .then((items) => {
        if (active) setHighlights(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (active) setHighlights([])
      })
    return () => {
      active = false
    }
  }, [pillarId, topicId, prefix, kitSlug])

  // Load fallback dogears if not controlled by GuidePage
  useEffect(() => {
    if (controlledDogears !== undefined) return
    let active = true
    Promise.resolve(guideContentApi?.listDogears?.())
      .then((items) => {
        if (active) setLocalDogears(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (active) setLocalDogears([])
      })
    return () => {
      active = false
    }
  }, [controlledDogears, prefix, kitSlug])

  // Fetch progress map for the library landing page
  const fetchProgress = useCallback(async () => {
    try {
      const data = (await Promise.resolve(guideContentApi?.progress?.())) as Record<
        string,
        boolean
      > | null
      setProgress(data || {})
    } catch {
      setProgress({})
    }
  }, [])

  useEffect(() => {
    if (!pillarId) {
      void fetchProgress()
      const onUpdated = () => {
        void fetchProgress()
      }
      window.addEventListener('guide-progress-updated', onUpdated)
      return () => window.removeEventListener('guide-progress-updated', onUpdated)
    }
  }, [pillarId, prefix, kitSlug, fetchProgress])

  const handleToggleDogear = useCallback(
    (pId: string, tId: string, secId = '') => {
      if (controlledToggleDogear) {
        controlledToggleDogear(pId, tId, secId)
        return
      }
      setLocalDogears((prev) => {
        const exists = prev.some(
          (d) => d.pillarId === pId && d.topicId === tId && (d.sectionId || '') === secId,
        )
        return exists
          ? prev.filter(
              (d) =>
                !(d.pillarId === pId && d.topicId === tId && (d.sectionId || '') === secId),
            )
          : [
              ...prev,
              { pillarId: pId, topicId: tId, sectionId: secId, createdAt: new Date().toISOString() },
            ]
      })
      void Promise.resolve(guideContentApi?.toggleDogear?.(pId, tId, secId))
        .then(() => window.dispatchEvent(new Event('guide-dogears-updated')))
        .catch(() => null)
    },
    [controlledToggleDogear],
  )

  const handleAddHighlight = useCallback(
    (
      sectionId: string,
      quote: string,
      color: HighlightColor,
      prefixText = '',
      suffixText = '',
    ) => {
      if (!pillarId || !topicId) return
      const tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
      const optimistic: GuideHighlightItem = {
        id: tempId,
        pillarId,
        topicId,
        sectionId,
        quote,
        prefix: prefixText,
        suffix: suffixText,
        color,
        note: '',
        cardId: null,
        createdAt: new Date().toISOString(),
        updatedAt: null,
      }
      setHighlights((prev) => [...prev, optimistic])

      void Promise.resolve(
        guideContentApi?.createHighlight?.({
          pillarId,
          topicId,
          sectionId,
          quote,
          prefix: prefixText,
          suffix: suffixText,
          color,
        }),
      )
        .then((saved) => {
          if (saved?.id) {
            setHighlights((prev) => prev.map((h) => (h.id === tempId ? saved : h)))
          }
        })
        .catch(() => null)
    },
    [pillarId, topicId],
  )

  const handleRemoveHighlight = useCallback((id: string) => {
    setHighlights((prev) => prev.filter((h) => h.id !== id))
    if (!id.startsWith('temp-')) {
      void Promise.resolve(guideContentApi?.deleteHighlight?.(id)).catch(() => null)
    }
  }, [])

  const handleAskKit = useCallback(
    (quote: string) => {
      try {
        localStorage.setItem('toolbox_chat_quote', quote)
      } catch {
        /* ignore */
      }
      window.dispatchEvent(new CustomEvent('toolbox:ask-kit', { detail: { quote } }))
      if (controlledAskKit) {
        controlledAskKit(quote)
      } else {
        openGuideCompanionChat()
      }
    },
    [controlledAskKit],
  )

  const handleMakeCardFromQuote = useCallback(
    async (sectionId: string, sectionName: string, quote: string) => {
      const clipped = quote.length > 88 ? `${quote.slice(0, 85)}…` : quote
      const frontPrompt = `Explain in ${topic?.name || 'this topic'} (${sectionName}): “${clipped}”`

      const { decksApi, flashcardsApi } = safeGetDeckApis()
      if (decksApi?.list && flashcardsApi?.create) {
        try {
          const decks = await Promise.resolve(decksApi.list())
          const firstDeck = Array.isArray(decks) ? decks[0] : undefined
          if (firstDeck?.id) {
            await Promise.resolve(
              flashcardsApi.create(firstDeck.id, {
                front: frontPrompt,
                back: quote,
                source_pillar_id: pillarId ?? null,
                source_topic_id: topicId ?? null,
                source_section_id: sectionId,
              }),
            )
            addToast({
              type: 'success',
              message: `Added flashcard to "${firstDeck.name}"`,
            })
            return
          }
        } catch {
          // fall through to review modal
        }
      }

      setGeneratedCards([
        {
          front: frontPrompt,
          back: quote,
          sourceSectionId: sectionId,
          sourceSectionName: sectionName,
          sourcePillarId: pillarId ?? null,
          sourceTopicId: topicId ?? null,
        },
      ])
      setShowReviewModal(true)
      addToast({ type: 'info', message: 'Drafted flashcard from highlight' })
    },
    [topic?.name, pillarId, topicId, addToast],
  )

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }))
  }

  const startEdit = (sectionId: string) => {
    const existing = sectionContent[sectionId]?.content || ''
    setEditDraft(existing)
    setEditingSection(sectionId)
  }

  const cancelEdit = () => {
    setEditingSection(null)
    setEditDraft('')
  }

  const saveEdit = async (sectionId: string) => {
    if (!pillarId || !topicId) return
    setIsSaving(true)
    try {
      await guideContentApi.upsert(pillarId, topicId, sectionId, editDraft)
      setSectionContent((prev) => ({
        ...prev,
        [sectionId]: { content: editDraft, committedAt: new Date().toISOString() },
      }))
      setEditingSection(null)
      setEditDraft('')
      window.dispatchEvent(new Event('guide-progress-updated'))
      addToast({ type: 'success', message: 'Section updated' })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save' })
    } finally {
      setIsSaving(false)
    }
  }

  const clearSection = (sectionId: string) => {
    if (!pillarId || !topicId) return
    const oldContent = sectionContent[sectionId]

    setSectionContent((prev) => {
      const next = { ...prev }
      delete next[sectionId]
      return next
    })

    const actionId = `clear-section-${pillarId}-${topicId}-${sectionId}`
    useAppStore.getState().scheduleAction(
      actionId,
      async () => {
        try {
          await guideContentApi.clear(pillarId, topicId, sectionId)
          window.dispatchEvent(new Event('guide-progress-updated'))
        } catch (err) {
          useAppStore.getState().addToast({
            type: 'error',
            message: err instanceof Error ? err.message : 'Failed to clear',
          })
        }
      },
      5000,
    )

    addToast({
      type: 'info',
      message: 'Section cleared',
      action: {
        label: 'Undo',
        onClick: () => {
          if (useAppStore.getState().cancelAction(actionId) && oldContent) {
            setSectionContent((prev) => ({ ...prev, [sectionId]: oldContent }))
          }
        },
      },
    })
  }

  const handleGenerateFlashcards = async () => {
    let sectionEntries = sections
      .filter((s) => sectionContent[s.id]?.content?.trim())
      .map((s) => ({
        sectionId: s.id,
        sectionName: s.name,
        content: sectionContent[s.id].content,
      }))

    if (sectionEntries.length === 0) {
      sectionEntries = sections.map((s) => ({
        sectionId: s.id,
        sectionName: s.name,
        content: `Foundational ${skeleton.identity.name} principles, core mechanics, and tradeoffs for "${topic?.name || 'Topic'}" in ${s.name}${s.promptHint ? `: ${s.promptHint}` : ''}`,
      }))
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
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate flashcards',
      })
    } finally {
      setIsGeneratingCards(false)
    }
  }

  // ── No pillar selected — Library overview landing ───────────────────────────
  if (!pillar) {
    const pillarStats = pillars.map((p) => {
      const bpSections = sectionsByPillar[p.id] || []
      const total = p.topics.length * bpSections.length
      const filled = p.topics.reduce((acc, t) => {
        return acc + bpSections.filter((s) => progress[`${p.id}__${t.id}__${s.id}`]).length
      }, 0)
      return {
        ...p,
        filled,
        total,
        percent: total > 0 ? Math.round((filled / total) * 100) : 0,
      }
    })

    const totalSections = pillarStats.reduce((a, p) => a + p.total, 0)
    const totalFilled = pillarStats.reduce((a, p) => a + p.filled, 0)
    const overallPercent =
      totalSections > 0 ? Math.round((totalFilled / totalSections) * 100) : 0

    const heroDescription =
      skeleton.identity.slug === 'system-design'
        ? 'Reference notes organized across seven foundational pillars.'
        : skeleton.identity.description ||
          `Reference notes across ${pillars.length} pillars for ${skeleton.identity.name}.`

    return (
      <PullToRefresh onRefresh={fetchProgress}>
        <div className="page-wrapper blueprint-library-wrapper">
          {/* Hero header */}
          <div className="blueprint-library-hero">
            <div className="blueprint-hero-icon border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink)]">
              <DomainGlyph
                kind={resolveKitGlyph(skeleton.identity.slug)}
                size={24}
              />
            </div>
            <h1 className="page-title blueprint-hero-title font-serif">
              {skeleton.identity.name} Guide
            </h1>
            <p className="page-description blueprint-hero-desc">{heroDescription}</p>
          </div>

          {/* Overall progress card */}
          <div className="blueprint-progress-card rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-5 shadow-[var(--shadow-hairline)]">
            <div className="blueprint-progress-header">
              <div>
                <div className="mb-1 text-[14px] font-medium text-[var(--color-ink)]">
                  Library Progress
                </div>
                <div className="text-[12px] text-[var(--color-ink-muted)] tabular-nums">
                  {totalFilled} of {totalSections} sections filled across all pillars
                </div>
              </div>
              <div className="font-mono text-[22px] font-semibold text-[var(--color-ink)] tabular-nums">
                {overallPercent}%
              </div>
            </div>

            <div className="blueprint-progress-bar-bg">
              <div
                className="blueprint-progress-bar-fill !bg-[var(--color-ink)]"
                style={{ width: `${overallPercent}%` }}
              />
            </div>

            <button
              type="button"
              className="btn btn-primary w-full justify-center text-[13.5px]"
              onClick={() => navigate(`${prefix}/chat`)}
            >
              <Sparkles size={14} />
              {totalFilled > 0 ? 'Continue Studying →' : 'Start Studying →'}
            </button>
          </div>

          {/* Pillar cards grid */}
          <div className="blueprint-pillar-list-header">Pillars</div>

          <div className="guide-grid">
            {pillarStats.map((p) => (
              <div
                key={p.id}
                className="blueprint-pillar-card notebook-sheet cursor-pointer"
                onClick={() => navigate(`${prefix}/guide/${p.id}`)}
              >
                <div className="blueprint-pillar-card-header">
                  <div className="blueprint-pillar-icon-wrap border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink-muted)]">
                    <span className="font-mono text-[12px] font-semibold tabular-nums">
                      {p.number}
                    </span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="blueprint-card-title font-serif">{p.shortName}</div>
                    <div className="blueprint-card-subtitle">{p.topics.length} topics</div>
                  </div>
                </div>

                <div className="blueprint-card-progress-section">
                  <div className="blueprint-card-progress-header">
                    <span className="blueprint-card-progress-label">
                      {p.percent === 100 ? 'Complete' : 'Progress'}
                    </span>
                    <span className="blueprint-card-progress-value font-mono text-[var(--color-ink-muted)] tabular-nums">
                      {p.filled}/{p.total}
                    </span>
                  </div>
                  <div className="blueprint-card-progress-bg">
                    <div
                      className="blueprint-card-progress-fill !bg-[var(--color-ink-muted)]"
                      style={{ width: `${Math.max(p.percent, 0)}%` }}
                    />
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
        <div className="mb-6">
          <div className="mb-2 flex items-center gap-3">
            <span className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[var(--color-ink-muted)]">
              Pillar {pillar.number}
            </span>
          </div>
          <h1 className="page-title font-serif">{pillar.name}</h1>
          <p className="page-description">
            Select a topic below to view its study blueprint.
          </p>
        </div>

        <div className="guide-grid">
          {pillar.topics.map((t) => (
            <div
              key={t.id}
              className="blueprint-pillar-card notebook-sheet cursor-pointer"
              onClick={() => navigate(`${prefix}/guide/${pillar.id}/${t.id}`)}
            >
              <div className="blueprint-pillar-card-header">
                <div className="blueprint-pillar-icon-wrap border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink-muted)]">
                  <BookOpen size={16} />
                </div>
                <div>
                  <div className="blueprint-card-title font-serif text-[16px]">
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

  const isTopicDogeared = effectiveDogears.some(
    (d) =>
      d.pillarId === pillar.id &&
      d.topicId === topic.id &&
      (d.sectionId || '') === '',
  )

  // ── Full notebook view for selected topic ────────────────────────────────
  return (
    <div className="page-wrapper blueprint-topic-wrapper">
      <NotebookSheet
        dogeared={isTopicDogeared}
        onToggleDogear={() => handleToggleDogear(pillar.id, topic.id, '')}
        dogearTestId="topic-dogear-btn"
        className="blueprint-topic-header mb-6 p-5 sm:p-6"
      >
        <div className="blueprint-badge-wrap pr-8">
          <span className="rounded-md border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2.5 py-0.5 font-mono text-[11px] font-medium text-[var(--color-ink-muted)]">
            Pillar {pillar.number}: {pillar.shortName}
          </span>
        </div>
        <h1 className="page-title mt-2 pr-8 font-serif">{topic.name}</h1>
        <div className="blueprint-topic-actions mt-2">
          <p className="page-description m-0 text-[var(--color-ink-muted)]">
            Highlight key passages, fold dogears, or study with Kit.
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm whitespace-nowrap"
            onClick={() => {
              void handleGenerateFlashcards()
            }}
            disabled={isGeneratingCards}
          >
            <Layers size={12} />
            {isGeneratingCards ? 'Generating...' : 'Generate Flashcards'}
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm whitespace-nowrap"
            onClick={() => navigate(`${prefix}/chat`)}
          >
            <Sparkles size={12} />
            Study in Chat
          </button>
        </div>
      </NotebookSheet>

      <FlashcardReviewModal
        open={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        cards={generatedCards}
        topicName={topic.name}
        pillarId={pillarId}
        topicId={topicId}
      />

      <div className="flex flex-col gap-4">
        {sections.map((section) => {
          const Icon = iconMap[section.icon] || Cpu
          const isExpanded = Boolean(expandedSections[section.id])
          const committed = sectionContent[section.id]
          const hasContent = Boolean(
            committed?.content && committed.content.trim().length > 0,
          )
          const isEditing = editingSection === section.id
          const isSectionDogeared = effectiveDogears.some(
            (d) =>
              d.pillarId === pillar.id &&
              d.topicId === topic.id &&
              d.sectionId === section.id,
          )
          const sectionHighlights = highlights.filter((h) => h.sectionId === section.id)

          const editActions = isEditing && (
            <div className="blueprint-edit-actions-bottom">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={cancelEdit}
                disabled={isSaving}
              >
                <X size={12} />
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  void saveEdit(section.id)
                }}
                disabled={isSaving || !editDraft.trim()}
              >
                {isSaving ? <RefreshCw size={12} className="spin" /> : <Save size={12} />}
                Save Notes
              </button>
            </div>
          )

          return (
            <NotebookSheet
              key={section.id}
              id={`blueprint-${section.id}`}
              dogeared={isSectionDogeared}
              onToggleDogear={() => handleToggleDogear(pillar.id, topic.id, section.id)}
              dogearTestId={`dogear-${section.id}`}
              className="card p-5"
            >
              <div
                className={`flex items-start ${
                  isMobile ? 'gap-2.5' : 'gap-4'
                }`}
              >
                <div
                  className={`blueprint-section-icon-wrap border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink-muted)] ${
                    isMobile ? 'h-7 w-7' : 'h-9 w-9'
                  }`}
                >
                  <Icon size={isMobile ? 14 : 16} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="blueprint-section-header-row pr-6">
                    <h3
                      className="blueprint-section-title font-serif"
                      onClick={() => toggleSection(section.id)}
                    >
                      {section.name}
                    </h3>

                    {!isLoadingContent && (
                      <span
                        className={`blueprint-status-badge ${
                          hasContent ? 'filled' : 'empty'
                        }`}
                      >
                        {hasContent ? '✓ Filled' : 'Empty'}
                      </span>
                    )}

                    {hasContent && !isEditing && (
                      <div className="blueprint-edit-actions">
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm h-[26px] w-[26px]"
                          onClick={() => startEdit(section.id)}
                          title="Edit content"
                        >
                          <Edit3 size={12} />
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost btn-icon btn-sm h-[26px] w-[26px] text-[var(--color-err)]"
                          onClick={() => clearSection(section.id)}
                          title="Clear section"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    )}

                    {!hasContent && !isEditing && (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm blueprint-add-notes-btn"
                        onClick={() => startEdit(section.id)}
                        title="Add notes manually"
                      >
                        <Edit3 size={11} />
                        Add notes
                      </button>
                    )}
                  </div>

                  {!isMobile && isEditing && (
                    <div className="mt-2">
                      <textarea
                        value={editDraft}
                        onChange={(e) => setEditDraft(e.target.value)}
                        rows={12}
                        placeholder="Write markdown notes for this section..."
                        className="blueprint-edit-textarea"
                      />
                      {editActions}
                    </div>
                  )}

                  {!isEditing && isExpanded && (
                    <div>
                      {isLoadingContent ? (
                        <div className="blueprint-content blueprint-content-box blueprint-content-text">
                          <Skeleton
                            style={{
                              width: '60%',
                              height: 24,
                              marginBottom: 'var(--space-4)',
                            }}
                          />
                          <Skeleton
                            style={{
                              width: '100%',
                              height: 16,
                              marginBottom: 'var(--space-2)',
                            }}
                          />
                          <Skeleton
                            style={{
                              width: '95%',
                              height: 16,
                              marginBottom: 'var(--space-2)',
                            }}
                          />
                          <Skeleton style={{ width: '80%', height: 16 }} />
                        </div>
                      ) : hasContent && committed ? (
                        <div className="blueprint-content blueprint-content-box blueprint-content-text">
                          <HighlightableProse
                            contentKey={committed.content}
                            highlights={sectionHighlights}
                            onAddHighlight={(quote, color, prefixText, suffixText) =>
                              handleAddHighlight(
                                section.id,
                                quote,
                                color,
                                prefixText,
                                suffixText,
                              )
                            }
                            onRemoveHighlight={handleRemoveHighlight}
                            onAskKit={handleAskKit}
                            onMakeCard={(quote) => {
                              void handleMakeCardFromQuote(
                                section.id,
                                section.name,
                                quote,
                              )
                            }}
                          >
                            <MarkdownRenderer content={committed.content} />
                          </HighlightableProse>
                          {committed.committedAt && (
                            <div className="blueprint-content-timestamp">
                              Last updated{' '}
                              {new Date(committed.committedAt).toLocaleDateString()}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="blueprint-content-box empty">
                          No notes yet. Start a learning session, then commit insights
                          here, or click &quot;Add notes&quot; to write manually.
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {isMobile && isEditing && (
                <div className="mt-3 -mx-0.5">
                  <textarea
                    value={editDraft}
                    onChange={(e) => setEditDraft(e.target.value)}
                    rows={14}
                    placeholder="Write markdown notes for this section..."
                    className="blueprint-edit-textarea blueprint-edit-textarea-mobile"
                  />
                  {editActions}
                </div>
              )}
            </NotebookSheet>
          )
        })}
      </div>
    </div>
  )
}
