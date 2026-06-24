import { useState, useEffect } from 'react'
import { X, Edit3, Trash2, Save, Layers, Loader2, AlertTriangle, ArrowRightLeft } from 'lucide-react'
import { decksApi, flashcardsApi, chatApi } from '../../utils/api'
import useAppStore from '../../stores/appStore'
import useIsMobile from '../../hooks/useIsMobile'

export default function FlashcardReviewModal({ open, onClose, cards: initialCards, topicName, pillarId, topicId, onSaveSuccess }) {
  const addToast = useAppStore((s) => s.addToast)
  const selectedModel = useAppStore((s) => s.model)
  const [cards, setCards] = useState([])
  const [isSaving, setIsSaving] = useState(false)
  const [editingIndex, setEditingIndex] = useState(null)
  const [editFront, setEditFront] = useState('')
  const [editBack, setEditBack] = useState('')
  
  // Duplicate detection state
  const [duplicateMap, setDuplicateMap] = useState({}) // index -> { isDuplicate, duplicateOf, similarity }
  const [excludedIndexes, setExcludedIndexes] = useState(new Set())
  const [isCheckingDupes, setIsCheckingDupes] = useState(false)

  // Reverse cards state
  const [reverseEnabled, setReverseEnabled] = useState(false)
  const [isGeneratingReverse, setIsGeneratingReverse] = useState(false)
  const [reverseCards, setReverseCards] = useState([]) // { front, back, originalIndex, sourceSectionId?, ... }

  // New UX States
  const [editingReverseIndex, setEditingReverseIndex] = useState(null)
  const [editReverseFront, setEditReverseFront] = useState('')
  const [editReverseBack, setEditReverseBack] = useState('')
  const [generatingReverseIndexes, setGeneratingReverseIndexes] = useState(new Set())
  const [expandedDuplicateIndexes, setExpandedDuplicateIndexes] = useState(new Set())

  // Global Cmd+Enter to Save All
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        if (e.target.tagName.toLowerCase() === 'textarea') return
        document.getElementById('flashcard-save-all-btn')?.click()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (open && initialCards) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCards(initialCards)
      setDuplicateMap({})
      setExcludedIndexes(new Set())
      setReverseEnabled(false)
      setReverseCards([])
      setEditingIndex(null)
      
      setEditingReverseIndex(null)
      setGeneratingReverseIndexes(new Set())
      setExpandedDuplicateIndexes(new Set())
    }
  }, [open, initialCards])

  // Run duplicate check when cards are loaded and a deck exists for this topic
  useEffect(() => {
    if (!open || !initialCards || initialCards.length === 0) return
    
    const checkDuplicates = async () => {
      try {
        const allDecks = await decksApi.list()
        const deck = allDecks.find(d => d.name.toLowerCase() === topicName?.toLowerCase())
        if (!deck) return // No existing deck = no duplicates possible

        setIsCheckingDupes(true)
        const cardsToCheck = initialCards.map(c => ({ front: c.front, back: c.back }))
        const result = await flashcardsApi.checkDuplicates(deck.id, cardsToCheck)
        
        if (result?.results) {
          const newDupeMap = {}
          const newExcluded = new Set()
          result.results.forEach((r, i) => {
            if (r.isDuplicate) {
              newDupeMap[i] = { isDuplicate: true, duplicateOf: r.duplicateOf, similarity: r.similarity }
              newExcluded.add(i)
            }
          })
          setDuplicateMap(newDupeMap)
          setExcludedIndexes(newExcluded)
        }
      } catch {
        // Silently fail — duplicate check is best-effort
      } finally {
        setIsCheckingDupes(false)
      }
    }

    checkDuplicates()
  }, [open, initialCards, topicName])

  const isMobile = useIsMobile()

  if (!open) return null

  const removeCard = (index) => {
    setCards((prev) => prev.filter((_, i) => i !== index))
    // Re-key maps — all indexes above the removed one shift down by 1
    setDuplicateMap(prev => {
      const next = {}
      for (const [k, v] of Object.entries(prev)) {
        const ki = Number(k)
        if (ki < index) next[ki] = v
        else if (ki > index) next[ki - 1] = v
        // ki === index is deleted
      }
      return next
    })
    setExcludedIndexes(prev => {
      const next = new Set()
      for (const ki of prev) {
        if (ki < index) next.add(ki)
        else if (ki > index) next.add(ki - 1)
      }
      return next
    })
  }

  const toggleExclude = (index) => {
    setExcludedIndexes(prev => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
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
        next[editingIndex] = { ...next[editingIndex], front: editFront, back: editBack }
        return next
      })
      setEditingIndex(null)
    }
  }

  const removeReverseCard = (index) => {
    setReverseCards(prev => prev.filter((_, i) => i !== index))
  }

  const startEditReverse = (index, card) => {
    setEditingReverseIndex(index)
    setEditReverseFront(card.front)
    setEditReverseBack(card.back)
  }

  const saveEditReverse = () => {
    if (editingReverseIndex !== null) {
      setReverseCards((prev) => {
        const next = [...prev]
        next[editingReverseIndex] = { ...next[editingReverseIndex], front: editReverseFront, back: editReverseBack }
        return next
      })
      setEditingReverseIndex(null)
    }
  }

  const handleGenerateSingleReverse = async (originalIndex, card) => {
    setGeneratingReverseIndexes(prev => {
      const next = new Set(prev)
      next.add(originalIndex)
      return next
    })
    try {
      const res = await chatApi.generateReverseCards({
        cards: [{ front: card.front, back: card.back }],
        model: selectedModel,
      })
      if (res?.reverseCards?.length > 0) {
        const rc = res.reverseCards[0]
        const enrichedReverse = {
          ...rc,
          originalIndex,
          sourceSectionId: card.sourceSectionId,
          sourceSectionName: card.sourceSectionName,
          sourcePillarId: card.sourcePillarId || pillarId,
          sourceTopicId: card.sourceTopicId || topicId,
        }
        setReverseCards(prev => [...prev, enrichedReverse])
        addToast({ type: 'success', message: 'Generated reverse card' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to generate reverse card' })
    } finally {
      setGeneratingReverseIndexes(prev => {
        const next = new Set(prev)
        next.delete(originalIndex)
        return next
      })
    }
  }

  const handleTextareaInput = (e) => {
    e.target.style.height = 'auto'
    e.target.style.height = e.target.scrollHeight + 'px'
  }
  
  const textareaRefEffect = (el) => {
    if (el) {
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }
  }

  const removeAllDuplicates = () => {
    const dupeIndexes = Object.keys(duplicateMap).map(Number)
    setCards(prev => prev.filter((_, i) => !dupeIndexes.includes(i)))
    setDuplicateMap({})
    setExcludedIndexes(new Set())
  }

  const handleGenerateReverse = async () => {
    const includedCards = cards.filter((_, i) => !excludedIndexes.has(i))
    if (includedCards.length === 0) return

    setIsGeneratingReverse(true)
    try {
      const res = await chatApi.generateReverseCards({
        cards: includedCards.map(c => ({ front: c.front, back: c.back })),
        model: selectedModel,
      })
      if (res?.reverseCards?.length > 0) {
        // Attach source metadata from originals
        const enrichedReverse = res.reverseCards.map(rc => {
          const originalCard = includedCards[rc.originalIndex]
          return {
            ...rc,
            sourceSectionId: originalCard?.sourceSectionId,
            sourceSectionName: originalCard?.sourceSectionName,
            sourcePillarId: originalCard?.sourcePillarId || pillarId,
            sourceTopicId: originalCard?.sourceTopicId || topicId,
          }
        })
        setReverseCards(enrichedReverse)
        addToast({ type: 'success', message: `Generated ${enrichedReverse.length} reverse card(s)` })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to generate reverse cards' })
      setReverseEnabled(false)
    } finally {
      setIsGeneratingReverse(false)
    }
  }

  // Toggle reverse card generation
  const handleReverseToggle = () => {
    if (!reverseEnabled) {
      setReverseEnabled(true)
      handleGenerateReverse()
    } else {
      setReverseEnabled(false)
      setReverseCards([])
    }
  }

  const handleSaveAll = async () => {
    const includedCards = cards.filter((_, i) => !excludedIndexes.has(i))
    const allCardsToSave = [...includedCards, ...reverseCards]
    if (allCardsToSave.length === 0) return
    setIsSaving(true)

    try {
      // 1. Find or create deck
      const allDecks = await decksApi.list()
      let deck = allDecks.find(d => d.name.toLowerCase() === topicName?.toLowerCase())
      
      if (!deck) {
        deck = await decksApi.create({ name: topicName || 'Generated Cards' })
      }

      // 2. Save all cards (originals + reverse)
      for (let i = 0; i < allCardsToSave.length; i++) {
        const card = allCardsToSave[i]
        const isReverse = i >= includedCards.length
        const cardData = {
          front: card.front,
          back: card.back,
          source_pillar_id: card.sourcePillarId || pillarId || null,
          source_topic_id: card.sourceTopicId || topicId || null,
          source_section_id: card.sourceSectionId || null,
          is_reverse: isReverse ? 1 : 0,
        }
        await flashcardsApi.create(deck.id, cardData)
      }

      const originalCount = includedCards.length
      const reverseCount = reverseCards.length
      const msg = reverseCount > 0
        ? `Saved ${originalCount} card(s) + ${reverseCount} reverse card(s) to "${deck.name}"`
        : `Saved ${originalCount} flashcard(s) to "${deck.name}" deck.`
      addToast({ type: 'success', message: msg })
      onSaveSuccess?.()
      onClose()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save flashcards.' })
    } finally {
      setIsSaving(false)
    }
  }

  const duplicateCount = Object.keys(duplicateMap).length
  const includedCount = cards.filter((_, i) => !excludedIndexes.has(i)).length

  // Group cards by section for display
  const sectionGroups = []
  const hasAnySections = cards.some(c => c.sourceSectionId)
  
  if (hasAnySections) {
    const groupMap = new Map()
    cards.forEach((card, i) => {
      const key = card.sourceSectionId || '__unsorted__'
      if (!groupMap.has(key)) {
        groupMap.set(key, { 
          sectionId: card.sourceSectionId, 
          sectionName: card.sourceSectionName || 'Other',
          cards: [] 
        })
      }
      groupMap.get(key).cards.push({ card, index: i })
    })
    sectionGroups.push(...groupMap.values())
  } else {
    sectionGroups.push({ sectionId: null, sectionName: null, cards: cards.map((card, i) => ({ card, index: i })) })
  }

  const renderCard = (card, i) => {
    const isDupe = duplicateMap[i]
    const isExcluded = excludedIndexes.has(i)

    return (
      <div key={i} style={{
        background: 'var(--color-bg-secondary)',
        border: `1px solid ${isDupe ? 'rgba(245, 158, 11, 0.4)' : 'var(--color-border)'}`,
        borderLeft: isDupe ? '3px solid #f59e0b' : undefined,
        borderRadius: 'var(--radius-lg)',
        padding: isMobile ? 'var(--space-3)' : 'var(--space-4)',
        opacity: isExcluded ? 0.45 : 1,
        transition: 'opacity 0.2s ease',
      }}>
        {editingIndex === i ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>Front</label>
              <textarea
                ref={textareaRefEffect}
                value={editFront}
                onChange={e => setEditFront(e.target.value)}
                onInput={handleTextareaInput}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    saveEdit()
                  }
                }}
                style={{
                  width: '100%', padding: 'var(--space-2)',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-sm)', resize: 'none', overflow: 'hidden'
                }}
              />
            </div>
            <div>
              <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>Back</label>
              <textarea
                ref={textareaRefEffect}
                value={editBack}
                onChange={e => setEditBack(e.target.value)}
                onInput={handleTextareaInput}
                onKeyDown={(e) => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    saveEdit()
                  }
                }}
                style={{
                  width: '100%', padding: 'var(--space-2)',
                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
                  fontSize: 'var(--text-sm)', resize: 'none', overflow: 'hidden'
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
            {/* Duplicate warning banner */}
            {isDupe && (
              <div style={{
                display: 'flex', flexDirection: 'column', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-3)',
                marginBottom: 'var(--space-3)',
                background: 'rgba(245, 158, 11, 0.08)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--text-xs)', color: '#d97706' }}>
                  <AlertTriangle size={12} style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1, fontWeight: 500 }}>
                    {isDupe.similarity}% similar to existing card
                  </span>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                    onClick={() => {
                      setExpandedDuplicateIndexes(prev => {
                        const next = new Set(prev)
                        if (next.has(i)) next.delete(i)
                        else next.add(i)
                        return next
                      })
                    }}
                  >
                    {expandedDuplicateIndexes.has(i) ? 'Hide' : 'Compare'}
                  </button>
                  <button
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: '11px', padding: '2px 8px', flexShrink: 0 }}
                    onClick={() => toggleExclude(i)}
                  >
                    {isExcluded ? 'Include Card' : 'Exclude Card'}
                  </button>
                </div>
                {expandedDuplicateIndexes.has(i) && (
                  <div style={{
                    marginTop: 'var(--space-2)',
                    padding: 'var(--space-3)',
                    background: 'var(--color-surface)',
                    border: '1px solid rgba(245, 158, 11, 0.3)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: 'var(--text-sm)',
                    color: 'var(--color-text-secondary)'
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 4 }}>EXISTING FRONT</div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: 'var(--space-2)' }}>{isDupe.duplicateOf?.front}</div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 4 }}>EXISTING BACK</div>
                    <div>{isDupe.duplicateOf?.back}</div>
                  </div>
                )}
              </div>
            )}

            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
              marginBottom: 'var(--space-3)',
              gap: 'var(--space-2)',
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 4 }}>FRONT</div>
                <div style={{
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                  color: isExcluded ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                  lineHeight: 'var(--leading-relaxed)',
                  textDecoration: isExcluded ? 'line-through' : 'none'
                }}>
                  {card.front}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => handleGenerateSingleReverse(i, card)} title="Generate Reverse"
                  disabled={generatingReverseIndexes.has(i) || isExcluded}
                  style={{ width: 32, height: 32, color: 'var(--color-teal)' }}>
                  {generatingReverseIndexes.has(i) ? <Loader2 size={14} className="spin" /> : <ArrowRightLeft size={14} />}
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEdit(i, card)} title="Edit"
                  style={{ width: 32, height: 32 }}>
                  <Edit3 size={14} />
                </button>
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeCard(i)} title="Remove"
                  style={{ color: 'var(--color-error)', width: 32, height: 32 }}>
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 4 }}>BACK</div>
              <div style={{
                fontSize: 'var(--text-sm)',
                color: isExcluded ? 'var(--color-text-tertiary)' : 'var(--color-text-secondary)',
                background: 'var(--color-surface)',
                padding: isMobile ? 'var(--space-2)' : 'var(--space-3)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                lineHeight: 'var(--leading-relaxed)',
                textDecoration: isExcluded ? 'line-through' : 'none'
              }}>
                {card.back}
              </div>
            </div>
          </>
        )}
      </div>
    )
  }

  return (
    <div
      className="flashcard-review-overlay"
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
        zIndex: 1000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobile ? 0 : 'var(--space-4)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget && !isSaving) onClose() }}
    >
      <div
        className="flashcard-review-modal"
        style={{
          background: 'var(--color-surface)',
          borderRadius: isMobile ? 0 : 'var(--radius-xl)',
          border: isMobile ? 'none' : '1px solid var(--color-border)',
          width: '100%',
          maxWidth: isMobile ? '100%' : 640,
          height: isMobile ? '100%' : 'auto',
          maxHeight: isMobile ? '100%' : '90vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          boxShadow: isMobile ? 'none' : '0 24px 60px rgba(0,0,0,0.4)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: isMobile ? 'var(--space-4)' : 'var(--space-5) var(--space-6)',
          borderBottom: '1px solid var(--color-border)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', minWidth: 0 }}>
            <div style={{
              width: 32, height: 32, borderRadius: 'var(--radius-md)',
              background: 'var(--color-accent-subtle)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Layers size={16} style={{ color: 'var(--color-accent)' }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 'var(--text-md)' }}>Review Flashcards</div>
              <div style={{
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-secondary)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}>
                Deck: {topicName || 'Generated Cards'}
                {isCheckingDupes && <span style={{ marginLeft: 8, color: 'var(--color-text-tertiary)' }}>• Checking duplicates…</span>}
              </div>
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} disabled={isSaving}
            style={{ width: 36, height: 36, flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        {/* Duplicate batch action bar */}
        {duplicateCount > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 'var(--space-2) var(--space-4)',
            background: 'rgba(245, 158, 11, 0.06)',
            borderBottom: '1px solid rgba(245, 158, 11, 0.15)',
            fontSize: 'var(--text-xs)',
            color: '#d97706',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <AlertTriangle size={13} />
              <span><strong>{duplicateCount}</strong> potential duplicate{duplicateCount > 1 ? 's' : ''} found</span>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: '11px', padding: '2px 10px', color: '#d97706' }}
              onClick={removeAllDuplicates}
            >
              Remove All
            </button>
          </div>
        )}

        {/* Card List */}
        <div style={{
          flex: 1, overflow: 'auto',
          padding: isMobile ? 'var(--space-3)' : 'var(--space-4) var(--space-6)',
          WebkitOverflowScrolling: 'touch',
        }}>
          {cards.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 'var(--space-8)', color: 'var(--color-text-tertiary)' }}>
              No cards generated or all removed.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 'var(--space-3)' : 'var(--space-4)' }}>
              {sectionGroups.map((group, gi) => (
                <div key={gi}>
                  {/* Section header */}
                  {group.sectionName && hasAnySections && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                      marginBottom: 'var(--space-3)',
                      marginTop: gi > 0 ? 'var(--space-4)' : 0,
                    }}>
                      <div style={{
                        fontSize: 'var(--text-xs)',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                        color: 'var(--color-accent)',
                      }}>
                        {group.sectionName}
                      </div>
                      <div style={{
                        flex: 1, height: 1,
                        background: 'var(--color-border)',
                      }} />
                      <span style={{
                        fontSize: '10px',
                        color: 'var(--color-text-tertiary)',
                        fontWeight: 600,
                      }}>
                        {group.cards.length} card{group.cards.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: isMobile ? 'var(--space-3)' : 'var(--space-3)' }}>
                    {group.cards.map(({ card, index }) => renderCard(card, index))}
                  </div>
                </div>
              ))}

              {/* Reverse cards section */}
              {reverseCards.length > 0 && (
                <div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    marginBottom: 'var(--space-3)',
                    marginTop: 'var(--space-4)',
                  }}>
                    <div style={{
                      fontSize: 'var(--text-xs)',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      color: 'var(--color-teal)',
                      display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                      <ArrowRightLeft size={12} />
                      Reverse Cards
                    </div>
                    <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
                    <span style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
                      {reverseCards.length} card{reverseCards.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {reverseCards.map((rc, ri) => (
                      <div key={`reverse-${ri}`} style={{
                        background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-border)',
                        borderLeft: '3px solid var(--color-teal)',
                        borderRadius: 'var(--radius-lg)',
                        padding: isMobile ? 'var(--space-3)' : 'var(--space-4)',
                      }}>
                        {editingReverseIndex === ri ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            <div>
                              <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>Front</label>
                              <textarea
                                ref={textareaRefEffect}
                                value={editReverseFront}
                                onChange={e => setEditReverseFront(e.target.value)}
                                onInput={handleTextareaInput}
                                onKeyDown={(e) => {
                                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    saveEditReverse()
                                  }
                                }}
                                style={{
                                  width: '100%', padding: 'var(--space-2)',
                                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
                                  fontSize: 'var(--text-sm)', resize: 'none', overflow: 'hidden'
                                }}
                              />
                            </div>
                            <div>
                              <label style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: '4px', display: 'block' }}>Back</label>
                              <textarea
                                ref={textareaRefEffect}
                                value={editReverseBack}
                                onChange={e => setEditReverseBack(e.target.value)}
                                onInput={handleTextareaInput}
                                onKeyDown={(e) => {
                                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    saveEditReverse()
                                  }
                                }}
                                style={{
                                  width: '100%', padding: 'var(--space-2)',
                                  background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                                  borderRadius: 'var(--radius-md)', color: 'var(--color-text-primary)',
                                  fontSize: 'var(--text-sm)', resize: 'none', overflow: 'hidden'
                                }}
                              />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)' }}>
                              <button className="btn btn-ghost btn-sm" onClick={() => setEditingReverseIndex(null)}>Cancel</button>
                              <button className="btn btn-primary btn-sm" onClick={saveEditReverse}>Save Edits</button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)', gap: 'var(--space-2)' }}>
                              <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
                                  <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-teal)', letterSpacing: '0.05em' }}>FRONT</div>
                                  <div style={{
                                    fontSize: '9px', padding: '1px 5px', borderRadius: 'var(--radius-full)',
                                    background: 'rgba(20, 184, 166, 0.1)', color: 'var(--color-teal)',
                                    fontWeight: 600, flexShrink: 0,
                                  }}>
                                    ↩ Reverse
                                  </div>
                                </div>
                                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', lineHeight: 'var(--leading-relaxed)' }}>
                                  {rc.front}
                                </div>
                              </div>
                              <div style={{ display: 'flex', gap: 'var(--space-1)', flexShrink: 0 }}>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => startEditReverse(ri, rc)} title="Edit"
                                  style={{ width: 32, height: 32 }}>
                                  <Edit3 size={14} />
                                </button>
                                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeReverseCard(ri)} title="Remove"
                                  style={{ color: 'var(--color-error)', width: 32, height: 32 }}>
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--color-teal)', letterSpacing: '0.05em', marginBottom: 4 }}>BACK</div>
                              <div style={{
                                fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
                                background: 'var(--color-surface)', padding: isMobile ? 'var(--space-2)' : 'var(--space-3)',
                                borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)',
                                lineHeight: 'var(--leading-relaxed)',
                              }}>
                                {rc.back}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          padding: isMobile ? 'var(--space-3) var(--space-4)' : 'var(--space-4) var(--space-6)',
          borderTop: '1px solid var(--color-border)',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          background: 'var(--color-bg-secondary)',
          flexShrink: 0,
        }}>
          {/* Reverse toggle row */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleReverseToggle}
              disabled={isGeneratingReverse || isSaving || includedCount === 0}
              style={{
                fontSize: 'var(--text-xs)',
                color: reverseEnabled ? 'var(--color-teal)' : 'var(--color-text-secondary)',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
              }}
            >
              {isGeneratingReverse ? (
                <Loader2 size={13} className="spin" />
              ) : (
                <ArrowRightLeft size={13} />
              )}
              {isGeneratingReverse ? 'Generating…' : reverseEnabled ? 'Reverse On' : 'Generate Reverse Cards'}
            </button>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
              {includedCount} card{includedCount !== 1 ? 's' : ''}{reverseCards.length > 0 ? ` + ${reverseCards.length} reverse` : ''}
            </span>
          </div>

          {/* Action buttons */}
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            justifyContent: 'flex-end',
            gap: 'var(--space-2)',
          }}>
            <button className={includedCount + reverseCards.length === 0 ? "btn btn-primary" : "btn btn-secondary"} onClick={onClose} disabled={isSaving}
              style={isMobile ? { width: '100%', height: 44, justifyContent: 'center' } : {}}>
              {includedCount + reverseCards.length === 0 ? 'Close' : 'Cancel'}
            </button>
            <button 
              id="flashcard-save-all-btn"
              className={includedCount + reverseCards.length === 0 ? "btn btn-ghost" : "btn btn-primary"} 
              onClick={handleSaveAll} 
              disabled={includedCount + reverseCards.length === 0 || isSaving}
              style={isMobile ? { width: '100%', height: 48, justifyContent: 'center', fontSize: 'var(--text-md)' } : {}}>
              {isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
              {isSaving ? 'Saving...' : `Save ${includedCount + reverseCards.length} Card${(includedCount + reverseCards.length) === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
