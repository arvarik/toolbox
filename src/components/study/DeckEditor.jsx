import { useState } from 'react'
import { Plus, Trash2, Save, X, GripVertical } from 'lucide-react'

/**
 * Deck editor for creating/editing deck metadata and cards.
 * @param {Object} deck - Deck data (null for new deck)
 * @param {Array} cards - Cards in the deck
 * @param {function} onSave - Save handler
 * @param {function} onCancel - Cancel handler
 */
export default function DeckEditor({ deck, cards: initialCards = [], onSave, onCancel }) {
  const [name, setName] = useState(deck?.name || '')
  const [description, setDescription] = useState(deck?.description || '')
  const [tags, setTags] = useState(deck?.tags || '')
  const [cards, setCards] = useState(() =>
    initialCards.length > 0
      ? initialCards
      : [{ id: `card-${Date.now()}`, front: '', back: '' }]
  )

  const addCard = () => {
    setCards((prev) => [
      ...prev,
      { id: `card-${Date.now()}`, front: '', back: '' },
    ])
  }

  const updateCard = (id, field, value) => {
    setCards((prev) =>
      prev.map((c) => (c.id === id ? { ...c, [field]: value } : c))
    )
  }

  const removeCard = (id) => {
    if (cards.length <= 1) return
    setCards((prev) => prev.filter((c) => c.id !== id))
  }

  const handleSave = () => {
    if (!name.trim()) return
    onSave({
      name: name.trim(),
      description: description.trim(),
      tags: tags.trim(),
      cards: cards.filter((c) => c.front.trim() || c.back.trim()),
    })
  }

  return (
    <div style={{ padding: 'var(--space-6) var(--space-8)', maxWidth: 800 }} id="deck-editor">
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 'var(--space-6)',
      }}>
        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 700 }}>
          {deck ? 'Edit Deck' : 'New Deck'}
        </h2>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button className="btn btn-ghost" onClick={onCancel}>
            <X size={14} />
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!name.trim()}>
            <Save size={14} />
            Save Deck
          </button>
        </div>
      </div>

      {/* Deck info */}
      <div style={{ marginBottom: 'var(--space-6)' }}>
        <div className="settings-field">
          <label className="settings-label">Deck Name</label>
          <input
            className="input"
            placeholder="e.g., Caching Strategies"
            value={name}
            onChange={(e) => setName(e.target.value)}
            id="deck-name-input"
          />
        </div>
        <div className="settings-field">
          <label className="settings-label">Description (optional)</label>
          <textarea
            className="input"
            placeholder="Brief description of this deck..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            id="deck-desc-input"
          />
        </div>
        <div className="settings-field">
          <label className="settings-label">Tags (comma-separated)</label>
          <input
            className="input"
            placeholder="e.g., databases, caching, fundamentals"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            id="deck-tags-input"
          />
          {tags && (
            <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
              {tags.split(',').filter(Boolean).map((tag, i) => (
                <span
                  key={i}
                  style={{
                    fontSize: '10px',
                    padding: '2px 8px',
                    borderRadius: 'var(--radius-full)',
                    background: 'var(--color-accent-subtle)',
                    color: 'var(--color-accent)',
                    fontWeight: 600,
                  }}
                >
                  {tag.trim()}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Cards */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-4)',
        }}>
          <h3 style={{ fontSize: 'var(--text-md)', fontWeight: 600 }}>
            Cards ({cards.length})
          </h3>
          <button className="btn btn-secondary btn-sm" onClick={addCard} id="add-card-btn">
            <Plus size={14} />
            Add Card
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {cards.map((card, index) => (
            <div
              key={card.id}
              className="card"
              style={{ padding: 'var(--space-4)' }}
            >
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--space-3)',
                marginBottom: 'var(--space-3)',
              }}>
                <GripVertical
                  size={14}
                  style={{ color: 'var(--color-text-disabled)', cursor: 'grab', flexShrink: 0 }}
                />
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    color: 'var(--color-text-tertiary)',
                    flex: 1,
                  }}
                >
                  Card {index + 1}
                </span>
                <button
                  className="btn btn-ghost btn-icon"
                  onClick={() => removeCard(card.id)}
                  disabled={cards.length <= 1}
                  aria-label="Remove card"
                  style={{ width: 24, height: 24, opacity: cards.length <= 1 ? 0.3 : 0.6 }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <div className="deck-card-fields" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                <div>
                  <label
                    className="settings-label"
                    style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}
                  >
                    Front (Question)
                  </label>
                  <textarea
                    className="input"
                    placeholder="Enter question..."
                    value={card.front}
                    onChange={(e) => updateCard(card.id, 'front', e.target.value)}
                    rows={2}
                  />
                </div>
                <div>
                  <label
                    className="settings-label"
                    style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}
                  >
                    Back (Answer)
                  </label>
                  <textarea
                    className="input"
                    placeholder="Enter answer..."
                    value={card.back}
                    onChange={(e) => updateCard(card.id, 'back', e.target.value)}
                    rows={2}
                  />
                </div>
              </div>
              <div style={{ marginTop: 'var(--space-3)' }}>
                <label
                  className="settings-label"
                  style={{ fontSize: 'var(--text-xs)', marginBottom: 'var(--space-1)' }}
                >
                  Prerequisite Card (optional)
                </label>
                <select
                  className="input"
                  value={card.prerequisite_id || ''}
                  onChange={(e) => updateCard(card.id, 'prerequisite_id', e.target.value)}
                  style={{ height: '32px', padding: '0 var(--space-2)' }}
                >
                  <option value="">None</option>
                  {cards
                    .filter((c) => c.id !== card.id && (c.front.trim() || c.id.startsWith('card-')))
                    .map((c, i) => (
                      <option key={c.id} value={c.id}>
                        {c.front ? c.front.slice(0, 40) + (c.front.length > 40 ? '...' : '') : `Card ${i + 1}`}
                      </option>
                    ))}
                </select>
                <p style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                  This card will not appear in due queues until the prerequisite card is well-learned (Ease Factor ≥ 2.5).
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Add more button at bottom */}
      <button
        className="btn btn-ghost"
        onClick={addCard}
        style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed', border: '1px dashed var(--color-border)' }}
      >
        <Plus size={14} />
        Add Another Card
      </button>
    </div>
  )
}
