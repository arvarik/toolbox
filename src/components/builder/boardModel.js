/**
 * @fileoverview Board data model — the bridge between the persisted board
 * shape and React Flow.
 *
 * The database, the templates, and the server keep the legacy shape:
 *   nodes: [{ id, name, icon, category, x, y }]
 *   edges: [{ id, from, fromAnchor, to, toAnchor }]
 *
 * React Flow works with:
 *   nodes: [{ id, type, position: {x, y}, data: { name, icon, category } }]
 *   edges: [{ id, source, sourceHandle, target, targetHandle, ... }]
 *
 * The app store holds the React Flow shape (so the canvas is a plain
 * controlled component); these converters run only at the boundaries:
 * board load/save, template load, image export, and the AI verify payload.
 */
import {
  Database, Zap, Globe, Monitor, Smartphone, Shield,
  AlertTriangle, FileText, BarChart, Radio, Activity, HardDrive,
  Archive, Search, Brain, Cpu, ExternalLink, Mail, Box, Cog,
  Split, DoorOpen, Layers, GitBranch, RefreshCw, Filter,
  Scale, HelpCircle, Lightbulb,
} from 'lucide-react'
import { MarkerType } from '@xyflow/react'
import { BUILDER_COMPONENTS } from '../../utils/constants'

/** Map: icon slug (from constants.js or kit canvasConfig) → lucide component. */
export const BUILDER_ICONS = {
  split: Split, 'door-open': DoorOpen, box: Box, zap: Zap, cog: Cog,
  mail: Mail, radio: Radio, activity: Activity, database: Database,
  'hard-drive': HardDrive, archive: Archive, search: Search, brain: Brain,
  globe: Globe, monitor: Monitor, smartphone: Smartphone, cpu: Cpu,
  'external-link': ExternalLink, shield: Shield, 'alert-triangle': AlertTriangle,
  'file-text': FileText, 'bar-chart': BarChart, layers: Layers,
  'git-branch': GitBranch, 'refresh-cw': RefreshCw, filter: Filter,
  scale: Scale, 'help-circle': HelpCircle, lightbulb: Lightbulb,
}

/** Default Novakian Concept-Map palette when a concept-mode Kit omits canvasConfig.components. */
export const DEFAULT_CONCEPT_COMPONENTS = [
  {
    category: 'Foundations',
    color: '#818cf8',
    items: [
      { id: 'core-concept', name: 'Core Concept', icon: 'brain' },
      { id: 'theorem-principle', name: 'Theorem / Principle', icon: 'scale' },
    ],
  },
  {
    category: 'Mechanisms',
    color: '#34d399',
    items: [
      { id: 'mechanism-process', name: 'Mechanism / Process', icon: 'cog' },
      { id: 'causal-driver', name: 'Causal Driver / Force', icon: 'zap' },
    ],
  },
  {
    category: 'Evidence',
    color: '#fbbf24',
    items: [
      { id: 'concrete-example', name: 'Concrete Example', icon: 'file-text' },
      { id: 'counterexample', name: 'Counterexample / Edge Case', icon: 'alert-triangle' },
    ],
  },
  {
    category: 'Inquiry',
    color: '#f97316',
    items: [
      { id: 'question-hypothesis', name: 'Question / Hypothesis', icon: 'help-circle' },
    ],
  },
]

export const DEFAULT_CONCEPT_PROTOCOLS = [
  'implies',
  'depends on',
  'causes',
  'example of',
  'contrasts with',
  'part of',
]

/** Map: category name → color, derived from the component & concept palettes. */
export const CATEGORY_COLORS = {
  ...Object.fromEntries(DEFAULT_CONCEPT_COMPONENTS.map((g) => [g.category, g.color])),
  ...Object.fromEntries(BUILDER_COMPONENTS.map((group) => [group.category, group.color])),
}

export const DEFAULT_NODE_COLOR = '#818cf8'

export function categoryColor(category, explicitColor) {
  return explicitColor || CATEGORY_COLORS[category] || DEFAULT_NODE_COLOR
}

/** Persisted board node → React Flow node. */
export function toFlowNodes(boardNodes = []) {
  return boardNodes.map((n) => ({
    id: n.id,
    type: 'component',
    position: { x: n.x || 0, y: n.y || 0 },
    data: {
      name: n.name,
      icon: n.icon,
      category: n.category,
      ...(n.color ? { color: n.color } : {}),
    },
  }))
}

/** React Flow node → persisted board node. */
export function toBoardNodes(flowNodes = []) {
  return flowNodes.map((n) => ({
    id: n.id,
    name: n.data?.name,
    icon: n.data?.icon,
    category: n.data?.category,
    ...(n.data?.color ? { color: n.data.color } : {}),
    x: Math.round(n.position?.x || 0),
    y: Math.round(n.position?.y || 0),
  }))
}

/** Style one flow edge from its source node's category color. */
export function styleFlowEdge(edge, sourceCategory) {
  const color = categoryColor(sourceCategory)
  const labelText = typeof edge.label === 'string' ? edge.label.trim() : ''
  return {
    ...edge,
    ...(labelText
      ? {
          label: labelText,
          labelStyle: { fontSize: 11, fontWeight: 600, fill: 'var(--color-text-primary, #e4e4e7)' },
          labelBgStyle: { fill: 'var(--color-surface, #1e1e2a)', fillOpacity: 0.9 },
          labelBgPadding: [6, 3],
          labelBgBorderRadius: 4,
        }
      : {}),
    type: 'default',
    style: { stroke: color, strokeWidth: 2 },
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
  }
}

/** Persisted board edge → React Flow edge (colored by source category). */
export function toFlowEdges(boardEdges = [], boardNodes = []) {
  const categoryById = new Map(boardNodes.map((n) => [n.id, n.category]))
  return boardEdges.map((e) => {
    const labelText = String(e.label ?? e.protocol ?? '').trim()
    return styleFlowEdge(
      {
        id: e.id,
        source: e.from,
        sourceHandle: e.fromAnchor || 'bottom',
        target: e.to,
        targetHandle: e.toAnchor || 'top',
        ...(labelText ? { label: labelText } : {}),
      },
      categoryById.get(e.from)
    )
  })
}

/** React Flow edge → persisted board edge. */
export function toBoardEdges(flowEdges = []) {
  return flowEdges.map((e) => {
    const labelText = String(e.label ?? e.data?.protocol ?? '').trim()
    return {
      id: e.id,
      from: e.source,
      fromAnchor: e.sourceHandle || 'bottom',
      to: e.target,
      toAnchor: e.targetHandle || 'top',
      ...(labelText ? { label: labelText } : {}),
    }
  })
}

/** Full board payload for persistence / export / AI verification. */
export function toBoardData(flowNodes, flowEdges) {
  return { nodes: toBoardNodes(flowNodes), edges: toBoardEdges(flowEdges) }
}
