import {
  useCallback,
  useMemo,
  type CSSProperties,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react'
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
  type Connection,
  type EdgeChange,
  type Node,
  type NodeChange,
  type NodeProps,
} from '@xyflow/react'
import { Trash2, Move, Box } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import {
  BUILDER_ICONS,
  categoryColor,
  readStoreEdges,
  readStoreNodes,
  styleFlowEdge,
  writeStoreGraph,
  type BuilderFlowEdge,
  type BuilderFlowNode,
} from './boardModel'

/** The four connection anchors, one handle per side (loose mode). */
const HANDLES: ReadonlyArray<{ id: string; position: Position }> = [
  { id: 'top', position: Position.Top },
  { id: 'right', position: Position.Right },
  { id: 'bottom', position: Position.Bottom },
  { id: 'left', position: Position.Left },
]

interface DroppedComponentPayload {
  id: string
  name: string
  icon: string
  category: string
  color?: string
}

/**
 * One system component card on the canvas: icon chip, name, delete
 * button, and a connection handle on each side.
 */
function ComponentNode({ id, data, selected }: NodeProps<BuilderFlowNode>) {
  const Icon = BUILDER_ICONS[data.icon] || Box
  const color = categoryColor(data.category, data.color)

  const removeNode = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    const state = useAppStore.getState()
    writeStoreGraph({
      nodes: readStoreNodes(state).filter((n) => n.id !== id),
      edges: readStoreEdges(state).filter((edge) => edge.source !== id && edge.target !== id),
    })
  }

  return (
    <div
      className={`builder-node${selected ? ' selected' : ''}`}
      style={{ '--node-color': color } as CSSProperties}
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

export interface CanvasProps {
  defaultEdgeLabel?: string
  isConceptMode?: boolean
}

function CanvasInner({ defaultEdgeLabel = '', isConceptMode = false }: CanvasProps) {
  const nodes = useAppStore((s) => readStoreNodes(s))
  const edges = useAppStore((s) => readStoreEdges(s))
  const { screenToFlowPosition } = useReactFlow()

  const onNodesChange = useCallback((changes: NodeChange<BuilderFlowNode>[]) => {
    const current = readStoreNodes(useAppStore.getState())
    writeStoreGraph({ nodes: applyNodeChanges(changes, current) })
  }, [])

  const onEdgesChange = useCallback((changes: EdgeChange<BuilderFlowEdge>[]) => {
    const current = readStoreEdges(useAppStore.getState())
    writeStoreGraph({ edges: applyEdgeChanges(changes, current) })
  }, [])

  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const state = useAppStore.getState()
    const current = readStoreEdges(state)
    // One edge per node pair, either direction — same rule as before.
    const exists = current.some(
      (e) =>
        (e.source === connection.source && e.target === connection.target) ||
        (e.source === connection.target && e.target === connection.source)
    )
    if (exists || connection.source === connection.target) return
    const sourceNode = readStoreNodes(state).find((n) => n.id === connection.source)
    const label = typeof defaultEdgeLabel === 'string' ? defaultEdgeLabel.trim() : ''
    const edge = styleFlowEdge(
      {
        id: `edge-${Date.now()}`,
        source: connection.source,
        sourceHandle: connection.sourceHandle ?? undefined,
        target: connection.target,
        targetHandle: connection.targetHandle ?? undefined,
        ...(label ? { label } : {}),
      },
      sourceNode?.data?.category
    )
    writeStoreGraph({ edges: [...current, edge] })
  }, [defaultEdgeLabel])

  // Clicking an edge removes it (the pre-migration behavior).
  const onEdgeClick = useCallback((event: ReactMouseEvent, edge: BuilderFlowEdge) => {
    event.stopPropagation()
    const current = readStoreEdges(useAppStore.getState())
    writeStoreGraph({ edges: current.filter((e) => e.id !== edge.id) })
  }, [])

  // Drops from the component toolbox (HTML5 drag & drop).
  const onDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json')) as DroppedComponentPayload
      const raw = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      // Guard against a zero-size container (e.g. first paint, test DOM)
      const node: BuilderFlowNode = {
        id: `${data.id}-${Date.now()}`,
        type: 'component',
        position: {
          x: Number.isFinite(raw.x) ? raw.x - 84 : 120,
          y: Number.isFinite(raw.y) ? raw.y - 26 : 120,
        },
        data: {
          name: data.name,
          icon: data.icon,
          category: data.category,
          ...(data.color ? { color: data.color } : {}),
        },
      }
      const current = readStoreNodes(useAppStore.getState())
      writeStoreGraph({ nodes: [...current, node] })
    } catch {
      // Ignore invalid drops
    }
  }, [screenToFlowPosition])

  const minimapNodeColor = useMemo(
    () => (node: Node) => {
      const d = node.data as { category?: string; color?: string } | undefined
      return categoryColor(d?.category, d?.color)
    },
    []
  )

  return (
    <div className="builder-canvas" id="builder-canvas" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow<BuilderFlowNode, BuilderFlowEdge>
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
        proOptions={{ hideAttribution: true }}
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
            {isConceptMode
              ? 'Drag concept primitives or add a custom concept to start mapping'
              : 'Drag components from the toolbox to start designing'}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Architecture & Concept-Map canvas, powered by React Flow.
 * State lives in the app store (React Flow shape); the persisted board
 * format is unchanged — see boardModel.ts for the boundary converters.
 */
export default function Canvas({ defaultEdgeLabel = '', isConceptMode = false }: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner defaultEdgeLabel={defaultEdgeLabel} isConceptMode={isConceptMode} />
    </ReactFlowProvider>
  )
}
