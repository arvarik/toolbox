import { useMemo, useState, useCallback } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
} from '@xyflow/react'
import { ancestorsOf, descendantsOf } from '../../utils/knowledgeGraph'
import { computeLayout, HEALTH_COLORS, NODE_WIDTH, NODE_HEIGHT } from './graphLayout'

/** Edge colors per lineage state (SVG markers need literal colors). */
const EDGE_COLORS = { default: '#52525b', up: '#818cf8', down: '#2dd4bf' }

/**
 * One concept pill: health-colored dot + name, card-count badge,
 * ready/locked styling, and the numbered badge of the active track.
 */
function ConceptNode({ data }) {
  const color = HEALTH_COLORS[data.health] || HEALTH_COLORS.unseen
  return (
    <div
      id={`graph-node-${data.nodeId}`}
      className={`graph-node${data.filteredOut ? ' filtered-out' : ''}${data.focus ? ' focus' : ''}${data.inLineage ? ' lineage' : ''}${data.ready ? ' ready' : ''}${data.locked ? ' locked' : ''}`}
      style={{ '--health-color': color }}
      title={`${data.name}\n${data.summary}\nCards: ${data.counts?.total ?? 0}`}
    >
      <Handle type="target" position={Position.Left} className="graph-node-port" isConnectable={false} />
      <span className="graph-node-dot" />
      <span className="graph-node-name">{data.name}</span>
      {(data.counts?.total ?? 0) > 0 && (
        <span className="graph-node-count">{data.counts.total}</span>
      )}
      {typeof data.trackPos === 'number' && (
        <span className="graph-node-track">{data.trackPos}</span>
      )}
      <Handle type="source" position={Position.Right} className="graph-node-port" isConnectable={false} />
    </div>
  )
}

const nodeTypes = { concept: ConceptNode }

/**
 * The knowledge-graph canvas, powered by React Flow with a dagre
 * layered layout (prerequisites flow left → right). Pure view — all
 * data comes from props.
 *
 * @param {Array} nodes - Nodes with health/strength/counts from the API.
 * @param {Array} edges - [{ from, to }] prerequisite edges.
 * @param {Set|null} visibleIds - Nodes matching the active filters (null = all).
 * @param {Map|null} trackOrder - nodeId → 1-based position in the active track.
 * @param {string|null} selectedId
 * @param {Function} onSelect - (nodeId|null) => void
 */
export default function GraphCanvas({ nodes, edges, visibleIds, trackOrder, selectedId, onSelect }) {
  const [hoverId, setHoverId] = useState(null)

  const positions = useMemo(() => computeLayout(nodes, edges), [nodes, edges])

  // Lineage of the focused node: everything it needs (ancestors) and
  // everything it unlocks (descendants).
  const focusId = hoverId || selectedId
  const lineage = useMemo(() => {
    if (!focusId) return null
    return {
      up: ancestorsOf(focusId, edges),
      down: descendantsOf(focusId, edges),
    }
  }, [focusId, edges])

  const flowNodes = useMemo(() => nodes.map((node) => ({
    id: node.id,
    type: 'concept',
    position: positions.get(node.id) || { x: 0, y: 0 },
    // Explicit dimensions: the graph never applies RF dimension changes,
    // and the minimap + fitView need node sizes up front.
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
    draggable: false,
    connectable: false,
    data: {
      ...node,
      nodeId: node.id,
      filteredOut: Boolean(visibleIds && !visibleIds.has(node.id)),
      focus: node.id === focusId || node.id === selectedId,
      inLineage: Boolean(lineage && (lineage.up.has(node.id) || lineage.down.has(node.id))),
      trackPos: trackOrder?.get(node.id),
    },
  })), [nodes, positions, visibleIds, focusId, selectedId, lineage, trackOrder])

  const flowEdges = useMemo(() => edges.map((edge) => {
    const hidden = Boolean(
      visibleIds && (!visibleIds.has(edge.from) || !visibleIds.has(edge.to))
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

  const onNodeClick = useCallback((event, node) => {
    onSelect(node.id === selectedId ? null : node.id)
  }, [onSelect, selectedId])

  const minimapNodeColor = useCallback(
    (node) => HEALTH_COLORS[node.data?.health] || HEALTH_COLORS.unseen,
    []
  )

  return (
    <div className="graph-canvas-wrap" id="graph-canvas">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        onNodeMouseEnter={(e, node) => setHoverId(node.id)}
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
