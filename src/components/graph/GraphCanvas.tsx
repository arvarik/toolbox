import { useMemo, useState, useCallback, type CSSProperties, type MouseEvent } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react'
import { ancestorsOf, descendantsOf } from '../../../shared/kits/kitSkeleton'
import { computeLayout, HEALTH_COLORS, NODE_WIDTH, NODE_HEIGHT, type HealthBucket } from './graphLayout'

export interface GraphNodeItem {
  id: string
  name: string
  pillarId: string
  pillarName?: string
  pillarColor?: string
  topicId?: string | null
  summary: string
  health: HealthBucket
  strength: number
  counts?: {
    total?: number
    new?: number
    learning?: number
    lapsed?: number
    due?: number
    maturing?: number
    mastered?: number
  }
  ready?: boolean
  locked?: boolean
}

export interface GraphEdgeItem {
  from: string
  to: string
}

interface ConceptNodeData extends Record<string, unknown>, GraphNodeItem {
  nodeId: string
  filteredOut: boolean
  focus: boolean
  inLineage: boolean
  dimmed: boolean
  trackPos: number | undefined
}

type ConceptFlowNode = Node<ConceptNodeData, 'concept'>

/** Edge colors per lineage state (SVG markers need literal colors). */
const EDGE_COLORS: Record<string, string> = { default: '#6e685e', up: '#f0a429', down: '#6fbf94' }

/**
 * One concept pill: health-colored dot + name, card-count badge,
 * ready/locked styling, and the numbered badge of the active track.
 */
function ConceptNode({ data }: NodeProps<ConceptFlowNode>) {
  const color = HEALTH_COLORS[data.health] || HEALTH_COLORS.unseen
  const totalCards = data.counts?.total ?? 0
  return (
    <div
      id={`graph-node-${data.nodeId}`}
      className={`graph-node${data.filteredOut ? ' filtered-out' : ''}${data.focus ? ' focus' : ''}${data.inLineage ? ' lineage in-lineage' : ''}${data.dimmed ? ' lineage-dimmed' : ''}${data.ready ? ' ready' : ''}${data.locked ? ' locked' : ''}`}
      style={{ '--health-color': color } as CSSProperties}
      title={`${data.name}\n${data.summary}\nCards: ${totalCards}`}
    >
      <Handle type="target" position={Position.Left} className="graph-node-port" isConnectable={false} />
      <span className="graph-node-dot" />
      <span className="graph-node-name">{data.name}</span>
      {totalCards > 0 && (
        <span className="graph-node-count">{totalCards}</span>
      )}
      {typeof data.trackPos === 'number' && (
        <span className="graph-node-track">{data.trackPos}</span>
      )}
      <Handle type="source" position={Position.Right} className="graph-node-port" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { concept: ConceptNode }

interface GraphCanvasProps {
  nodes: GraphNodeItem[]
  edges: GraphEdgeItem[]
  visibleIds: Set<string> | null
  trackOrder: Map<string, number> | null
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
}

/**
 * The knowledge-graph canvas, powered by React Flow with a dagre
 * layered layout (prerequisites flow left → right). Pure view — all
 * data comes from props.
 */
export default function GraphCanvas({
  nodes,
  edges,
  visibleIds,
  trackOrder,
  selectedId,
  onSelect,
}: GraphCanvasProps) {
  const [hoverId, setHoverId] = useState<string | null>(null)

  const positions = useMemo(() => computeLayout(nodes, edges), [nodes, edges])

  const focusId = hoverId || selectedId
  const lineage = useMemo(() => {
    if (!focusId) return null
    return {
      up: ancestorsOf(focusId, edges),
      down: descendantsOf(focusId, edges),
    }
  }, [focusId, edges])

  const flowNodes = useMemo<ConceptFlowNode[]>(() => nodes.map((node) => {
    const filtered = Boolean(visibleIds && !visibleIds.has(node.id))
    const focus = node.id === focusId || node.id === selectedId
    const inLineage = Boolean(lineage && (lineage.up.has(node.id) || lineage.down.has(node.id)))
    return {
      id: node.id,
      type: 'concept',
      position: positions.get(node.id) || { x: 0, y: 0 },
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      draggable: false,
      connectable: false,
      data: {
        ...node,
        nodeId: node.id,
        filteredOut: filtered,
        focus,
        inLineage,
        dimmed: Boolean(lineage && !focus && !inLineage && !filtered),
        trackPos: trackOrder?.get(node.id),
      },
    }
  }), [nodes, positions, visibleIds, focusId, selectedId, lineage, trackOrder])

  const flowEdges = useMemo<Edge[]>(() => edges.map((edge) => {
    const hidden = Boolean(
      visibleIds && (!visibleIds.has(edge.from) || !visibleIds.has(edge.to)),
    )
    let state = 'default'
    if (lineage) {
      const onUpPath =
        (edge.to === focusId || lineage.up.has(edge.to)) &&
        (lineage.up.has(edge.from) || edge.from === focusId)
      const onDownPath =
        (edge.from === focusId || lineage.down.has(edge.from)) &&
        (lineage.down.has(edge.to) || edge.to === focusId)
      state = onUpPath ? 'up' : onDownPath ? 'down' : 'faded'
    }
    const color = EDGE_COLORS[state] || EDGE_COLORS.default
    return {
      id: `${edge.from}->${edge.to}`,
      source: edge.from,
      target: edge.to,
      className: `graph-edge ${state}`,
      hidden,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
    }
  }), [edges, visibleIds, lineage, focusId])

  const onNodeClick = useCallback((_event: MouseEvent, node: ConceptFlowNode) => {
    onSelect(node.id === selectedId ? null : node.id)
  }, [onSelect, selectedId])

  const minimapNodeColor = useCallback(
    (node: Node) => {
      const health = (node.data as { health?: HealthBucket } | undefined)?.health
      return (health && HEALTH_COLORS[health]) || HEALTH_COLORS.unseen
    },
    [],
  )

  return (
    <div className="graph-canvas-wrap" id="graph-canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(_e, node) => setHoverId(node.id)}
        onNodeMouseLeave={() => setHoverId(null)}
        onPaneClick={() => onSelect(null)}
        nodesDraggable={false}
        nodesConnectable={false}
        edgesFocusable={false}
        minZoom={0.15}
        maxZoom={2.5}
        fitView
        fitViewOptions={{ padding: 0.1 }}
      >
        <Background variant={BackgroundVariant.Dots} gap={28} size={1} />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={6}
        />
      </ReactFlow>
    </div>
  )
}
