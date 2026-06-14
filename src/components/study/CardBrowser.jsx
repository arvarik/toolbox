import { useState } from 'react'
import { Search, Edit2, Trash2, Plus, ArrowLeft } from 'lucide-react'

export default function CardBrowser({ deck, onBack, onSaveCard, onDeleteCard, onAddCard }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState('all') // 'all' | 'new' | 'learning' | 'review'
  const [editingCardId, setEditingCardId] = useState(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')

  const getCardStateLabel = (state) => {
    switch (state) {
      case 0: return { label: 'New', color: 'var(--color-info)' }
      case 1:
      case 3: return { label: 'Learning', color: 'var(--color-warning)' }
      case 2: return { label: 'Review', color: 'var(--color-success)' }
      default: return { label: 'New', color: 'var(--color-info)' }
    }
  }

  const filteredCards = (deck.cards || []).filter(c => {
    const matchesSearch = c.front.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          c.back.toLowerCase().includes(searchQuery.toLowerCase())
    
    let matchesFilter = true
    if (activeFilter === 'new') matchesFilter = (c.state || 0) === 0
    else if (activeFilter === 'learning') matchesFilter = c.state === 1 || c.state === 3
    else if (activeFilter === 'review') matchesFilter = c.state === 2

    return matchesSearch && matchesFilter
  })

  const startEdit = (c) => {
    setEditingCardId(c.id)
    setEditFront(c.front)
    setEditBack(c.back)
  }

  const saveEdit = (cardId) => {
    if (!editFront.trim() || !editBack.trim()) return
    onSaveCard(cardId, { front: editFront.trim(), back: editBack.trim() })
    setEditingCardId(null)
  }

  return (
    <div style={{ padding: 'var(--space-6) var(--space-8)' }} id="card-browser">
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-6)',
      }}>
        <button className="btn btn-ghost btn-sm" onClick={onBack}>
          <ArrowLeft size={14} />
          {deck.name}
        </button>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700 }}>Browse Cards</h2>
        <button className="btn btn-primary btn-sm" onClick={onAddCard} style={{ gap: 6 }}>
          <Plus size={14} /> Add Card
        </button>
      </div>

      {/* Toolbar */}
      <div style={{ 
        display: 'flex', 
        gap: 'var(--space-4)', 
        marginBottom: 'var(--space-6)',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 260 }}>
          <Search size={16} style={{
            position: 'absolute',
            left: 12,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--color-text-tertiary)',
            pointerEvents: 'none'
          }} />
          <input
            className="input"
            style={{ paddingLeft: 38 }}
            placeholder="Search questions or answers..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['all', 'new', 'learning', 'review'].map(f => (
            <button
              key={f}
              className={`btn btn-sm ${activeFilter === f ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => setActiveFilter(f)}
              style={{ textTransform: 'capitalize' }}
            >
              {f} ({(deck.cards || []).filter(c => {
                if (f === 'all') return true
                if (f === 'new') return (c.state || 0) === 0
                if (f === 'learning') return c.state === 1 || c.state === 3
                if (f === 'review') return c.state === 2
                return false
              }).length})
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ 
        background: 'var(--color-bg-secondary)', 
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden'
      }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 'var(--text-sm)' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-hover)' }}>
              <th style={{ padding: 'var(--space-3) var(--space-4)', width: '35%' }}>Front</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', width: '35%' }}>Back</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', width: '10%' }}>State</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', width: '10%' }}>Interval</th>
              <th style={{ padding: 'var(--space-3) var(--space-4)', width: '10%', textAlign: 'right' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredCards.length === 0 ? (
              <tr>
                <td colSpan="5" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                  No cards found matching current search/filters.
                </td>
              </tr>
            ) : (
              filteredCards.map((c) => {
                const isEditing = editingCardId === c.id
                const stateInfo = getCardStateLabel(c.state)
                return (
                  <tr key={c.id} style={{ borderBottom: '1px solid var(--color-border)', verticalAlign: 'top' }}>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      {isEditing ? (
                        <textarea
                          className="input"
                          rows={2}
                          value={editFront}
                          onChange={(e) => setEditFront(e.target.value)}
                        />
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{c.front}</div>
                      )}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      {isEditing ? (
                        <textarea
                          className="input"
                          rows={2}
                          value={editBack}
                          onChange={(e) => setEditBack(e.target.value)}
                        />
                      ) : (
                        <div style={{ whiteSpace: 'pre-wrap' }}>{c.back}</div>
                      )}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)' }}>
                      <span style={{
                        fontSize: '10px',
                        fontWeight: 600,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        background: `${stateInfo.color}15`,
                        color: stateInfo.color,
                        display: 'inline-block'
                      }}>
                        {stateInfo.label}
                      </span>
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', color: 'var(--color-text-secondary)' }}>
                      {c.state === 2 ? `${c.interval || 0}d` : '-'}
                    </td>
                    <td style={{ padding: 'var(--space-3) var(--space-4)', textAlign: 'right' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        {isEditing ? (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => setEditingCardId(null)}>
                              Cancel
                            </button>
                            <button className="btn btn-primary btn-sm" onClick={() => saveEdit(c.id)}>
                              Save
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEdit(c)} title="Edit Card">
                              <Edit2 size={12} />
                            </button>
                            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => onDeleteCard(c.id)} title="Delete Card" style={{ color: 'var(--color-error)' }}>
                              <Trash2 size={12} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
