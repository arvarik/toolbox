import { useState } from 'react'
import { ChevronLeft, ChevronRight, RotateCcw, Shuffle, ArrowLeft } from 'lucide-react'

/**
 * Flashcard viewer with flip animation and navigation.
 * @param {Array} cards - Array of flashcard objects { front, back }
 * @param {function} onBack - Handler to return to deck list
 * @param {string} deckName - Name of the current deck
 */
export default function FlashcardView({ cards = [], onBack, deckName }) {
  const [currentIndex, setCurrentIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)

  const currentCard = cards[currentIndex]

  const handleFlip = () => setFlipped(!flipped)

  const handlePrev = () => {
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
  }

  if (cards.length === 0) {
    return (
      <div className="flashcard-viewer">
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-4)' }}>
            No cards in this deck yet.
          </p>
          <button className="btn btn-secondary" onClick={onBack}>
            <ArrowLeft size={14} />
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
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost btn-icon" onClick={handleShuffle} title="Shuffle">
            <Shuffle size={16} />
          </button>
          <button className="btn btn-ghost btn-icon" onClick={handleReset} title="Reset">
            <RotateCcw size={16} />
          </button>
        </div>
      </div>

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
          </div>
        </div>
      </div>

      {/* Navigation */}
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
    </div>
  )
}
