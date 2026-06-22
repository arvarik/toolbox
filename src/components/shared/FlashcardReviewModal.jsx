import { useState, useEffect } from 'react'
import { X, Edit3, Trash2, Save, Layers, Loader2 } from 'lucide-react'
import { decksApi, flashcardsApi } from '../../utils/api'
import useAppStore from '../../stores/appStore'

export default function FlashcardReviewModal({ open, onClose, cards: initialCards, topicName, onSaveSuccess }) {
  const addToast = useAppStore((s) => s.addToast)
  const [cards, setCards] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')

  useEffect(() => {
    if (open && initialCards) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCards(initialCards)
    }
  }, [open, initialCards])

  if (!open) return null

  const removeCard = (index) => {
    setCards((prev) => prev.filter((_, i) => i !== index))
  }

  const startEdit = (index, card) => {
    setEditingIndex(index)
    setEditFront(card.front)
    setEditBack(card.back)
  }

  const saveEdit = () => {
    if (editingIndex !== null) {
      setCards((prev) => {
        const next = [...prev]
        next[editingIndex] = { front: editFront, back: editBack }
        return next
      })
      setEditingIndex(null)
    }
  }

  const handleSaveAll = async () => {
    if (cards.length === 0) return
    setIsSaving(true)

    try {
      // 1. Find or create deck
      const allDecks = await decksApi.list()
      let deck = allDecks.find(d => d.name.toLowerCase() === topicName?.toLowerCase())
      
      if (!deck) {
        deck = await decksApi.create({ name: topicName || 'Generated Cards' })
      }

      // 2. Add all cards
      for (const card of cards) {
        await flashcardsApi.create(deck.id, { front: card.front, back: card.back })
      }

      addToast({ type: 'success', message: `Saved ${cards.length} flashcard(s) to ${deck.name} deck.` })
      onSaveSuccess?.()
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save flashcards.' })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose() }}
    >
      <div
        style={{
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl)',
          border: '1px solid var(--color-border)',
          width: '100%',
          maxWidth: 600,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Layers size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>Review Generated Flashcards</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                Target Deck: {topicName || 'Generated Cards'}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} disabled={isSaving}>
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4) var(--space-6)' }}>
          {cards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-tertiary)' }}>
              No cards generated or all removed.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {cards.map((card, i) => (
                <div key={i} style={{
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-lg)',
                  padding: 'var(--space-4)',
                }}>
                  {editingIndex === i ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                      <div>
                        <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>Front</label>
                        <textarea
                          value={editFront}
                          onChange={e => setEditFront(e.target.value)}
                          style={{
                            width: '100%', padding: 'var(--space-2)',
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
                            fontSize: 'var(--text-sm)', resize: 'vertical', minHeight: '60px'
                          }}
                        />
                      </div>
                      <div>
                        <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>Back</label>
                        <textarea
                          value={editBack}
                          onChange={e => setEditBack(e.target.value)}
                          style={{
                            width: '100%', padding: 'var(--space-2)',
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
                            fontSize: 'var(--text-sm)', resize: 'vertical', minHeight: '80px'
                          }}
                        />
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setEditingIndex(null)}>Cancel</button>
                        <button className="btn btn-primary btn-sm" onClick={saveEdit}>Save Edits</button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>
                          {card.front}
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEdit(i, card)} title="Edit">
                            <Edit3 size={14} />
                          </button>
                          <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeCard(i)} title="Remove" style={{ color: 'var(--color-error)' }}>
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', background: 'var(--color-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px dashed var(--color-border)' }}>
                        {card.back}
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{
          padding: 'var(--space-4) var(--space-6)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)',
          background: 'var(--color-bg-secondary)',
        }}>
          <button className="btn btn-secondary" onClick={onClose} disabled={isSaving}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={handleSaveAll} disabled={cards.length === 0 || isSaving}>
            {isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
            {isSaving ? 'Saving...' : `Save ${cards.length} Card${cards.length === 1 ? '' : 's'} to Deck`}
          </button>
        </div>
      </div>
    </div>
  )
}
