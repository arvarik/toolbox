import { useState, useEffect, useRef } from 'react'
import {
  MessageSquare, Save, Undo, Redo, ZoomIn, ZoomOut,
  MousePointer, Type, ArrowRight, Palette,
} from 'lucide-react'
import Toolbox from '../components/builder/Toolbox'
import Canvas from '../components/builder/Canvas'
import BoardList from '../components/builder/BoardList'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'
import { boardsApi } from '../utils/api'

const defaultBoards = [
  { id: 'board-1', name: 'Untitled Board' },
]

export default function BuilderPage() {
  const toggleChat = useAppStore((s) => s.toggleChat)
  const nodes = useAppStore((s) => s.nodes) || []
  const edges = useAppStore((s) => s.edges) || []
  const setNodes = useAppStore((s) => s.setNodes)
  const setEdges = useAppStore((s) => s.setEdges)
  const addToast = useAppStore((s) => s.addToast)

  const [boards, setBoards] = useState(defaultBoards)
  const [activeBoard, setActiveBoard] = useState('board-1')
  const [activeTool, setActiveTool] = useState('select')
  const [zoomLevel, setZoomLevel] = useState(100)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const canvasRef = useRef(null)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    boardsApi.list().then((list) => {
      if (list && list.length > 0) {
        setBoards(list)
        setActiveBoard(list[0].id)
      } else {
        setBoards(defaultBoards)
        setActiveBoard('board-1')
      }
    }).catch(() => {
      setBoards(defaultBoards)
      setActiveBoard('board-1')
    })
  }, [])

  // Load active board nodes and edges when activeBoard changes
  useEffect(() => {
    if (!activeBoard) return

    const isNew = activeBoard.startsWith('board-')
    if (isNew) {
      setNodes([])
      setEdges([])
      return
    }

    boardsApi.get(activeBoard).then((board) => {
      if (board && board.data) {
        setNodes(board.data.nodes || [])
        setEdges(board.data.edges || [])
      } else {
        setNodes([])
        setEdges([])
      }
    }).catch(() => {
      setNodes([])
      setEdges([])
    })
  }, [activeBoard, setNodes, setEdges])

  const handleNewBoard = () => {
    const newId = `board-${Date.now()}`
    setBoards((prev) => [...prev, { id: newId, name: `Board ${prev.length + 1}` }])
    setActiveBoard(newId)
  }

  const handleSaveBoard = async () => {
    const currentBoard = boards.find((b) => b.id === activeBoard)
    if (!currentBoard) return

    const name = currentBoard.name
    const data = { nodes, edges }
    const isNew = activeBoard.startsWith('board-')

    try {
      if (isNew) {
        const saved = await boardsApi.create({ name, data })
        setBoards((prev) =>
          prev.map((b) => (b.id === activeBoard ? { ...b, id: saved.id, name: saved.name } : b))
        )
        setActiveBoard(saved.id)
        addToast({ type: 'success', message: 'Board created and saved successfully' })
      } else {
        await boardsApi.update(activeBoard, { name, data })
        addToast({ type: 'success', message: 'Board saved successfully' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to save board' })
    }
  }

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
          onSelect={setActiveBoard}
          onNew={handleNewBoard}
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
        <Canvas onTransformChange={handleTransformChange} />
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
