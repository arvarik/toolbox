import { describe, it, expect, vi } from 'vitest'
import {
  CURATED_STARTER_CARDS,
  STARTER_DECK_META,
  seedCuratedStarterDeck,
} from '../utils/starterDeck'
import { nodesForCard } from '../utils/knowledgeGraph'

describe('Curated Starter Deck', () => {
  it('contains exactly 15 high-yield system design cards', () => {
    expect(CURATED_STARTER_CARDS).toHaveLength(15)
  })

  it('each card has front, back, and guide metadata', () => {
    for (const card of CURATED_STARTER_CARDS) {
      expect(card.front).toBeTruthy()
      expect(card.back).toBeTruthy()
      expect(card.source_pillar_id).toBeTruthy()
      expect(card.source_topic_id).toBeTruthy()
    }
  })

  it('every starter card matches at least one Knowledge Graph concept node', () => {
    for (const card of CURATED_STARTER_CARDS) {
      const matchedNodeIds = nodesForCard(card)
      expect(matchedNodeIds.length).toBeGreaterThan(0)
    }
  })

  it('seedCuratedStarterDeck creates deck and inserts all 15 cards', async () => {
    const mockDecksApi = {
      create: vi.fn().mockResolvedValue({ id: 'deck-123', name: STARTER_DECK_META.name }),
    }
    const mockFlashcardsApi = {
      create: vi.fn().mockResolvedValue({ id: 'card-1' }),
    }

    const deck = await seedCuratedStarterDeck(mockDecksApi, mockFlashcardsApi)

    expect(mockDecksApi.create).toHaveBeenCalledWith(STARTER_DECK_META)
    expect(mockFlashcardsApi.create).toHaveBeenCalledTimes(15)
    expect(deck.id).toBe('deck-123')
  })
})
