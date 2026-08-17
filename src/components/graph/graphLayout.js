/**
 * @fileoverview Layered layout for the knowledge graph.
 *
 * Dagre computes a left-to-right Sugiyama layout: every prerequisite
 * sits in an earlier column than its dependents, and crossing
 * minimization keeps the edge bundles readable. The layout is
 * deterministic — the same graph always lays out the same way.
 */
import dagre from '@dagrejs/dagre'

/** Concept pill dimensions used for layout spacing (must match the CSS). */
export const NODE_WIDTH = 180
export const NODE_HEIGHT = 44

/**
 * @param {Array} nodes - Graph nodes (need id).
 * @param {Array} edges - [{ from, to }]
 * @returns {Map<string, {x: number, y: number}>} Top-left positions per node id.
 */
export function computeLayout(nodes, edges) {
  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: 'LR',
    nodesep: 18,
    ranksep: 80,
    marginx: 40,
    marginy: 40,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  }
  for (const edge of edges) {
    if (g.hasNode(edge.from) && g.hasNode(edge.to)) {
      g.setEdge(edge.from, edge.to)
    }
  }

  dagre.layout(g)

  const positions = new Map()
  for (const node of nodes) {
    const placed = g.node(node.id)
    if (!placed) continue
    // Dagre returns center coordinates; React Flow wants top-left.
    positions.set(node.id, {
      x: placed.x - NODE_WIDTH / 2,
      y: placed.y - NODE_HEIGHT / 2,
    })
  }
  return positions
}

/** Node fill/stroke colors per health bucket (matches the CSS legend). */
export const HEALTH_COLORS = {
  mastered: '#34d399',
  due: '#fbbf24',
  decayed: '#f87171',
  unseen: '#71717a',
}

export const HEALTH_LABELS = {
  mastered: 'Mastered',
  due: 'Learning / Due',
  decayed: 'Decayed / Fragile',
  unseen: 'Not started',
}
