import { describe, expect, it } from 'vitest'
import { PILLARS } from '../utils/constants'
import {
  GRAPH_EDGES,
  GRAPH_NODES,
  LEARNING_TRACKS,
  ancestorsOf,
  descendantsOf,
  expandTrack,
  nodeDepths,
  nodesForCard,
  prerequisitesOf,
  topologicalSort,
  validateGraph,
} from '../utils/knowledgeGraph'
import type { GraphNodeInput } from '../utils/knowledgeGraph'

describe('graph data integrity & validation', () => {
  it('validates shipped graph nodes, pillars, topics, lowercase keywords, tracks, and spec chain', () => {
    expect(() => validateGraph()).not.toThrow()

    const pillarIds = new Set(PILLARS.map((p) => p.id))
    const nodeIds = new Set(GRAPH_NODES.map((n) => n.id))

    for (const node of GRAPH_NODES) {
      expect(pillarIds.has(node.pillarId), `${node.id} → ${node.pillarId}`).toBe(true)
      if (node.topicId) {
        const pillar = PILLARS.find((p) => p.id === node.pillarId)
        expect(
          pillar?.topics.find((t) => t.id === node.topicId),
          `${node.id} → ${node.pillarId}/${node.topicId}`,
        ).toBeDefined()
      }
      expect(node.keywords.length, node.id).toBeGreaterThan(0)
      expect(node.summary.length, node.id).toBeGreaterThan(10)
      for (const kw of node.keywords) {
        expect(kw).toBe(kw.toLowerCase())
      }
    }

    for (const track of LEARNING_TRACKS) {
      for (const target of track.targets) {
        expect(nodeIds.has(target), `${track.id} → ${target}`).toBe(true)
      }
    }

    expect(ancestorsOf('distributed-kv').has('consistent-hashing')).toBe(true)
    const vnodeAncestors = ancestorsOf('virtual-nodes')
    expect(vnodeAncestors.has('distributed-kv')).toBe(true)
    expect(vnodeAncestors.has('consistent-hashing')).toBe(true)
  })

  it('rejects direct cycles, transitive cycles, self-loops, dangling edges, and duplicate ids', () => {
    const nodes: GraphNodeInput[] = [
      { id: 'a', pillarId: 'compute', topicId: null, keywords: ['aaa'], components: [], summary: 'a' },
      { id: 'b', pillarId: 'compute', topicId: null, keywords: ['bbb'], components: [], summary: 'b' },
      { id: 'c', pillarId: 'compute', topicId: null, keywords: ['ccc'], components: [], summary: 'c' },
    ]

    expect(() => validateGraph(nodes, [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }])).toThrow(/Cycle detected/)
    expect(() =>
      validateGraph(nodes, [
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ]),
    ).toThrow(/Cycle detected/)
    expect(() => validateGraph(nodes, [{ from: 'a', to: 'a' }])).toThrow(/Self-loop/)
    expect(() => validateGraph(nodes, [{ from: 'a', to: 'ghost' }])).toThrow(/missing node/)
    expect(() => validateGraph([...nodes, { ...nodes[0] }], [])).toThrow(/Duplicate/)
  })
})

describe('traversal, learning tracks, and card matching', () => {
  it('maintains topological ordering, monotonically increasing depths, and inverse ancestor/descendant sets', () => {
    const order = topologicalSort()
    expect(order.length).toBe(GRAPH_NODES.length)
    const position = new Map(order.map((id, i) => [id, i]))
    for (const edge of GRAPH_EDGES) {
      expect(
        (position.get(edge.from) ?? Infinity) < (position.get(edge.to) ?? -1),
        `${edge.from} must sort before ${edge.to}`,
      ).toBe(true)
    }

    const depths = nodeDepths()
    expect(depths.get('client-server')).toBe(0)
    expect(depths.get('http-rest')).toBe(1)
    for (const edge of GRAPH_EDGES) {
      expect(
        (depths.get(edge.to) ?? -1) > (depths.get(edge.from) ?? Infinity),
        `${edge.to} deeper than ${edge.from}`,
      ).toBe(true)
    }

    for (const nodeId of ['consensus', 'heavy-read-fanout']) {
      for (const anc of ancestorsOf(nodeId)) {
        expect(descendantsOf(anc).has(nodeId)).toBe(true)
      }
    }
  })

  it('expands learning tracks to targets plus transitive prerequisites in topological order', () => {
    const prereqs = prerequisitesOf()
    for (const track of LEARNING_TRACKS) {
      const expanded = expandTrack(track)
      const expandedSet = new Set(expanded)
      const position = new Map(expanded.map((id, i) => [id, i]))

      for (const target of track.targets) {
        expect(expandedSet.has(target), `${track.id} keeps ${target}`).toBe(true)
      }
      for (const id of expanded) {
        for (const p of prereqs.get(id) ?? []) {
          expect(expandedSet.has(p), `${track.id}: ${id} needs ${p}`).toBe(true)
          expect((position.get(p) ?? Infinity) < (position.get(id) ?? -1)).toBe(true)
        }
      }
    }
  })

  it('matches cards by keyword first, falls back to source_topic_id, and returns [] when unlinkable', () => {
    expect(
      nodesForCard({ front: 'Explain Consistent Hashing', back: 'Nodes on a hash ring own arcs.' }),
    ).toContain('consistent-hashing')

    const indexed = nodesForCard({
      front: 'What is a B-Tree index?',
      back: 'A balanced tree that keeps database index lookups logarithmic.',
      source_topic_id: 'relational-oltp',
    })
    expect(indexed).toContain('db-indexing')
    expect(indexed).not.toContain('transactions-acid')

    expect(
      nodesForCard({
        front: 'Question with no matching phrases',
        back: 'Nothing recognizable here.',
        source_topic_id: 'circuit-breakers',
      }),
    ).toContain('circuit-breakers')

    expect(nodesForCard({ front: 'Totally unrelated', back: 'Nothing.' })).toEqual([])
  })
})
