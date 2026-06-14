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
      {/* Tags */}
      {deck.tags && deck.tags.trim() && (
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
          {deck.tags.split(',').filter(Boolean).slice(0, 3).map((tag, i) => (
            <span
              key={i}
              style={{
                fontSize: '10px',
                padding: '1px 6px',
                borderRadius: 'var(--radius-full)',
                background: 'var(--color-accent-subtle)',
                color: 'var(--color-accent)',
                fontWeight: 500,
              }}
            >
              {tag.trim()}
            </span>
          ))}
          {deck.tags.split(',').filter(Boolean).length > 3 && (
            <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
              +{deck.tags.split(',').filter(Boolean).length - 3}
            </span>
          )}
        </div>
      )}
      {/* Anki Counters */}
      <div style={{ display: 'flex', gap: 6, margin: 'var(--space-2) 0 var(--space-3) 0', flexWrap: 'wrap' }}>
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(96, 165, 250, 0.12)',
          color: 'var(--color-info)',
        }} title="New cards">
          {deck.newCount || 0} new
        </span>
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(251, 191, 36, 0.12)',
          color: 'var(--color-warning)',
        }} title="Learning cards">
          {deck.learnCount || 0} learn
        </span>
        <span style={{
          fontSize: '10px',
          fontWeight: 700,
          padding: '2px 8px',
          borderRadius: 'var(--radius-md)',
          background: 'rgba(52, 211, 153, 0.12)',
          color: 'var(--color-success)',
        }} title="Due reviews">
          {deck.dueCount || 0} due
        </span>
      </div>

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

      {/* Mastery Progress Bar */}
      <div style={{ marginTop: 'var(--space-3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Mastery</span>
          <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-primary)' }}>
            {deck.progress !== undefined ? deck.progress : 0}%
          </span>
        </div>
        <div style={{ height: '6px', background: 'var(--color-bg-hover, #f3f4f6)', borderRadius: '3px', overflow: 'hidden' }}>
          <div
            style={{
              height: '100%',
              width: `${deck.progress !== undefined ? deck.progress : 0}%`,
              background: color,
              borderRadius: '3px',
              transition: 'width var(--duration-normal)',
            }}
          />
        </div>
      </div>
    </div>
  )
}
