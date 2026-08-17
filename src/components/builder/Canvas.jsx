import { useCallback, useMemo } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  ConnectionMode,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
} from '@xyflow/react'
import { Trash2, Move, Box } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import {
  BUILDER_ICONS,
  categoryColor,
  styleFlowEdge,
} from './boardModel'

/** The four connection anchors, one handle per side (loose mode). */
const HANDLES = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
]

/**
 * One system component card on the canvas: icon chip, name, delete
 * button, and a connection handle on each side.
 */
function ComponentNode({ id, data, selected }) {
  const Icon = BUILDER_ICONS[data.icon] || Box
  const color = categoryColor(data.category)

  const removeNode = (e) => {
    e.stopPropagation()
    useAppStore.setState((s) => ({
      nodes: (s.nodes || []).filter((n) => n.id !== id),
      edges: (s.edges || []).filter((edge) => edge.source !== id && edge.target !== id),
    }))
  }

  return (
    <div
      className={`builder-node${selected ? ' selected' : ''}`}
      style={{ '--node-color': color }}
    >
      {HANDLES.map((h) => (
        <Handle
          key={h.id}
          id={h.id}
          type="source"
          position={h.position}
          className="builder-node-handle"
          title={`Connect ${h.id}`}
        />
      ))}
      <div className="builder-node-body">
        <div className="builder-node-icon">
          <Icon size={14} />
        </div>
        <span className="builder-node-name">{data.name}</span>
        <button
          className="builder-node-delete"
          onClick={removeNode}
          aria-label="Remove node"
        >
          <Trash2 size={12} />
        </button>
      </div>
    </div>
  )
}

const nodeTypes = { component: ComponentNode }

function CanvasInner() {
  const nodes = useAppStore((s) => s.nodes || [])
  const edges = useAppStore((s) => s.edges || [])
  const { screenToFlowPosition } = useReactFlow()

  const onNodesChange = useCallback((changes) => {
    useAppStore.setState((s) => ({ nodes: applyNodeChanges(changes, s.nodes || []) }))
  }, [])

  const onEdgesChange = useCallback((changes) => {
    useAppStore.setState((s) => ({ edges: applyEdgeChanges(changes, s.edges || []) }))
  }, [])

  const onConnect = useCallback((connection) => {
    useAppStore.setState((s) => {
      const current = s.edges || []
      // One edge per node pair, either direction — same rule as before.
      const exists = current.some(
        (e) =>
          (e.source === connection.source && e.target === connection.target) ||
          (e.source === connection.target && e.target === connection.source)
      )
      if (exists || connection.source === connection.target) return s
      const sourceNode = (s.nodes || []).find((n) => n.id === connection.source)
      const edge = styleFlowEdge(
        { ...connection, id: `edge-${Date.now()}` },
        sourceNode?.data?.category
      )
      return { edges: [...current, edge] }
    })
  }, [])

  // Clicking an edge removes it (the pre-migration behavior).
  const onEdgeClick = useCallback((event, edge) => {
    event.stopPropagation()
    useAppStore.setState((s) => ({ edges: (s.edges || []).filter((e) => e.id !== edge.id) }))
  }, [])

  // Drops from the component toolbox (HTML5 drag & drop).
  const onDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      const raw = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // Guard against a zero-size container (e.g. first paint, test DOM)
      const node = {
        id: `${data.id}-${Date.now()}`,
        type: 'component',
        position: {
          x: Number.isFinite(raw.x) ? raw.x - 84 : 120,
          y: Number.isFinite(raw.y) ? raw.y - 26 : 120,
        },
        data: { name: data.name, icon: data.icon, category: data.category },
      }
      useAppStore.setState((s) => ({ nodes: [...(s.nodes || []), node] }))
    } catch {
      // Ignore invalid drops
    }
  }, [screenToFlowPosition])

  const minimapNodeColor = useMemo(
    () => (node) => categoryColor(node.data?.category),
    []
  )

  return (
    <div className="builder-canvas" id="builder-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={onEdgeClick}
        connectionMode={ConnectionMode.Loose}
        deleteKeyCode={['Backspace', 'Delete']}
        minZoom={0.25}
        maxZoom={3}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        connectionRadius={28}
        proOptions={{ hideAttribution: false }}
      >
        <Background variant={BackgroundVariant.Dots} gap={24} size={1.2} />
        <Controls showInteractive={false} position="bottom-right" />
        <MiniMap
          pannable
          zoomable
          position="bottom-left"
          nodeColor={minimapNodeColor}
          nodeStrokeWidth={4}
        />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="builder-canvas-empty">
          <Move size={32} style={{ margin: '0 auto var(--space-3)', color: 'var(--color-text-disabled)' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-disabled)' }}>
            Drag components from the toolbox to start designing
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Architecture whiteboard canvas, powered by React Flow.
 * State lives in the app store (React Flow shape); the persisted board
 * format is unchanged — see boardModel.js for the boundary converters.
 */
export default function Canvas() {
  return (
    <ReactFlowProvider>
      <CanvasInner />
    </ReactFlowProvider>
  )
}
