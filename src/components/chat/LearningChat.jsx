import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Send, Sparkles, Copy, Check, Trash2, GitCommit,
  Plus, ChevronDown, Edit2, X,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import useAppStore from '../../stores/appStore'
import { chatApi } from '../../utils/api'

// ─── Session storage ──────────────────────────────────────────────────────────
const SESSIONS_KEY = 'toolbox_learning_sessions'
const CURRENT_KEY  = 'toolbox_learning_current'
const MAX_MESSAGES = 120

function loadSessions() {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) return parsed
    }
  } catch { /* ignore */ }
  return {}
}

function saveSessions(sessions) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
  } catch { /* ignore */ }
}

function loadCurrentId() {
  try { return localStorage.getItem(CURRENT_KEY) || null } catch { return null }
}

function saveCurrentId(id) {
  try { localStorage.setItem(CURRENT_KEY, id) } catch { /* ignore */ }
}

function makeSession(name) {
  return {
    id: `session-${Date.now()}`,
    name: name || `Session ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    createdAt: new Date().toISOString(),
    messages: [],
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
  }
  return (
    <button onClick={handleCopy} title={copied ? 'Copied!' : 'Copy'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}>
      {copied ? <Check size={13} style={{ color: 'var(--color-success, #22c55e)' }} /> : <Copy size={13} />}
    </button>
  )
}

function MdContent({ text }) {
  if (!text) return null
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      pre: (p) => { const r = { ...p }; delete r.node; return <pre {...r} /> },
      code: (p) => { const r = { ...p }; delete r.node; return <code {...r} /> },
      strong: (p) => { const r = { ...p }; delete r.node; return <strong {...r} /> },
      h3: (p) => { const r = { ...p }; delete r.node; return <h3 {...r} /> },
    }}>
      {text}
    </ReactMarkdown>
  )
}

const STARTER_PROMPTS = [
  'Explain consistent hashing with a concrete example and when I should use it',
  'Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale',
  'How do circuit breakers work and what are the most common misconfiguration mistakes?',
  'Explain the CAP theorem — which real systems sacrifice C vs A and why?',
  'Compare Kafka, RabbitMQ, and SQS: when does each shine?',
  'What separates a Senior from a Principal answer in a system design interview?',
]

const LEARN_SYSTEM_CONTEXT =
  'You are an expert system design interview coach. Help the user study deeply through explanation, examples, analogies, and Socratic questioning. Correct misconceptions, surface edge cases, and highlight what separates good from great interview answers. Be concise but thorough. Format responses clearly with markdown.'

// ─── Session Picker Dropdown ──────────────────────────────────────────────────
function SessionPicker({ sessions, currentId, onSelect, onCreate, onRename, onDelete }) {
  const [open, setOpen] = useState(false)
  const [renamingId, setRenamingId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const dropRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = sessions[currentId]
  const sortedIds = Object.keys(sessions).sort(
    (a, b) => new Date(sessions[b].createdAt) - new Date(sessions[a].createdAt)
  )

  const startRename = (id, name, e) => {
    e.stopPropagation()
    setRenamingId(id)
    setRenameVal(name)
  }

  const commitRename = (id) => {
    if (renameVal.trim()) onRename(id, renameVal.trim())
    setRenamingId(null)
  }

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="session-picker-btn"
        id="session-picker-btn"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
          background: 'var(--color-bg-tertiary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          padding: '4px 10px',
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
          minWidth: 240, maxWidth: 300,
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

// ─── Main Component ───────────────────────────────────────────────────────────
/**
 * LearningChat — full-page AI chat with named, per-session history.
 * Sessions are persisted in localStorage.
 *
 * @param {string|null} seedPrompt - Fires this prompt on mount/change (from to-do clicks)
 * @param {Function} onCommitClick - Called with current session messages
 */
export default function LearningChat({ seedPrompt, onCommitClick }) {
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)

  // Sessions state
  const [sessions, setSessions] = useState(() => {
    const all = loadSessions()
    // Bootstrap: if no sessions exist, create the first one
    if (Object.keys(all).length === 0) {
      const first = makeSession()
      return { [first.id]: first }
    }
    return all
  })

  const [currentId, setCurrentId] = useState(() => {
    const saved = loadCurrentId()
    const all = loadSessions()
    if (saved && all[saved]) return saved
    // Fall back to most recent session
    const ids = Object.keys(all).sort((a, b) => new Date(all[b]?.createdAt) - new Date(all[a]?.createdAt))
    return ids[0] || null
  })

  // Derive current session
  const currentSession = sessions[currentId] || null
  const messages = currentSession?.messages || []

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)
  const seedFiredRef = useRef(null) // track which seed prompt has been fired

  // Persist sessions whenever they change
  useEffect(() => { saveSessions(sessions) }, [sessions])
  useEffect(() => { if (currentId) saveCurrentId(currentId) }, [currentId])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Update messages for current session
  const setMessages = useCallback((updaterOrMessages) => {
    setSessions((prev) => {
      const session = prev[currentId]
      if (!session) return prev
      const newMessages = typeof updaterOrMessages === 'function'
        ? updaterOrMessages(session.messages)
        : updaterOrMessages
      return {
        ...prev,
        [currentId]: {
          ...session,
          messages: newMessages.slice(-MAX_MESSAGES),
        },
      }
    })
  }, [currentId])

  const handleSend = useCallback(async (customText) => {
    const text = typeof customText === 'string' ? customText.trim() : input.trim()
    if (!text || isLoading) return

    const userMessage = { role: 'user', content: text }
    const newMessages = [...messages, userMessage]
    setMessages(newMessages)
    if (typeof customText !== 'string') setInput('')
    setIsLoading(true)
    setErrorMsg(null)

    try {
      const aiPlaceholder = { role: 'ai', content: '' }
      setMessages([...newMessages, aiPlaceholder])

      const fullText = await chatApi.stream(
        { message: text, context: LEARN_SYSTEM_CONTEXT, history: messages, model: selectedModel },
        (partialText) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', content: partialText }
            return updated
          })
        }
      )

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'ai', content: fullText }
        return updated
      })
    } catch (err) {
      setErrorMsg(err.message)
      setMessages([...newMessages, { role: 'ai', content: `Error: ${err.message}. Please check your API key in Settings.` }])
    } finally {
      setIsLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, isLoading, messages, selectedModel, setMessages])

  // Fire seed prompt when it changes (from to-do panel clicks)
  useEffect(() => {
    if (seedPrompt && seedPrompt !== seedFiredRef.current && !isLoading) {
      seedFiredRef.current = seedPrompt
      const t = setTimeout(() => handleSend(seedPrompt), 150)
      return () => clearTimeout(t)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedPrompt])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  // ── Session management ──────────────────────────────────────────────────────
  const createSession = useCallback((name) => {
    const s = makeSession(name)
    setSessions((prev) => ({ ...prev, [s.id]: s }))
    setCurrentId(s.id)
    setInput('')
    setErrorMsg(null)
    addToast({ type: 'info', message: `Started "${s.name}"` })
  }, [addToast])

  const switchSession = useCallback((id) => {
    setCurrentId(id)
    setInput('')
    setErrorMsg(null)
  }, [])

  const renameSession = useCallback((id, name) => {
    setSessions((prev) => prev[id] ? { ...prev, [id]: { ...prev[id], name } } : prev)
  }, [])

  const deleteSession = useCallback((id) => {
    setSessions((prev) => {
      const next = { ...prev }
      delete next[id]
      // If we deleted the active session, switch to the most recent remaining one
      if (id === currentId) {
        const remaining = Object.keys(next).sort((a, b) => new Date(next[b]?.createdAt) - new Date(next[a]?.createdAt))
        if (remaining.length > 0) {
          setCurrentId(remaining[0])
        } else {
          // Create a fresh session so there's always at least one
          const fresh = makeSession()
          next[fresh.id] = fresh
          setCurrentId(fresh.id)
        }
      }
      return next
    })
  }, [currentId])

  const clearCurrentSession = useCallback(() => {
    setMessages([])
    setErrorMsg(null)
  }, [setMessages])

  const aiMessages = messages.filter((m) => m.role === 'ai' && m.content.trim().length > 0)

  return (
    <div className="learning-chat" id="learning-chat">
      {/* ── Header ── */}
      <div className="learning-chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0 }}>
          <span className="ai-dot" />
          <Sparkles size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <SessionPicker
            sessions={sessions}
            currentId={currentId}
            onSelect={switchSession}
            onCreate={() => createSession()}
            onRename={renameSession}
            onDelete={deleteSession}
          />
          {messages.length > 0 && (
            <span style={{
              fontSize: '10px', color: 'var(--color-text-tertiary)',
              background: 'var(--color-bg-tertiary)', padding: '1px 7px',
              borderRadius: 'var(--radius-full)', flexShrink: 0,
            }}>
              {messages.length} msg
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {aiMessages.length > 0 && (
            <button
              className="btn btn-primary"
              style={{ fontSize: 'var(--text-xs)', padding: '5px 12px', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
              onClick={() => onCommitClick?.(messages)}
              id="commit-to-guide-btn"
            >
              <GitCommit size={13} />
              Commit to Guide
            </button>
          )}
          {messages.length > 0 && (
            <button
              onClick={clearCurrentSession}
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}
              title="Clear this session's messages"
            >
              <X size={12} />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="learning-chat-messages" id="learning-chat-messages">
        {messages.length === 0 && (
          <div className="learning-chat-empty">
            <div style={{ textAlign: 'center', marginBottom: 'var(--space-6)' }}>
              <div style={{
                width: 48, height: 48, borderRadius: '50%',
                background: 'var(--color-accent-subtle)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                margin: '0 auto var(--space-3)',
              }}>
                <Sparkles size={22} style={{ color: 'var(--color-accent)' }} />
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-md)', marginBottom: 'var(--space-1)' }}>
                {apiKeyConfigured ? currentSession?.name || 'New Session' : 'Configure API Key First'}
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', maxWidth: 340, margin: '0 auto' }}>
                {apiKeyConfigured
                  ? 'Ask deep questions, explore concepts, then commit insights to the guide.'
                  : 'Add your Gemini API key in Settings to start studying with AI.'}
              </div>
            </div>

            {apiKeyConfigured && (
              <div className="learning-starter-prompts">
                {STARTER_PROMPTS.map((p, i) => (
                  <button key={i} className="learning-starter-btn" onClick={() => handleSend(p)}>{p}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`learning-message ${msg.role}`} data-role={msg.role}>
            <div className={`learning-message-avatar ${msg.role}`}>
              {msg.role === 'ai' ? '✦' : 'U'}
            </div>
            <div className="learning-message-body">
              <div className="learning-message-text"><MdContent text={msg.content} /></div>
              {msg.role === 'ai' && msg.content && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-1)' }}>
                  <CopyButton text={msg.content} />
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="learning-message ai">
            <div className="learning-message-avatar ai">✦</div>
            <div className="learning-message-body">
              <div className="bounced-dots" style={{ display: 'flex', gap: 4, padding: '4px 0' }}>
                <span className="dot" /><span className="dot" /><span className="dot" />
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div style={{ margin: 'var(--space-2) var(--space-4)', padding: 'var(--space-3)', background: 'rgba(239,68,68,0.1)', color: 'var(--color-error)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-xs)' }}>
            {errorMsg}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="learning-chat-input-area">
        <div className="learning-chat-input-wrapper">
          <textarea
            ref={inputRef}
            className="learning-chat-input"
            placeholder="Ask a question, explore a concept, request examples..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            id="learning-chat-input"
          />
          <button
            className="chat-send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
          >
            <Send size={15} />
          </button>
        </div>
        <div style={{ textAlign: 'center', fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>
          Enter to send · Shift+Enter for new line · Sessions saved automatically
        </div>
      </div>
    </div>
  )
}
