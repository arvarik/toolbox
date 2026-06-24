import { useState, useRef, useEffect, useCallback, useMemo, memo } from 'react'
import {
  Send, Sparkles, Copy, Check, Trash2, GitCommit,
  Plus, ChevronDown, Edit2, X, RotateCcw, Square, Map, Layers, MoreHorizontal
} from 'lucide-react'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import FlashcardReviewModal from '../shared/FlashcardReviewModal'
import useAppStore from '../../stores/appStore'
import { chatApi, guideContentApi } from '../../utils/api'
import { BLUEPRINT_SECTIONS } from '../../utils/constants'

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

function makeSession(name, topicContext) {
  return {
    id: `session-${Date.now()}`,
    name: name || `Session ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    createdAt: new Date().toISOString(),
    messages: [],
    // Topic binding for intelligent commit (null if unbound)
    pillarId: topicContext?.pillarId || null,
    topicId: topicContext?.topicId || null,
    topicName: topicContext?.topicName || null,
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

const MdContent = memo(function MdContent({ text }) {
  if (!text) return null
  return <MarkdownRenderer content={text} />
})

const STARTER_PROMPTS = [
  'Explain consistent hashing with a concrete example and when I should use it',
  'Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale',
  'How do circuit breakers work and what are the most common misconfiguration mistakes?',
  'Explain the CAP theorem — which real systems sacrifice C vs A and why?',
  'Compare Kafka, RabbitMQ, and SQS: when does each shine?',
  'What separates a Senior from a Principal answer in a system design interview?',
]

const PERSONAS = {
  socratic: {
    id: 'socratic',
    name: 'Socratic Tutor',
    icon: '💡',
    context: 'You are an expert system design interview coach. Help the user study deeply through explanation, examples, analogies, and Socratic questioning. Correct misconceptions, surface edge cases, and highlight what separates good from great interview answers. Be concise but thorough. Format responses clearly with markdown.',
    steeringStyle: 'When the current topic is exhausted or there is a natural pause, smoothly transition by asking a thought-provoking Socratic question about the next uncovered section. For example: "Now that we understand X, what do you think would happen if we considered Y?" or "How would this change if we looked at it from the perspective of [next section]?" Only introduce ONE new section at a time.'
  },
  eli5: {
    id: 'eli5',
    name: 'Explain Like I\'m 5',
    icon: '🧸',
    context: 'You are an expert tutor. Explain concepts using extremely simple language, every-day analogies (like Legos, pizza delivery, water pipes), and avoid jargon entirely. Break down complex system design topics so a 5-year-old could intuitively understand the core mechanics.',
    steeringStyle: 'When the current topic is exhausted, gently introduce the next uncovered section with a fun analogy or story. For example: "Great, you understand X! Now imagine you had a lemonade stand and needed to handle [next section concept]..." Only introduce ONE new section at a time. Keep it playful.'
  },
  gordon: {
    id: 'gordon',
    name: 'Strict',
    icon: '🔥',
    context: 'You are a highly demanding, intense, and strict engineering manager. You speak directly, concisely, and with a sense of urgency. You do not tolerate fluff or buzzwords. Point out flaws in the user\'s reasoning immediately, demand precision, but remain deeply educational and ensure they actually learn the right way to build systems.',
    steeringStyle: 'When the current topic is exhausted, firmly direct the user to the next uncovered section. For example: "Alright, you\'ve got a handle on X. But you haven\'t said a WORD about [next section]. Explain it. Now." Be direct and demanding but educational. Only move to ONE new section at a time.'
  },
  devil: {
    id: 'devil',
    name: "Devil's Advocate",
    icon: '👿',
    context: 'You are a ruthless technical critic and debate simulator. Whatever the user proposes, you politely but aggressively disagree and poke holes in their logic, scalability, or fault-tolerance. Force the user to defend their architectural choices vigorously. This is for interview prep, so be rigorous.',
    steeringStyle: 'When the current topic is exhausted, challenge the user about their gaps: "You\'ve been suspiciously silent about [next section]. What happens when [failure scenario related to that section]? I bet your design falls apart." Provoke them into exploring the uncovered section. Only raise ONE new section at a time.'
  }
}

// ─── Persona Picker Dropdown ──────────────────────────────────────────────────
function PersonaPicker({ activeId, onSelect }) {
  const [open, setOpen] = useState(false)
  const dropRef = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const current = PERSONAS[activeId]

  return (
    <div ref={dropRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="persona-picker-btn"
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          background: 'var(--color-bg-secondary)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-full)',
          padding: '4px 12px',
          cursor: 'pointer', color: 'var(--color-text-primary)',
          fontSize: 'var(--text-xs)', fontWeight: 600,
          transition: 'border-color 0.2s',
        }}
        title="Change AI Persona"
      >
        <span>{current?.icon}</span>
        <span className="hide-on-mobile" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {current?.name}
        </span>
        <ChevronDown size={12} className="hide-on-mobile" style={{ flexShrink: 0, opacity: 0.6 }} />
      </button>

      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', right: 0,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          minWidth: 200, zIndex: 200, overflow: 'hidden',
          display: 'flex', flexDirection: 'column'
        }}>
          {Object.values(PERSONAS).map(p => (
            <button
              key={p.id}
              onClick={() => { onSelect(p.id); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-3) var(--space-4)',
                background: p.id === activeId ? 'var(--color-accent-subtle)' : 'transparent',
                border: 'none', borderBottom: '1px solid var(--color-border)',
                cursor: 'pointer', textAlign: 'left',
                color: p.id === activeId ? 'var(--color-accent)' : 'var(--color-text-primary)',
                fontSize: 'var(--text-sm)', fontWeight: p.id === activeId ? 600 : 400
              }}
              onMouseEnter={(e) => { if (p.id !== activeId) e.currentTarget.style.background = 'var(--color-bg-hover)' }}
              onMouseLeave={(e) => { if (p.id !== activeId) e.currentTarget.style.background = 'transparent' }}
            >
              <span>{p.icon}</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

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
 * @param {Object|null} activeTopic - {pillar, topic} from LearningTodo. Fetches dynamic starters.
 * @param {Function} onCommitClick - Called with current session messages
 */
export default function LearningChat({ activeTopic, onCommitClick }) {
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
    if (saved && sessions[saved]) return saved
    // Fall back to most recent session
    const ids = Object.keys(sessions).sort((a, b) => new Date(sessions[b]?.createdAt) - new Date(sessions[a]?.createdAt))
    return ids[0] || null
  })

  // Derive current session
  const currentSession = sessions[currentId] || null
  const emptyMessages = useMemo(() => [], [])
  const messages = currentSession?.messages || emptyMessages

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const [starters, setStarters] = useState(STARTER_PROMPTS)
  const [loadingStarters, setLoadingStarters] = useState(false)
  const [generatingMap, setGeneratingMap] = useState(false)
  const [personaId, setPersonaId] = useState('socratic')

  // Section status for smart steering: { completedSections: string[], emptySections: string[] }
  const [sectionStatus, setSectionStatus] = useState(null)

  // Flashcards state
  const [popupState, setPopupState] = useState(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [generatedCards, setGeneratedCards] = useState([])
  const [isGeneratingCards, setIsGeneratingCards] = useState(false)

  const messagesEndRef = useRef(null)
  const messagesContainerRef = useRef(null)
  const inputRef = useRef(null)
  const abortControllerRef = useRef(null)

  const currentIdRef = useRef(currentId)
  useEffect(() => { currentIdRef.current = currentId }, [currentId])
  const sessionsRef = useRef(sessions)
  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  const activeTopicIdRef = useRef(activeTopic?.topic?.id)

  // Persist sessions whenever they change
  useEffect(() => { saveSessions(sessions) }, [sessions])
  useEffect(() => { if (currentId) saveCurrentId(currentId) }, [currentId])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Keep scroll pinned to bottom on container resize (e.g. input auto-grow, window resize)
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container) return

    let lastScrollHeight = container.scrollHeight
    let lastClientHeight = container.clientHeight

    const handleResize = () => {
      const scrollOffset = lastScrollHeight - container.scrollTop - lastClientHeight
      const wasAtBottom = scrollOffset < 30

      if (wasAtBottom) {
        container.style.scrollBehavior = 'auto'
        container.scrollTop = container.scrollHeight - container.clientHeight
        container.offsetHeight // Force layout reflow
        container.style.scrollBehavior = 'smooth'
      }

      lastScrollHeight = container.scrollHeight
      lastClientHeight = container.clientHeight
    }

    const observer = new ResizeObserver(handleResize)
    observer.observe(container)

    return () => observer.disconnect()
  }, [])

  // Focus input on mount
  useEffect(() => { inputRef.current?.focus() }, [])

  // Handle text selection for flashcard generation (works on both desktop mouseup and mobile touch selection)
  const checkSelection = useCallback((e) => {
    if (e?.target?.closest?.('#flashcard-popup') || e?.target?.closest?.('input') || e?.target?.closest?.('textarea') || e?.target?.closest?.('.flashcard-modal-ignore')) return

    const selection = window.getSelection()
    const text = selection.toString().trim()
    
    if (text.length > 10) {
      // Check if selection is within the chat messages area
      const anchor = selection.anchorNode
      const msgContainer = anchor?.parentElement?.closest?.('.learning-chat-messages')
      if (msgContainer) {
        const range = selection.getRangeAt(0)
        const rect = range.getBoundingClientRect()
        setPopupState({
          text,
          top: Math.max(10, rect.top - 48),
          left: Math.min(Math.max(80, rect.left + rect.width / 2), window.innerWidth - 80),
        })
        return
      }
    }
    setPopupState(null)
  }, [])

  useEffect(() => {
    // Desktop: mouseup
    document.addEventListener('mouseup', checkSelection)
    
    // Mobile: selectionchange (fires when user finishes selecting text via touch)
    let selectionTimer = null
    const handleSelectionChange = () => {
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => checkSelection(null), 300)
    }
    document.addEventListener('selectionchange', handleSelectionChange)
    
    return () => {
      document.removeEventListener('mouseup', checkSelection)
      document.removeEventListener('selectionchange', handleSelectionChange)
      clearTimeout(selectionTimer)
    }
  }, [checkSelection])

  const handleGenerateAdHocFlashcard = async () => {
    if (!popupState?.text) return
    setIsGeneratingCards(true)
    const textToGen = popupState.text
    setPopupState(null)
    
    try {
      const topicName = activeTopic?.topic?.name || currentSession?.topicName

      // Build session context from recent messages for more informed card generation
      let sessionContext = ''
      if (messages.length > 0) {
        const recentMsgs = messages.slice(-4)
        sessionContext = recentMsgs
          .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content.slice(0, 300)}`)
          .join('\n')
      }

      const res = await chatApi.generateFlashcards({ text: textToGen, topicName, model: selectedModel, sessionContext })
      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({ type: 'info', message: 'No flashcards could be generated from that selection.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to generate flashcard.' })
    } finally {
      setIsGeneratingCards(false)
    }
  }

  const handleGenerateSessionFlashcards = async () => {
    if (messages.length === 0 || isGeneratingCards) return
    setIsGeneratingCards(true)
    
    try {
      const topicName = activeTopic?.topic?.name || currentSession?.topicName
      
      const fullSessionText = messages
        .filter(m => m.content.trim().length > 0)
        .map(m => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
        .join('\n\n')

      const res = await chatApi.generateFlashcards({ 
        text: fullSessionText, 
        topicName, 
        model: selectedModel, 
        sessionContext: '' // The text itself is the session context
      })
      
      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({ type: 'info', message: 'No flashcards could be generated from this session.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err.message || 'Failed to generate flashcards.' })
    } finally {
      setIsGeneratingCards(false)
    }
  }

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

  const handleSend = useCallback(async (customText, overrideHistory = null) => {
    const text = typeof customText === 'string' ? customText.trim() : input.trim()
    if (!text || isLoading) return

    const currentHistory = overrideHistory || messages
    const currentPersonaObj = PERSONAS[personaId]
    const userMessage = { role: 'user', content: text, model: selectedModel, persona: currentPersonaObj }
    const newMessages = [...currentHistory, userMessage]
    setMessages(newMessages)
    if (typeof customText !== 'string') setInput('')
    setIsLoading(true)
    setErrorMsg(null)

    try {
      const aiPlaceholder = { role: 'ai', content: '', model: selectedModel, persona: currentPersonaObj }
      setMessages([...newMessages, aiPlaceholder])

      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal

      // Build persona context with section steering awareness
      let currentPersona = currentPersonaObj.context
      if (sectionStatus && (sectionStatus.emptySections.length > 0 || sectionStatus.completedSections.length > 0)) {
        const topicName = currentSession?.topicName || activeTopic?.topic?.name || 'this topic'
        currentPersona += `\n\n[STUDY SESSION CONTEXT]\nThe student is studying: "${topicName}".`
        if (sectionStatus.completedSections.length > 0) {
          currentPersona += `\nSections already covered in their guide (they have notes on these): ${sectionStatus.completedSections.join(', ')}.`
        }
        if (sectionStatus.emptySections.length > 0) {
          currentPersona += `\nSections NOT yet covered (empty, no notes): ${sectionStatus.emptySections.join(', ')}.`
          currentPersona += `\n\n[STEERING INSTRUCTION]\n${currentPersonaObj.steeringStyle || 'When the current topic is exhausted, naturally guide the conversation toward the first uncovered section. Only introduce ONE new section at a time.'}`
          currentPersona += `\nIMPORTANT: Do NOT dump all uncovered sections at once. Address them naturally, one at a time, as the conversation flows. Always respond to the user's immediate question first, then steer if appropriate.`
        }
      }

      const fullText = await chatApi.stream(
        { message: text, context: currentPersona, history: currentHistory, model: selectedModel },
        (partialText) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', content: partialText, model: selectedModel, persona: currentPersonaObj }
            return updated
          })
        },
        null,
        signal
      )

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'ai', content: fullText, model: selectedModel, persona: currentPersonaObj }
        return updated
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorMsg(err.message)
      setMessages([...newMessages, { role: 'ai', content: `Error: ${err.message}. Please check your API key in Settings.` }])
    } finally {
      setIsLoading(false)
    }
     
  }, [input, isLoading, messages, selectedModel, setMessages, personaId, sectionStatus, activeTopic, currentSession])

  // Handle activeTopic changes (from to-do panel clicks)
  useEffect(() => {
    if (!activeTopic) {
      setTimeout(() => setStarters(STARTER_PROMPTS), 0)
      return
    }

    const currId = currentIdRef.current
    const session = sessionsRef.current[currId]

    // Switch to a fresh session for this topic if the current one is in use
    const topicCtx = {
      pillarId: activeTopic.pillar.id,
      topicId: activeTopic.topic.id,
      topicName: activeTopic.topic.name,
    }
    
    // Only recreate/rename session if the topic actually changed
    if (activeTopicIdRef.current !== activeTopic.topic.id) {
      activeTopicIdRef.current = activeTopic.topic.id
      setTimeout(() => {
        if (session && session.messages.length > 0) {
          const s = makeSession(`Study: ${activeTopic.topic.name}`, topicCtx)
          setSessions((prev) => ({ ...prev, [s.id]: s }))
          setCurrentId(s.id)
        } else if (session) {
          setSessions((prev) => ({ ...prev, [currId]: {
            ...session,
            name: `Study: ${activeTopic.topic.name}`,
            pillarId: topicCtx.pillarId,
            topicId: topicCtx.topicId,
            topicName: topicCtx.topicName,
          } }))
        }
      }, 0)
    }

    // Fetch section status for smart persona steering
    const pillarSections = BLUEPRINT_SECTIONS[activeTopic.pillar.id] || []
    if (pillarSections.length > 0) {
      guideContentApi.getForTopic(activeTopic.pillar.id, activeTopic.topic.id)
        .then((data) => {
          const completed = []
          const empty = []
          pillarSections.forEach((sec) => {
            if (data?.[sec.id]?.content?.trim()) {
              completed.push(sec.name)
            } else {
              empty.push(sec.name)
            }
          })
          setSectionStatus({ completedSections: completed, emptySections: empty })
        })
        .catch(() => setSectionStatus(null))
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSectionStatus(null)
    }

    let active = true
    setTimeout(() => setLoadingStarters(true), 0)
    fetch(`/api/chat/starters?pillarId=${activeTopic.pillar.id}&topicId=${activeTopic.topic.id}&topicName=${encodeURIComponent(activeTopic.topic.name)}&model=${selectedModel}`, { cache: 'no-store' })
      .then(res => res.json())
      .then(data => {
        if (active && data.suggestions) {
          setStarters(data.suggestions)
        }
      })
      .catch(err => console.error('Failed to fetch starters', err))
      .finally(() => { if (active) setLoadingStarters(false) })

    return () => { active = false }
  }, [activeTopic, selectedModel])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
    }
  }

  const handleRetry = (index) => {
    const userMsg = messages[index]
    if (userMsg && userMsg.role === 'user') {
      const newHistory = messages.slice(0, index)
      setMessages(newHistory)
      // Pass newHistory directly to bypass closure trap
      setTimeout(() => handleSend(userMsg.content, newHistory), 50)
    }
  }

  const handleGenerateConceptMap = async () => {
    if (messages.length < 2 || generatingMap) return
    setGeneratingMap(true)
    setErrorMsg(null)

    try {
      const { response } = await chatApi.generateConceptMap({ history: messages, model: selectedModel })
      setMessages((prev) => [...prev, { role: 'ai', content: `Here's a concept map summarizing what we just discussed:\n\n${response}` }])
    } catch (err) {
      setErrorMsg(`Failed to generate concept map: ${err.message}`)
    } finally {
      setGeneratingMap(false)
    }
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

  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef(null)

  useEffect(() => {
    const handler = (e) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
        setShowActionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const aiMessages = messages.filter((m) => m.role === 'ai' && m.content.trim().length > 0)

  return (
    <div className="learning-chat" id="learning-chat">
      {/* ── Header ── */}
      <div className="learning-chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1, minWidth: 0 }}>
          <span className="ai-dot hide-on-mobile" />
          <Sparkles size={14} className="hide-on-mobile" style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <SessionPicker
            sessions={sessions}
            currentId={currentId}
            onSelect={switchSession}
            onCreate={() => createSession()}
            onRename={renameSession}
            onDelete={deleteSession}
          />
          <PersonaPicker activeId={personaId} onSelect={setPersonaId} />
          {messages.length > 0 && (
            <span className="hide-on-mobile" style={{
              fontSize: '10px', color: 'var(--color-text-tertiary)',
              background: 'var(--color-bg-tertiary)', padding: '1px 7px',
              borderRadius: 'var(--radius-full)', flexShrink: 0,
            }}>
              {messages.length} msg
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
          {messages.length >= 4 && (
            <div style={{ position: 'relative' }} ref={actionsMenuRef}>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setShowActionsMenu(p => !p)}
                title="More Actions"
                aria-label="More Actions"
              >
                <MoreHorizontal size={16} />
              </button>
              {showActionsMenu && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                  background: 'var(--color-surface)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  minWidth: 180, zIndex: 100,
                  display: 'flex', flexDirection: 'column',
                  overflow: 'hidden'
                }}>
                  <button
                    className="dropdown-item"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 16px', border: 'none', background: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)',
                      opacity: generatingMap ? 0.5 : 1
                    }}
                    onClick={() => {
                      setShowActionsMenu(false)
                      handleGenerateConceptMap()
                    }}
                    disabled={generatingMap}
                  >
                    <Map size={14} style={{ animation: generatingMap ? 'spin 2s linear infinite' : 'none' }} />
                    {generatingMap ? 'Generating Map...' : 'Generate Map'}
                  </button>
                  <button
                    className="dropdown-item"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 16px', border: 'none', background: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)',
                      opacity: isGeneratingCards ? 0.5 : 1
                    }}
                    onClick={() => {
                      setShowActionsMenu(false)
                      handleGenerateSessionFlashcards()
                    }}
                    disabled={isGeneratingCards}
                  >
                    <Layers size={14} style={{ animation: isGeneratingCards ? 'spin 2s linear infinite' : 'none' }} />
                    {isGeneratingCards ? 'Generating Cards...' : 'Generate Flashcards'}
                  </button>
                </div>
              )}
            </div>
          )}
          {aiMessages.length > 0 && (
            <button
              className="btn btn-primary"
              style={{
                fontSize: 'var(--text-xs)', padding: '5px 12px',
                display: 'flex', alignItems: 'center', gap: 'var(--space-1)',
                opacity: currentSession?.pillarId ? 1 : 0.5,
              }}
              onClick={() => onCommitClick?.(messages, {
                pillarId: currentSession?.pillarId,
                topicId: currentSession?.topicId,
                topicName: currentSession?.topicName,
              })}
              disabled={!currentSession?.pillarId}
              title={currentSession?.pillarId
                ? `Commit session to ${currentSession.topicName} guide`
                : 'Start a session from the Study Plan to enable commit'
              }
              id="commit-to-guide-btn"
            >
              <GitCommit size={13} />
              <span className="hide-on-mobile">Commit to Guide</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Popups and Modals ── */}
      {popupState && (
        <div
          id="flashcard-popup"
          className="flashcard-modal-ignore"
          style={{
            position: 'fixed',
            top: popupState.top,
            left: popupState.left,
            transform: 'translateX(-50%)',
            zIndex: 100,
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
            borderRadius: 'var(--radius-lg)',
            padding: '6px',
            display: 'flex',
            gap: '4px'
          }}
        >
          <button
            className="btn btn-primary btn-sm"
            style={{ fontSize: '12px', padding: '8px 12px', minHeight: 36, whiteSpace: 'nowrap' }}
            onClick={handleGenerateAdHocFlashcard}
            disabled={isGeneratingCards}
          >
            {isGeneratingCards ? (
               <Sparkles size={14} style={{ marginRight: 4, animation: 'pulse 1.5s infinite' }} />
            ) : (
               <Layers size={14} style={{ marginRight: 4 }} />
            )}
            {isGeneratingCards ? 'Generating...' : 'Make Flashcard'}
          </button>
        </div>
      )}

      <FlashcardReviewModal
        open={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        cards={generatedCards}
        topicName={activeTopic?.topic?.name || currentSession?.topicName}
        pillarId={activeTopic?.pillar?.id || currentSession?.pillarId}
        topicId={activeTopic?.topic?.id || currentSession?.topicId}
        onSaveSuccess={() => {
          // Toast is handled inside the modal
        }}
      />

      {/* ── Messages ── */}
      <div className="learning-chat-messages" id="learning-chat-messages" ref={messagesContainerRef}>
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
                {loadingStarters ? (
                  Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="learning-starter-btn" style={{ 
                      height: '36px', 
                      background: 'var(--color-bg-hover)', 
                      animation: 'pulse 1.5s ease-in-out infinite',
                      border: '1px solid transparent'
                    }} />
                  ))
                ) : (
                  starters.map((p, i) => (
                    <button key={i} className="learning-starter-btn" onClick={() => handleSend(p)}>{p}</button>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`learning-message ${msg.role}`} data-role={msg.role}>
            <div className={`learning-message-avatar ${msg.role}`}>
              {msg.role === 'ai' ? (msg.persona?.icon || '✦') : 'U'}
            </div>
            <div className="learning-message-body">
              {msg.role === 'ai' && msg.model && (
                <div style={{ fontSize: '10px', color: 'var(--color-text-tertiary)', marginBottom: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontWeight: 600 }}>{msg.persona?.name || 'AI'}</span>
                  <span style={{ opacity: 0.6 }}>•</span>
                  <span style={{ background: 'var(--color-bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>{msg.model}</span>
                </div>
              )}
              <div className="learning-message-text"><MdContent text={msg.content} /></div>
              {msg.role === 'ai' && msg.content && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-1)' }}>
                  <CopyButton text={msg.content} />
                </div>
              )}
              {msg.role === 'user' && !isLoading && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-1)' }}>
                  <button 
                    onClick={() => handleRetry(i)}
                    className="btn-ghost"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
                    title="Retry this prompt"
                  >
                    <RotateCcw size={13} />
                  </button>
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
      <div className="learning-chat-input-area" style={{ position: 'relative' }}>
        <div className="learning-chat-input-wrapper">
          {isLoading && (
            <button
              onClick={handleStop}
              style={{
                position: 'absolute',
                top: '-40px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '6px 12px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
              }}
            >
              <Square fill="currentColor" size={10} /> Stop generating
            </button>
          )}
          <textarea
            ref={inputRef}
            className="learning-chat-input"
            placeholder="Ask a question, explore a concept, request examples..."
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Auto-grow: reset height then set to scrollHeight
              const el = e.target
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 320) + 'px'
            }}
            onKeyDown={handleKeyDown}
            rows={2}
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
        <div className="learning-chat-help-text" style={{ textAlign: 'center', fontSize: '10px', color: 'var(--color-text-tertiary)', marginTop: 'var(--space-1)' }}>
          Enter to send · Shift+Enter for new line · Drag bottom-right to resize · Sessions saved automatically
        </div>
      </div>
    </div>
  )
}
