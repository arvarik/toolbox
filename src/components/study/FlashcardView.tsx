import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type TouchEvent as ReactTouchEvent,
} from 'react'
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Shuffle,
  ArrowLeft,
  Clock,
  Keyboard,
  BookOpen,
  Wrench,
  MessageSquare,
  Layers,
  Loader2,
  PenLine,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { flashcardsApi, chatApi } from '../../utils/api'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../../shared/kits/systemDesignKit'
import StudySessionSummary, { type StudySessionStats } from './StudySessionSummary'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import { AnkiGradeBar, Kbd, KitAvatar, type AnkiGrade } from '../ui'
import useAppStore from '../../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../../stores/useKitStore'

export interface SrsPreviews {
  again: string
  hard: string
  good: string
  easy: string
}

export interface FlashcardItem {
  id: string
  deck_id?: string
  deckName?: string
  front: string
  back: string
  state?: number
  learning_step?: number
  ease_factor?: number
  interval?: number
  repetitions?: number
  next_review?: string | null
  position?: number
  prerequisite_id?: string | null
  srs_previews?: SrsPreviews
  source_pillar_id?: string | null
  source_topic_id?: string | null
  source_section_id?: string | null
  is_reverse?: number
  reverse_of_id?: string | null
  is_remediation?: number
  remediation_node?: string | null
  remediation_reason?: string | null
}

interface ReviewCardResponse extends Partial<FlashcardItem> {
  remediation?: Array<{ nodeName?: string }>
}

interface GuideLinkInfo {
  url: string
  sectionName: string
}

const GRADE_TO_QUALITY: Record<AnkiGrade, 1 | 3 | 4 | 5> = {
  again: 1,
  hard: 3,
  good: 4,
  easy: 5,
}

export interface FlashcardViewProps {
  cards?: ReadonlyArray<FlashcardItem>
  onBack?: () => void
  deckName?: string
  deckId?: string
  reviewMode?: boolean
}

export default function FlashcardView({
  cards = [],
  onBack,
  deckName,
  deckId,
  reviewMode = false,
}: FlashcardViewProps) {
  const navigate = useNavigate()
  const { skeleton, capabilities, sectionsByPillar } = useActiveKit()
  const prefix = useKitRoutePrefix()

  const [sessionQueue, setSessionQueue] = useState<FlashcardItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [typeAnswerOpen, setTypeAnswerOpen] = useState(false)
  const [typedAnswer, setTypedAnswer] = useState('')
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [sessionStats, setSessionStats] = useState<StudySessionStats | null>(null)
  const [showHotkeysGuide, setShowHotkeysGuide] = useState(false)
  const [interceptorActive, setInterceptorActive] = useState(false)
  const [interceptorQuality, setInterceptorQuality] = useState<number | null>(null)
  const [interceptorInput, setInterceptorInput] = useState('')
  const [interceptorLoading, setInterceptorLoading] = useState(false)
  const [interceptorFeedback, setInterceptorFeedback] = useState<string | null>(null)
  const [guideLink, setGuideLink] = useState<GuideLinkInfo | null>(null)

  const startTimeRef = useRef<number>(0)
  const ratingsRef = useRef<Record<number, number>>({})
  const correctCountRef = useRef<number>(0)
  const typeInputRef = useRef<HTMLTextAreaElement>(null)

  // Load cards into the dynamic session queue
  useEffect(() => {
    if (cards.length > 0) {
      setSessionQueue([...cards])
      setCurrentIndex(0)
      setFlipped(false)
      setTypedAnswer('')
      setIsReviewing(false)
      setReviewedCount(0)
      setSessionStats(null)
      startTimeRef.current = Date.now()
      ratingsRef.current = {}
      correctCountRef.current = 0
      setInterceptorActive(false)
      setInterceptorQuality(null)
      setInterceptorInput('')
      setInterceptorFeedback(null)
    } else {
      setSessionQueue([])
    }
  }, [cards])

  useEffect(() => {
    if (reviewMode && typeAnswerOpen && !flipped) {
      typeInputRef.current?.focus()
    }
  }, [reviewMode, typeAnswerOpen, flipped, currentIndex])

  const currentCard = sessionQueue[currentIndex]
  const isDone = reviewMode && sessionStats !== null

  // Compute dynamic counters for remaining cards in queue (New, Learn, Due)
  const remainingCards = sessionQueue.slice(currentIndex)
  const newCount = remainingCards.filter((c) => (c.state || 0) === 0).length
  const learnCount = remainingCards.filter((c) => c.state === 1 || c.state === 3).length
  const dueCount = remainingCards.filter((c) => c.state === 2).length

  const touchStartX = useRef<number | null>(null)
  const touchEndX = useRef<number | null>(null)

  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (reviewMode) return
    const touch = e.targetTouches[0]
    if (touch) touchStartX.current = touch.clientX
  }

  const handleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (reviewMode || touchStartX.current === null) return
    const touch = e.targetTouches[0]
    if (touch) touchEndX.current = touch.clientX
  }

  const handleTouchEnd = () => {
    if (reviewMode || touchStartX.current === null || touchEndX.current === null) return
    const diff = touchStartX.current - touchEndX.current
    if (Math.abs(diff) > 50) {
      if (diff > 0) {
        handleNext()
      } else {
        handlePrev()
      }
    }
    touchStartX.current = null
    touchEndX.current = null
  }

  const handleFlip = () => {
    if (!isReviewing) {
      setFlipped(!flipped)
    }
  }

  const handlePrev = () => {
    if (reviewMode) return
    setFlipped(false)
    setTypedAnswer('')
    setCurrentIndex((i) => Math.max(0, i - 1))
  }

  const handleNext = () => {
    setFlipped(false)
    setTypedAnswer('')
    setCurrentIndex((i) => Math.min(sessionQueue.length - 1, i + 1))
  }

  const handleShuffle = () => {
    setFlipped(false)
    setTypedAnswer('')
    setCurrentIndex(Math.floor(Math.random() * sessionQueue.length))
  }

  const handleReset = () => {
    setFlipped(false)
    setTypedAnswer('')
    setCurrentIndex(0)
    setReviewedCount(0)
  }

  const handleRate = useCallback(
    async (quality: number, skipInterceptor = false) => {
      // The "Why?" Interceptor
      if (!skipInterceptor && reviewMode && (quality === 4 || quality === 5) && Math.random() < 0.1) {
        setInterceptorActive(true)
        setInterceptorQuality(quality)
        setInterceptorInput('')
        setInterceptorFeedback(null)
        return
      }

      const targetDeckId = currentCard?.deck_id || deckId
      if (!currentCard || !targetDeckId || isReviewing) return
      setIsReviewing(true)
      try {
        const updatedCardData = (await flashcardsApi.review(
          targetDeckId,
          currentCard.id,
          quality,
          'medium',
        )) as ReviewCardResponse

        // Let live views (Knowledge Graph heatmap) refresh without a reload
        useAppStore.getState().bumpSrsVersion()

        // The adaptive engine queued prerequisite cards after this lapse
        if (updatedCardData?.remediation && updatedCardData.remediation.length > 0) {
          const names = updatedCardData.remediation
            .map((r) => r.nodeName)
            .filter((name): name is string => Boolean(name))
          useAppStore.getState().addToast({
            type: 'info',
            message: `Foundation checkup queued: ${updatedCardData.remediation.length} prerequisite card${updatedCardData.remediation.length === 1 ? '' : 's'}${names.length > 0 ? ` (${[...new Set(names)].join(', ')})` : ''} added to your next session`,
          })
        }

        if (quality === 5 && !skipInterceptor) {
          useAppStore.getState().triggerAhaMoment()
        }

        const newReviewedCount = reviewedCount + 1
        setReviewedCount(newReviewedCount)

        ratingsRef.current[quality] = (ratingsRef.current[quality] || 0) + 1
        if (quality >= 3) correctCountRef.current += 1

        // Show "Review in Guide" link when rated Again and card has source metadata
        if (quality === 1 && currentCard.source_pillar_id && currentCard.source_topic_id) {
          const sectionId = currentCard.source_section_id
          const pillarId = currentCard.source_pillar_id
          const activePillarSections =
            sectionsByPillar[pillarId] ||
            SYSTEM_DESIGN_KIT_SKELETON.pillars.find((p) => p.id === pillarId)?.sections ||
            []
          const sectionDef = activePillarSections.find((s) => s.id === sectionId)
          const sectionName = sectionDef?.name || 'this section'
          const url = `${prefix}/guide/${currentCard.source_pillar_id}/${currentCard.source_topic_id}${sectionId ? `#blueprint-${sectionId}` : ''}`
          setGuideLink({ url, sectionName })
          setTimeout(() => setGuideLink(null), 4000)
        } else {
          setGuideLink(null)
        }

        // Anki dynamic queue re-insertion logic
        const isStillLearning = updatedCardData.state === 1 || updatedCardData.state === 3

        setFlipped(false)
        setTypedAnswer('')
        const nextIdx = currentIndex + 1

        if (isStillLearning) {
          setSessionQueue((prev) => {
            const newQueue = [...prev]
            const insertPos = Math.min(newQueue.length, currentIndex + 4)
            newQueue.splice(insertPos, 0, { ...currentCard, ...updatedCardData })
            return newQueue
          })
        }

        // Check if session is finished
        if (nextIdx >= sessionQueue.length + (isStillLearning ? 1 : 0)) {
          const finalStats: StudySessionStats = {
            totalCards: newReviewedCount,
            correctCards: correctCountRef.current,
            totalTimeMs: Date.now() - (startTimeRef.current || Date.now()),
            ratings: { ...ratingsRef.current },
          }
          setSessionStats(finalStats)
          setIsReviewing(false)
        } else {
          setTimeout(() => {
            setCurrentIndex(nextIdx)
            setIsReviewing(false)
          }, 150)
        }
      } catch (err) {
        console.error('Review failed:', err)
        setIsReviewing(false)
      }
    },
    [
      currentCard,
      currentIndex,
      deckId,
      isReviewing,
      prefix,
      reviewMode,
      reviewedCount,
      sectionsByPillar,
      sessionQueue.length,
    ],
  )

  // Keyboard Shortcuts listener — Space/Enter ONLY reveals in reviewMode (never auto-grades Good)
  useEffect(() => {
    if (isDone || !currentCard || isReviewing || interceptorActive) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName ? target.tagName.toLowerCase() : ''
      if (tag === 'input' || tag === 'textarea' || Boolean(target?.isContentEditable)) return

      if (e.key === '?' && reviewMode) {
        e.preventDefault()
        setShowHotkeysGuide((v) => !v)
        return
      }

      if (e.key === ' ' || e.code === 'Space' || (reviewMode && e.key === 'Enter')) {
        if (tag === 'button' && e.key === 'Enter') return
        if (!flipped) {
          e.preventDefault()
          setFlipped(true)
        } else if (!reviewMode) {
          e.preventDefault()
          setFlipped(false)
        }
      } else if (reviewMode && flipped) {
        if (e.key === '1') {
          e.preventDefault()
          void handleRate(1)
        } else if (e.key === '2') {
          e.preventDefault()
          void handleRate(3)
        } else if (e.key === '3') {
          e.preventDefault()
          void handleRate(4)
        } else if (e.key === '4') {
          e.preventDefault()
          void handleRate(5)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [flipped, currentCard, reviewMode, isDone, isReviewing, interceptorActive, handleRate])

  const submitInterceptor = async () => {
    if (!interceptorInput.trim() || interceptorLoading || interceptorQuality === null) return
    setInterceptorLoading(true)

    try {
      const evaluation = await chatApi.evaluateInterceptor({
        explanation: interceptorInput,
        front: currentCard?.front,
        back: currentCard?.back,
        model: useAppStore.getState().model || undefined,
      })

      if (evaluation.pass) {
        setInterceptorActive(false)
        useAppStore.getState().triggerAhaMoment()
        void handleRate(interceptorQuality, true)
      } else {
        setInterceptorFeedback(
          evaluation.feedback ||
            'Your explanation was incorrect or incomplete. Please review the material.',
        )
      }
    } catch (err) {
      console.error('Interceptor failed:', err)
      setInterceptorActive(false)
      useAppStore.getState().triggerAhaMoment()
      void handleRate(interceptorQuality, true)
    } finally {
      setInterceptorLoading(false)
    }
  }

  const handleFailAcknowledge = () => {
    setInterceptorActive(false)
    void handleRate(1, true)
  }

  if (sessionQueue.length === 0) {
    return (
      <div className="flashcard-viewer">
        <div className="text-center space-y-4">
          {reviewMode && (
            <div className="flex justify-center">
              <KitAvatar size={32} state="done" />
            </div>
          )}
          <p className="text-sm text-on-surface-variant">
            {reviewMode ? 'No cards due for review.' : 'No cards in this deck yet.'}
          </p>
          <button className="btn btn-secondary" onClick={onBack}>
            <ArrowLeft size={14} />
            Back to Decks
          </button>
        </div>
      </div>
    )
  }

  if (isDone && sessionStats) {
    return (
      <div className="flashcard-viewer" id="flashcard-viewer">
        <StudySessionSummary
          stats={sessionStats}
          onBack={onBack}
          onStudyAgain={() => {
            setSessionQueue([...cards])
            setCurrentIndex(0)
            setReviewedCount(0)
            startTimeRef.current = Date.now()
            ratingsRef.current = {}
            correctCountRef.current = 0
            setSessionStats(null)
            setFlipped(false)
            setTypedAnswer('')
          }}
        />
      </div>
    )
  }

  const previews = currentCard?.srs_previews || { again: '1m', hard: '5m', good: '10m', easy: '4d' }

  const canvasCapability = capabilities?.canvas ?? 'architecture'
  const canvasRoute = `${prefix}/${canvasCapability === 'concept' ? 'canvas' : 'builder'}`
  const canvasLabel = canvasCapability === 'concept' ? 'Concept Canvas' : 'Architecture Canvas'
  const domainLabel =
    skeleton?.identity?.slug === 'system-design' || !skeleton?.identity?.name
      ? 'system design'
      : skeleton.identity.name

  return (
    <div className="flashcard-viewer" id="flashcard-viewer">
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-xl mb-6">
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          {deckName}
        </button>
        <div className="flex items-center gap-2">
          {reviewMode ? (
            <>
              <button
                type="button"
                aria-pressed={typeAnswerOpen}
                onClick={() => {
                  setTypeAnswerOpen((v) => {
                    if (v) setTypedAnswer('')
                    return !v
                  })
                }}
                className={`btn btn-sm ${
                  typeAnswerOpen
                    ? 'bg-primary/15 text-on-primary-wash border-primary/35'
                    : 'btn-ghost'
                }`}
              >
                <PenLine size={12} />
                Type answer
              </button>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary/12 text-on-primary-wash border border-primary/30 inline-flex items-center gap-1">
                <Clock size={12} />
                SRS Review
              </span>
              <button
                className={`btn btn-icon btn-sm ${showHotkeysGuide ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setShowHotkeysGuide(!showHotkeysGuide)}
                title="Keyboard Shortcuts"
                aria-label="Keyboard Shortcuts"
              >
                <Keyboard size={14} />
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-ghost btn-icon" onClick={handleShuffle} title="Shuffle" aria-label="Shuffle">
                <Shuffle size={16} />
              </button>
              <button className="btn btn-ghost btn-icon" onClick={handleReset} title="Reset" aria-label="Reset">
                <RotateCcw size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Foundational checkup banner */}
      {reviewMode && currentCard?.is_remediation === 1 && (
        <div
          className="w-full max-w-xl mb-4 rounded-xl border border-warning/35 bg-warning/10 p-3 text-xs text-on-surface flex items-center gap-2"
          id="remediation-banner"
        >
          <Wrench size={13} className="text-warning shrink-0" />
          <span className="font-semibold">
            Foundation Checkup{currentCard.remediation_node ? ` · ${currentCard.remediation_node}` : ''}
          </span>
          {currentCard.remediation_reason && (
            <span className="text-on-surface-variant">{currentCard.remediation_reason}</span>
          )}
        </div>
      )}

      {/* Card */}
      <div
        className={`flashcard${flipped ? ' flipped' : ''}`}
        onClick={handleFlip}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="flashcard-inner">
          <div className="flashcard-face flashcard-front notebook-sheet">
            <div className="flex justify-between items-center w-full">
              <span className="flashcard-label">Prompt</span>
              {currentCard?.deckName && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-on-surface-variant font-medium">
                  {currentCard.deckName}
                </span>
              )}
            </div>
            <MarkdownRenderer
              content={currentCard?.front}
              className="flashcard-markdown"
              paragraphClassName="flashcard-text"
            />
            <span className="text-xs text-on-surface-variant mt-6">
              Click or press Space to reveal
            </span>
          </div>
          <div className="flashcard-face flashcard-back notebook-sheet">
            <div className="flex justify-between items-center w-full">
              <span className="flashcard-label">Answer</span>
              {currentCard?.deckName && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-on-surface-variant font-medium">
                  {currentCard.deckName}
                </span>
              )}
            </div>
            {reviewMode && typedAnswer.trim() && (
              <div className="w-full rounded-xl border border-outline-variant bg-surface-container-low px-3 py-2 text-xs text-on-surface-variant text-left mb-3">
                <span className="font-semibold text-on-surface">Your recall:</span>{' '}
                {typedAnswer.trim()}
              </div>
            )}
            <MarkdownRenderer
              content={currentCard?.back}
              className="flashcard-markdown"
              paragraphClassName="flashcard-text"
            />
            {(currentCard?.interval ?? 0) > 0 && (
              <span className="text-xs font-mono tabular-nums text-on-surface-variant mt-3">
                Interval: {currentCard?.interval}d · Ease{' '}
                {Math.round((currentCard?.ease_factor || 2.5) * 100)}%
              </span>
            )}
          </div>
        </div>

        {reviewMode && typeAnswerOpen && !flipped && (
          <div className="mt-3 w-full" onClick={(e) => e.stopPropagation()}>
            <textarea
              ref={typeInputRef}
              aria-label="Jot your recall before flipping"
              rows={2}
              value={typedAnswer}
              onChange={(e) => setTypedAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || !e.shiftKey)) {
                  e.preventDefault()
                  setFlipped(true)
                }
              }}
              placeholder="Jot your recall before flipping (Enter to reveal)..."
              className="input w-full text-sm resize-none"
            />
          </div>
        )}

        {!flipped && (
          <div className="mt-4 flex justify-center w-full">
            <button
              type="button"
              className={reviewMode ? 'btn btn-primary px-6 py-2.5' : 'btn btn-outline px-6 py-2.5'}
              onClick={(e) => {
                e.stopPropagation()
                setFlipped(true)
              }}
            >
              <span>{reviewMode ? 'Reveal Answer' : 'Show Answer'}</span>
              <Kbd>Space</Kbd>
            </button>
          </div>
        )}
      </div>

      {/* Anki-style Counts Badge Panel */}
      {reviewMode && (
        <div className="flex justify-center gap-2.5 my-4 w-full max-w-xl font-mono text-xs tabular-nums">
          <span
            className="px-2.5 py-0.5 rounded-md border border-outline-variant bg-surface-container-low text-on-surface-variant"
            title="New cards left"
          >
            {newCount} New
          </span>
          <span
            className="px-2.5 py-0.5 rounded-md border border-outline-variant bg-surface-container-low text-warning"
            title="Learning/relearning cards left"
          >
            {learnCount} Learn
          </span>
          <span
            className="px-2.5 py-0.5 rounded-md border border-outline-variant bg-surface-container-low text-success"
            title="Due review cards left"
          >
            {dueCount} Due
          </span>
        </div>
      )}

      {/* Keyboard Shortcuts Guide Overlay */}
      {reviewMode && showHotkeysGuide && !interceptorActive && (
        <div className="w-full max-w-xl mt-3 rounded-xl border border-outline-variant bg-surface-container-low p-3 text-xs text-on-surface-variant flex flex-wrap gap-x-4 gap-y-1.5 items-center">
          <span className="inline-flex items-center gap-1.5">
            <Kbd>Space</Kbd> Reveal answer
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>1</Kbd> Again
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>2</Kbd> Hard
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>3</Kbd> Good
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Kbd>4</Kbd> Easy
          </span>
        </div>
      )}

      {/* Shared Pure Anki Grade Bar */}
      {!interceptorActive && reviewMode && flipped && (
        <AnkiGradeBar
          intervals={previews}
          disabled={isReviewing}
          onRate={(grade) => void handleRate(GRADE_TO_QUALITY[grade])}
          className="mt-4 w-full max-w-xl"
        />
      )}

      {/* Review in Guide link — appears after rating "Again" on cards with source metadata */}
      {guideLink && reviewMode && (
        <div className="w-full max-w-xl mt-3">
          <Link
            to={guideLink.url}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-outline-variant bg-surface-container-low hover:bg-surface-container text-xs font-semibold text-on-surface transition"
          >
            <BookOpen size={13} />
            Review: {guideLink.sectionName}
          </Link>
        </div>
      )}

      {/* Navigation (for Study mode) */}
      {!reviewMode && (
        <div className="flashcard-controls">
          <button
            className="btn btn-secondary btn-icon"
            onClick={handlePrev}
            disabled={currentIndex === 0}
            aria-label="Previous card"
          >
            <ChevronLeft size={18} />
          </button>
          <span className="flashcard-counter">
            {currentIndex + 1} / {sessionQueue.length}
          </span>
          <button
            className="btn btn-secondary btn-icon"
            onClick={handleNext}
            disabled={currentIndex === sessionQueue.length - 1}
            aria-label="Next card"
          >
            <ChevronRight size={18} />
          </button>
        </div>
      )}

      {/* Review mode counter */}
      {reviewMode && !flipped && (
        <div className="flashcard-controls">
          <span className="flashcard-counter">
            Card {currentIndex + 1} of {sessionQueue.length}
          </span>
        </div>
      )}

      {/* Cross-tool learning loop bar */}
      <div className="flashcard-cross-tool-bar flex items-center justify-center gap-2 mt-4 flex-wrap">
        {currentCard?.source_pillar_id && currentCard?.source_topic_id ? (
          <Link
            to={`${prefix}/guide/${currentCard.source_pillar_id}/${currentCard.source_topic_id}`}
            className="btn btn-ghost btn-sm"
            title="Open related guide topic blueprint and deep dive"
          >
            <BookOpen size={12} /> Guide Note
          </Link>
        ) : null}
        {canvasCapability !== 'none' && (
          <Link
            to={canvasRoute}
            className="btn btn-ghost btn-sm"
            title={`Open ${canvasLabel}`}
          >
            <Layers size={12} /> {canvasLabel}
          </Link>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          title="Ask Kit for deep explanation & tradeoffs"
          onClick={() => {
            const chatRoute = `${prefix}/chat`
            try {
              sessionStorage.setItem(
                'toolbox_chat_draft',
                `Explain this ${domainLabel} concept and its key tradeoffs:\n\n**${currentCard?.front || ''}**\n\n${currentCard?.back || ''}`,
              )
              window.dispatchEvent(new CustomEvent('toolbox-chat-draft'))
              navigate(chatRoute)
            } catch {
              navigate(chatRoute)
            }
          }}
        >
          <MessageSquare size={12} /> Ask Kit
        </button>
      </div>

      {/* Elaborative Interrogation Modal Overlay */}
      {interceptorActive && (
        <div className="modal-overlay">
          <div className="rounded-2xl border border-outline-variant bg-surface-container-low p-6 w-full max-w-lg shadow-xl space-y-4">
            <div className="text-center space-y-1.5">
              <h2 className="font-serif text-xl font-normal text-on-surface">
                Hold on — why does this hold?
              </h2>
              <p className="text-sm text-on-surface-variant">
                You rated this <strong>{interceptorQuality === 5 ? 'Easy' : 'Good'}</strong>. State the underlying mechanism in one or two sentences.
              </p>
            </div>

            {interceptorFeedback ? (
              <div className="rounded-xl border border-error/35 bg-error/10 p-4 text-sm text-error space-y-3">
                <div>
                  <strong className="block mb-1">Feedback</strong>
                  <span className="text-on-surface">{interceptorFeedback}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary w-full"
                  onClick={handleFailAcknowledge}
                >
                  Accept &amp; Rate Again
                </button>
              </div>
            ) : (
              <>
                <textarea
                  aria-label="Explain the underlying concept"
                  className="input min-h-28 text-sm resize-none"
                  placeholder="Type your explanation here…"
                  value={interceptorInput}
                  onChange={(e) => setInterceptorInput(e.target.value)}
                  autoFocus
                  disabled={interceptorLoading}
                />
                <button
                  type="button"
                  className="btn btn-primary w-full py-2.5"
                  onClick={() => void submitInterceptor()}
                  disabled={!interceptorInput.trim() || interceptorLoading}
                >
                  {interceptorLoading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" />
                      Evaluating…
                    </>
                  ) : (
                    'Submit Explanation'
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
