import { useState, useEffect, useRef } from 'react'
import { Search, X, ArrowRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { PILLARS } from '../../utils/constants'

/**
 * SearchDialog — command-palette-style search overlay for all guide topics.
 * Opens with ⌘/ (Ctrl+/) or the search button.
 */
export default function SearchDialog({ open, onClose }) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef(null)
  const navigate = useNavigate()

  // Build flat searchable list from pillars
  const allTopics = PILLARS.flatMap((pillar) =>
    pillar.topics.map((topic) => ({
      id: topic.id,
      name: topic.name,
      pillarId: pillar.id,
      pillarName: pillar.shortName,
      pillarColor: pillar.color,
      path: `/guide/${pillar.id}/${topic.id}`,
    }))
  )

  // Filter by query
  const filtered = query.trim()
    ? allTopics.filter(
        (t) =>
          t.name.toLowerCase().includes(query.toLowerCase()) ||
          t.pillarName.toLowerCase().includes(query.toLowerCase())
      )
    : allTopics

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => {
        setQuery('')
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
      setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && filtered[selectedIndex]) {
      navigate(filtered[selectedIndex].path)
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
            style={{ width: 28, height: 28, flexShrink: 0 }}
            aria-label="Close search"
          >
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="search-bar-results">
          {filtered.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
              No matching topics found.
            </div>
          ) : (
            filtered.map((topic, i) => (
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
                <div style={{ flex: 1 }}>
                  <div className="search-result-name">{topic.name}</div>
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
