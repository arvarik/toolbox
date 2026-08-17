/**
 * @fileoverview Static force-directed layout for the knowledge graph.
 *
 * The layout runs d3-force synchronously (no animation loop):
 *  - a strong forceX pins each node's column to its prerequisite depth,
 *    so learning flows left → right
 *  - a weak forceY pulls nodes toward their pillar's band, keeping
 *    related concepts vertically clustered
 *  - collision + charge spread nodes apart
 *
 * Initial positions are deterministic, so the same graph always lays
 * out the same way.
 */
import {
  forceSimulation,
  forceLink,
  forceManyBody,
  forceX,
  forceY,
  forceCollide,
} from 'd3-force'
import { nodeDepths } from '../../utils/knowledgeGraph'
import { PILLARS } from '../../utils/constants'

const COLUMN_SPACING = 180
const X_OFFSET = 110
const BAND_HEIGHT = 130
const PADDING = 70

/**
 * @param {Array} nodes - Graph nodes (need id + pillarId).
 * @param {Array} edges - [{ from, to }]
 * @returns {{ positions: Map<string, {x: number, y: number}>, width: number, height: number }}
 */
export function computeLayout(nodes, edges) {
  if (nodes.length === 0) {
    return { positions: new Map(), width: 800, height: 600 }
  }

  const depths = nodeDepths(nodes, edges)
  const pillarOrder = new Map(PILLARS.map((p, i) => [p.id, i]))
  const bandCenter = (pillarId) =>
    PADDING + ((pillarOrder.get(pillarId) ?? 3) + 0.5) * BAND_HEIGHT

  const simNodes = nodes.map((n, idx) => ({
    id: n.id,
    depth: depths.get(n.id) ?? 0,
    band: bandCenter(n.pillarId),
    // Deterministic starting positions — no randomness in the layout.
    x: X_OFFSET + (depths.get(n.id) ?? 0) * COLUMN_SPACING,
    y: bandCenter(n.pillarId) + ((idx % 7) - 3) * 14,
  }))
  const simLinks = edges.map((e) => ({ source: e.from, target: e.to }))

  const simulation = forceSimulation(simNodes)
    .force('link', forceLink(simLinks).id((d) => d.id).distance(90).strength(0.12))
    .force('charge', forceManyBody().strength(-260))
    .force('x', forceX((d) => X_OFFSET + d.depth * COLUMN_SPACING).strength(0.85))
    .force('y', forceY((d) => d.band).strength(0.08))
    .force('collide', forceCollide(40))
    .stop()

  for (let i = 0; i < 300; i++) simulation.tick()

  const positions = new Map()
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const n of simNodes) {
    positions.set(n.id, { x: n.x, y: n.y })
    minX = Math.min(minX, n.x)
    maxX = Math.max(maxX, n.x)
    minY = Math.min(minY, n.y)
    maxY = Math.max(maxY, n.y)
  }

  // Normalize so everything sits in positive space with padding.
  const dx = PADDING - minX
  const dy = PADDING - minY
  for (const pos of positions.values()) {
    pos.x += dx
    pos.y += dy
  }

  return {
    positions,
    width: maxX - minX + PADDING * 2,
    height: maxY - minY + PADDING * 2,
  }
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
