import { useState, useEffect } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import { X, Edit3, Trash2, Save, Layers, Loader2, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { decksApi, flashcardsApi, chatApi } from '../../utils/api'
import type {
  DuplicateMatchItem,
  GeneratedFlashcardDraft,
  ReverseCardDraft,
} from '../../utils/api'
import useAppStore from '../../stores/appStore'
import useIsMobile from '../../hooks/useIsMobile'
import MarkdownRenderer from './MarkdownRenderer'

export interface FlashcardReviewModalProps {
  open: boolean
  onClose: () => void
  cards?: GeneratedFlashcardDraft[]
  topicName?: string
  pillarId?: string | null
  topicId?: string | null
  onSaved?: (createdCardIds: string[]) => void
}

interface SectionCardGroup {
  sectionName: string | null
  cards: Array<{ card: GeneratedFlashcardDraft; index: number }>
}

const CAPTION_LABEL_STYLE: CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  color: 'var(--color-text-tertiary)',
  letterSpacing: '0.05em',
  marginBottom: 4,
}

const EDIT_LABEL_STYLE: CSSProperties = {
  fontSize: 'var(--text-xs)',
  fontWeight: 600,
  color: 'var(--color-text-secondary)',
  marginBottom: '4px',
  display: 'block',
}

const EDIT_TEXTAREA_STYLE: CSSProperties = {
  width: '100%',
  padding: 'var(--space-2)',
  background: 'var(--color-surface)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--color-text-primary)',
  fontSize: 'var(--text-sm)',
  resize: 'none',
  overflow: 'hidden',
}

const autoGrow = (el: HTMLTextAreaElement | null) => {
  if (el) {
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }
}

const handleTextareaInput = (e: FormEvent<HTMLTextAreaElement>) => autoGrow(e.currentTarget)

function CardEditForm({
  front,
  back,
  onFrontChange,
  onBackChange,
  onSave,
  onCancel,
}: {
  front: string
  back: string
  onFrontChange: (v: string) => void
  onBackChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
}) {
  const onCmdEnter = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      onSave()
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {[
        { label: 'Front', value: front, onChange: onFrontChange },
        { label: 'Back', value: back, onChange: onBackChange },
      ].map((f) => (
        <div key={f.label}>
          <label style={EDIT_LABEL_STYLE}>{f.label}</label>
          <textarea
            ref={autoGrow}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            onInput={handleTextareaInput}
            onKeyDown={onCmdEnter}
            style={EDIT_TEXTAREA_STYLE}
          />
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary btn-sm" onClick={onSave}>
          Save Edits
        </button>
      </div>
    </div>
  )
}

function CardFacePreview({
  front,
  back,
  isMobile,
  isExcluded = false,
  labelColor = 'var(--color-text-tertiary)',
  frontBadge,
  actions,
}: {
  front: string
  back: string
  isMobile: boolean
  isExcluded?: boolean
  labelColor?: string
  frontBadge?: ReactNode
  actions: ReactNode
}) {
  return (
    <>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 'var(--space-3)',
          gap: 'var(--space-2)',
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
            <div style={{ ...CAPTION_LABEL_STYLE, color: labelColor, marginBottom: 0 }}>FRONT</div>
            {frontBadge}
          </div>
          <div
            style={{
              fontWeight: 600,
              fontSize: 'var(--text-sm)',
              color: isExcluded ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
              lineHeight: 'var(--leading-relaxed)',
              textDecoration: isExcluded ? 'line-through' : 'none',
            }}
          >
            <MarkdownRenderer content={front} className="flashcard-compact-md" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>{actions}</div>
      </div>
      <div>
        <div style={{ ...CAPTION_LABEL_STYLE, color: labelColor }}>BACK</div>
        <div
          style={{
            fontSize: 'var(--text-sm)',
            color: isExcluded ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
            background: 'var(--color-surface)',
            padding: isMobile ? 'var(--space-2)' : 'var(--space-3)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--color-border)',
            lineHeight: 'var(--leading-relaxed)',
            textDecoration: isExcluded ? 'line-through' : 'none',
          }}
        >
          <MarkdownRenderer content={back} className="flashcard-compact-md" />
        </div>
      </div>
    </>
  )
}

function SectionDivider({
  label,
  color,
  count,
  marginTop,
}: {
  label: ReactNode
  color: string
  count: number
  marginTop: number | string
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'var(--space-2)',
        marginBottom: 'var(--space-3)',
        marginTop,
      }}
    >
      <div
        style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
        }}
      >
        {label}
      </div>
      <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
      <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
        {count} card{count !== 1 ? 's' : ''}
      </span>
    </div>
  )
}

export default function FlashcardReviewModal({
  open,
  onClose,
  cards: initialCards,
  topicName,
  pillarId,
  topicId,
  onSaved,
}: FlashcardReviewModalProps) {
  const addToast = useAppStore((s) => s.addToast)
  const selectedModel = useAppStore((s) => s.model)
  const [cards, setCards] = useState<GeneratedFlashcardDraft[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')

  const [duplicateMap, setDuplicateMap] = useState<Record<number, DuplicateMatchItem>>({})
  const [excludedIndexes, setExcludedIndexes] = useState<Set<number>>(new Set())
  const [isCheckingDupes, setIsCheckingDupes] = useState(false)

  const [reverseEnabled, setReverseEnabled] = useState(false)
  const [isGeneratingReverse, setIsGeneratingReverse] = useState(false)
  const [reverseCards, setReverseCards] = useState<ReverseCardDraft[]>([])

  const [editingReverseIndex, setEditingReverseIndex] = useState<number | null>(null)
  const [editReverseFront, setEditReverseFront] = useState('')
  const [editReverseBack, setEditReverseBack] = useState('')
  const [generatingReverseIndexes, setGeneratingReverseIndexes] = useState<Set<number>>(new Set())
  const [expandedDuplicateIndexes, setExpandedDuplicateIndexes] = useState<Set<number>>(new Set())

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const target = e.target as HTMLElement | null
        if (target?.tagName?.toLowerCase() === 'textarea') return
        document.getElementById('flashcard-save-all-btn')?.click()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (open && initialCards) {
      setCards(initialCards)
      setDuplicateMap({})
      setExcludedIndexes(new Set())
      setReverseEnabled(false)
      setReverseCards([])
      setEditingIndex(null)
      setEditingReverseIndex(null)
      setGeneratingReverseIndexes(new Set())
      setExpandedDuplicateIndexes(new Set())
    }
  }, [open, initialCards])

  // Run duplicate check when cards are loaded and a deck exists for this topic
  useEffect(() => {
    const trimmedTopic = topicName?.trim()
    if (!open || !initialCards || initialCards.length === 0 || !trimmedTopic) return

    let cancelled = false

    const checkDuplicates = async () => {
      let startedCheck = false
      try {
        const allDecks = await decksApi.list()
        if (cancelled) return
        const deck = allDecks.find((d) => d.name.toLowerCase() === trimmedTopic.toLowerCase())
        if (!deck) return

        startedCheck = true
        setIsCheckingDupes(true)
        const cardsToCheck = initialCards.map((c) => ({ front: c.front, back: c.back }))
        const result = await flashcardsApi.checkDuplicates(deck.id, cardsToCheck)
        if (cancelled) return

        if (result?.results) {
          const newDupeMap: Record<number, DuplicateMatchItem> = {}
          const newExcluded = new Set<number>()
          result.results.forEach((r, i) => {
            if (r.isDuplicate) {
              newDupeMap[i] = {
                isDuplicate: true,
                duplicateOf: r.duplicateOf,
                similarity: r.similarity,
              }
              newExcluded.add(i)
            }
          })
          setDuplicateMap(newDupeMap)
          setExcludedIndexes(newExcluded)
        }
      } catch {
        // Silently fail — duplicate check is best-effort
      } finally {
        if (startedCheck && !cancelled) {
          setIsCheckingDupes(false)
        }
      }
    }

    void checkDuplicates()
    return () => {
      cancelled = true
    }
  }, [open, initialCards, topicName])

  const isMobile = useIsMobile()

  if (!open) return null

  const removeCard = (index: number) => {
    setCards((prev) => prev.filter((_, i) => i !== index))
    setDuplicateMap((prev) => {
      const next: Record<number, DuplicateMatchItem> = {}
      for (const [k, v] of Object.entries(prev)) {
        const ki = Number(k)
        if (ki < index) next[ki] = v
        else if (ki > index) next[ki - 1] = v
      }
      return next
    })
    setExcludedIndexes((prev) => {
      const next = new Set<number>()
      for (const ki of prev) {
        if (ki < index) next.add(ki)
        else if (ki > index) next.add(ki - 1)
      }
      return next
    })
  }

  const toggleSet = (
    setter: React.Dispatch<React.SetStateAction<Set<number>>>,
    idx: number,
  ) => {
    setter((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const enrichReverse = (
    rc: ReverseCardDraft,
    src: GeneratedFlashcardDraft | undefined,
    originalIndex = rc.originalIndex,
  ): ReverseCardDraft => ({
    ...rc,
    originalIndex,
    sourceSectionId: src?.sourceSectionId,
    sourceSectionName: src?.sourceSectionName,
    sourcePillarId: src?.sourcePillarId || pillarId || null,
    sourceTopicId: src?.sourceTopicId || topicId || null,
  })

  const startEdit = (index: number, card: GeneratedFlashcardDraft) => {
    setEditingIndex(index)
    setEditFront(card.front)
    setEditBack(card.back)
  }

  const saveEdit = () => {
    if (editingIndex !== null) {
      setCards((prev) =>
        prev.map((c, idx) =>
          idx === editingIndex ? { ...c, front: editFront, back: editBack } : c,
        ),
      )
      setEditingIndex(null)
    }
  }

  const startEditReverse = (index: number, card: ReverseCardDraft) => {
    setEditingReverseIndex(index)
    setEditReverseFront(card.front)
    setEditReverseBack(card.back)
  }

  const saveEditReverse = () => {
    if (editingReverseIndex !== null) {
      setReverseCards((prev) =>
        prev.map((c, idx) =>
          idx === editingReverseIndex
            ? { ...c, front: editReverseFront, back: editReverseBack }
            : c,
        ),
      )
      setEditingReverseIndex(null)
    }
  }

  const handleGenerateSingleReverse = async (
    originalIndex: number,
    card: GeneratedFlashcardDraft,
  ) => {
    setGeneratingReverseIndexes((prev) => new Set(prev).add(originalIndex))
    try {
      const res = await chatApi.generateReverseCards({
        cards: [{ front: card.front, back: card.back }],
        model: selectedModel,
      })
      if (res?.reverseCards?.length > 0) {
        setReverseCards((prev) => [
          ...prev,
          enrichReverse(res.reverseCards[0], card, originalIndex),
        ])
        addToast({ type: 'success', message: 'Generated reverse card' })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate reverse card',
      })
    } finally {
      setGeneratingReverseIndexes((prev) => {
        const next = new Set(prev)
        next.delete(originalIndex)
        return next
      })
    }
  }

  const removeAllDuplicates = () => {
    const dupeIndexes = Object.keys(duplicateMap).map(Number)
    setCards((prev) => prev.filter((_, i) => !dupeIndexes.includes(i)))
    setDuplicateMap({})
    setExcludedIndexes(new Set())
  }

  const handleGenerateReverse = async () => {
    const includedCards = cards.filter((_, i) => !excludedIndexes.has(i))
    if (includedCards.length === 0) return

    setIsGeneratingReverse(true)
    try {
      const res = await chatApi.generateReverseCards({
        cards: includedCards.map((c) => ({ front: c.front, back: c.back })),
        model: selectedModel,
      })
      if (res?.reverseCards?.length > 0) {
        const enrichedReverse = res.reverseCards.map((rc) =>
          enrichReverse(rc, includedCards[rc.originalIndex]),
        )
        setReverseCards(enrichedReverse)
        addToast({
          type: 'success',
          message: `Generated ${enrichedReverse.length} reverse card(s)`,
        })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate reverse cards',
      })
      setReverseEnabled(false)
    } finally {
      setIsGeneratingReverse(false)
    }
  }

  const handleReverseToggle = () => {
    if (!reverseEnabled) {
      setReverseEnabled(true)
      void handleGenerateReverse()
    } else {
      setReverseEnabled(false)
      setReverseCards([])
    }
  }

  const handleSaveAll = async () => {
    const includedCards = cards.filter((_, i) => !excludedIndexes.has(i))
    const allCardsToSave: GeneratedFlashcardDraft[] = [...includedCards, ...reverseCards]
    if (allCardsToSave.length === 0) return
    setIsSaving(true)

    try {
      const allDecks = await decksApi.list()
      let deck = allDecks.find((d) => d.name.toLowerCase() === topicName?.toLowerCase())

      if (!deck) {
        deck = await decksApi.create({ name: topicName || 'Generated Cards' })
      }

      const createdCardIds: string[] = []
      for (let i = 0; i < allCardsToSave.length; i++) {
        const card = allCardsToSave[i]
        const isReverse = i >= includedCards.length
        const cardData = {
          front: card.front,
          back: card.back,
          source_pillar_id: card.sourcePillarId || pillarId || null,
          source_topic_id: card.sourceTopicId || topicId || null,
          source_section_id: card.sourceSectionId || null,
          is_reverse: isReverse ? 1 : 0,
        }
        const created = await flashcardsApi.create(deck.id, cardData)
        if (created && typeof (created as { id?: unknown }).id === 'string') {
          createdCardIds.push((created as { id: string }).id)
        }
      }

      const originalCount = includedCards.length
      const reverseCount = reverseCards.length
      const msg =
        reverseCount > 0
          ? `Saved ${originalCount} card(s) + ${reverseCount} reverse card(s) to "${deck.name}"`
          : `Saved ${originalCount} flashcard(s) to "${deck.name}" deck.`
      addToast({ type: 'success', message: msg })
      onSaved?.(createdCardIds)
      onClose()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to save flashcards.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const duplicateCount = Object.keys(duplicateMap).length
  const includedCount = cards.filter((_, i) => !excludedIndexes.has(i)).length

  const sectionGroups: SectionCardGroup[] = []
  const hasAnySections = cards.some((c) => c.sourceSectionId)

  if (hasAnySections) {
    const groupMap = new Map<string, SectionCardGroup>()
    cards.forEach((card, i) => {
      const key = card.sourceSectionId || '__unsorted__'
      if (!groupMap.has(key)) {
        groupMap.set(key, {
          sectionName: card.sourceSectionName || 'Other',
          cards: [],
        })
      }
      groupMap.get(key)?.cards.push({ card, index: i })
    })
    sectionGroups.push(...groupMap.values())
  } else {
    sectionGroups.push({
      sectionName: null,
      cards: cards.map((card, i) => ({ card, index: i })),
    })
  }

  const renderCard = (card: GeneratedFlashcardDraft, i: number) => {
    const isDupe = duplicateMap[i]
    const isExcluded = excludedIndexes.has(i)

    return (
      <div
        key={i}
        style={{
          background: 'var(--color-bg-secondary)',
          border: `1px solid ${isDupe ? 'rgba(245, 158, 11, 0.4)' : 'var(--color-border)'}`,
          borderLeft: isDupe ? '3px solid #f59e0b' : undefined,
          borderRadius: 'var(--radius-lg)',
          padding: isMobile ? 'var(--space-3)' : 'var(--space-4)',
          opacity: isExcluded ? 0.45 : 1,
          transition: 'opacity 0.2s ease',
        }}
      >
        {editingIndex === i ? (
          <CardEditForm
            front={editFront}
            back={editBack}
            onFrontChange={setEditFront}
            onBackChange={setEditBack}
            onSave={saveEdit}
            onCancel={() => setEditingIndex(null)}
          />
        ) : (
          <>
            {isDupe && (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'var(--space-2)',
                  padding: 'var(--space-2) var(--space-3)',
                  marginBottom: 'var(--space-3)',
                  background: 'rgba(245, 158, 11, 0.08)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid rgba(245, 158, 11, 0.2)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--text-xs)',
                    color: '#d97706',
                  }}
                >
                  <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 500 }}>
                    {isDupe.similarity}% similar to existing card
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                    onClick={() => toggleSet(setExpandedDuplicateIndexes, i)}
                  >
                    {expandedDuplicateIndexes.has(i) ? 'Hide' : 'Compare'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                    onClick={() => toggleSet(setExcludedIndexes, i)}
                  >
                    {isExcluded ? 'Include Card' : 'Exclude Card'}
                  </button>
                </div>
                {expandedDuplicateIndexes.has(i) && (
                  <div
                    style={{
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-3)',
                      background: 'var(--color-surface)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-sm)',
                      color: 'var(--color-text-secondary)',
                    }}
                  >
                    <div style={CAPTION_LABEL_STYLE}>EXISTING FRONT</div>
                    <div
                      style={{
                        fontWeight: 600,
                        color: 'var(--color-text-primary)',
                        marginBottom: 'var(--space-2)',
                      }}
                    >
                      <MarkdownRenderer
                        content={isDupe.duplicateOf?.front}
                        className="flashcard-compact-md"
                      />
                    </div>
                    <div style={CAPTION_LABEL_STYLE}>EXISTING BACK</div>
                    <div>
                      <MarkdownRenderer
                        content={isDupe.duplicateOf?.back}
                        className="flashcard-compact-md"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            <CardFacePreview
              front={card.front}
              back={card.back}
              isMobile={isMobile}
              isExcluded={isExcluded}
              actions={
                <>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => void handleGenerateSingleReverse(i, card)}
                    title="Generate Reverse"
                    disabled={generatingReverseIndexes.has(i) || isExcluded}
                    style={{ width: 32, height: 32, color: 'var(--color-teal)' }}
                  >
                    {generatingReverseIndexes.has(i) ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      <ArrowRightLeft size={14} />
                    )}
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => startEdit(i, card)}
                    title="Edit"
                    style={{ width: 32, height: 32 }}
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    className="btn btn-ghost btn-icon btn-sm"
                    onClick={() => removeCard(i)}
                    title="Remove"
                    style={{ color: 'var(--color-error)', width: 32, height: 32 }}
                  >
                    <Trash2 size={14} />
                  </button>
                </>
              }
            />
          </>
        )}
      </div>
    )
  }

  return (
    <div
      className="flashcard-review-overlay"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: isMobile ? 0 : 'var(--space-4)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onClose()
      }}
    >
      <div
        className="flashcard-review-modal"
        style={{
          background: 'var(--color-surface)',
          borderRadius: isMobile ? 0 : 'var(--radius-xl)',
          border: isMobile ? 'none' : '1px solid var(--color-border)',
          width: '100%',
          maxWidth: isMobile ? '100%' : 640,
          height: isMobile ? '100%' : 'auto',
          maxHeight: isMobile ? '100%' : '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: isMobile ? 'none' : '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isMobile ? 'var(--space-4)' : 'var(--space-5) var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              minWidth: 0,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-accent-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Layers size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>Review Flashcards</div>
              <div
                style={{
                  fontSize: 'var(--text-xs)',
                  color: 'var(--color-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                Deck: {topicName || 'Generated Cards'}
                {isCheckingDupes && (
                  <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>
                    • Checking duplicates…
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            disabled={isSaving}
            style={{ width: 36, height: 36, flexShrink: 0 }}
          >
            <X size={18} />
          </button>
        </div>

        {duplicateCount > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: 'var(--space-2) var(--space-4)',
              background: 'rgba(245, 158, 11, 0.06)',
              borderBottom: '1px solid rgba(245, 158, 11, 0.15)',
              fontSize: 'var(--text-xs)',
              color: '#d97706',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <AlertTriangle size={13} />
              <span>
                <strong>{duplicateCount}</strong> potential duplicate
                {duplicateCount > 1 ? 's' : ''} found
              </span>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '11px', padding: '2px 10px', color: '#d97706' }}
              onClick={removeAllDuplicates}
            >
              Remove All
            </button>
          </div>
        )}

        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: isMobile ? 'var(--space-3)' : 'var(--space-4) var(--space-6)',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          {cards.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: 'var(--space-8)',
                color: 'var(--color-text-tertiary)',
              }}
            >
              No cards generated or all removed.
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: isMobile ? 'var(--space-3)' : 'var(--space-4)',
              }}
            >
              {sectionGroups.map((group, gi) => (
                <div key={gi}>
                  {group.sectionName && hasAnySections && (
                    <SectionDivider
                      label={group.sectionName}
                      color="var(--color-accent)"
                      count={group.cards.length}
                      marginTop={gi > 0 ? 'var(--space-4)' : 0}
                    />
                  )}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'var(--space-3)',
                    }}
                  >
                    {group.cards.map(({ card, index }) => renderCard(card, index))}
                  </div>
                </div>
              ))}

              {reverseCards.length > 0 && (
                <div>
                  <SectionDivider
                    label={
                      <>
                        <ArrowRightLeft size={12} />
                        Reverse Cards
                      </>
                    }
                    color="var(--color-teal)"
                    count={reverseCards.length}
                    marginTop="var(--space-4)"
                  />
                  <div
                    style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}
                  >
                    {reverseCards.map((rc, ri) => (
                      <div
                        key={`reverse-${ri}`}
                        style={{
                          background: 'var(--color-bg-secondary)',
                          border: '1px solid var(--color-border)',
                          borderLeft: '3px solid var(--color-teal)',
                          borderRadius: 'var(--radius-lg)',
                          padding: isMobile ? 'var(--space-3)' : 'var(--space-4)',
                        }}
                      >
                        {editingReverseIndex === ri ? (
                          <CardEditForm
                            front={editReverseFront}
                            back={editReverseBack}
                            onFrontChange={setEditReverseFront}
                            onBackChange={setEditReverseBack}
                            onSave={saveEditReverse}
                            onCancel={() => setEditingReverseIndex(null)}
                          />
                        ) : (
                          <CardFacePreview
                            front={rc.front}
                            back={rc.back}
                            isMobile={isMobile}
                            labelColor="var(--color-teal)"
                            frontBadge={
                              <div
                                style={{
                                  fontSize: '9px',
                                  padding: '1px 5px',
                                  borderRadius: 'var(--radius-full)',
                                  background: 'rgba(20, 184, 166, 0.1)',
                                  color: 'var(--color-teal)',
                                  fontWeight: 600,
                                  flexShrink: 0,
                                }}
                              >
                                ↩ Reverse
                              </div>
                            }
                            actions={
                              <>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  onClick={() => startEditReverse(ri, rc)}
                                  title="Edit"
                                  style={{ width: 32, height: 32 }}
                                >
                                  <Edit3 size={14} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-icon btn-sm"
                                  onClick={() =>
                                    setReverseCards((prev) => prev.filter((_, idx) => idx !== ri))
                                  }
                                  title="Remove"
                                  style={{ color: 'var(--color-error)', width: 32, height: 32 }}
                                >
                                  <Trash2 size={14} />
                                </button>
                              </>
                            }
                          />
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            padding: isMobile ? 'var(--space-3) var(--space-4)' : 'var(--space-4) var(--space-6)',
            borderTop: '1px solid var(--color-border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
            background: 'var(--color-bg-secondary)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleReverseToggle}
              disabled={isGeneratingReverse || isSaving || includedCount === 0}
              style={{
                fontSize: 'var(--text-xs)',
                color: reverseEnabled ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-1)',
              }}
            >
              {isGeneratingReverse ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <ArrowRightLeft size={13} />
              )}
              {isGeneratingReverse
                ? 'Generating…'
                : reverseEnabled
                  ? 'Reverse On'
                  : 'Generate Reverse Cards'}
            </button>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
              {includedCount} card{includedCount !== 1 ? 's' : ''}
              {reverseCards.length > 0 ? ` + ${reverseCards.length} reverse` : ''}
            </span>
          </div>

          <div
            style={{
              display: 'flex',
              flexDirection: isMobile ? 'column' : 'row',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
            }}
          >
            <button
              className={
                includedCount + reverseCards.length === 0 ? 'btn btn-primary' : 'btn btn-secondary'
              }
              onClick={onClose}
              disabled={isSaving}
              style={isMobile ? { width: '100%', height: 44, justifyContent: 'center' } : {}}
            >
              {includedCount + reverseCards.length === 0 ? 'Close' : 'Cancel'}
            </button>
            <button
              id="flashcard-save-all-btn"
              className={
                includedCount + reverseCards.length === 0 ? 'btn btn-ghost' : 'btn btn-primary'
              }
              onClick={() => void handleSaveAll()}
              disabled={includedCount + reverseCards.length === 0 || isSaving}
              style={
                isMobile
                  ? {
                      width: '100%',
                      height: 48,
                      justifyContent: 'center',
                      fontSize: 'var(--text-md)',
                    }
                  : {}
              }
            >
              {isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              {isSaving
                ? 'Saving...'
                : `Save ${includedCount + reverseCards.length} Card${
                    includedCount + reverseCards.length === 1 ? '' : 's'
                  }`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
