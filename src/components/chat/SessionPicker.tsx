import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { Plus, ChevronDown, Edit2, Trash2 } from 'lucide-react'
import type { PersonaDef } from './personas'

export interface ChatMessage {
  id?: string
  role: 'user' | 'ai'
  content: string
  model?: string
  persona?: PersonaDef
}

export interface ChatSession {
  id: string
  name: string
  createdAt: string
  messages: ChatMessage[]
  pillarId?: string | null
  topicId?: string | null
  topicName?: string | null
}

interface SessionPickerProps {
  sessions: Record<string, ChatSession>
  currentId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

/**
 * SessionPicker Dropdown — switches between, creates, renames, and deletes named chat sessions.
 */
export default function SessionPicker({
  sessions,
  currentId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: SessionPickerProps) {
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameVal, setRenameVal] = useState('')
  const dropRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && e.target instanceof Node && !dropRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = currentId ? sessions[currentId] : undefined
  const sortedIds = Object.keys(sessions).sort(
    (a, b) => new Date(sessions[b].createdAt).getTime() - new Date(sessions[a].createdAt).getTime(),
  )

  const startRename = (id: string, name: string, e: ReactMouseEvent) => {
    e.stopPropagation()
    setRenamingId(id)
    setRenameVal(name)
  }

  const commitRename = (id: string) => {
    if (renameVal.trim()) onRename(id, renameVal.trim())
    setRenamingId(null)
  }

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="session-picker-btn"
        id="session-picker-btn"
        aria-label={`Select chat session: ${current?.name || 'No session'}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '6px 10px',
          minHeight: 34,
          cursor: 'pointer', color: 'var(--color-text-primary)',
          fontSize: 'var(--text-xs)', fontWeight: 600,
          maxWidth: 200,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
          {current?.name || 'No session'}
        </span>
        <ChevronDown size={12} style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          minWidth: 'min(240px, calc(100vw - 24px))',
          maxWidth: 'min(300px, calc(100vw - 24px))',
          zIndex: 200,
          overflow: 'hidden',
        }}>
          {/* New session button */}
          <div style={{ padding: 'var(--space-2)', borderBottom: '1px solid var(--color-border)' }}>
            <button
              className="btn btn-primary"
              style={{ width: '100%', fontSize: 'var(--text-xs)', justifyContent: 'center' }}
              onClick={() => { onCreate(); setOpen(false) }}
              id="new-session-btn"
            >
              <Plus size={12} /> New Session
            </button>
          </div>

          {/* Session list */}
          <div style={{ maxHeight: 260, overflowY: 'auto' }}>
            {sortedIds.length === 0 && (
              <div style={{ padding: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', textAlign: 'center' }}>
                No sessions yet
              </div>
            )}
            {sortedIds.map((id) => {
              const s = sessions[id]
              const isActive = id === currentId
              return (
                <div
                  key={id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)',
                    background: isActive ? 'var(--color-accent-subtle)' : 'transparent',
                    cursor: 'pointer',
                    transition: 'background var(--duration-fast)',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-hover)' }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = 'transparent' }}
                >
                  {renamingId === id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(id); if (e.key === 'Escape') setRenamingId(null) }}
                      onBlur={() => commitRename(id)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        flex: 1, background: 'var(--color-bg-secondary)',
                        border: '1px solid var(--color-accent)', borderRadius: 'var(--radius-sm)',
                        padding: '2px 6px', fontSize: 'var(--text-xs)', color: 'var(--color-text-primary)',
                        outline: 'none',
                      }}
                    />
                  ) : (
                    <div
                      style={{ flex: 1, minWidth: 0 }}
                      onClick={() => { onSelect(id); setOpen(false) }}
                    >
                      <div style={{
                        fontSize: 'var(--text-xs)', fontWeight: isActive ? 600 : 400,
                        color: isActive ? 'var(--color-accent)' : 'var(--color-text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {s.name}
                      </div>
                      <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)' }}>
                        {s.messages.length} messages · {new Date(s.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                  )}

                  {renamingId !== id && (
                    <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                      <button
                        title="Rename"
                        onClick={(e) => startRename(id, s.name, e)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--color-text-tertiary)', borderRadius: 'var(--radius-sm)', display: 'flex' }}
                      >
                        <Edit2 size={11} />
                      </button>
                      {sortedIds.length > 1 && (
                        <button
                          title="Delete session"
                          onClick={(e) => { e.stopPropagation(); onDelete(id); if (open && sortedIds.length <= 1) setOpen(false) }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 3, color: 'var(--color-error)', borderRadius: 'var(--radius-sm)', display: 'flex' }}
                        >
                          <Trash2 size={11} />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
