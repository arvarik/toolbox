import { Layers, Clock, Hash } from 'lucide-react'

/**
 * Deck card for the grid display.
 * @param {Object} deck - Deck data object
 * @param {function} onClick - Click handler
 */
export default function DeckCard({ deck, onClick }) {
  const colors = [
    '#818cf8', '#34d399', '#60a5fa', '#fbbf24', '#f472b6',
    '#a78bfa', '#2dd4bf', '#fb923c',
  ]
  const color = colors[deck.colorIndex || 0]

  return (
    <div
      className="card card-interactive deck-card"
      onClick={() => onClick(deck)}
      id={`deck-${deck.id}`}
    >
      <div className="deck-card-header">
        <div className="deck-card-icon" style={{ background: `${color}15`, color }}>
          <Layers size={18} />
        </div>
      </div>
      <div className="deck-card-title">{deck.name}</div>
      {deck.description && (
        <p
          style={{
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
            marginBottom: 'var(--space-3)',
            lineHeight: 'var(--leading-relaxed)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {deck.description}
        </p>
      )}
      <div className="deck-card-meta">
        <span>
          <Hash size={12} />
          {deck.cardCount || 0} cards
        </span>
        <span>
          <Clock size={12} />
          {deck.lastStudied || 'Never studied'}
        </span>
      </div>
    </div>
  )
}
