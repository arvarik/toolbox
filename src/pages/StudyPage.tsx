import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus,
  Trash2,
  Clock,
  Play,
  BarChart2,
  Search,
  MessageSquare,
  GraduationCap,
  Edit,
  Settings,
  Sparkles,
} from 'lucide-react'
import Skeleton from '../components/shared/Skeleton'
import PullToRefresh from '../components/shared/PullToRefresh'
import DeckCard from '../components/study/DeckCard'
import FlashcardView, { type FlashcardItem } from '../components/study/FlashcardView'
import DeckEditor, { type DeckSavePayload } from '../components/study/DeckEditor'
import StudyHeatmap, { type StudySessionDay } from '../components/study/StudyHeatmap'
import ChatPanel from '../components/shared/ChatPanel'
import EmptyState from '../components/shared/EmptyState'
import Modal from '../components/shared/Modal'
import { DomainGlyph, resolveKitGlyph } from '../components/ui'

import useAppStore from '../stores/appStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'
import { decksApi, flashcardsApi, studySessionsApi } from '../utils/api'
import DeckOptionsModal, { DEFAULT_DECK_SETTINGS, type DeckSchedulerSettings } from '../components/study/DeckOptionsModal'
import CardBrowser from '../components/study/CardBrowser'
import StatsDashboard from '../components/study/StatsDashboard'
import useIsMobile from '../hooks/useIsMobile'
import { seedCuratedStarterDeck } from '../utils/starterDeck'

type StudyViewMode = 'list' | 'study' | 'review' | 'edit' | 'new' | 'browser' | 'stats'

interface RawApiDeck {
  id: string
  name: string
  description?: string
  color_index?: number
  card_count?: number
  new_count?: number
  learn_count?: number
  due_count?: number
  tags?: string
  last_studied?: string
  lastStudied?: string
  progress?: number
  settings?: Partial<DeckSchedulerSettings>
  cards?: FlashcardItem[]
}

export interface StudyDeckItem {
  id: string
  name: string
  description: string
  colorIndex: number
  cardCount: number
  newCount: number
  learnCount: number
  dueCount: number
  tags: string
  lastStudied: string
  progress: number
  settings: DeckSchedulerSettings
  cards: FlashcardItem[]
}

const errMsg = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback

const QUICK_BTN_STYLE = { width: 28, height: 28 } as const

const mapCardFromApi = (c: FlashcardItem): FlashcardItem => ({
  id: c.id,
  deck_id: c.deck_id,
  deckName: c.deckName,
  front: c.front,
  back: c.back,
  ease_factor: c.ease_factor,
  interval: c.interval,
  repetitions: c.repetitions,
  next_review: c.next_review ?? null,
  state: c.state || 0,
  learning_step: c.learning_step || 0,
  position: c.position ?? 0,
  prerequisite_id: c.prerequisite_id ?? null,
  srs_previews: c.srs_previews,
  source_pillar_id: c.source_pillar_id || null,
  source_topic_id: c.source_topic_id || null,
  source_section_id: c.source_section_id || null,
  is_reverse: c.is_reverse || 0,
  reverse_of_id: c.reverse_of_id || null,
  is_remediation: c.is_remediation || 0,
  remediation_node: c.remediation_node || null,
  remediation_reason: c.remediation_reason || null,
})

const mapDeckFromApi = (d: RawApiDeck): StudyDeckItem => ({
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
  settings: { ...DEFAULT_DECK_SETTINGS, ...(d.settings || {}) },
  cards: Array.isArray(d.cards) ? d.cards.map(mapCardFromApi) : [],
})

export default function StudyPage() {
  const toggleChat = useAppStore((s) => s.toggleChat)
  const addToast = useAppStore((s) => s.addToast)
  const { kit, kitSlug, skeleton } = useActiveKit()
  const prefix = useKitRoutePrefix()

  const [view, setView] = useState<StudyViewMode>('list')
  const isMobile = useIsMobile()

  const [decks, setDecks] = useState<StudyDeckItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [selectedDeck, setSelectedDeck] = useState<StudyDeckItem | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTag, setActiveTag] = useState('')
  const [deleteModal, setDeleteModal] = useState<StudyDeckItem | null>(null)
  const [optionsModalDeck, setOptionsModalDeck] = useState<StudyDeckItem | null>(null)
  const [studySessions, setStudySessions] = useState<StudySessionDay[]>([])
  const [isLoadingStarter, setIsLoadingStarter] = useState(false)

  const fetchSeqRef = useRef(0)

  const isCustomKit = Boolean(kit && skeleton?.identity?.slug && skeleton.identity.slug !== 'system-design')
  const kitStarterDeck = skeleton?.seeds?.starterDeck
  const canSeedStarter = !isCustomKit || Boolean(kitStarterDeck && kitStarterDeck.cards.length > 0)

  const fetchDecks = useCallback(async (isRefresh = false) => {
    const seq = ++fetchSeqRef.current
    if (!isRefresh) setIsLoading(true)
    try {
      const fetchStudySessions = studySessionsApi.list()
      const [list, sessions] = await Promise.all([
        decksApi.list(),
        fetchStudySessions,
      ])
      if (seq !== fetchSeqRef.current) return
      if (Array.isArray(list)) {
        setDecks((list as RawApiDeck[]).map(mapDeckFromApi))
      }
      if (Array.isArray(sessions)) {
        setStudySessions(sessions as StudySessionDay[])
      }
    } catch {
      // Ignore
    } finally {
      if (seq === fetchSeqRef.current) {
        setIsLoading(false)
      }
    }
  }, [])

  // Reset sub-views/modals and reload decks when active Kit or route prefix changes
  useEffect(() => {
    setView('list')
    setSelectedDeck(null)
    setSearchQuery('')
    setActiveTag('')
    setDeleteModal(null)
    setOptionsModalDeck(null)
    void fetchDecks()
  }, [kit?.id, kitSlug, prefix, fetchDecks])

  const handleSeedStarterDeck = async () => {
    setIsLoadingStarter(true)
    try {
      if (isCustomKit && kitStarterDeck && kitStarterDeck.cards.length > 0) {
        const created = (await decksApi.create({
          name: kitStarterDeck.name,
          description: kitStarterDeck.description || '',
          tags: (skeleton?.identity?.tags || []).join(', '),
          color_index: 0,
        })) as { id: string }
        for (const seedCard of kitStarterDeck.cards) {
          await flashcardsApi.create(created.id, {
            front: seedCard.front,
            back: seedCard.back,
            source_pillar_id: seedCard.pillarId || null,
            source_topic_id: seedCard.topicId || null,
          })
        }
        await fetchDecks(true)
        addToast({
          type: 'success',
          message: `Loaded "${kitStarterDeck.name}" starter deck with ${kitStarterDeck.cards.length} curated cards!`,
        })
      } else {
        await seedCuratedStarterDeck(decksApi, flashcardsApi)
        await fetchDecks(true)
        addToast({
          type: 'success',
          message: 'Loaded "System Design Foundations" starter deck with 15 curated cards!',
        })
      }
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Failed to load starter deck') })
    } finally {
      setIsLoadingStarter(false)
    }
  }

  // Collect all unique tags across decks
  const allTags = [
    ...new Set(
      decks.flatMap((d) =>
        d.tags
          ? d.tags
              .split(',')
              .map((t) => t.trim())
              .filter(Boolean)
          : [],
      ),
    ),
  ].sort()

  const filteredDecks = decks.filter((d) => {
    const q = searchQuery.toLowerCase()
    const matchesSearch =
      d.name.toLowerCase().includes(q) || Boolean(d.tags?.toLowerCase().includes(q))
    const matchesTag =
      !activeTag ||
      Boolean(
        d.tags
          ?.split(',')
          .map((t) => t.trim())
          .includes(activeTag),
      )
    return matchesSearch && matchesTag
  })

  const openFullDeck = async (
    deck: StudyDeckItem,
    targetView: StudyViewMode,
    eagerView = true,
  ) => {
    setSelectedDeck(deck)
    if (eagerView) setView(targetView)
    try {
      const fullDeck = (await decksApi.get(deck.id)) as RawApiDeck
      setSelectedDeck(mapDeckFromApi(fullDeck))
      if (!eagerView) setView(targetView)
    } catch {
      // Ignore
    }
  }

  const handleDeckClick = (deck: StudyDeckItem) => openFullDeck(deck, 'study')
  const handleEditDeck = (deck: StudyDeckItem) => openFullDeck(deck, 'edit')

  const handleReviewDeck = async (deck: StudyDeckItem) => {
    setSelectedDeck(deck)
    setView('review')
    try {
      const dueCards = (await flashcardsApi.due(deck.id)) as FlashcardItem[]
      setSelectedDeck({
        ...deck,
        cards: Array.isArray(dueCards) ? dueCards.map(mapCardFromApi) : [],
      })
    } catch {
      // Ignore
    }
  }

  const handleNewDeck = () => {
    setSelectedDeck(null)
    setView('new')
  }

  const handleSaveDeck = async (data: DeckSavePayload) => {
    const colorIndex = selectedDeck ? selectedDeck.colorIndex : decks.length % 8
    const tempId = selectedDeck ? selectedDeck.id : `deck-${Date.now()}`
    const mappedCards: FlashcardItem[] = (data.cards || []).map((c) => ({
      id: c.id,
      front: c.front,
      back: c.back,
      prerequisite_id: c.prerequisite_id ?? null,
    }))

    if (selectedDeck) {
      setDecks((prev) =>
        prev.map((d) =>
          d.id === selectedDeck.id
            ? {
                ...d,
                name: data.name,
                description: data.description,
                tags: data.tags || '',
                cards: mappedCards,
                cardCount: mappedCards.length,
              }
            : d,
        ),
      )
    } else {
      const newDeck: StudyDeckItem = {
        id: tempId,
        name: data.name,
        description: data.description,
        tags: data.tags || '',
        colorIndex,
        cardCount: mappedCards.length,
        newCount: mappedCards.length,
        learnCount: 0,
        dueCount: 0,
        lastStudied: 'Never studied',
        progress: 0,
        settings: DEFAULT_DECK_SETTINGS,
        cards: mappedCards,
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
          color_index: colorIndex,
        })

        const existingCards = selectedDeck.cards || []
        const currentCards = data.cards || []

        const deletedCards = existingCards.filter(
          (ec) => !currentCards.some((cc) => cc.id === ec.id),
        )
        for (const card of deletedCards) {
          await flashcardsApi.delete(tempId, card.id)
        }

        for (const card of currentCards) {
          const isNew = String(card.id).startsWith('card-')
          const payload = {
            front: card.front,
            back: card.back,
            ...(card.prerequisite_id !== undefined
              ? { prerequisite_id: card.prerequisite_id || null }
              : {}),
          }
          if (isNew) {
            await flashcardsApi.create(tempId, payload)
          } else {
            await flashcardsApi.update(tempId, card.id, payload)
          }
        }
        addToast({ type: 'success', message: 'Deck updated successfully' })
      } else {
        const deck = (await decksApi.create({
          name: data.name,
          description: data.description,
          tags: data.tags || '',
          color_index: colorIndex,
        })) as { id?: string } | null
        const deckId = deck?.id || tempId
        if (deckId !== tempId) {
          setDecks((prev) =>
            prev.map((d) => (d.id === tempId ? { ...d, id: deckId } : d)),
          )
        }
        const currentCards = data.cards || []
        for (const card of currentCards) {
          await flashcardsApi.create(deckId, {
            front: card.front,
            back: card.back,
            ...(card.prerequisite_id ? { prerequisite_id: card.prerequisite_id } : {}),
          })
        }
        addToast({ type: 'success', message: 'Deck created successfully' })
      }

      const list = await decksApi.list()
      if (Array.isArray(list)) {
        setDecks((list as RawApiDeck[]).map(mapDeckFromApi))
      }
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Failed to save deck') })
    }
  }

  // Refresh decks list
  const refreshDecks = async () => {
    try {
      const list = await decksApi.list()
      if (Array.isArray(list)) setDecks((list as RawApiDeck[]).map(mapDeckFromApi))
    } catch {
      /* ignore */
    }
  }

  const reloadSelectedDeck = async (deckId: string) => {
    const fullDeck = (await decksApi.get(deckId)) as RawApiDeck
    setSelectedDeck(mapDeckFromApi(fullDeck))
  }

  const backToList = () => {
    setView('list')
    setSelectedDeck(null)
    void refreshDecks()
  }

  const handleDeleteDeck = (deck: StudyDeckItem) => {
    setDecks((prev) => prev.filter((d) => d.id !== deck.id))
    setDeleteModal(null)
    const wasSelected = Boolean(selectedDeck && selectedDeck.id === deck.id)
    if (wasSelected) setSelectedDeck(null)

    const actionId = `delete-deck-${deck.id}`
    useAppStore.getState().scheduleAction(
      actionId,
      async () => {
        try {
          await decksApi.delete(deck.id)
        } catch (err) {
          useAppStore.getState().addToast({
            type: 'error',
            message: errMsg(err, 'Failed to delete deck'),
          })
          void refreshDecks()
        }
      },
      5000,
    )

    addToast({
      type: 'info',
      message: `"${deck.name}" deleted`,
      action: {
        label: 'Undo',
        onClick: () => {
          if (useAppStore.getState().cancelAction(actionId)) {
            setDecks((prev) => [...prev, deck])
            if (wasSelected) setSelectedDeck(deck)
          }
        },
      },
    })
  }

  const handleSaveDeckSettings = async (
    deckId: string,
    settingsData: DeckSchedulerSettings,
  ) => {
    try {
      const updated = (await decksApi.updateSettings(deckId, settingsData)) as {
        settings?: Partial<DeckSchedulerSettings>
      }
      const nextSettings = { ...DEFAULT_DECK_SETTINGS, ...(updated?.settings || settingsData) }
      setDecks((prev) =>
        prev.map((d) => (d.id === deckId ? { ...d, settings: nextSettings } : d)),
      )
      if (selectedDeck?.id === deckId) {
        setSelectedDeck((prev) => (prev ? { ...prev, settings: nextSettings } : null))
      }
      setOptionsModalDeck(null)
      addToast({ type: 'success', message: 'Deck settings saved successfully' })
      void refreshDecks()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Failed to save deck settings') })
    }
  }

  const handleSaveBrowserCard = async (
    cardId: string,
    cardData: { front: string; back: string },
  ) => {
    if (!selectedDeck) return
    try {
      await flashcardsApi.update(selectedDeck.id, cardId, cardData)
      await reloadSelectedDeck(selectedDeck.id)
      addToast({ type: 'success', message: 'Card updated' })
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Failed to update card') })
    }
  }

  const handleDeleteBrowserCard = (cardId: string) => {
    if (!selectedDeck) return
    const targetDeckId = selectedDeck.id
    const cardToRestore = selectedDeck.cards.find((c) => c.id === cardId)
    setSelectedDeck((prev) =>
      prev ? { ...prev, cards: prev.cards.filter((c) => c.id !== cardId) } : null,
    )

    const actionId = `delete-card-${cardId}`
    useAppStore.getState().scheduleAction(
      actionId,
      async () => {
        try {
          await flashcardsApi.delete(targetDeckId, cardId)
        } catch (err) {
          useAppStore.getState().addToast({
            type: 'error',
            message: errMsg(err, 'Failed to delete card'),
          })
          await reloadSelectedDeck(targetDeckId)
        }
      },
      5000,
    )

    addToast({
      type: 'info',
      message: 'Card deleted',
      action: {
        label: 'Undo',
        onClick: () => {
          if (useAppStore.getState().cancelAction(actionId) && cardToRestore) {
            setSelectedDeck((prev) =>
              prev
                ? {
                    ...prev,
                    cards: [...prev.cards, cardToRestore].sort(
                      (a, b) => (a.position || 0) - (b.position || 0),
                    ),
                  }
                : null,
            )
          }
        },
      },
    })
  }

  const handleAddBrowserCard = async () => {
    if (!selectedDeck) return
    try {
      await flashcardsApi.create(selectedDeck.id, { front: 'New Front', back: 'New Back' })
      await reloadSelectedDeck(selectedDeck.id)
      addToast({ type: 'success', message: 'Blank card added' })
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Failed to add card') })
    }
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
            onBack={backToList}
          />
        </div>
        {!isMobile && (
          <ChatPanel
            page="study"
            title="Study Assistant"
            placeholder="Ask Kit about this topic or generate cards..."
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
            onBack={backToList}
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
          <StatsDashboard deck={selectedDeck} onBack={backToList} />
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
            cards={selectedDeck ? selectedDeck.cards || [] : []}
            onSave={(data) => void handleSaveDeck(data)}
            onCancel={() => {
              setView('list')
              setSelectedDeck(null)
            }}
          />
        </div>
        {!isMobile && (
          <ChatPanel
            page="study"
            title="Card Generator"
            placeholder="Describe a topic for Kit to generate flashcards..."
          />
        )}
      </div>
    )
  }

  const kitTitleName = skeleton?.identity?.name || 'System Design'

  // Deck list view
  return (
    <div className="study-layout" id="study-page">
      <div className="study-main">
        {/* Page Header */}
        <div className="page-header">
          <div className="page-header-top">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                <DomainGlyph
                  kind={resolveKitGlyph(`${kitSlug ?? ''} ${kitTitleName}`)}
                  size={15}
                />
                <span>{kitTitleName}</span>
              </div>
              <h1 className="page-title font-serif font-normal">Flashcards</h1>
              <p className="page-description">
                Spaced repetition decks scheduled with FSRS-6 across {kitTitleName}.
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <button
                className="btn btn-secondary btn-ai-generate"
                onClick={() => toggleChat('study')}
                id="study-chat-btn"
              >
                <MessageSquare size={14} />
                Ask Kit to Generate
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
        <PullToRefresh onRefresh={() => fetchDecks(true)}>
          <div className="study-content space-y-6">
            <StudyHeatmap sessions={studySessions} />

            {isLoading ? (
              <div className="deck-grid">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="card p-5">
                    <Skeleton variant="circular" style={{ width: 36, height: 36, marginBottom: 'var(--space-3)' }} />
                    <Skeleton style={{ width: '70%', height: 16, marginBottom: 'var(--space-2)' }} />
                    <Skeleton style={{ width: '40%', height: 12 }} />
                  </div>
                ))}
              </div>
            ) : (
              <>
                {/* Search */}
                {decks.length > 0 && (
                  <div className="space-y-2.5">
                    <div className="search-bar">
                      <Search size={16} />
                      <input
                        aria-label="Search decks"
                        placeholder="Search decks..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        id="search-decks"
                      />
                    </div>
                    {/* Tag filter chips */}
                    {allTags.length > 0 && (
                      <div className="flex gap-1.5 flex-wrap">
                        <button
                          type="button"
                          className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition cursor-pointer ${
                            !activeTag
                              ? 'bg-primary text-on-primary border-primary'
                              : 'bg-surface-container-low text-on-surface-variant border-outline-variant hover:text-on-surface'
                          }`}
                          onClick={() => setActiveTag('')}
                        >
                          All
                        </button>
                        {allTags.map((tag) => {
                          const selected = activeTag === tag
                          return (
                            <button
                              key={tag}
                              type="button"
                              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border transition cursor-pointer ${
                                selected
                                  ? 'bg-primary text-on-primary border-primary'
                                  : 'bg-surface-container-low text-on-surface-variant border-outline-variant hover:text-on-surface'
                              }`}
                              onClick={() => setActiveTag(selected ? '' : tag)}
                            >
                              {tag}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Deck grid or empty state */}
                {filteredDecks.length > 0 ? (
                  <div className="deck-grid">
                    {filteredDecks.map((deck) => (
                      <div key={deck.id} className="relative">
                        <DeckCard deck={deck} onClick={(d) => void handleDeckClick(d)} />
                        {/* Due count badge */}
                        {deck.dueCount > 0 && (
                          <div className="absolute -top-2.5 -right-2.5 z-10 px-2 py-0.5 rounded-full bg-primary text-on-primary text-xs font-mono font-semibold tabular-nums inline-flex items-center gap-1 shadow-sm">
                            <Clock size={10} />
                            {deck.dueCount} due
                          </div>
                        )}
                        {/* Quick actions overlay */}
                        <div className="deck-actions absolute top-3 right-3 flex gap-1 opacity-0 focus-within:opacity-100 transition-opacity">
                          {deck.dueCount > 0 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-icon btn-sm text-on-primary-wash"
                              onClick={(e) => {
                                e.stopPropagation()
                                void handleReviewDeck(deck)
                              }}
                              title="Review Due Cards"
                              aria-label={`Review due cards in ${deck.name}`}
                              style={QUICK_BTN_STYLE}
                            >
                              <Clock size={12} />
                            </button>
                          )}
                          {[
                            { title: 'Study', icon: <Play size={12} />, run: () => void handleDeckClick(deck) },
                            { title: 'Browse Cards', icon: <Search size={12} />, run: () => void openFullDeck(deck, 'browser', false) },
                            { title: 'Deck Stats', icon: <BarChart2 size={12} />, run: () => void openFullDeck(deck, 'stats', false) },
                            { title: 'Deck Options', icon: <Settings size={12} />, run: () => setOptionsModalDeck(deck) },
                            { title: 'Edit Metadata', icon: <Edit size={12} />, run: () => void handleEditDeck(deck) },
                          ].map((act) => (
                            <button
                              key={act.title}
                              type="button"
                              className="btn btn-ghost btn-icon btn-sm"
                              onClick={(e) => {
                                e.stopPropagation()
                                act.run()
                              }}
                              title={act.title}
                              aria-label={`${act.title} ${deck.name}`}
                              style={QUICK_BTN_STYLE}
                            >
                              {act.icon}
                            </button>
                          ))}
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm text-error"
                            onClick={(e) => {
                              e.stopPropagation()
                              setDeleteModal(deck)
                            }}
                            title="Delete"
                            aria-label={`Delete ${deck.name}`}
                            style={QUICK_BTN_STYLE}
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
                    description={
                      isCustomKit
                        ? canSeedStarter
                          ? `Load the curated ${kitTitleName} starter deck or create a blank deck.`
                          : `Create a blank deck or ask Kit to generate ${kitTitleName} cards.`
                        : 'Load the 15-card System Design starter deck or create a blank deck.'
                    }
                    action={
                      <div className="flex gap-2 flex-wrap justify-center">
                        {canSeedStarter && (
                          <button
                            className="btn btn-primary"
                            onClick={() => void handleSeedStarterDeck()}
                            disabled={isLoadingStarter}
                            id="load-starter-deck-btn"
                          >
                            <Sparkles size={14} />
                            {isLoadingStarter ? 'Loading Starter Deck...' : 'Load Curated Starter Deck'}
                          </button>
                        )}
                        <button className="btn btn-secondary" onClick={handleNewDeck} id="create-first-deck-btn">
                          <Plus size={14} />
                          Create Blank Deck
                        </button>
                      </div>
                    }
                  />
                ) : (
                  <EmptyState
                    icon={<Search size={24} />}
                    title="No results"
                    description={`No decks match "${searchQuery}".`}
                    action={null}
                  />
                )}
              </>
            )}
          </div>
        </PullToRefresh>
      </div>

      {/* AI Chat panel */}
      {!isMobile && (
        <ChatPanel
          page="study"
          title="Card Generator"
          placeholder="Describe a topic for Kit to generate flashcards..."
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
              style={{ background: 'var(--color-error)', color: 'var(--color-on-error)' }}
              onClick={() => deleteModal && handleDeleteDeck(deleteModal)}
            >
              Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-on-surface-variant">
          Delete <strong className="text-on-surface">&ldquo;{deleteModal?.name}&rdquo;</strong>? All cards in this deck will be permanently removed.
        </p>
      </Modal>

      {/* Deck settings options modal */}
      <DeckOptionsModal
        open={!!optionsModalDeck}
        onClose={() => setOptionsModalDeck(null)}
        deck={optionsModalDeck}
        onSave={(settingsData) => {
          if (optionsModalDeck) {
            void handleSaveDeckSettings(optionsModalDeck.id, settingsData)
          }
        }}
      />
    </div>
  )
}
