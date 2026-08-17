import { describe, it, expect } from 'vitest'
import {
  GRAPH_NODES,
  GRAPH_EDGES,
  LEARNING_TRACKS,
  validateGraph,
  topologicalSort,
  nodeDepths,
  ancestorsOf,
  descendantsOf,
  expandTrack,
  nodesForCard,
  prerequisitesOf,
} from '../utils/knowledgeGraph'
import { PILLARS } from '../utils/constants'

describe('graph data integrity', () => {
  it('the shipped graph validates (unique ids, no dangling edges, acyclic)', () => {
    expect(() => validateGraph()).not.toThrow()
  })

  it('every node maps to a real pillar', () => {
    const pillarIds = new Set(PILLARS.map((p) => p.id))
    for (const node of GRAPH_NODES) {
      expect(pillarIds.has(node.pillarId), `${node.id} → ${node.pillarId}`).toBe(true)
    }
  })

  it('every non-null topicId exists inside its pillar', () => {
    for (const node of GRAPH_NODES) {
      if (!node.topicId) continue
      const pillar = PILLARS.find((p) => p.id === node.pillarId)
      const topic = pillar.topics.find((t) => t.id === node.topicId)
      expect(topic, `${node.id} → ${node.pillarId}/${node.topicId}`).toBeDefined()
    }
  })

  it('every node has keywords and a summary', () => {
    for (const node of GRAPH_NODES) {
      expect(node.keywords.length, node.id).toBeGreaterThan(0)
      expect(node.summary.length, node.id).toBeGreaterThan(10)
      // Keywords must be lowercase — matching lowercases the card text.
      for (const kw of node.keywords) {
        expect(kw).toBe(kw.toLowerCase())
      }
    }
  })

  it('every learning track targets existing nodes', () => {
    const ids = new Set(GRAPH_NODES.map((n) => n.id))
    for (const track of LEARNING_TRACKS) {
      for (const target of track.targets) {
        expect(ids.has(target), `${track.id} → ${target}`).toBe(true)
      }
    }
  })

  it('matches the spec chain: consistent hashing → distributed KV → virtual nodes', () => {
    const ancestorsOfKv = ancestorsOf('distributed-kv')
    expect(ancestorsOfKv.has('consistent-hashing')).toBe(true)
    const ancestorsOfVnodes = ancestorsOf('virtual-nodes')
    expect(ancestorsOfVnodes.has('distributed-kv')).toBe(true)
    expect(ancestorsOfVnodes.has('consistent-hashing')).toBe(true)
  })
})

describe('cycle prevention', () => {
  const nodes = [
    { id: 'a', pillarId: 'compute', topicId: null, keywords: ['aaa'], components: [], summary: 'a' },
    { id: 'b', pillarId: 'compute', topicId: null, keywords: ['bbb'], components: [], summary: 'b' },
    { id: 'c', pillarId: 'compute', topicId: null, keywords: ['ccc'], components: [], summary: 'c' },
  ]

  it('rejects a direct cycle', () => {
    const edges = [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }]
    expect(() => validateGraph(nodes, edges)).toThrow(/Cycle detected/)
  })

  it('rejects a transitive cycle', () => {
    const edges = [
      { from: 'a', to: 'b' },
      { from: 'b', to: 'c' },
      { from: 'c', to: 'a' },
    ]
    expect(() => validateGraph(nodes, edges)).toThrow(/Cycle detected/)
  })

  it('rejects self-loops and dangling edges', () => {
    expect(() => validateGraph(nodes, [{ from: 'a', to: 'a' }])).toThrow(/Self-loop/)
    expect(() => validateGraph(nodes, [{ from: 'a', to: 'ghost' }])).toThrow(/missing node/)
  })

  it('rejects duplicate node ids', () => {
    expect(() => validateGraph([...nodes, { ...nodes[0] }], [])).toThrow(/Duplicate/)
  })
})

describe('traversal', () => {
  it('topological sort places every prerequisite before its dependent', () => {
    const order = topologicalSort()
    expect(order.length).toBe(GRAPH_NODES.length)
    const position = new Map(order.map((id, i) => [id, i]))
    for (const edge of GRAPH_EDGES) {
      expect(
        position.get(edge.from) < position.get(edge.to),
        `${edge.from} must sort before ${edge.to}`
      ).toBe(true)
    }
  })

  it('depths grow along prerequisite chains', () => {
    const depths = nodeDepths()
    expect(depths.get('client-server')).toBe(0)
    expect(depths.get('http-rest')).toBe(1)
    for (const edge of GRAPH_EDGES) {
      expect(
        depths.get(edge.to) > depths.get(edge.from),
        `${edge.to} deeper than ${edge.from}`
      ).toBe(true)
    }
  })

  it('ancestors and descendants are consistent inverses', () => {
    for (const nodeId of ['consensus', 'heavy-read-fanout']) {
      for (const anc of ancestorsOf(nodeId)) {
        expect(descendantsOf(anc).has(nodeId)).toBe(true)
      }
    }
  })
})

describe('learning tracks', () => {
  it('expands to targets plus all transitive prerequisites, in order', () => {
    for (const track of LEARNING_TRACKS) {
      const expanded = expandTrack(track)
      const expandedSet = new Set(expanded)
      // All targets present
      for (const target of track.targets) {
        expect(expandedSet.has(target), `${track.id} keeps ${target}`).toBe(true)
      }
      // Closed under prerequisites
      const prereqs = prerequisitesOf()
      for (const id of expanded) {
        for (const p of prereqs.get(id) || []) {
          expect(expandedSet.has(p), `${track.id}: ${id} needs ${p}`).toBe(true)
        }
      }
      // Ordered: prerequisites come first
      const position = new Map(expanded.map((id, i) => [id, i]))
      for (const id of expanded) {
        for (const p of prereqs.get(id) || []) {
          expect(position.get(p) < position.get(id)).toBe(true)
        }
      }
    }
  })
})

describe('card → node matching', () => {
  it('matches by keyword phrase', () => {
    const card = { front: 'Explain Consistent Hashing', back: 'Nodes on a hash ring own arcs.' }
    expect(nodesForCard(card)).toContain('consistent-hashing')
  })

  it('keyword matches beat the topic fallback', () => {
    const card = {
      front: 'What is a B-Tree index?',
      back: 'A balanced tree that keeps database index lookups logarithmic.',
      source_topic_id: 'relational-oltp',
    }
    const matches = nodesForCard(card)
    expect(matches).toContain('db-indexing')
    // Not diluted to every relational-oltp node
    expect(matches).not.toContain('transactions-acid')
  })

  it('falls back to the source topic when no keyword hits', () => {
    const card = {
      front: 'Question with no matching phrases',
      back: 'Nothing recognizable here.',
      source_topic_id: 'circuit-breakers',
    }
    expect(nodesForCard(card)).toContain('circuit-breakers')
  })

  it('returns empty for unlinkable cards', () => {
    const card = { front: 'Totally unrelated', back: 'Nothing.' }
    expect(nodesForCard(card)).toEqual([])
  })
})
