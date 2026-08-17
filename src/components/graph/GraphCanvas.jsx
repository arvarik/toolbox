import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import { ancestorsOf, descendantsOf } from '../../utils/knowledgeGraph'
import { computeLayout, HEALTH_COLORS } from './graphLayout'

const MIN_ZOOM = 0.25
const MAX_ZOOM = 2.5

/**
 * The SVG knowledge-graph canvas: pan, zoom, hover lineage highlighting,
 * and node selection. Pure view — all data comes from props.
 *
 * @param {Array} nodes - Nodes with health/strength/counts from the API.
 * @param {Array} edges - [{ from, to }] prerequisite edges.
 * @param {Set|null} visibleIds - Nodes matching the active filters (null = all).
 * @param {Map|null} trackOrder - nodeId → 1-based position in the active track.
 * @param {string|null} selectedId
 * @param {Function} onSelect - (nodeId|null) => void
 */
export default function GraphCanvas({ nodes, edges, visibleIds, trackOrder, selectedId, onSelect }) {
  const containerRef = useRef(null)
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 })
  const [hoverId, setHoverId] = useState(null)
  const dragRef = useRef(null)

  const layout = useMemo(() => computeLayout(nodes, edges), [nodes, edges])

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

  const fitToView = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const k = Math.min(
      MAX_ZOOM,
      Math.max(MIN_ZOOM, Math.min(rect.width / layout.width, rect.height / layout.height))
    )
    setTransform({
      x: (rect.width - layout.width * k) / 2,
      y: (rect.height - layout.height * k) / 2,
      k,
    })
  }, [layout])

  // Fit when the layout first resolves.
  useEffect(() => { fitToView() }, [fitToView])

  const zoomBy = (factor) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    zoomAt(rect.width / 2, rect.height / 2, factor)
  }

  const zoomAt = (cx, cy, factor) => {
    setTransform((t) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, t.k * factor))
      const scale = k / t.k
      return {
        k,
        x: cx - (cx - t.x) * scale,
        y: cy - (cy - t.y) * scale,
      }
    })
  }

  const handleWheel = (e) => {
    e.preventDefault()
    const rect = containerRef.current.getBoundingClientRect()
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
  }

  // React attaches wheel listeners passively; bind manually so
  // preventDefault stops the page from scrolling while zooming.
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const wheel = (e) => handleWheel(e)
    el.addEventListener('wheel', wheel, { passive: false })
    return () => el.removeEventListener('wheel', wheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handlePointerDown = (e) => {
    if (e.button !== 0) return
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: transform.x, ty: transform.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const handlePointerMove = (e) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.startX
    const dy = e.clientY - drag.startY
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true
    setTransform((t) => ({ ...t, x: drag.tx + dx, y: drag.ty + dy }))
  }

  const handlePointerUp = (e) => {
    const drag = dragRef.current
    dragRef.current = null
    // A clean click (no drag) on empty canvas clears the selection.
    if (drag && !drag.moved && e.target.tagName === 'svg') onSelect(null)
  }

  const isDimmed = (id) => {
    if (visibleIds && !visibleIds.has(id)) return true
    if (lineage && id !== focusId && !lineage.up.has(id) && !lineage.down.has(id)) {
      // Keep filter-visible nodes readable, lineage just glows brighter.
      return false
    }
    return false
  }

  const edgeState = (edge) => {
    if (visibleIds && (!visibleIds.has(edge.from) || !visibleIds.has(edge.to))) return 'hidden'
    if (!lineage) return 'default'
    const onUpPath =
      (edge.to === focusId || lineage.up.has(edge.to)) &&
      (lineage.up.has(edge.from) || edge.from === focusId)
    const onDownPath =
      (edge.from === focusId || lineage.down.has(edge.from)) &&
      (lineage.down.has(edge.to) || edge.to === focusId)
    if (onUpPath) return 'up'
    if (onDownPath) return 'down'
    return 'faded'
  }

  const nodeRadius = (node) => 11 + Math.min(7, (node.counts?.total || 0) * 1.2)

  return (
    <div className="graph-canvas-wrap" ref={containerRef} id="graph-canvas">
      <svg
        className="graph-svg"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        role="application"
        aria-label="Knowledge graph canvas"
      >
        <defs>
          <marker id="arrow-default" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="var(--color-border-strong)" />
          </marker>
          <marker id="arrow-up" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#818cf8" />
          </marker>
          <marker id="arrow-down" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 0 1 L 9 5 L 0 9 z" fill="#2dd4bf" />
          </marker>
        </defs>

        <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
          {/* Edges under nodes */}
          {edges.map((edge) => {
            const from = layout.positions.get(edge.from)
            const to = layout.positions.get(edge.to)
            if (!from || !to) return null
            const state = edgeState(edge)
            if (state === 'hidden') return null
            const midX = (from.x + to.x) / 2
            const d = `M ${from.x} ${from.y} C ${midX} ${from.y}, ${midX} ${to.y}, ${to.x} ${to.y}`
            return (
              <path
                key={`${edge.from}->${edge.to}`}
                d={d}
                className={`graph-edge ${state}`}
                markerEnd={`url(#arrow-${state === 'up' ? 'up' : state === 'down' ? 'down' : 'default'})`}
              />
            )
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = layout.positions.get(node.id)
            if (!pos) return null
            const dimmed = isDimmed(node.id)
            const filteredOut = visibleIds && !visibleIds.has(node.id)
            const r = nodeRadius(node)
            const color = HEALTH_COLORS[node.health] || HEALTH_COLORS.unseen
            const inLineage = lineage && (lineage.up.has(node.id) || lineage.down.has(node.id))
            const isFocus = node.id === focusId
            const trackPos = trackOrder?.get(node.id)
            return (
              <g
                key={node.id}
                transform={`translate(${pos.x},${pos.y})`}
                className={`graph-node${filteredOut ? ' filtered-out' : ''}${dimmed ? ' dimmed' : ''}${isFocus ? ' focus' : ''}${inLineage ? ' lineage' : ''}`}
                onClick={(e) => { e.stopPropagation(); onSelect(node.id === selectedId ? null : node.id) }}
                onMouseEnter={() => setHoverId(node.id)}
                onMouseLeave={() => setHoverId(null)}
                role="button"
                aria-label={`${node.name} — ${node.health}`}
                id={`graph-node-${node.id}`}
              >
                <title>{`${node.name}\n${node.summary}\nCards: ${node.counts?.total ?? 0}`}</title>
                {node.ready && (
                  <circle r={r + 5} className="graph-node-ready-ring" />
                )}
                {node.id === selectedId && (
                  <circle r={r + 8} className="graph-node-selected-ring" />
                )}
                <circle
                  r={r}
                  fill={color}
                  fillOpacity={node.health === 'unseen' ? 0.14 : 0.22}
                  stroke={color}
                  strokeWidth={isFocus ? 2.5 : 1.8}
                  strokeDasharray={node.locked ? '3 3' : 'none'}
                />
                {typeof trackPos === 'number' && (
                  <g className="graph-node-track-badge">
                    <circle cx={r * 0.85} cy={-r * 0.85} r={8} />
                    <text cx={r * 0.85} x={r * 0.85} y={-r * 0.85 + 3}>{trackPos}</text>
                  </g>
                )}
                <text className="graph-node-label" y={r + 14}>{node.name}</text>
              </g>
            )
          })}
        </g>
      </svg>

      {/* Zoom controls */}
      <div className="graph-zoom-controls">
        <button className="btn btn-secondary btn-icon btn-sm" onClick={() => zoomBy(1.25)} aria-label="Zoom in" title="Zoom in">
          <ZoomIn size={14} />
        </button>
        <button className="btn btn-secondary btn-icon btn-sm" onClick={() => zoomBy(1 / 1.25)} aria-label="Zoom out" title="Zoom out">
          <ZoomOut size={14} />
        </button>
        <button className="btn btn-secondary btn-icon btn-sm" onClick={fitToView} aria-label="Fit to view" title="Fit to view">
          <Maximize size={14} />
        </button>
      </div>
    </div>
  )
}
