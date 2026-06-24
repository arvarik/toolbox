import { useState, useEffect, useRef } from 'react'
import { Search, X, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PILLARS } from '../../utils/constants'
import { searchApi } from '../../utils/api'

// Build default list from pillars
const defaultTopics = PILLARS.flatMap((pillar) =>
  pillar.topics.map((topic) => ({
    id: topic.id,
    name: topic.name,
    pillarName: pillar.shortName,
    pillarColor: pillar.color,
    path: `/guide/${pillar.id}/${topic.id}`,
  }))
)

/**
 * SearchDialog — command-palette-style search overlay for all guide topics.
 * Opens with ⌘/ (Ctrl+/) or the search button.
 */
export default function SearchDialog({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  const [results, setResults] = useState([])

  // Fetch from global search API when query changes
  useEffect(() => {
    if (!query.trim()) {
      const timer = setTimeout(() => setResults(defaultTopics), 0)
      return () => clearTimeout(timer)
    }

    const fetchSearch = async () => {
      try {
        const res = await searchApi.query(query)
        const combined = []

        res.guideContent.forEach(item => {
          combined.push({
            id: `guide-${item.section_id}`,
            name: item.section_id.replace(/-/g, ' '),
            pillarName: `Guide Note: ${item.topic_id}`,
            pillarColor: '#4f46e5',
            path: `/guide/${item.pillar_id}/${item.topic_id}`
          })
        })

        res.flashcards.forEach(item => {
          combined.push({
            id: `fc-${item.id}`,
            name: item.front,
            pillarName: `Flashcard (Deck ${item.deck_id})`,
            pillarColor: '#34d399',
            path: '/study'
          })
        })

        res.boards.forEach(item => {
          combined.push({
            id: `board-${item.id}`,
            name: item.name,
            pillarName: 'Whiteboard',
            pillarColor: '#fbbf24',
            path: '/builder'
          })
        })

        res.decks.forEach(item => {
          combined.push({
            id: `deck-${item.id}`,
            name: item.name,
            pillarName: 'Deck',
            pillarColor: '#60a5fa',
            path: '/study'
          })
        })

        setResults(combined)
        setSelectedIndex(0)
      } catch (err) {
        console.error('Search failed:', err)
      }
    }

    const timer = setTimeout(fetchSearch, 150)
    return () => clearTimeout(timer)
  }, [query])

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        setQuery('')
        setResults(defaultTopics)
        setSelectedIndex(0)
        inputRef.current?.focus()
      }, 50)
    }
  }, [open])

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      navigate(results[selectedIndex].path)
      onClose()
    }
  }

  if (!open) return null

  return (
    <div className="search-bar-overlay" onClick={onClose} id="search-dialog">
      <div
        className="search-bar-container"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Input */}
        <div className="search-bar-input-row">
          <Search size={16} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search topics, pillars..."
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setSelectedIndex(0)
            }}
          />
          <button
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            style={{ width: 44, height: 44, flexShrink: 0 }}
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="search-bar-results">
          {results.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
              No matching results found.
            </div>
          ) : (
            results.map((topic, i) => (
              <button
                key={topic.id}
                className={`search-result-item${i === selectedIndex ? ' selected' : ''}`}
                onClick={() => {
                  navigate(topic.path)
                  onClose()
                }}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: topic.pillarColor,
                    flexShrink: 0,
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="search-result-name" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{topic.name}</div>
                  <div className="search-result-pillar">{topic.pillarName}</div>
                </div>
                <ArrowRight size={12} style={{ color: 'var(--color-text-disabled)' }} />
              </button>
            ))
          )}
        </div>

        {/* Footer hints */}
        <div className="search-bar-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> select</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
