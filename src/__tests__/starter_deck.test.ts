import { describe, expect, it, vi } from 'vitest'
import { nodesForCard } from '../../shared/kits/kitSkeleton.ts'
import { SYSTEM_DESIGN_KIT_SKELETON } from '../../shared/kits/systemDesignKit.ts'
import {
  CURATED_STARTER_CARDS,
  STARTER_DECK_META,
  seedCuratedStarterDeck,
} from '../utils/starterDeck.ts'

describe('Curated Starter Deck', () => {
  it('contains 15 cards with full metadata that link to System Design graph nodes', () => {
    expect(CURATED_STARTER_CARDS).toHaveLength(15)
    for (const card of CURATED_STARTER_CARDS) {
      expect(card.front).toBeTruthy()
      expect(card.back).toBeTruthy()
      expect(card.source_pillar_id).toBeTruthy()
      expect(card.source_topic_id).toBeTruthy()
      expect(nodesForCard(card, SYSTEM_DESIGN_KIT_SKELETON.graph.nodes).length).toBeGreaterThan(0)
    }
  })

  it('seedCuratedStarterDeck creates deck and inserts all 15 cards', async () => {
    const createDeck = vi.fn().mockResolvedValue({ id: 'deck-123', name: STARTER_DECK_META.name })
    const createCard = vi.fn().mockResolvedValue({ id: 'card-1' })
    const deck = await seedCuratedStarterDeck({ create: createDeck }, { create: createCard })
    expect(createDeck).toHaveBeenCalledWith(STARTER_DECK_META)
    expect(createCard).toHaveBeenCalledTimes(15)
    expect(deck.id).toBe('deck-123')
  })
})
