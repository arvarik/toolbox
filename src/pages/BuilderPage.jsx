import { useState, useEffect, useRef, useCallback } from 'react'
import {
  MessageSquare, Save, Undo, Redo, ZoomIn, ZoomOut,
  MousePointer, Type, ArrowRight, Palette, Layout, Download,
} from 'lucide-react'
import Toolbox from '../components/builder/Toolbox'
import Canvas from '../components/builder/Canvas'
import BoardList from '../components/builder/BoardList'
import TemplateGallery from '../components/builder/TemplateGallery'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'
import useIsMobile from '../hooks/useIsMobile'
import { boardsApi } from '../utils/api'

// Auto-save debounce interval (ms)
const AUTO_SAVE_DELAY = 3000

export default function BuilderPage() {
  const toggleChat = useAppStore((s) => s.toggleChat)
  const nodes = useAppStore((s) => s.nodes || [])
  const edges = useAppStore((s) => s.edges || [])
  const setNodes = useAppStore((s) => s.setNodes)
  const setEdges = useAppStore((s) => s.setEdges)
  const addToast = useAppStore((s) => s.addToast)

  const [boards, setBoards] = useState([])
  const [activeBoard, setActiveBoard] = useState(null)
  const [activeTool, setActiveTool] = useState('select')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [showTemplates, setShowTemplates] = useState(false)
  const isMobile = useIsMobile()
  const autoSaveTimer = useRef(null)
  const lastSavedData = useRef(null)

  // Track which board IDs are local-only (not yet saved to DB)
  const [unsavedIds, setUnsavedIds] = useState(new Set())

  // Prevent the board-load effect from clearing canvas when we just dropped a node
  const skipNextLoad = useRef(false)

  // ─── Initial Load ───
  useEffect(() => {
    let cancelled = false

    boardsApi.list().then((list) => {
      if (cancelled) return
      if (list && list.length > 0) {
        setBoards(list)
        setActiveBoard(list[0].id)
      } else {
        // No saved boards — create a default local board
        const newBoard = { id: `local-${Date.now()}`, name: 'Untitled Board' }
        setBoards([newBoard])
        setActiveBoard(newBoard.id)
        setUnsavedIds(new Set([newBoard.id]))
      }
    }).catch(() => {
      if (cancelled) return
      const newBoard = { id: `local-${Date.now()}`, name: 'Untitled Board' }
      setBoards([newBoard])
      setActiveBoard(newBoard.id)
      setUnsavedIds(new Set([newBoard.id]))
    })

    return () => { cancelled = true }
  }, [])

  // ─── Load board data when activeBoard changes ───
  useEffect(() => {
    if (!activeBoard) return

    // Skip if flagged (e.g., after a drop that shouldn't trigger reload)
    if (skipNextLoad.current) {
      skipNextLoad.current = false
      return
    }

    // Local (unsaved) boards have no data on the server
    if (unsavedIds.has(activeBoard)) {
      setNodes([])
      setEdges([])
      lastSavedData.current = null
      return
    }

    // Load from server
    boardsApi.get(activeBoard).then((board) => {
      if (board && board.data) {
        setNodes(board.data.nodes || [])
        setEdges(board.data.edges || [])
        lastSavedData.current = JSON.stringify({ nodes: board.data.nodes || [], edges: board.data.edges || [] })
      } else {
        setNodes([])
        setEdges([])
        lastSavedData.current = null
      }
    }).catch(() => {
      setNodes([])
      setEdges([])
      lastSavedData.current = null
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBoard])

  // ─── Auto-save: debounced save when nodes or edges change ───
  useEffect(() => {
    // Skip local (unsaved) boards
    if (!activeBoard || unsavedIds.has(activeBoard)) return

    const currentData = JSON.stringify({ nodes, edges })
    if (currentData === lastSavedData.current) return

    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)

    autoSaveTimer.current = setTimeout(async () => {
      const currentBoard = boards.find((b) => b.id === activeBoard)
      if (!currentBoard) return
      try {
        await boardsApi.update(activeBoard, { name: currentBoard.name, data: { nodes, edges } })
        lastSavedData.current = currentData
      } catch {
        // Silent fail for auto-save
      }
    }, AUTO_SAVE_DELAY)

    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current)
    }
  }, [nodes, edges, activeBoard, boards, unsavedIds])

  // ─── Board Management Handlers ───

  const handleNewBoard = useCallback(() => {
    const newId = `local-${Date.now()}`
    const newBoard = { id: newId, name: `Board ${boards.length + 1}` }
    setBoards((prev) => [...prev, newBoard])
    setUnsavedIds((prev) => new Set([...prev, newId]))
    setActiveBoard(newId)
  }, [boards.length])

  const handleSaveBoard = useCallback(async () => {
    const currentBoard = boards.find((b) => b.id === activeBoard)
    if (!currentBoard) return

    const name = currentBoard.name
    const data = { nodes, edges }
    const isLocal = unsavedIds.has(activeBoard)

    try {
      if (isLocal) {
        const saved = await boardsApi.create({ name, data })
        // Replace the local board with the server board
        setBoards((prev) =>
          prev.map((b) => (b.id === activeBoard ? { ...b, id: saved.id, name: saved.name } : b))
        )
        setUnsavedIds((prev) => {
          const next = new Set(prev)
          next.delete(activeBoard)
          return next
        })
        skipNextLoad.current = true
        setActiveBoard(saved.id)
        lastSavedData.current = JSON.stringify(data)
        addToast({ type: 'success', message: 'Board created and saved' })
      } else {
        await boardsApi.update(activeBoard, { name, data })
        lastSavedData.current = JSON.stringify(data)
        addToast({ type: 'success', message: 'Board saved' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save board' })
    }
  }, [activeBoard, boards, nodes, edges, unsavedIds, addToast])

  const handleRenameBoard = useCallback(async (id, newName) => {
    // Update local state immediately
    setBoards((prev) => prev.map((b) => (b.id === id ? { ...b, name: newName } : b)))

    // If saved, also update on server
    if (!unsavedIds.has(id)) {
      try {
        await boardsApi.rename(id, newName)
      } catch {
        addToast({ type: 'error', message: 'Failed to rename board' })
      }
    }
  }, [unsavedIds, addToast])

  const handleDeleteBoard = useCallback(async (id) => {
    // Don't delete the last board
    if (boards.length <= 1) {
      addToast({ type: 'warning', message: 'Cannot delete the last board' })
      return
    }

    // If saved, delete from server
    if (!unsavedIds.has(id)) {
      try {
        await boardsApi.delete(id)
      } catch {
        addToast({ type: 'error', message: 'Failed to delete board' })
        return
      }
    }

    // Remove from local state
    setBoards((prev) => prev.filter((b) => b.id !== id))
    setUnsavedIds((prev) => {
      const next = new Set(prev)
      next.delete(id)
      return next
    })

    // If deleting the active board, switch to another
    if (id === activeBoard) {
      const remaining = boards.filter((b) => b.id !== id)
      if (remaining.length > 0) {
        setActiveBoard(remaining[0].id)
      }
    }

    addToast({ type: 'success', message: 'Board deleted' })
  }, [boards, activeBoard, unsavedIds, addToast])

  const handleDuplicateBoard = useCallback((id) => {
    const source = boards.find((b) => b.id === id)
    if (!source) return

    const newId = `local-${Date.now()}`
    const newBoard = { id: newId, name: `${source.name} (copy)` }
    setBoards((prev) => {
      const idx = prev.findIndex((b) => b.id === id)
      const next = [...prev]
      next.splice(idx + 1, 0, newBoard)
      return next
    })
    setUnsavedIds((prev) => new Set([...prev, newId]))

    // If duplicating the active board, copy nodes/edges too
    if (id === activeBoard) {
      // Switch to the new board — Canvas will be cleared, then we set the duplicated data
      setActiveBoard(newId)
      // Need to re-set nodes/edges after the state updates
      setTimeout(() => {
        setNodes([...nodes])
        setEdges([...edges])
      }, 0)
    } else {
      setActiveBoard(newId)
    }

    addToast({ type: 'success', message: `Duplicated "${source.name}"` })
  }, [boards, activeBoard, nodes, edges, setNodes, setEdges, addToast])

  const handleReorderBoards = useCallback(async (reorderedBoards) => {
    setBoards(reorderedBoards)

    // Only persist order for saved boards
    const savedIds = reorderedBoards
      .filter((b) => !unsavedIds.has(b.id))
      .map((b) => b.id)

    if (savedIds.length > 0) {
      try {
        await boardsApi.reorder(savedIds)
      } catch {
        // Silent fail for reorder
      }
    }
  }, [unsavedIds])

  // ─── Canvas Handlers ───

  const handleZoomIn = () => {
    const canvas = document.getElementById('builder-canvas')
    if (canvas?._zoomIn) canvas._zoomIn()
  }

  const handleZoomOut = () => {
    const canvas = document.getElementById('builder-canvas')
    if (canvas?._zoomOut) canvas._zoomOut()
  }

  const handleTransformChange = (t) => {
    setZoomLevel(Math.round(t.scale * 100))
  }

  // Load template onto canvas
  const handleLoadTemplate = (template) => {
    const ts = Date.now()
    const idMap = {}
    const newNodes = template.nodes.map((n) => {
      const newId = `${n.id}-${ts}`
      idMap[n.id] = newId
      return { ...n, id: newId }
    })
    const newEdges = template.edges.map((e) => ({
      ...e,
      id: `${e.id}-${ts}`,
      from: idMap[e.from] || e.from,
      to: idMap[e.to] || e.to,
    }))
    setNodes(newNodes)
    setEdges(newEdges)
    setShowTemplates(false)
    addToast({ type: 'success', message: `Loaded "${template.name}" template` })
  }

  // Export board as PNG image
  const handleExportImage = useCallback(() => {
    const canvasEl = document.getElementById('builder-canvas')
    if (!canvasEl) return

    try {
      const rect = canvasEl.getBoundingClientRect()
      const canvas2d = document.createElement('canvas')
      const scale = 2
      canvas2d.width = rect.width * scale
      canvas2d.height = rect.height * scale
      const ctx = canvas2d.getContext('2d')

      const isDark = document.documentElement.getAttribute('data-theme') !== 'light'
      ctx.fillStyle = isDark ? '#16161d' : '#f1f3f5'
      ctx.fillRect(0, 0, canvas2d.width, canvas2d.height)

      // Draw dot grid
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'
      for (let x = 0; x < canvas2d.width; x += 24 * scale) {
        for (let y = 0; y < canvas2d.height; y += 24 * scale) {
          ctx.beginPath()
          ctx.arc(x, y, 1 * scale, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      const catColors = {
        Compute: '#818cf8',
        Storage: '#34d399',
        Clients: '#60a5fa',
        Observability: '#fbbf24',
      }

      ctx.scale(scale, scale)

      nodes.forEach((node) => {
        const color = catColors[node.category] || '#818cf8'
        const x = node.x || 0
        const y = node.y || 0
        const w = 140
        const h = 52

        ctx.fillStyle = isDark ? '#1c1c27' : '#ffffff'
        ctx.strokeStyle = color + '44'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.roundRect(x, y, w, h, 8)
        ctx.fill()
        ctx.stroke()

        ctx.fillStyle = color
        ctx.beginPath()
        ctx.roundRect(x, y, 4, h, [4, 0, 0, 4])
        ctx.fill()

        ctx.fillStyle = isDark ? '#f4f4f5' : '#111827'
        ctx.font = '12px Inter, sans-serif'
        ctx.textBaseline = 'middle'
        ctx.fillText(node.name || 'Node', x + 14, y + h / 2)
      })

      edges.forEach((edge) => {
        const fromNode = nodes.find((n) => n.id === edge.from)
        const toNode = nodes.find((n) => n.id === edge.to)
        if (!fromNode || !toNode) return

        const fromX = (fromNode.x || 0) + 70
        const fromY = (fromNode.y || 0) + 52
        const toX = (toNode.x || 0) + 70
        const toY = toNode.y || 0

        const fromColor = catColors[fromNode.category] || '#818cf8'
        ctx.strokeStyle = fromColor + '88'
        ctx.lineWidth = 1.5
        ctx.beginPath()
        ctx.moveTo(fromX, fromY)
        const midY = (fromY + toY) / 2
        ctx.bezierCurveTo(fromX, midY, toX, midY, toX, toY)
        ctx.stroke()
      })

      canvas2d.toBlob((blob) => {
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${boards.find((b) => b.id === activeBoard)?.name || 'board'}.png`
        a.click()
        URL.revokeObjectURL(url)
        addToast({ type: 'success', message: 'Board exported as image' })
      })
    } catch {
      addToast({ type: 'error', message: 'Failed to export board' })
    }
  }, [nodes, edges, boards, activeBoard, addToast])

  const tools = [
    { id: 'select', icon: MousePointer, label: 'Select' },
    { id: 'text', icon: Type, label: 'Add Text' },
    { id: 'arrow', icon: ArrowRight, label: 'Draw Arrow' },
    { id: 'color', icon: Palette, label: 'Change Color' },
  ]

  return (
    <div className="builder-layout" id="builder-page">
      {/* Left: Component toolbox */}
      <Toolbox />

      {/* Center: Canvas area */}
      <div className="builder-canvas-area">
        {/* Board tabs */}
        <BoardList
          boards={boards}
          activeId={activeBoard}
          unsavedIds={unsavedIds}
          onSelect={setActiveBoard}
          onNew={handleNewBoard}
          onRename={handleRenameBoard}
          onDelete={handleDeleteBoard}
          onDuplicate={handleDuplicateBoard}
          onReorder={handleReorderBoards}
        />

        {/* Toolbar */}
        <div className="builder-toolbar">
          <div className="builder-toolbar-group">
            {tools.map((tool) => {
              const Icon = tool.icon
              return (
                <button
                  key={tool.id}
                  className={`btn btn-ghost btn-icon${activeTool === tool.id ? ' active' : ''}`}
                  onClick={() => setActiveTool(tool.id)}
                  title={tool.label}
                  id={`tool-${tool.id}`}
                  style={
                    activeTool === tool.id
                      ? {
                          background: 'var(--color-accent-subtle)',
                          color: 'var(--color-accent)',
                        }
                      : undefined
                  }
                >
                  <Icon size={16} />
                </button>
              )
            })}

            <div className="divider" />

            <button className="btn btn-ghost btn-icon" title="Undo" id="tool-undo">
              <Undo size={16} />
            </button>
            <button className="btn btn-ghost btn-icon" title="Redo" id="tool-redo">
              <Redo size={16} />
            </button>

            <div className="divider" />

            <button className="btn btn-ghost btn-icon" title="Zoom In" id="tool-zoom-in" onClick={handleZoomIn}>
              <ZoomIn size={16} />
            </button>
            <span style={{
              fontSize: 'var(--text-xs)',
              fontFamily: 'var(--font-mono)',
              color: 'var(--color-text-tertiary)',
              minWidth: 36,
              textAlign: 'center',
            }}>
              {zoomLevel}%
            </span>
            <button className="btn btn-ghost btn-icon" title="Zoom Out" id="tool-zoom-out" onClick={handleZoomOut}>
              <ZoomOut size={16} />
            </button>
          </div>

          <div className="builder-toolbar-group">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setShowTemplates((prev) => !prev)}
              title="Load Template"
              id="template-btn"
            >
              <Layout size={14} />
              Templates
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={handleExportImage}
              title="Export as Image"
              id="export-image-btn"
            >
              <Download size={14} />
              Export
            </button>
            <button className="btn btn-secondary btn-sm" id="save-board-btn" onClick={handleSaveBoard}>
              <Save size={14} />
              Save
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => toggleChat('builder')}
              id="builder-chat-btn"
            >
              <MessageSquare size={14} />
              Verify Design
            </button>
          </div>
        </div>

        {/* Canvas */}
        <div style={{ position: 'relative', flex: 1 }}>
          <Canvas onTransformChange={handleTransformChange} />
          {showTemplates && (
            <TemplateGallery
              onSelect={handleLoadTemplate}
              onClose={() => setShowTemplates(false)}
            />
          )}
        </div>
      </div>

      {/* Right: AI Chat panel */}
      {!isMobile && (
        <ChatPanel
          page="builder"
          title="Verify Architecture"
          placeholder="Describe your system for AI review..."
        />
      )}
    </div>
  )
}
