import { useState, useEffect } from 'react'
import { Plus, Search, MessageSquare, GraduationCap, Trash2, Edit, Play, Clock, Settings, BarChart2 } from 'lucide-react'
import DeckCard from '../components/study/DeckCard'
import FlashcardView from '../components/study/FlashcardView'
import DeckEditor from '../components/study/DeckEditor'
import StudyHeatmap from '../components/study/StudyHeatmap'
import ChatPanel from '../components/shared/ChatPanel'
import EmptyState from '../components/shared/EmptyState'
import Modal from '../components/shared/Modal'
import useAppStore from '../stores/appStore'
import { decksApi, flashcardsApi, studySessionsApi } from '../utils/api'
import DeckOptionsModal from '../components/study/DeckOptionsModal'
import CardBrowser from '../components/study/CardBrowser'
import StatsDashboard from '../components/study/StatsDashboard'
import useIsMobile from '../hooks/useIsMobile'

const mapDeckFromApi = (d) => ({
  id: d.id,
  name: d.name,
  description: d.description || '',
  colorIndex: d.color_index !== undefined ? d.color_index : 0,
  cardCount: d.card_count !== undefined ? d.card_count : (d.cards ? d.cards.length : 0),
  newCount: d.new_count || 0,
  learnCount: d.learn_count || 0,
  dueCount: d.due_count || 0,
  tags: d.tags || '',
  lastStudied: d.last_studied || d.lastStudied || 'Never studied',
  progress: d.progress !== undefined ? d.progress : 0,
  settings: d.settings || { new_limit: 20, review_limit: 200, steps: '1m 10m', lapse_steps: '10m', easy_bonus: 1.3 },
  cards: d.cards ? d.cards.map(c => ({
    id: c.id, front: c.front, back: c.back,
    ease_factor: c.ease_factor, interval: c.interval,
    repetitions: c.repetitions, next_review: c.next_review,
    state: c.state || 0, learning_step: c.learning_step || 0,
    srs_previews: c.srs_previews,
    // Guide linking metadata
    source_pillar_id: c.source_pillar_id || null,
    source_topic_id: c.source_topic_id || null,
    source_section_id: c.source_section_id || null,
    // Reverse card tracking
    is_reverse: c.is_reverse || 0,
    reverse_of_id: c.reverse_of_id || null,
  })) : []
})

export default function StudyPage() {
  const toggleChat = useAppStore((s) => s.toggleChat)
  const addToast = useAppStore((s) => s.addToast)

  const [view, setView] = useState('list') // 'list' | 'study' | 'review' | 'edit' | 'new'
  const isMobile = useIsMobile()

  const [decks, setDecks] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedDeck, setSelectedDeck] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [deleteModal, setDeleteModal] = useState(null)
  const [optionsModalDeck, setOptionsModalDeck] = useState(null)
  const [studySessions, setStudySessions] = useState([])

  useEffect(() => {
    const fetchStudySessions = studySessionsApi ? studySessionsApi.list() : Promise.resolve([])
    Promise.all([
      decksApi.list(),
      fetchStudySessions
    ]).then(([list, sessions]) => {
      if (list && list.length > 0) {
        setDecks(list.map(mapDeckFromApi))
      }
      if (sessions) {
        setStudySessions(sessions)
      }
    }).catch(() => {}).finally(() => {
      setIsLoading(false)
    })
  }, [])

  // Collect all unique tags across decks
  const allTags = [...new Set(
    decks.flatMap((d) => d.tags ? d.tags.split(',').map((t) => t.trim()).filter(Boolean) : [])
  )].sort()

  const filteredDecks = decks.filter((d) => {
    const matchesSearch = d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (d.tags && d.tags.toLowerCase().includes(searchQuery.toLowerCase()))
    const matchesTag = !activeTag || (d.tags && d.tags.split(',').map((t) => t.trim()).includes(activeTag))
    return matchesSearch && matchesTag
  })

  const handleDeckClick = async (deck) => {
    setSelectedDeck(deck)
    setView('study')
    try {
      const fullDeck = await decksApi.get(deck.id)
      setSelectedDeck(mapDeckFromApi(fullDeck))
    } catch {
      // Ignore
    }
  }

  const handleReviewDeck = async (deck) => {
    setSelectedDeck(deck)
    setView('review')
    try {
      const dueCards = await flashcardsApi.due(deck.id)
      setSelectedDeck({
        ...deck,
        cards: dueCards.map(c => ({
          id: c.id, front: c.front, back: c.back,
          ease_factor: c.ease_factor, interval: c.interval,
          repetitions: c.repetitions, next_review: c.next_review,
          source_pillar_id: c.source_pillar_id || null,
          source_topic_id: c.source_topic_id || null,
          source_section_id: c.source_section_id || null,
        })),
      })
    } catch {
      // Ignore
    }
  }

  const handleNewDeck = () => {
    setSelectedDeck(null)
    setView('new')
  }

  const handleEditDeck = async (deck) => {
    setSelectedDeck(deck)
    setView('edit')
    try {
      const fullDeck = await decksApi.get(deck.id)
      setSelectedDeck(mapDeckFromApi(fullDeck))
    } catch {
      // Ignore
    }
  }

  const handleSaveDeck = async (data) => {
    const colorIndex = selectedDeck ? selectedDeck.colorIndex : (decks.length % 8)
    const tempId = selectedDeck ? selectedDeck.id : `deck-${Date.now()}`

    if (selectedDeck) {
      setDecks((prev) =>
        prev.map((d) =>
          d.id === selectedDeck.id
            ? {
                ...d,
                name: data.name,
                description: data.description,
                tags: data.tags || '',
                cards: data.cards || [],
                cardCount: data.cards?.length || 0,
              }
            : d
        )
      )
    } else {
      const newDeck = {
        id: tempId,
        name: data.name,
        description: data.description,
        tags: data.tags || '',
        colorIndex: colorIndex,
        cardCount: data.cards?.length || 0,
        lastStudied: 'Never studied',
        progress: 0,
        cards: data.cards || []
      }
      setDecks((prev) => [...prev, newDeck])
    }
    setView('list')
    setSelectedDeck(null)

    try {
      if (selectedDeck) {
        await decksApi.update(tempId, {
          name: data.name,
          description: data.description,
          tags: data.tags || '',
          color_index: colorIndex
        })

        const existingCards = selectedDeck.cards || []
        const currentCards = data.cards || []

        const deletedCards = existingCards.filter(
          (ec) => !currentCards.some((cc) => cc.id === ec.id)
        )
        for (const card of deletedCards) {
          await flashcardsApi.delete(tempId, card.id)
        }

        for (const card of currentCards) {
          const isNew = String(card.id).startsWith('card-')
          if (isNew) {
            await flashcardsApi.create(tempId, { front: card.front, back: card.back })
          } else {
            await flashcardsApi.update(tempId, card.id, { front: card.front, back: card.back })
          }
        }
        addToast({ type: 'success', message: 'Deck updated successfully' })
      } else {
        const deck = await decksApi.create({
          name: data.name,
          description: data.description,
          tags: data.tags || '',
          color_index: colorIndex
        })
        const deckId = deck?.id || tempId
        if (deckId !== tempId) {
          setDecks((prev) =>
            prev.map((d) => (d.id === tempId ? { ...d, id: deckId } : d))
          )
        }
        const currentCards = data.cards || []
        for (const card of currentCards) {
          await flashcardsApi.create(deckId, { front: card.front, back: card.back })
        }
        addToast({ type: 'success', message: 'Deck created successfully' })
      }

      const list = await decksApi.list()
      if (list && list.length > 0) {
        setDecks(list.map(mapDeckFromApi))
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save deck' })
    }
  }

  const handleDeleteDeck = async (deck) => {
    setDecks((prev) => prev.filter((d) => d.id !== deck.id))
    setDeleteModal(null)
    try {
      await decksApi.delete(deck.id)
      addToast({ type: 'info', message: `"${deck.name}" deleted` })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to delete deck' })
    }
  }

  const handleSaveDeckSettings = async (deckId, settingsData) => {
    try {
      const updated = await decksApi.updateSettings(deckId, settingsData)
      setDecks(prev => prev.map(d => d.id === deckId ? { ...d, settings: updated.settings } : d))
      if (selectedDeck && selectedDeck.id === deckId) {
        setSelectedDeck(prev => ({ ...prev, settings: updated.settings }))
      }
      setOptionsModalDeck(null)
      addToast({ type: 'success', message: 'Deck settings saved successfully' })
      refreshDecks()
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save deck settings' })
    }
  }

  const handleSaveBrowserCard = async (cardId, cardData) => {
    try {
      await flashcardsApi.update(selectedDeck.id, cardId, cardData)
      const fullDeck = await decksApi.get(selectedDeck.id)
      setSelectedDeck(mapDeckFromApi(fullDeck))
      addToast({ type: 'success', message: 'Card updated' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to update card' })
    }
  }

  const handleDeleteBrowserCard = async (cardId) => {
    try {
      await flashcardsApi.delete(selectedDeck.id, cardId)
      const fullDeck = await decksApi.get(selectedDeck.id)
      setSelectedDeck(mapDeckFromApi(fullDeck))
      addToast({ type: 'info', message: 'Card deleted' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to delete card' })
    }
  }

  const handleAddBrowserCard = async () => {
    try {
      await flashcardsApi.create(selectedDeck.id, { front: 'New Front', back: 'New Back' })
      const fullDeck = await decksApi.get(selectedDeck.id)
      setSelectedDeck(mapDeckFromApi(fullDeck))
      addToast({ type: 'success', message: 'Blank card added' })
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to add card' })
    }
  }

  // Refresh decks list
  const refreshDecks = async () => {
    try {
      const list = await decksApi.list()
      if (list && list.length > 0) setDecks(list.map(mapDeckFromApi))
    } catch { /* ignore */ }
  }

  // Study view
  if ((view === 'study' || view === 'review') && selectedDeck) {
    return (
      <div className="study-layout" id="study-page">
        <div className="study-main">
          <FlashcardView
            cards={selectedDeck.cards || []}
            deckName={selectedDeck.name}
            deckId={selectedDeck.id}
            reviewMode={view === 'review'}
            onBack={() => {
              setView('list')
              setSelectedDeck(null)
              refreshDecks()
            }}
          />
        </div>
        {!isMobile && (
          <ChatPanel
            page="study"
            title="Study Assistant"
            placeholder="Ask about this topic or generate more cards..."
          />
        )}
      </div>
    )
  }

  // Card Browser view
  if (view === 'browser' && selectedDeck) {
    return (
      <div className="study-layout" id="study-page">
        <div className="study-main">
          <CardBrowser
            deck={selectedDeck}
            onBack={() => {
              setView('list')
              setSelectedDeck(null)
              refreshDecks()
            }}
            onSaveCard={handleSaveBrowserCard}
            onDeleteCard={handleDeleteBrowserCard}
            onAddCard={handleAddBrowserCard}
          />
        </div>
      </div>
    )
  }

  // Stats Dashboard view
  if (view === 'stats' && selectedDeck) {
    return (
      <div className="study-layout" id="study-page">
        <div className="study-main">
          <StatsDashboard
            deck={selectedDeck}
            onBack={() => {
              setView('list')
              setSelectedDeck(null)
              refreshDecks()
            }}
          />
        </div>
      </div>
    )
  }

  // Edit / New view
  if (view === 'edit' || view === 'new') {
    return (
      <div className="study-layout" id="study-page">
        <div className="study-main">
          <DeckEditor
            deck={selectedDeck}
            cards={selectedDeck ? (selectedDeck.cards || []) : []}
            onSave={handleSaveDeck}
            onCancel={() => {
              setView('list')
              setSelectedDeck(null)
            }}
          />
        </div>
        {!isMobile && (
          <ChatPanel
            page="study"
            title="AI Card Generator"
            placeholder="Describe a topic to auto-generate flashcards..."
          />
        )}
      </div>
    )
  }

  // Deck list view
  return (
    <div className="study-layout" id="study-page">
      <div className="study-main">
        {/* Page Header */}
        <div style={{ marginBottom: 'var(--space-8)' }}>
          <h1 className="page-title">Study Hub</h1>
          <p className="page-subtitle">Master your architecture knowledge with spaced repetition.</p>
        </div>

        <StudyHeatmap sessions={studySessions} />

        {/* Main Content Area */}
        <div className="page-header">
          <div className="page-header-top">
            <div>
              <h1 className="page-title">Flashcards</h1>
              <p className="page-description">
                Create and study flashcard decks to reinforce system design concepts.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
              <button
                className="btn btn-secondary btn-ai-generate"
                onClick={() => toggleChat('study')}
                id="study-chat-btn"
              >
                <MessageSquare size={14} />
                AI Generate
              </button>
              <button
                className="btn btn-primary"
                onClick={handleNewDeck}
                id="new-deck-btn"
              >
                <Plus size={14} />
                New Deck
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="study-content">
          {/* Loading state */}
          {isLoading ? (
            <div className="deck-grid">
              {[1, 2, 3].map((i) => (
                <div key={i} className="card" style={{
                  padding: 'var(--space-5)',
                  animation: 'pulse 1.5s ease-in-out infinite',
                }}>
                  <div style={{
                    width: 36, height: 36,
                    borderRadius: 'var(--radius-md)',
                    background: 'var(--color-bg-hover)',
                    marginBottom: 'var(--space-3)',
                  }} />
                  <div style={{
                    width: '70%', height: 16,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg-hover)',
                    marginBottom: 'var(--space-2)',
                  }} />
                  <div style={{
                    width: '40%', height: 12,
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--color-bg-hover)',
                  }} />
                </div>
              ))}
            </div>
          ) : (
          <>
          {/* Search */}
          {decks.length > 0 && (
            <div style={{ marginBottom: 'var(--space-5)' }}>
              <div className="search-bar">
                <Search size={16} />
                <input
                  placeholder="Search decks..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  id="search-decks"
                />
              </div>
              {/* Tag filter chips */}
              {allTags.length > 0 && (
                <div style={{ display: 'flex', gap: 'var(--space-1)', flexWrap: 'wrap', marginTop: 'var(--space-2)' }}>
                  <button
                    className={`btn btn-ghost`}
                    style={{
                      fontSize: '11px',
                      padding: '2px 10px',
                      borderRadius: 'var(--radius-full)',
                      background: !activeTag ? 'var(--color-accent-subtle)' : 'transparent',
                      color: !activeTag ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                      fontWeight: !activeTag ? 600 : 400,
                    }}
                    onClick={() => setActiveTag('')}
                  >
                    All
                  </button>
                  {allTags.map((tag) => (
                    <button
                      key={tag}
                      className={`btn btn-ghost`}
                      style={{
                        fontSize: '11px',
                        padding: '2px 10px',
                        borderRadius: 'var(--radius-full)',
                        background: activeTag === tag ? 'var(--color-accent-subtle)' : 'transparent',
                        color: activeTag === tag ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                        fontWeight: activeTag === tag ? 600 : 400,
                      }}
                      onClick={() => setActiveTag(activeTag === tag ? '' : tag)}
                    >
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Deck grid or empty state */}
          {filteredDecks.length > 0 ? (
            <div className="deck-grid">
                {filteredDecks.map((deck) => (
                <div key={deck.id} style={{ position: 'relative' }}>
                  <DeckCard deck={deck} onClick={handleDeckClick} />
                  {/* Due count badge */}
                  {deck.dueCount > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '-10px',
                        right: '-10px',
                        background: 'var(--color-accent)',
                        color: '#fff',
                        fontSize: '11px',
                        fontWeight: 700,
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-full)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                        zIndex: 3,
                        boxShadow: 'var(--shadow-sm)',
                      }}
                    >
                      <Clock size={10} />
                      {deck.dueCount} due
                    </div>
                  )}
                  {/* Quick actions overlay */}
                  <div
                    style={{
                      position: 'absolute',
                      top: 'var(--space-3)',
                      right: 'var(--space-3)',
                      display: 'flex',
                      gap: 'var(--space-1)',
                      opacity: 0,
                      transition: 'opacity var(--duration-fast)',
                    }}
                    className="deck-actions"
                  >
                    {deck.dueCount > 0 && (
                      <button
                        className="btn btn-ghost btn-icon btn-sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleReviewDeck(deck)
                        }}
                        title="Review Due Cards"
                        style={{ width: 28, height: 28, color: 'var(--color-accent)' }}
                      >
                        <Clock size={12} />
                      </button>
                    )}
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDeckClick(deck)
                      }}
                      title="Study"
                      style={{ width: 28, height: 28 }}
                    >
                      <Play size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedDeck(deck)
                        decksApi.get(deck.id).then(fullDeck => {
                          setSelectedDeck(mapDeckFromApi(fullDeck))
                          setView('browser')
                        }).catch(() => {})
                      }}
                      title="Browse Cards"
                      style={{ width: 28, height: 28 }}
                    >
                      <Search size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setSelectedDeck(deck)
                        decksApi.get(deck.id).then(fullDeck => {
                          setSelectedDeck(mapDeckFromApi(fullDeck))
                          setView('stats')
                        }).catch(() => {})
                      }}
                      title="Deck Stats"
                      style={{ width: 28, height: 28 }}
                    >
                      <BarChart2 size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setOptionsModalDeck(deck)
                      }}
                      title="Deck Options"
                      style={{ width: 28, height: 28 }}
                    >
                      <Settings size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleEditDeck(deck)
                      }}
                      title="Edit Metadata"
                      style={{ width: 28, height: 28 }}
                    >
                      <Edit size={12} />
                    </button>
                    <button
                      className="btn btn-ghost btn-icon btn-sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        setDeleteModal(deck)
                      }}
                      title="Delete"
                      style={{ width: 28, height: 28, color: 'var(--color-error)' }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : decks.length === 0 ? (
            <EmptyState
              icon={<GraduationCap size={24} />}
              title="No flashcard decks yet"
              description="Create your first deck to start studying system design concepts, or use AI to auto-generate cards."
              action={
                <button className="btn btn-primary" onClick={handleNewDeck}>
                  <Plus size={14} />
                  Create First Deck
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={<Search size={24} />}
              title="No results"
              description={`No decks match "${searchQuery}"`}
            />
          )}
          </>
          )}
        </div>
      </div>

      {/* AI Chat panel */}
      {!isMobile && (
        <ChatPanel
          page="study"
          title="AI Card Generator"
          placeholder="Describe a topic to auto-generate flashcards..."
        />
      )}

      {/* Delete confirmation modal */}
      <Modal
        open={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Deck"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => setDeleteModal(null)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              style={{ background: 'var(--color-error)' }}
              onClick={() => handleDeleteDeck(deleteModal)}
            >
              Delete
            </button>
          </>
        }
      >
        <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}>
          Are you sure you want to delete <strong>"{deleteModal?.name}"</strong>? This action cannot
          be undone and all cards in this deck will be permanently removed.
        </p>
      </Modal>

      {/* Deck settings options modal */}
      <DeckOptionsModal
        open={!!optionsModalDeck}
        onClose={() => setOptionsModalDeck(null)}
        deck={optionsModalDeck}
        onSave={(settingsData) => handleSaveDeckSettings(optionsModalDeck.id, settingsData)}
      />
    </div>
  )
}
