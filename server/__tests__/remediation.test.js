import { describe, it, expect } from 'vitest'
import { planRemediation, isShaky, MAX_REMEDIATION_CARDS } from '../graph/remediation.js'

const NOW = new Date('2026-08-16T12:00:00Z')
const daysFromNow = (d) => new Date(NOW.getTime() + d * 24 * 3600 * 1000).toISOString()

// Injected micro-graph: two foundations feed one advanced concept.
const nodes = [
  { id: 'hashing', pillarId: 'distributed-mechanics', topicId: null, keywords: ['hash function basics'], components: [], summary: 's' },
  { id: 'partitioning', pillarId: 'distributed-mechanics', topicId: null, keywords: ['partitioning basics'], components: [], summary: 's' },
  { id: 'consistent-hashing', pillarId: 'distributed-mechanics', topicId: null, keywords: ['consistent hashing'], components: [], summary: 's' },
]
const edges = [
  { from: 'hashing', to: 'partitioning' },
  { from: 'partitioning', to: 'consistent-hashing' },
]

const solid = (overrides = {}) => ({
  state: 2,
  ease_factor: 2.6,
  interval: 30,
  next_review: daysFromNow(10),
  prerequisite_id: null,
  ...overrides,
})

const failedCard = {
  id: 'adv-1',
  front: 'Explain consistent hashing',
  back: 'Hash ring where nodes own arcs.',
  ...solid(),
}

describe('isShaky', () => {
  it('flags never-studied, learning, and relearning cards', () => {
    expect(isShaky({ state: 0 }, NOW)).toBe(true)
    expect(isShaky({ state: 1 }, NOW)).toBe(true)
    expect(isShaky({ state: 3 }, NOW)).toBe(true)
  })

  it('flags weak review cards: low ease, short interval, or overdue', () => {
    expect(isShaky(solid({ ease_factor: 2.2 }), NOW)).toBe(true)
    expect(isShaky(solid({ interval: 3 }), NOW)).toBe(true)
    expect(isShaky(solid({ next_review: daysFromNow(-1) }), NOW)).toBe(true)
  })

  it('does not flag solid review cards', () => {
    expect(isShaky(solid(), NOW)).toBe(false)
  })
})

describe('planRemediation', () => {
  it('queues a shaky card from the direct prerequisite node', () => {
    const allCards = [
      failedCard,
      { id: 'part-1', front: 'partitioning basics question', back: 'b', ...solid({ state: 0 }) },
    ]
    const plan = planRemediation(failedCard, allCards, { now: NOW, nodes, edges })
    expect(plan).toHaveLength(1)
    expect(plan[0].cardId).toBe('part-1')
    expect(plan[0].nodeId).toBe('partitioning')
    expect(plan[0].nodeName).toBe('partitioning')
  })

  it('only reaches one level up — not transitive grandparents', () => {
    const allCards = [
      failedCard,
      { id: 'hash-1', front: 'hash function basics question', back: 'b', ...solid({ state: 0 }) },
    ]
    // 'hashing' is a grandparent of 'consistent-hashing' — not direct.
    const plan = planRemediation(failedCard, allCards, { now: NOW, nodes, edges })
    expect(plan).toHaveLength(0)
  })

  it('queues nothing when the foundations are rock solid', () => {
    const allCards = [
      failedCard,
      { id: 'part-1', front: 'partitioning basics question', back: 'b', ...solid() },
    ]
    const plan = planRemediation(failedCard, allCards, { now: NOW, nodes, edges })
    expect(plan).toHaveLength(0)
  })

  it('caps the plan and picks the weakest cards first', () => {
    const allCards = [
      failedCard,
      { id: 'p1', front: 'partitioning basics 1', back: 'b', ...solid({ state: 0, ease_factor: 2.5 }) },
      { id: 'p2', front: 'partitioning basics 2', back: 'b', ...solid({ ease_factor: 1.5, next_review: daysFromNow(-3) }) },
      { id: 'p3', front: 'partitioning basics 3', back: 'b', ...solid({ ease_factor: 1.8, next_review: daysFromNow(-2) }) },
      { id: 'p4', front: 'partitioning basics 4', back: 'b', ...solid({ ease_factor: 2.0, next_review: daysFromNow(-1) }) },
      { id: 'p5', front: 'partitioning basics 5', back: 'b', ...solid({ state: 1 }) },
    ]
    const plan = planRemediation(failedCard, allCards, { now: NOW, nodes, edges })
    expect(plan).toHaveLength(MAX_REMEDIATION_CARDS)
    // Weakest ease first
    expect(plan[0].cardId).toBe('p2')
    expect(plan[1].cardId).toBe('p3')
  })

  it('never queues the failed card itself', () => {
    // Failed card's text also matches the prerequisite node.
    const weird = {
      id: 'adv-2',
      front: 'consistent hashing vs partitioning basics',
      back: 'both phrases here',
      ...solid({ state: 3 }),
    }
    const plan = planRemediation(weird, [weird], { now: NOW, nodes, edges })
    expect(plan.every((p) => p.cardId !== 'adv-2')).toBe(true)
  })

  it('honors an explicit card-level prerequisite link first', () => {
    const prereqCard = { id: 'manual-1', front: 'unrelated text', back: 'b', ...solid({ state: 0 }) }
    const failed = { ...failedCard, prerequisite_id: 'manual-1' }
    const allCards = [
      failed,
      prereqCard,
      { id: 'part-1', front: 'partitioning basics question', back: 'b', ...solid({ state: 0 }) },
    ]
    const plan = planRemediation(failed, allCards, { now: NOW, nodes, edges })
    expect(plan[0].cardId).toBe('manual-1')
    expect(plan[0].reason).toMatch(/Linked prerequisite/)
    expect(plan.map((p) => p.cardId)).toContain('part-1')
  })

  it('returns empty for cards that match no graph node', () => {
    const orphan = { id: 'o1', front: 'nothing here', back: 'nope', ...solid({ state: 3 }) }
    const plan = planRemediation(orphan, [orphan], { now: NOW, nodes, edges })
    expect(plan).toEqual([])
  })
})
