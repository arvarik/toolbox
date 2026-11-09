import { describe, expect, it, vi } from 'vitest'
import { nodesForCard } from '../utils/knowledgeGraph'
import {
  CURATED_STARTER_CARDS,
  STARTER_DECK_META,
  seedCuratedStarterDeck,
} from '../utils/starterDeck'

describe('Curated Starter Deck', () => {
  it('contains 15 cards with full metadata that each link to the Knowledge Graph', () => {
    expect(CURATED_STARTER_CARDS).toHaveLength(15)
    for (const card of CURATED_STARTER_CARDS) {
      expect(card.front).toBeTruthy()
      expect(card.back).toBeTruthy()
      expect(card.source_pillar_id).toBeTruthy()
      expect(card.source_topic_id).toBeTruthy()
      expect(nodesForCard(card).length).toBeGreaterThan(0)
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
