import { useState, useRef, useCallback, useEffect } from 'react'
import { Trash2, Move } from 'lucide-react'
import {
  Database, Zap, Globe, Monitor, Smartphone, Shield,
  AlertTriangle, FileText, BarChart, Radio, Activity, HardDrive,
  Archive, Search, Brain, Cpu, ExternalLink, Mail, Box, Cog,
  Split, DoorOpen,
} from 'lucide-react'
import useAppStore from '../../stores/appStore'

const iconMap = {
  split: Split, 'door-open': DoorOpen, box: Box, zap: Zap, cog: Cog,
  mail: Mail, radio: Radio, activity: Activity, database: Database,
  'hard-drive': HardDrive, archive: Archive, search: Search, brain: Brain,
  globe: Globe, monitor: Monitor, smartphone: Smartphone, cpu: Cpu,
  'external-link': ExternalLink, shield: Shield, 'alert-triangle': AlertTriangle,
  'file-text': FileText, 'bar-chart': BarChart,
}

const categoryColors = {
  Compute: '#818cf8',
  Storage: '#34d399',
  Clients: '#60a5fa',
  Observability: '#fbbf24',
}

const MIN_SCALE = 0.25
const MAX_SCALE = 3.0
const ZOOM_STEP = 0.1
const NODE_WIDTH = 140

/**
 * Get the center position of a node anchor.
 */
function getAnchorPos(node, anchor) {
  const hw = NODE_WIDTH / 2
  const hh = 30 // approximate half-height of a node
  const cx = node.x + hw
  const cy = node.y + hh
  switch (anchor) {
    case 'top':    return { x: cx, y: node.y - 4 }
    case 'bottom': return { x: cx, y: node.y + hh * 2 + 4 }
    case 'left':   return { x: node.x - 4, y: cy }
    case 'right':  return { x: node.x + NODE_WIDTH + 4, y: cy }
    default:       return { x: cx, y: cy }
  }
}

/**
 * Build an SVG cubic Bézier path between two anchor positions.
 */
function buildEdgePath(from, to) {
  const dx = Math.abs(to.x - from.x) * 0.5
  const dy = Math.abs(to.y - from.y) * 0.5
  const offset = Math.max(dx, dy, 40)
  
  // Control points extend outward from the anchors
  const c1x = from.x + (to.x > from.x ? offset : -offset)
  const c1y = from.y
  const c2x = to.x + (from.x > to.x ? offset : -offset)
  const c2y = to.y
  
  return `M ${from.x} ${from.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${to.x} ${to.y}`
}

/**
 * Interactive canvas where users can drop, position, and connect system design components.
 * Supports pan, zoom, node dragging, and edge drawing.
 */
export default function Canvas({ onTransformChange }) {
  const nodes = useAppStore((s) => s.nodes) || []
  const edges = useAppStore((s) => s.edges) || []
  const addEdge = useAppStore((s) => s.addEdge)
  const removeEdge = useAppStore((s) => s.removeEdge)
  const setNodes = (newNodesVal) => {
    if (typeof newNodesVal === 'function') {
      useAppStore.setState((state) => ({ nodes: newNodesVal(state.nodes) }))
    } else {
      useAppStore.setState({ nodes: newNodesVal })
    }
  }

  // Dragging nodes
  const [dragging, setDragging] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })

  // Pan & Zoom
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isPanning, setIsPanning] = useState(false)
  const [panStart, setPanStart] = useState({ x: 0, y: 0 })
  const [spaceDown, setSpaceDown] = useState(false)

  // Edge drawing
  const [connecting, setConnecting] = useState(null) // { nodeId, anchor }
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 })

  // Hover state for edges
  const [hoveredEdge, setHoveredEdge] = useState(null)

  const canvasRef = useRef(null)

  // Expose transform to parent
  useEffect(() => {
    if (onTransformChange) onTransformChange(transform)
  }, [transform, onTransformChange])

  // Track space key for pan mode
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const handleKeyUp = (e) => {
      if (e.code === 'Space') {
        setSpaceDown(false)
        setIsPanning(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  }, [])

  // Convert screen coordinates to canvas coordinates
  const screenToCanvas = useCallback((clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect()
    return {
      x: (clientX - rect.left - transform.x) / transform.scale,
      y: (clientY - rect.top - transform.y) / transform.scale,
    }
  }, [transform])

  // Handle drops from toolbox
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      const pos = screenToCanvas(e.clientX, e.clientY)
      const x = pos.x - 70
      const y = pos.y - 30

      setNodes((prev) => [
        ...prev,
        {
          id: `${data.id}-${Date.now()}`,
          name: data.name,
          icon: data.icon,
          category: data.category,
          x,
          y,
        },
      ])
    } catch {
      // Ignore invalid drops
    }
  }, [screenToCanvas])

  // Handle wheel zoom
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const rect = canvasRef.current.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    setTransform((prev) => {
      const delta = e.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, prev.scale + delta))
      const ratio = newScale / prev.scale

      // Zoom towards cursor
      const newX = mouseX - (mouseX - prev.x) * ratio
      const newY = mouseY - (mouseY - prev.y) * ratio

      return { x: newX, y: newY, scale: newScale }
    })
  }, [])

  // Canvas mouse down — start panning
  const handleCanvasMouseDown = useCallback((e) => {
    // Middle-click or space+left-click starts pan
    if (e.button === 1 || (spaceDown && e.button === 0)) {
      e.preventDefault()
      setIsPanning(true)
      setPanStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
    }
  }, [spaceDown, transform])

  // Handle node dragging on canvas
  const handleNodeMouseDown = (e, node) => {
    if (spaceDown) return // Don't drag nodes while panning
    e.stopPropagation()
    const pos = screenToCanvas(e.clientX, e.clientY)
    setDragging(node.id)
    setDragOffset({
      x: pos.x - node.x,
      y: pos.y - node.y,
    })
  }

  // Handle anchor click to start edge drawing
  const handleAnchorMouseDown = (e, nodeId, anchor) => {
    e.stopPropagation()
    e.preventDefault()
    setConnecting({ nodeId, anchor })
    const pos = screenToCanvas(e.clientX, e.clientY)
    setMousePos(pos)
  }

  const handleMouseMove = useCallback(
    (e) => {
      // Panning
      if (isPanning) {
        setTransform((prev) => ({
          ...prev,
          x: e.clientX - panStart.x,
          y: e.clientY - panStart.y,
        }))
        return
      }

      // Edge drawing preview
      if (connecting) {
        const pos = screenToCanvas(e.clientX, e.clientY)
        setMousePos(pos)
        return
      }

      // Node dragging
      if (!dragging) return
      const pos = screenToCanvas(e.clientX, e.clientY)
      const x = pos.x - dragOffset.x
      const y = pos.y - dragOffset.y
      setNodes((prev) =>
        prev.map((n) => (n.id === dragging ? { ...n, x, y } : n))
      )
    },
    [dragging, dragOffset, isPanning, panStart, connecting, screenToCanvas]
  )

  // Handle anchor mouseup to complete edge
  const handleAnchorMouseUp = (e, nodeId, anchor) => {
    e.stopPropagation()
    if (connecting && connecting.nodeId !== nodeId) {
      // Prevent duplicate edges
      const exists = edges.some(
        (ed) => (ed.from === connecting.nodeId && ed.to === nodeId) ||
               (ed.from === nodeId && ed.to === connecting.nodeId)
      )
      if (!exists) {
        addEdge({
          id: `edge-${Date.now()}`,
          from: connecting.nodeId,
          fromAnchor: connecting.anchor,
          to: nodeId,
          toAnchor: anchor,
        })
      }
    }
    setConnecting(null)
  }

  const handleMouseUp = useCallback(() => {
    setDragging(null)
    setIsPanning(false)
    setConnecting(null)
  }, [])

  const removeNode = (id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
    // Also remove edges connected to this node
    const connectedEdges = edges.filter((e) => e.from === id || e.to === id)
    connectedEdges.forEach((e) => removeEdge(e.id))
  }

  // Zoom in/out functions for toolbar buttons
  const zoomIn = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.min(MAX_SCALE, prev.scale + ZOOM_STEP)
      return { ...prev, scale: newScale }
    })
  }, [])

  const zoomOut = useCallback(() => {
    setTransform((prev) => {
      const newScale = Math.max(MIN_SCALE, prev.scale - ZOOM_STEP)
      return { ...prev, scale: newScale }
    })
  }, [])

  // Expose zoom functions via ref on the DOM element
  useEffect(() => {
    if (canvasRef.current) {
      canvasRef.current._zoomIn = zoomIn
      canvasRef.current._zoomOut = zoomOut
      canvasRef.current._getScale = () => transform.scale
    }
  })

  return (
    <div
      ref={canvasRef}
      className="builder-canvas"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onMouseDown={handleCanvasMouseDown}
      onWheel={handleWheel}
      id="builder-canvas"
      style={{ cursor: isPanning || spaceDown ? 'grab' : undefined, overflow: 'hidden' }}
    >
      {/* SVG Layer for edges */}
      <svg
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          zIndex: 0,
          overflow: 'visible',
        }}
      >
        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Rendered edges */}
          {edges.map((edge) => {
            const fromNode = nodes.find((n) => n.id === edge.from)
            const toNode = nodes.find((n) => n.id === edge.to)
            if (!fromNode || !toNode) return null

            const from = getAnchorPos(fromNode, edge.fromAnchor)
            const to = getAnchorPos(toNode, edge.toAnchor)
            const pathD = buildEdgePath(from, to)
            const color = categoryColors[fromNode.category] || '#818cf8'

            return (
              <g key={edge.id}>
                {/* Invisible wider path for hover target */}
                <path
                  d={pathD}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={16}
                  style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
                  onMouseEnter={() => setHoveredEdge(edge.id)}
                  onMouseLeave={() => setHoveredEdge(null)}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeEdge(edge.id)
                  }}
                />
                {/* Visible edge */}
                <path
                  d={pathD}
                  fill="none"
                  stroke={hoveredEdge === edge.id ? '#ef4444' : color}
                  strokeWidth={hoveredEdge === edge.id ? 3 : 2}
                  strokeDasharray={hoveredEdge === edge.id ? '6 3' : 'none'}
                  style={{ transition: 'stroke 0.15s, stroke-width 0.15s' }}
                />
                {/* Arrow head */}
                <circle
                  cx={to.x}
                  cy={to.y}
                  r={4}
                  fill={hoveredEdge === edge.id ? '#ef4444' : color}
                />
              </g>
            )
          })}

          {/* Temporary edge while connecting */}
          {connecting && (() => {
            const fromNode = nodes.find((n) => n.id === connecting.nodeId)
            if (!fromNode) return null
            const from = getAnchorPos(fromNode, connecting.anchor)
            const pathD = buildEdgePath(from, mousePos)
            return (
              <path
                d={pathD}
                fill="none"
                stroke="#818cf8"
                strokeWidth={2}
                strokeDasharray="6 3"
                opacity={0.6}
              />
            )
          })()}
        </g>
      </svg>

      {/* Transformed content layer */}
      <div
        style={{
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
          transformOrigin: '0 0',
          position: 'absolute',
          inset: 0,
          zIndex: 1,
        }}
      >
        {nodes.length === 0 && transform.scale === 1 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <div style={{ textAlign: 'center', opacity: 0.5 }}>
              <Move size={32} style={{ margin: '0 auto var(--space-3)', color: 'var(--color-text-disabled)' }} />
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-disabled)' }}>
                Drag components from the toolbox to start designing
              </div>
            </div>
          </div>
        )}

        {nodes.map((node) => {
          const Icon = iconMap[node.icon] || Box
          const color = categoryColors[node.category] || '#818cf8'

          return (
            <div
              key={node.id}
              style={{
                position: 'absolute',
                left: `${node.x}px`,
                top: `${node.y}px`,
                width: NODE_WIDTH,
                background: 'var(--color-surface)',
                border: `1px solid ${dragging === node.id ? color : 'var(--color-surface-border)'}`,
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-3)',
                cursor: dragging === node.id ? 'grabbing' : (spaceDown ? 'grab' : 'grab'),
                boxShadow: dragging === node.id ? `var(--shadow-lg), 0 0 12px ${color}30` : 'var(--shadow-sm)',
                transition: dragging === node.id ? 'none' : 'box-shadow var(--duration-fast)',
                userSelect: 'none',
                zIndex: dragging === node.id ? 10 : 1,
              }}
              onMouseDown={(e) => handleNodeMouseDown(e, node)}
            >
              {/* Connection anchors */}
              {['top', 'right', 'bottom', 'left'].map((pos) => {
                const anchorStyle = {
                  position: 'absolute',
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: connecting ? '#818cf8' : color,
                  border: '2px solid var(--color-surface)',
                  ...(pos === 'top' && { top: -5, left: '50%', transform: 'translateX(-50%)' }),
                  ...(pos === 'right' && { right: -5, top: '50%', transform: 'translateY(-50%)' }),
                  ...(pos === 'bottom' && { bottom: -5, left: '50%', transform: 'translateX(-50%)' }),
                  ...(pos === 'left' && { left: -5, top: '50%', transform: 'translateY(-50%)' }),
                  opacity: connecting ? 0.9 : 0.6,
                  transition: 'opacity var(--duration-fast), transform var(--duration-fast)',
                  cursor: 'crosshair',
                  zIndex: 20,
                }
                return (
                  <div
                    key={pos}
                    style={anchorStyle}
                    title={`Connect ${pos}`}
                    onMouseDown={(e) => handleAnchorMouseDown(e, node.id, pos)}
                    onMouseUp={(e) => handleAnchorMouseUp(e, node.id, pos)}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.transform = pos === 'top' || pos === 'bottom' 
                        ? 'translateX(-50%) scale(1.4)' 
                        : 'translateY(-50%) scale(1.4)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = connecting ? '0.9' : '0.6'
                      e.currentTarget.style.transform = pos === 'top' || pos === 'bottom' 
                        ? 'translateX(-50%)' 
                        : 'translateY(-50%)'
                    }}
                  />
                )
              })}

              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 'var(--radius-sm)',
                    background: `${color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  <Icon size={14} style={{ color }} />
                </div>
                <span
                  style={{
                    fontSize: 'var(--text-xs)',
                    fontWeight: 600,
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {node.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    removeNode(node.id)
                  }}
                  style={{
                    opacity: 0.3,
                    cursor: 'pointer',
                    transition: 'opacity var(--duration-fast)',
                    background: 'none',
                    border: 'none',
                    padding: 2,
                    color: 'inherit',
                  }}
                  onMouseEnter={(e) => (e.target.style.opacity = 1)}
                  onMouseLeave={(e) => (e.target.style.opacity = 0.3)}
                  aria-label="Remove node"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* Zoom indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 'var(--space-3)',
          right: 'var(--space-3)',
          fontSize: 'var(--text-xs)',
          color: 'var(--color-text-disabled)',
          fontFamily: 'var(--font-mono)',
          background: 'var(--color-bg)',
          padding: '2px 8px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--color-border)',
          zIndex: 5,
        }}
      >
        {Math.round(transform.scale * 100)}%
      </div>
    </div>
  )
}
