import { describe, it, expect } from 'vitest'
import {
  cardStatus,
  nodeHealth,
  computeGraphHealth,
  prereqSatisfied,
} from '../graph/health.js'

const NOW = new Date('2026-08-16T12:00:00Z')
const daysFromNow = (d) => new Date(NOW.getTime() + d * 24 * 3600 * 1000).toISOString()

const card = (overrides = {}) => ({
  id: overrides.id || 'card-1',
  front: 'f',
  back: 'b',
  state: 2,
  ease_factor: 2.5,
  interval: 30,
  next_review: daysFromNow(10),
  ...overrides,
})

describe('cardStatus', () => {
  it('classifies by SRS state', () => {
    expect(cardStatus(card({ state: 0 }), NOW)).toBe('new')
    expect(cardStatus(card({ state: 1 }), NOW)).toBe('learning')
    expect(cardStatus(card({ state: 3 }), NOW)).toBe('lapsed')
  })

  it('review cards: mastered needs ease ≥ 2.5 AND interval > 21', () => {
    expect(cardStatus(card({ ease_factor: 2.5, interval: 22 }), NOW)).toBe('mastered')
    expect(cardStatus(card({ ease_factor: 2.5, interval: 21 }), NOW)).toBe('maturing')
    expect(cardStatus(card({ ease_factor: 2.49, interval: 30 }), NOW)).toBe('maturing')
  })

  it('review cards past next_review are due', () => {
    expect(cardStatus(card({ next_review: daysFromNow(-1) }), NOW)).toBe('due')
  })

  it('review cards with crushed ease are fragile (lapsed)', () => {
    expect(cardStatus(card({ ease_factor: 1.9 }), NOW)).toBe('lapsed')
  })

  it('missing SRS columns behave as defaults (legacy rows)', () => {
    expect(cardStatus({ id: 'x' }, NOW)).toBe('new')
    expect(cardStatus({ id: 'x', state: 2, interval: 30 }, NOW)).toBe('mastered')
  })
})

describe('nodeHealth', () => {
  it('no cards → unseen with zero strength', () => {
    const { health, strength } = nodeHealth([], { now: NOW })
    expect(health).toBe('unseen')
    expect(strength).toBe(0)
  })

  it('any lapsed card → decayed', () => {
    const { health } = nodeHealth([card(), card({ id: 'c2', state: 3 })], { now: NOW })
    expect(health).toBe('decayed')
  })

  it('a card in the remediation queue → decayed', () => {
    const { health } = nodeHealth([card()], {
      remediationCardIds: new Set(['card-1']),
      now: NOW,
    })
    expect(health).toBe('decayed')
  })

  it('all cards mastered and nothing due within 48h → mastered', () => {
    const cards = [
      card({ interval: 30, next_review: daysFromNow(10) }),
      card({ id: 'c2', interval: 40, next_review: daysFromNow(20) }),
    ]
    const { health, strength } = nodeHealth(cards, { now: NOW })
    expect(health).toBe('mastered')
    expect(strength).toBe(1)
  })

  it('mastered cards due within 48 hours drop to due (review soon)', () => {
    const cards = [card({ interval: 30, next_review: daysFromNow(1) })]
    const { health } = nodeHealth(cards, { now: NOW })
    expect(health).toBe('due')
  })

  it('a mix of new and mastered stays yellow (still learning)', () => {
    const cards = [card(), card({ id: 'c2', state: 0 })]
    const { health } = nodeHealth(cards, { now: NOW })
    expect(health).toBe('due')
  })
})

describe('computeGraphHealth — readiness and locking', () => {
  // A tiny injected graph: foundation → advanced
  const nodes = [
    { id: 'foundation', pillarId: 'compute', topicId: null, keywords: ['foundation phrase'], components: [], summary: 's' },
    { id: 'advanced', pillarId: 'compute', topicId: null, keywords: ['advanced phrase'], components: [], summary: 's' },
  ]
  const edges = [{ from: 'foundation', to: 'advanced' }]

  it('an unseen node whose prereqs have no cards is ready (no signal ≠ locked)', () => {
    const { byNode } = computeGraphHealth([], { now: NOW, nodes, edges })
    expect(byNode.get('advanced').ready).toBe(true)
    expect(byNode.get('advanced').locked).toBe(false)
  })

  it('an unseen node is locked while its prerequisite cards are mostly ungraduated', () => {
    const cards = [
      card({ id: 'f1', front: 'foundation phrase', state: 0 }),
      card({ id: 'f2', front: 'foundation phrase', state: 0 }),
    ]
    const { byNode } = computeGraphHealth(cards, { now: NOW, nodes, edges })
    expect(byNode.get('advanced').locked).toBe(true)
    expect(byNode.get('advanced').ready).toBe(false)
    expect(byNode.get('advanced').unsatisfiedPrereqs).toEqual(['foundation'])
  })

  it('unlocks once enough prerequisite cards graduate to review', () => {
    const cards = [
      card({ id: 'f1', front: 'foundation phrase' }),
      card({ id: 'f2', front: 'foundation phrase' }),
    ]
    const { byNode } = computeGraphHealth(cards, { now: NOW, nodes, edges })
    expect(byNode.get('advanced').locked).toBe(false)
    expect(byNode.get('advanced').ready).toBe(true)
  })

  it('indexes each card to its nodes', () => {
    const cards = [card({ id: 'a1', front: 'advanced phrase' })]
    const { cardNodeIndex, byNode } = computeGraphHealth(cards, { now: NOW, nodes, edges })
    expect(cardNodeIndex.get('a1')).toEqual(['advanced'])
    expect(byNode.get('advanced').counts.total).toBe(1)
    expect(byNode.get('foundation').counts.total).toBe(0)
  })
})

describe('prereqSatisfied', () => {
  it('is satisfied with no entry or no cards', () => {
    expect(prereqSatisfied(undefined)).toBe(true)
    expect(prereqSatisfied({ counts: { total: 0, due: 0, maturing: 0, mastered: 0 } })).toBe(true)
  })

  it('requires 60% of cards graduated', () => {
    expect(prereqSatisfied({ counts: { total: 10, due: 2, maturing: 2, mastered: 2 } })).toBe(true)
    expect(prereqSatisfied({ counts: { total: 10, due: 1, maturing: 2, mastered: 2 } })).toBe(false)
  })
})
