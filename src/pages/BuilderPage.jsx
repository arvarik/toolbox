import { useState } from 'react'
import {
  MessageSquare, Save, Undo, Redo, ZoomIn, ZoomOut,
  MousePointer, Type, ArrowRight, Palette,
} from 'lucide-react'
import Toolbox from '../components/builder/Toolbox'
import Canvas from '../components/builder/Canvas'
import BoardList from '../components/builder/BoardList'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'

const defaultBoards = [
  { id: 'board-1', name: 'Untitled Board' },
]

export default function BuilderPage() {
  const chatOpen = useAppStore((s) => s.chatOpen.builder)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const [boards, setBoards] = useState(defaultBoards)
  const [activeBoard, setActiveBoard] = useState('board-1')
  const [activeTool, setActiveTool] = useState('select')

  const handleNewBoard = () => {
    const newId = `board-${Date.now()}`
    setBoards((prev) => [...prev, { id: newId, name: `Board ${prev.length + 1}` }])
    setActiveBoard(newId)
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

            <button className="btn btn-ghost btn-icon" title="Zoom In" id="tool-zoom-in">
              <ZoomIn size={16} />
            </button>
            <button className="btn btn-ghost btn-icon" title="Zoom Out" id="tool-zoom-out">
              <ZoomOut size={16} />
            </button>
          </div>

          <div className="builder-toolbar-group">
            <button className="btn btn-secondary btn-sm" id="save-board-btn">
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
        <Canvas />
      </div>

      {/* Right: AI Chat panel */}
      <ChatPanel
        page="builder"
        title="Verify Architecture"
        placeholder="Describe your system for AI review..."
      />
    </div>
  )
}
