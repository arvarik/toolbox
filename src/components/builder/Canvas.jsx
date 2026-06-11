import { useState, useRef, useCallback } from 'react'
import { Trash2, Move } from 'lucide-react'
import {
  Server, Database, Zap, Globe, Monitor, Smartphone, Shield,
  AlertTriangle, FileText, BarChart, Radio, Activity, HardDrive,
  Archive, Search, Brain, Cpu, ExternalLink, Mail, Box, Cog,
  Split, DoorOpen,
} from 'lucide-react'

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

/**
 * Interactive canvas where users can drop, position, and connect system design components.
 * This is the initial scaffolding — full whiteboard features (arrows, anchors, text) will be built on top.
 */
export default function Canvas() {
  const [nodes, setNodes] = useState([])
  const [dragging, setDragging] = useState(null)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  const canvasRef = useRef(null)

  // Handle drops from toolbox
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'))
      const rect = canvasRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left - 70
      const y = e.clientY - rect.top - 30

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
  }, [])

  // Handle node dragging on canvas
  const handleNodeMouseDown = (e, node) => {
    e.stopPropagation()
    const rect = canvasRef.current.getBoundingClientRect()
    setDragging(node.id)
    setDragOffset({
      x: e.clientX - rect.left - node.x,
      y: e.clientY - rect.top - node.y,
    })
  }

  const handleMouseMove = useCallback(
    (e) => {
      if (!dragging) return
      const rect = canvasRef.current.getBoundingClientRect()
      const x = e.clientX - rect.left - dragOffset.x
      const y = e.clientY - rect.top - dragOffset.y
      setNodes((prev) =>
        prev.map((n) => (n.id === dragging ? { ...n, x, y } : n))
      )
    },
    [dragging, dragOffset]
  )

  const handleMouseUp = useCallback(() => {
    setDragging(null)
  }, [])

  const removeNode = (id) => {
    setNodes((prev) => prev.filter((n) => n.id !== id))
  }

  return (
    <div
      ref={canvasRef}
      className="builder-canvas"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      id="builder-canvas"
    >
      {nodes.length === 0 && (
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
              left: node.x,
              top: node.y,
              width: 140,
              background: 'var(--color-surface)',
              border: `1px solid ${dragging === node.id ? color : 'var(--color-surface-border)'}`,
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--space-3)',
              cursor: dragging === node.id ? 'grabbing' : 'grab',
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
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: color,
                border: '2px solid var(--color-surface)',
                ...(pos === 'top' && { top: -4, left: '50%', transform: 'translateX(-50%)' }),
                ...(pos === 'right' && { right: -4, top: '50%', transform: 'translateY(-50%)' }),
                ...(pos === 'bottom' && { bottom: -4, left: '50%', transform: 'translateX(-50%)' }),
                ...(pos === 'left' && { left: -4, top: '50%', transform: 'translateY(-50%)' }),
                opacity: 0.6,
                transition: 'opacity var(--duration-fast)',
                cursor: 'crosshair',
              }
              return <div key={pos} style={anchorStyle} title={`Connect ${pos}`} />
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
  )
}
