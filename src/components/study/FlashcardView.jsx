import { useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle, ArrowLeft, Clock } from 'lucide-react'
import { flashcardsApi } from '../../utils/api'

const QUALITY_BUTTONS = [
  { quality: 0, label: 'Again', color: '#ef4444', desc: 'Reset' },
  { quality: 3, label: 'Hard', color: '#f59e0b', desc: '1d' },
  { quality: 4, label: 'Good', color: '#34d399', desc: 'Scheduled' },
  { quality: 5, label: 'Easy', color: '#818cf8', desc: 'Extended' },
]

/**
 * Format the next review interval for display.
 */
function formatInterval(days) {
  if (days === 0) return 'Now'
  if (days === 1) return '1 day'
  if (days < 30) return `${days} days`
  if (days < 365) return `${Math.round(days / 30)} months`
  return `${Math.round(days / 365)} years`
}

/**
 * Flashcard viewer with flip animation, SRS rating buttons, and navigation.
 * @param {Array} cards - Array of flashcard objects
 * @param {function} onBack - Handler to return to deck list
 * @param {string} deckName - Name of the current deck
 * @param {string} deckId - ID of the current deck (for SRS API calls)
 * @param {boolean} reviewMode - If true, show SRS rating buttons
 * @param {function} onCardReviewed - Called after a card is reviewed
 */
export default function FlashcardView({ cards = [], onBack, deckName, deckId, reviewMode = false, onCardReviewed }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [isReviewing, setIsReviewing] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)

  const currentCard = cards[currentIndex]
  const isDone = reviewMode && currentIndex >= cards.length

  const handleFlip = () => {
    if (!isReviewing) setFlipped(!flipped)
  }

  const handlePrev = () => {
    if (reviewMode) return // No going back in review mode
    setFlipped(false)
    setCurrentIndex((i) => Math.max(0, i - 1))
  }

  const handleNext = () => {
    setFlipped(false)
    setCurrentIndex((i) => Math.min(cards.length - 1, i + 1))
  }

  const handleShuffle = () => {
    setFlipped(false)
    setCurrentIndex(Math.floor(Math.random() * cards.length))
  }

  const handleReset = () => {
    setFlipped(false)
    setCurrentIndex(0)
    setReviewedCount(0)
  }

  const handleRate = async (quality) => {
    if (!currentCard || !deckId || isReviewing) return
    setIsReviewing(true)
    try {
      await flashcardsApi.review(deckId, currentCard.id, quality)
      setReviewedCount((c) => c + 1)
      if (onCardReviewed) onCardReviewed(currentCard.id, quality)

      // Move to next card
      setFlipped(false)
      setTimeout(() => {
        setCurrentIndex((i) => i + 1)
        setIsReviewing(false)
      }, 200)
    } catch (err) {
      console.error('Review failed:', err)
      setIsReviewing(false)
    }
  }

  if (cards.length === 0) {
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

  // Review complete state
  if (isDone) {
    return (
      <div className="flashcard-viewer" id="flashcard-viewer">
        <div style={{
          textAlign: 'center',
          padding: 'var(--space-8)',
          maxWidth: 400,
        }}>
          <div style={{
            fontSize: 48,
            marginBottom: 'var(--space-4)',
          }}>🎉</div>
          <h2 style={{
            fontSize: 'var(--text-xl)',
            fontWeight: 700,
            marginBottom: 'var(--space-2)',
          }}>Review Complete!</h2>
          <p style={{
            color: 'var(--color-text-secondary)',
            fontSize: 'var(--text-sm)',
            marginBottom: 'var(--space-6)',
          }}>
            You reviewed {reviewedCount} card{reviewedCount !== 1 ? 's' : ''} in this session.
          </p>
          <button className="btn btn-primary" onClick={onBack}>
            Back to Decks
          </button>
        </div>
      </div>
    )
  }

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

      {/* Progress bar for review mode */}
      {reviewMode && (
        <div style={{
          width: '100%',
          maxWidth: 560,
          marginBottom: 'var(--space-4)',
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-tertiary)',
            marginBottom: 'var(--space-1)',
          }}>
            <span>Progress</span>
            <span>{reviewedCount} / {cards.length} reviewed</span>
          </div>
          <div style={{
            height: 4,
            background: 'var(--color-surface-border)',
            borderRadius: 'var(--radius-full)',
            overflow: 'hidden',
          }}>
            <div style={{
              height: '100%',
              width: `${(reviewedCount / cards.length) * 100}%`,
              background: 'var(--color-accent)',
              borderRadius: 'var(--radius-full)',
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}

      {/* Card */}
      <div className={`flashcard${flipped ? ' flipped' : ''}`} onClick={handleFlip}>
        <div className="flashcard-inner">
          <div className="flashcard-face flashcard-front">
            <span className="flashcard-label">Question</span>
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
            <span className="flashcard-label">Answer</span>
            <p className="flashcard-text">{currentCard?.back}</p>
            {currentCard?.interval > 0 && (
              <span style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-disabled)',
                marginTop: 'var(--space-3)',
              }}>
                Current interval: {formatInterval(currentCard.interval)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* SRS Rating buttons (shown when flipped in review mode) */}
      {reviewMode && flipped && (
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

      {/* Navigation */}
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
            {currentIndex + 1} / {cards.length}
          </span>
          <button
            className="btn btn-secondary btn-icon"
            onClick={handleNext}
            disabled={currentIndex === cards.length - 1}
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
            Card {currentIndex + 1} of {cards.length}
          </span>
        </div>
      )}
    </div>
  )
}
