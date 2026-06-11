import { Plus, FileIcon } from 'lucide-react'

/**
 * Board tab bar for managing multiple saved whiteboards.
 * @param {Array} boards - List of board objects
 * @param {string} activeId - Currently active board ID
 * @param {function} onSelect - Board selection handler
 * @param {function} onNew - New board handler
 */
export default function BoardList({ boards = [], activeId, onSelect, onNew }) {
  return (
    <div className="board-list-bar" id="board-list">
      {boards.map((board) => (
        <button
          key={board.id}
          className={`board-tab${board.id === activeId ? ' active' : ''}`}
          onClick={() => onSelect(board.id)}
        >
          <FileIcon size={12} />
          {board.name}
        </button>
      ))}

      <button
        className="board-tab board-tab-add"
        onClick={onNew}
        aria-label="New board"
        id="new-board-btn"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
