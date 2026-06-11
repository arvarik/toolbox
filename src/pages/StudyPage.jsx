import { useState } from 'react'
import { Plus, Search, MessageSquare, GraduationCap, Trash2, Edit, Play } from 'lucide-react'
import DeckCard from '../components/study/DeckCard'
import FlashcardView from '../components/study/FlashcardView'
import DeckEditor from '../components/study/DeckEditor'
import ChatPanel from '../components/shared/ChatPanel'
import EmptyState from '../components/shared/EmptyState'
import Modal from '../components/shared/Modal'
import useAppStore from '../stores/appStore'

// Sample decks for UI scaffolding
const sampleDecks = [
  {
    id: 'deck-1',
    name: 'CAP Theorem & Consistency',
    description: 'Understand the tradeoffs between Consistency, Availability, and Partition tolerance.',
    cardCount: 12,
    lastStudied: '2 days ago',
    colorIndex: 0,
  },
  {
    id: 'deck-2',
    name: 'Load Balancing Strategies',
    description: 'Round robin, least connections, consistent hashing, and more.',
    cardCount: 8,
    lastStudied: 'Yesterday',
    colorIndex: 1,
  },
  {
    id: 'deck-3',
    name: 'Database Scaling Patterns',
    description: 'Sharding, replication, partitioning, and read replicas.',
    cardCount: 15,
    lastStudied: 'Never studied',
    colorIndex: 2,
  },
]

const sampleCards = [
  {
    id: 'c1',
    front: 'What is the CAP Theorem?',
    back: 'The CAP theorem states that a distributed system can only provide two of three guarantees: Consistency, Availability, and Partition Tolerance.',
  },
  {
    id: 'c2',
    front: 'What is eventual consistency?',
    back: 'A consistency model where, given enough time without new updates, all replicas will converge to the same value. Used by systems like DynamoDB and Cassandra.',
  },
  {
    id: 'c3',
    front: 'When should you choose CP over AP?',
    back: 'Choose CP (Consistency + Partition Tolerance) for financial transactions, inventory systems, or any workload where stale reads are unacceptable.',
  },
]

export default function StudyPage() {
  const chatOpen = useAppStore((s) => s.chatOpen.study)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const addToast = useAppStore((s) => s.addToast)

  const [view, setView] = useState('list') // 'list' | 'study' | 'edit' | 'new'
  const [decks, setDecks] = useState(sampleDecks)
  const [selectedDeck, setSelectedDeck] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [deleteModal, setDeleteModal] = useState(null)

  const filteredDecks = decks.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const handleDeckClick = (deck) => {
    setSelectedDeck(deck)
    setView('study')
  }

  const handleNewDeck = () => {
    setSelectedDeck(null)
    setView('new')
  }

  const handleEditDeck = (deck) => {
    setSelectedDeck(deck)
    setView('edit')
  }

  const handleSaveDeck = (data) => {
    if (selectedDeck) {
      setDecks((prev) =>
        prev.map((d) => (d.id === selectedDeck.id ? { ...d, ...data } : d))
      )
      addToast({ type: 'success', message: 'Deck updated successfully' })
    } else {
      const newDeck = {
        id: `deck-${Date.now()}`,
        ...data,
        cardCount: data.cards?.length || 0,
        lastStudied: 'Never studied',
        colorIndex: decks.length % 8,
      }
      setDecks((prev) => [...prev, newDeck])
      addToast({ type: 'success', message: 'Deck created successfully' })
    }
    setView('list')
    setSelectedDeck(null)
  }

  const handleDeleteDeck = (deck) => {
    setDecks((prev) => prev.filter((d) => d.id !== deck.id))
    setDeleteModal(null)
    addToast({ type: 'info', message: `"${deck.name}" deleted` })
  }

  // Study view
  if (view === 'study' && selectedDeck) {
    return (
      <div className="study-layout" id="study-page">
        <div className="study-main">
          <FlashcardView
            cards={sampleCards}
            deckName={selectedDeck.name}
            onBack={() => {
              setView('list')
              setSelectedDeck(null)
            }}
          />
        </div>
        <ChatPanel
          page="study"
          title="Study Assistant"
          placeholder="Ask about this topic or generate more cards..."
        />
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
            cards={selectedDeck ? sampleCards : []}
            onSave={handleSaveDeck}
            onCancel={() => {
              setView('list')
              setSelectedDeck(null)
            }}
          />
        </div>
        <ChatPanel
          page="study"
          title="AI Card Generator"
          placeholder="Describe a topic to auto-generate flashcards..."
        />
      </div>
    )
  }

  // Deck list view
  return (
    <div className="study-layout" id="study-page">
      <div className="study-main">
        {/* Page header */}
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
                className="btn btn-secondary"
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
            </div>
          )}

          {/* Deck grid or empty state */}
          {filteredDecks.length > 0 ? (
            <div className="deck-grid">
              {filteredDecks.map((deck) => (
                <div key={deck.id} style={{ position: 'relative' }}>
                  <DeckCard deck={deck} onClick={handleDeckClick} />
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
                        handleEditDeck(deck)
                      }}
                      title="Edit"
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
        </div>
      </div>

      {/* AI Chat panel */}
      <ChatPanel
        page="study"
        title="AI Card Generator"
        placeholder="Describe a topic to auto-generate flashcards..."
      />

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
    </div>
  )
}
