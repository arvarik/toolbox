import { useState, useRef, useEffect } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle, ArrowLeft, Clock, Keyboard, BookOpen } from 'lucide-react'
import { Link } from 'react-router-dom'
import { flashcardsApi, chatApi } from '../../utils/api'
import { BLUEPRINT_SECTIONS } from '../../utils/constants'
import StudySessionSummary from './StudySessionSummary'
import useAppStore from '../../stores/appStore'

function getCurrentTime() {
  return Date.now()
}

export default function FlashcardView({ cards = [], onBack, deckName, deckId, reviewMode = false, onCardReviewed }) {
  const [sessionQueue, setSessionQueue] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [confidence, setConfidence] = useState(null)
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [sessionStats, setSessionStats] = useState(null)
  const [showHotkeysGuide, setShowHotkeysGuide] = useState(false)
  const [interceptorActive, setInterceptorActive] = useState(false)
  const [interceptorQuality, setInterceptorQuality] = useState(null)
  const [interceptorInput, setInterceptorInput] = useState('')
  const [interceptorLoading, setInterceptorLoading] = useState(false)
  const [interceptorFeedback, setInterceptorFeedback] = useState(null)
  const [guideLink, setGuideLink] = useState(null) // { url, sectionName }

  const startTimeRef = useRef(0)
  const ratingsRef = useRef({})
  const correctCountRef = useRef(0)

  // Load cards into the dynamic session queue
  useEffect(() => {
    if (cards.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessionQueue([...cards])
      setCurrentIndex(0)
      setFlipped(false)
      setConfidence(null)
      setIsReviewing(false)
      setReviewedCount(0)
      setSessionStats(null)
      startTimeRef.current = getCurrentTime()
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

  const currentCard = sessionQueue[currentIndex]
  const isDone = reviewMode && sessionStats !== null

  // Compute dynamic counters for remaining cards in queue (New, Learn, Due)
  const remainingCards = sessionQueue.slice(currentIndex)
  const newCount = remainingCards.filter(c => (c.state || 0) === 0).length
  const learnCount = remainingCards.filter(c => c.state === 1 || c.state === 3).length
  const dueCount = remainingCards.filter(c => c.state === 2).length

  const handleFlip = () => {
    if (!isReviewing) setFlipped(!flipped)
  }

  const handlePrev = () => {
    if (reviewMode) return
    setFlipped(false)
    setCurrentIndex((i) => Math.max(0, i - 1))
  }

  const handleNext = () => {
    setFlipped(false)
    setCurrentIndex((i) => Math.min(sessionQueue.length - 1, i + 1))
  }

  const handleShuffle = () => {
    setFlipped(false)
    setCurrentIndex(Math.floor(Math.random() * sessionQueue.length))
  }

  const handleReset = () => {
    setFlipped(false)
    setConfidence(null)
    setCurrentIndex(0)
    setReviewedCount(0)
  }

  const handleRate = async (quality, skipInterceptor = false) => {
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
      // API call to update the card in database
      const updatedCardData = await flashcardsApi.review(targetDeckId, currentCard.id, quality, confidence)
      
      if (quality === 5 && !skipInterceptor) {
        useAppStore.getState().triggerAhaMoment()
      }

      const newReviewedCount = reviewedCount + 1
      setReviewedCount(newReviewedCount)

      ratingsRef.current[quality] = (ratingsRef.current[quality] || 0) + 1
      if (quality >= 3) correctCountRef.current += 1
      if (onCardReviewed) onCardReviewed(currentCard.id, quality)

      // Show "Review in Guide" link when rated Again and card has source metadata
      if (quality === 1 && currentCard.source_pillar_id && currentCard.source_topic_id) {
        const sectionId = currentCard.source_section_id
        // Resolve section name from constants
        const pillarSections = BLUEPRINT_SECTIONS[currentCard.source_pillar_id] || []
        const sectionDef = pillarSections.find(s => s.id === sectionId)
        const sectionName = sectionDef?.name || 'this section'
        const url = `/guide/${currentCard.source_pillar_id}/${currentCard.source_topic_id}${sectionId ? `#blueprint-${sectionId}` : ''}`
        setGuideLink({ url, sectionName })
        // Auto-clear after 4 seconds
        setTimeout(() => setGuideLink(null), 4000)
      } else {
        setGuideLink(null)
      }

      // Anki dynamic queue re-insertion logic
      const isStillLearning = updatedCardData.state === 1 || updatedCardData.state === 3
      
      setFlipped(false)
      setConfidence(null)
      const nextIdx = currentIndex + 1

      if (isStillLearning) {
        setSessionQueue(prev => {
          const newQueue = [...prev]
          // Re-insert at currentIndex + 3 (or end of queue if short)
          const insertPos = Math.min(newQueue.length, currentIndex + 4)
          newQueue.splice(insertPos, 0, { ...currentCard, ...updatedCardData })
          return newQueue
        })
      }

      // Check if session is finished
      if (nextIdx >= sessionQueue.length + (isStillLearning ? 1 : 0)) {
        const finalStats = {
          totalCards: newReviewedCount,
          correctCards: correctCountRef.current,
          totalTimeMs: getCurrentTime() - (startTimeRef.current || getCurrentTime()),
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
  }

  // Keyboard Shortcuts listener
  useEffect(() => {
    if (!reviewMode || isDone || !currentCard || isReviewing) return

    const handleKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase()
      if (tag === 'input' || tag === 'textarea' || e.target.isContentEditable) return

      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        if (!flipped) {
          setConfidence('medium')
          setFlipped(true)
        } else {
          handleRate(4) // Good
        }
      } else if (flipped) {
        if (e.key === '1') {
          e.preventDefault()
          handleRate(1) // Again
        } else if (e.key === '2') {
          e.preventDefault()
          handleRate(3) // Hard
        } else if (e.key === '3') {
          e.preventDefault()
          handleRate(4) // Good
        } else if (e.key === '4') {
          e.preventDefault()
          handleRate(5) // Easy
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flipped, currentCard, reviewMode, isReviewing, handleRate, interceptorActive])

  const submitInterceptor = async () => {
    if (!interceptorInput.trim() || interceptorLoading) return
    setInterceptorLoading(true)
    
    try {
      const evaluation = await chatApi.evaluateInterceptor({
        explanation: interceptorInput,
        front: currentCard?.front,
        back: currentCard?.back,
      })
      
      if (evaluation.pass) {
        setInterceptorActive(false)
        useAppStore.getState().triggerAhaMoment()
        handleRate(interceptorQuality, true)
      } else {
        setInterceptorFeedback(evaluation.feedback || "Your explanation was incorrect or incomplete. Please review the material.")
      }
    } catch (err) {
      console.error('Interceptor failed:', err)
      // On failure, gracefully fallback to accepting their rating so they aren't blocked
      setInterceptorActive(false)
      useAppStore.getState().triggerAhaMoment()
      handleRate(interceptorQuality, true)
    } finally {
      setInterceptorLoading(false)
    }
  }

  const handleFailAcknowledge = () => {
    setInterceptorActive(false)
    handleRate(1, true) // Force "Again" rating due to failure
  }

  if (sessionQueue.length === 0) {
    return (
      <div className="flashcard-viewer">
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-4)' }}>
            {reviewMode ? 'No cards due for review! 🎉' : 'No cards in this deck yet.'}
          </p>
          <button className="btn btn-secondary" onClick={onBack}>
            <ArrowLeft size={14} />
            Back to Decks
          </button>
        </div>
      </div>
    )
  }

  if (isDone) {
    return (
      <div className="flashcard-viewer" id="flashcard-viewer">
        <StudySessionSummary
          stats={sessionStats}
          onBack={onBack}
          onStudyAgain={() => {
            setSessionQueue([...cards])
            setCurrentIndex(0)
            setReviewedCount(0)
            startTimeRef.current = getCurrentTime()
            ratingsRef.current = {}
            correctCountRef.current = 0
            setSessionStats(null)
            setFlipped(false)
            setConfidence(null)
          }}
        />
      </div>
    )
  }

  // Previews from card
  const previews = currentCard?.srs_previews || { again: '1m', hard: '5m', good: '10m', easy: '4d' }

  const QUALITY_BUTTONS = [
    { quality: 1, label: 'Again', color: '#ef4444', desc: previews.again },
    { quality: 3, label: 'Hard', color: '#f59e0b', desc: previews.hard },
    { quality: 4, label: 'Good', color: '#34d399', desc: previews.good },
    { quality: 5, label: 'Easy', color: '#818cf8', desc: previews.easy },
  ]

  return (
    <div className="flashcard-viewer" id="flashcard-viewer">
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
        maxWidth: 560,
        marginBottom: 'var(--space-6)',
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          {deckName}
        </button>
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {reviewMode && (
            <>
              <span style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-accent)',
                fontWeight: 600,
                padding: '2px 8px',
                background: 'var(--color-accent-subtle)',
                borderRadius: 'var(--radius-full)',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}>
                <Clock size={12} />
                SRS Review
              </span>
              <button 
                className={`btn btn-icon btn-sm ${showHotkeysGuide ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setShowHotkeysGuide(!showHotkeysGuide)}
                title="Keyboard Shortcuts"
                style={{ width: 28, height: 28 }}
              >
                <Keyboard size={14} />
              </button>
            </>
          )}
          {!reviewMode && (
            <>
              <button className="btn btn-ghost btn-icon" onClick={handleShuffle} title="Shuffle">
                <Shuffle size={16} />
              </button>
              <button className="btn btn-ghost btn-icon" onClick={handleReset} title="Reset">
                <RotateCcw size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Card */}
      <div className={`flashcard${flipped ? ' flipped' : ''}`} onClick={handleFlip}>
        <div className="flashcard-inner">
          <div className="flashcard-face flashcard-front">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="flashcard-label">Question</span>
              {currentCard?.deckName && (
                <span style={{ fontSize: '10px', padding: '2px 8px', background: 'var(--color-bg-tertiary)', borderRadius: '12px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {currentCard.deckName}
                </span>
              )}
            </div>
            <p className="flashcard-text">{currentCard?.front}</p>
            <span
              style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-disabled)',
                marginTop: 'var(--space-6)',
              }}
            >
              Click to reveal answer
            </span>
          </div>
          <div className="flashcard-face flashcard-back">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
              <span className="flashcard-label">Answer</span>
              {currentCard?.deckName && (
                <span style={{ fontSize: '10px', padding: '2px 8px', background: 'var(--color-bg-tertiary)', borderRadius: '12px', color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                  {currentCard.deckName}
                </span>
              )}
            </div>
            <p className="flashcard-text">{currentCard?.back}</p>
            {currentCard?.interval > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-disabled)',
                marginTop: 'var(--space-3)',
              }}>
                Current interval: {currentCard.interval}d (Ease: {Math.round((currentCard.ease_factor || 2.5) * 100)}%)
              </span>
            )}
          </div>
        </div>
        {reviewMode && !flipped ? (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', width: '100%' }}>
            <p style={{ textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
              How confident are you in your answer?
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-2)' }}>
              <button
                className="btn btn-outline"
                onClick={(e) => { e.stopPropagation(); setConfidence('low'); setFlipped(true) }}
                style={{ padding: 'var(--space-3)', minHeight: 44 }}
              >
                Low
              </button>
              <button
                className="btn btn-outline"
                onClick={(e) => { e.stopPropagation(); setConfidence('medium'); setFlipped(true) }}
                style={{ padding: 'var(--space-3)', borderColor: 'var(--color-border)', minHeight: 44 }}
              >
                Medium
              </button>
              <button
                className="btn btn-outline"
                onClick={(e) => { e.stopPropagation(); setConfidence('high'); setFlipped(true) }}
                style={{ padding: 'var(--space-3)', borderColor: 'var(--color-accent)', color: 'var(--color-accent)', minHeight: 44 }}
              >
                High
              </button>
            </div>
          </div>
        ) : !reviewMode && !flipped ? (
          <div style={{ marginTop: 'var(--space-4)', display: 'flex', justifyContent: 'center', width: '100%' }}>
            <button
              className="btn btn-outline"
              onClick={(e) => { e.stopPropagation(); setFlipped(true) }}
              style={{ minHeight: 44, padding: 'var(--space-3) var(--space-6)' }}
            >
              Show Answer
            </button>
          </div>
        ) : null}
      </div>

      {/* Anki-style Counts Badge Panel (shown in Review mode) */}
      {reviewMode && (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
          marginTop: 'var(--space-4)',
          width: '100%',
          maxWidth: 560,
        }}>
          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            padding: '2px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(96, 165, 250, 0.15)',
            color: 'var(--color-info)',
            border: '1px solid rgba(96, 165, 250, 0.3)'
          }} title="New cards left">
            {newCount} New
          </span>
          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            padding: '2px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(251, 191, 36, 0.15)',
            color: 'var(--color-warning)',
            border: '1px solid rgba(251, 191, 36, 0.3)'
          }} title="Learning/relearning cards left">
            {learnCount} Learn
          </span>
          <span style={{
            fontSize: 'var(--text-xs)',
            fontWeight: 700,
            padding: '2px 10px',
            borderRadius: 'var(--radius-md)',
            background: 'rgba(52, 211, 153, 0.15)',
            color: 'var(--color-success)',
            border: '1px solid rgba(52, 211, 153, 0.3)'
          }} title="Due review cards left">
            {dueCount} Due
          </span>
        </div>
      )}

      {/* Keyboard Shortcuts Guide Overlay */}
      {reviewMode && showHotkeysGuide && !interceptorActive && (
        <div style={{
          background: 'var(--color-bg-secondary)',
          borderRadius: 'var(--radius-md)',
          padding: 'var(--space-3) var(--space-4)',
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: 560,
          marginTop: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-secondary)',
          display: 'flex',
          flexDirection: 'column',
          gap: 4
        }}>
          <div><strong>Keyboard Shortcuts:</strong></div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, opacity: 0.85 }}>
            <div><kbd style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--color-border)' }}>Space</kbd> / <kbd style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--color-border)' }}>Enter</kbd> : Flip or rate Good</div>
            <div><kbd style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--color-border)' }}>1</kbd> : Rate Again (1m)</div>
            <div><kbd style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--color-border)' }}>2</kbd> : Rate Hard (5m)</div>
            <div><kbd style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--color-border)' }}>3</kbd> : Rate Good (10m)</div>
            <div><kbd style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 3, border: '1px solid var(--color-border)' }}>4</kbd> : Rate Easy (4d)</div>
          </div>
        </div>
      )}

      {/* SRS Buttons */}
      {!interceptorActive && reviewMode && flipped && (
        <div className="srs-rating-buttons" style={{
          display: 'flex',
          gap: 'var(--space-2)',
          marginTop: 'var(--space-4)',
          width: '100%',
          maxWidth: 560,
        }}>
          {QUALITY_BUTTONS.map((btn) => (
            <button
              key={btn.quality}
              className="srs-rating-btn"
              onClick={(e) => {
                e.stopPropagation()
                handleRate(btn.quality)
              }}
              disabled={isReviewing}
              style={{
                flex: 1,
                padding: 'var(--space-3) var(--space-2)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${btn.color}40`,
                background: `${btn.color}10`,
                color: btn.color,
                cursor: isReviewing ? 'wait' : 'pointer',
                transition: 'all var(--duration-fast)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = `${btn.color}25`
                e.currentTarget.style.borderColor = btn.color
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = `${btn.color}10`
                e.currentTarget.style.borderColor = `${btn.color}40`
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{btn.label}</span>
              <span style={{ fontSize: '10px', opacity: 0.7 }}>{btn.desc}</span>
            </button>
          ))}
        </div>
      )}

      {/* Review in Guide link — appears after rating "Again" on cards with source metadata */}
      {guideLink && reviewMode && (
        <div style={{
          width: '100%',
          maxWidth: 560,
          marginTop: 'var(--space-3)',
          animation: 'fadeIn var(--duration-normal) ease-out',
        }}>
          <Link
            to={guideLink.url}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 'var(--space-2)',
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-md)',
              background: 'rgba(96, 165, 250, 0.08)',
              border: '1px solid rgba(96, 165, 250, 0.2)',
              color: 'var(--color-info)',
              fontSize: 'var(--text-xs)',
              fontWeight: 600,
              textDecoration: 'none',
              transition: 'all 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(96, 165, 250, 0.15)'
              e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.4)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(96, 165, 250, 0.08)'
              e.currentTarget.style.borderColor = 'rgba(96, 165, 250, 0.2)'
            }}
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

      {/* Elaborative Interrogation Modal Overlay */}
      {interceptorActive && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0, 0, 0, 0.4)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999,
          padding: 'var(--space-4)',
          animation: 'fadeIn var(--duration-normal) ease-out'
        }}>
          <div style={{
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-xl)',
            padding: 'var(--space-6)',
            width: '100%',
            maxWidth: 500,
            boxShadow: 'var(--shadow-xl)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            animation: 'slideUp var(--duration-normal) ease-out'
          }}>
            <div style={{ textAlign: 'center' }}>
              <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-accent)', marginBottom: 'var(--space-2)' }}>Hold on... Why is this true?</h2>
              <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                You rated this as <strong>{interceptorQuality === 5 ? 'Easy' : 'Good'}</strong>, but true mastery requires deep understanding. Explain the underlying concept to proceed.
              </p>
            </div>

            {interceptorFeedback ? (
              <div style={{
                background: 'var(--color-error-subtle)',
                color: 'var(--color-error)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--text-sm)',
                lineHeight: 1.6,
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}>
                <div style={{ fontWeight: 700, marginBottom: 'var(--space-2)' }}>Feedback:</div>
                {interceptorFeedback}
                <div style={{ marginTop: 'var(--space-4)' }}>
                  <button className="btn btn-primary" style={{ width: '100%', background: 'var(--color-error)', color: 'white', borderColor: 'var(--color-error)' }} onClick={handleFailAcknowledge}>
                    Accept Penalty (Rate Again)
                  </button>
                </div>
              </div>
            ) : (
              <>
                <textarea
                  className="input"
                  style={{ minHeight: 120, fontSize: 'var(--text-md)', resize: 'none' }}
                  placeholder="Type your explanation here..."
                  value={interceptorInput}
                  onChange={(e) => setInterceptorInput(e.target.value)}
                  autoFocus
                  disabled={interceptorLoading}
                />
                <button
                  className="btn btn-primary"
                  style={{
                    height: 48,
                    fontSize: 'var(--text-md)',
                    opacity: (!interceptorInput.trim() || interceptorLoading) ? 0.6 : 1
                  }}
                  onClick={submitInterceptor}
                  disabled={!interceptorInput.trim() || interceptorLoading}
                >
                  {interceptorLoading ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="spinner" style={{ width: 16, height: 16, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
                      Evaluating...
                    </span>
                  ) : 'Submit Explanation'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
