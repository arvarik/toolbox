import { useState, useRef, useCallback, useEffect } from 'react'
import { Plus, FileIcon, X, Pencil, Trash2, Copy } from 'lucide-react'

/**
 * Board tab bar — full-featured tab management for whiteboards.
 *
 * Features:
 * - Click to select a board
 * - Double-click to inline-rename
 * - Right-click context menu (Rename / Duplicate / Delete)
 * - Close (×) button on hover
 * - Drag-to-reorder tabs
 * - Unsaved indicator dot
 * - Overflow scroll with fade edges
 *
 * @param {Array}    boards        – List of board objects { id, name }
 * @param {string}   activeId      – Currently active board ID
 * @param {Set}      unsavedIds    – Set of board IDs that haven't been saved to the server
 * @param {function} onSelect      – Board selection handler
 * @param {function} onNew         – New board handler
 * @param {function} onRename      – (id, newName) handler
 * @param {function} onDelete      – (id) handler
 * @param {function} onDuplicate   – (id) handler
 * @param {function} onReorder     – (reorderedBoards) handler
 */
export default function BoardList({
  boards = [],
  activeId,
  unsavedIds = new Set(),
  onSelect,
  onNew,
  onRename,
  onDelete,
  onDuplicate,
  onReorder,
}) {
  // Inline rename state
  const [editingId, setEditingId] = useState(null)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef(null)

  // Context menu state
  const [contextMenu, setContextMenu] = useState(null) // { x, y, boardId }

  // Drag-to-reorder state
  const [dragId, setDragId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editingId])

  // Close context menu on outside click or escape
  useEffect(() => {
    if (!contextMenu) return
    const handleClick = () => setContextMenu(null)
    const handleKey = (e) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('click', handleClick)
    window.addEventListener('keydown', handleKey)
    return () => {
      window.removeEventListener('click', handleClick)
      window.removeEventListener('keydown', handleKey)
    }
  }, [contextMenu])

  const startRename = useCallback((boardId) => {
    const board = boards.find((b) => b.id === boardId)
    if (!board) return
    setEditingId(boardId)
    setEditValue(board.name)
    setContextMenu(null)
  }, [boards])

  const commitRename = useCallback(() => {
    if (editingId && editValue.trim() && onRename) {
      onRename(editingId, editValue.trim())
    }
    setEditingId(null)
    setEditValue('')
  }, [editingId, editValue, onRename])

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter') {
      commitRename()
    } else if (e.key === 'Escape') {
      setEditingId(null)
      setEditValue('')
    }
  }, [commitRename])

  const handleContextMenu = useCallback((e, boardId) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, boardId })
  }, [])

  // Drag-to-reorder handlers
  const handleDragStart = useCallback((e, boardId) => {
    setDragId(boardId)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', boardId)
    // Make the drag image slightly transparent
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [])

  const handleDragEnd = useCallback((e) => {
    if (e.currentTarget) {
      e.currentTarget.style.opacity = '1'
    }
    setDragId(null)
    setDragOverId(null)
  }, [])

  const handleDragOver = useCallback((e, boardId) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (boardId !== dragId) {
      setDragOverId(boardId)
    }
  }, [dragId])

  const handleDrop = useCallback((e, targetId) => {
    e.preventDefault()
    if (!dragId || dragId === targetId || !onReorder) return

    const newBoards = [...boards]
    const dragIndex = newBoards.findIndex((b) => b.id === dragId)
    const targetIndex = newBoards.findIndex((b) => b.id === targetId)
    if (dragIndex === -1 || targetIndex === -1) return

    const [moved] = newBoards.splice(dragIndex, 1)
    newBoards.splice(targetIndex, 0, moved)
    onReorder(newBoards)

    setDragId(null)
    setDragOverId(null)
  }, [dragId, boards, onReorder])

  return (
    <div className="board-list-bar" id="board-list">
      <div className="board-tabs-scroll">
        {boards.map((board) => {
          const isActive = board.id === activeId
          const isUnsaved = unsavedIds.has(board.id)
          const isEditing = editingId === board.id
          const isDragOver = dragOverId === board.id && dragId !== board.id

          return (
            <div
              key={board.id}
              className={
                'board-tab' +
                (isActive ? ' active' : '') +
                (isDragOver ? ' drag-over' : '') +
                (dragId === board.id ? ' dragging' : '')
              }
              onClick={() => !isEditing && onSelect(board.id)}
              onDoubleClick={() => startRename(board.id)}
              onContextMenu={(e) => handleContextMenu(e, board.id)}
              draggable={!isEditing}
              onDragStart={(e) => handleDragStart(e, board.id)}
              onDragEnd={handleDragEnd}
              onDragOver={(e) => handleDragOver(e, board.id)}
              onDrop={(e) => handleDrop(e, board.id)}
              title={isEditing ? '' : `${board.name}${isUnsaved ? ' (unsaved)' : ''}`}
            >
              <FileIcon size={12} className="board-tab-icon" />

              {isEditing ? (
                <input
                  ref={editRef}
                  className="board-tab-input"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={handleKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  maxLength={50}
                />
              ) : (
                <span className="board-tab-name">{board.name}</span>
              )}

              {isUnsaved && !isEditing && (
                <span className="board-tab-unsaved" title="Unsaved" />
              )}

              {!isEditing && boards.length > 1 && (
                <button
                  className="board-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete && onDelete(board.id)
                  }}
                  aria-label={`Close ${board.name}`}
                  title="Close board"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          )
        })}
      </div>

      <button
        className="board-tab board-tab-add"
        onClick={onNew}
        aria-label="New board"
        id="new-board-btn"
        title="New board"
      >
        <Plus size={14} />
      </button>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="board-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="board-context-item"
            onClick={() => startRename(contextMenu.boardId)}
          >
            <Pencil size={13} />
            Rename
          </button>
          {onDuplicate && (
            <button
              className="board-context-item"
              onClick={() => {
                onDuplicate(contextMenu.boardId)
                setContextMenu(null)
              }}
            >
              <Copy size={13} />
              Duplicate
            </button>
          )}
          <div className="board-context-divider" />
          <button
            className="board-context-item board-context-danger"
            onClick={() => {
              onDelete && onDelete(contextMenu.boardId)
              setContextMenu(null)
            }}
          >
            <Trash2 size={13} />
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
