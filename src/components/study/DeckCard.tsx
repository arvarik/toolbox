import { Layers, Clock, Hash } from 'lucide-react'

export interface DeckCardData {
  id: string
  name: string
  description?: string
  colorIndex?: number
  tags?: string
  newCount?: number
  learnCount?: number
  dueCount?: number
  cardCount?: number
  lastStudied?: string
  progress?: number
}

export interface DeckCardProps<T extends DeckCardData = DeckCardData> {
  deck: T
  onClick: (deck: T) => void
}

/**
 * Deck card for the grid display — warm monochrome chrome with tabular progress.
 */
export default function DeckCard<T extends DeckCardData>({ deck, onClick }: DeckCardProps<T>) {
  const tagList = deck.tags ? deck.tags.split(',').map((t) => t.trim()).filter(Boolean) : []
  const progressPct = Math.min(100, Math.max(0, deck.progress ?? 0))

  return (
    <div
      role="button"
      tabIndex={0}
      className="card card-interactive deck-card"
      onClick={() => onClick(deck)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick(deck)
        }
      }}
      id={`deck-${deck.id}`}
    >
      <div className="deck-card-header">
        <div className="deck-card-icon border border-outline-variant bg-surface-container-high text-on-surface-variant">
          <Layers size={17} />
        </div>
      </div>
      <div className="deck-card-title font-serif text-lg font-normal text-on-surface">
        {deck.name}
      </div>
      {deck.description && (
        <p className="text-xs text-on-surface-variant mb-3 leading-relaxed line-clamp-2">
          {deck.description}
        </p>
      )}
      {/* Tags */}
      {tagList.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-2.5">
          {tagList.slice(0, 3).map((tag, i) => (
            <span
              key={i}
              className="text-xs px-2 py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-on-surface-variant"
            >
              {tag}
            </span>
          ))}
          {tagList.length > 3 && (
            <span className="text-xs font-mono tabular-nums text-on-surface-variant">
              +{tagList.length - 3}
            </span>
          )}
        </div>
      )}
      {/* Anki Counters */}
      <div className="flex gap-1.5 my-2.5 flex-wrap font-mono text-xs tabular-nums">
        <span
          className="px-2 py-0.5 rounded-md border border-outline-variant bg-surface-container-low text-on-surface-variant"
          title="New cards"
        >
          {deck.newCount || 0} new
        </span>
        <span
          className="px-2 py-0.5 rounded-md border border-outline-variant bg-surface-container-low text-on-surface-variant"
          title="Learning cards"
        >
          {deck.learnCount || 0} learn
        </span>
        <span
          className={`px-2 py-0.5 rounded-md border ${
            (deck.dueCount || 0) > 0
              ? 'border-primary/35 bg-primary/12 text-on-primary-wash font-semibold'
              : 'border-outline-variant bg-surface-container-low text-on-surface-variant'
          }`}
          title="Due reviews"
        >
          {deck.dueCount || 0} due
        </span>
      </div>

      <div className="deck-card-meta tabular-nums">
        <span>
          <Hash size={12} />
          {deck.cardCount || 0} cards
        </span>
        <span>
          <Clock size={12} />
          {deck.lastStudied || 'Never studied'}
        </span>
      </div>

      {/* Monochrome Tabular Mastery Progress Bar */}
      <div className="mt-3">
        <div className="flex justify-between items-center mb-1.5 text-xs">
          <span className="text-on-surface-variant">Mastery</span>
          <span className="font-mono font-semibold text-on-surface tabular-nums">
            {progressPct}%
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-surface-container-high overflow-hidden">
          <div
            className="h-full rounded-full bg-on-surface transition-all"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
