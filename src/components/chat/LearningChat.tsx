import {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  memo,
  type KeyboardEvent,
} from 'react'
import {
  Send, Sparkles, Copy, Check, GitCommit,
  RotateCcw, Square, Map as MapIcon, Layers, MoreHorizontal, Calculator,
} from 'lucide-react'
import type { Pillar } from '../../../shared/kits/kitSkeleton'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import FlashcardReviewModal from '../shared/FlashcardReviewModal'
import Skeleton from '../shared/Skeleton'
import PersonaPicker from './PersonaPicker'
import { buildPersonasForKit, getStarterPromptsForKit, type PersonaId } from './personas'
import SessionPicker, { type ChatMessage, type ChatSession } from './SessionPicker'
import type { CommitTopicContext } from '../../stores/useCommitStore'
import useAppStore from '../../stores/appStore'
import { getActiveKitSlugForRequest, useActiveKit } from '../../stores/useKitStore'
import { chatApi, guideContentApi } from '../../utils/api'

// ─── Session storage (scoped per Kit slug) ────────────────────────────────────
const SESSIONS_KEY = 'toolbox_learning_sessions'
const CURRENT_KEY = 'toolbox_learning_current'
const MAX_MESSAGES = 120

function sessionsStorageKey(slug: string | null | undefined): string {
  return slug && slug !== 'system-design' ? `${SESSIONS_KEY}:${slug}` : SESSIONS_KEY
}

function currentStorageKey(slug: string | null | undefined): string {
  return slug && slug !== 'system-design' ? `${CURRENT_KEY}:${slug}` : CURRENT_KEY
}

function loadSessions(slug: string | null | undefined): Record<string, ChatSession> {
  try {
    const raw = localStorage.getItem(sessionsStorageKey(slug))
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        return parsed as Record<string, ChatSession>
      }
    }
  } catch { /* ignore */ }
  return {}
}

function saveSessions(slug: string | null | undefined, sessions: Record<string, ChatSession>): void {
  try {
    localStorage.setItem(sessionsStorageKey(slug), JSON.stringify(sessions))
  } catch { /* ignore */ }
}

function loadCurrentId(slug: string | null | undefined): string | null {
  try {
    return localStorage.getItem(currentStorageKey(slug)) || null
  } catch {
    return null
  }
}

function saveCurrentId(slug: string | null | undefined, id: string): void {
  try {
    localStorage.setItem(currentStorageKey(slug), id)
  } catch { /* ignore */ }
}

function makeSession(name?: string, topicContext?: Partial<CommitTopicContext>): ChatSession {
  return {
    id: `session-${Date.now()}`,
    name: name || `Session ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    createdAt: new Date().toISOString(),
    messages: [],
    pillarId: topicContext?.pillarId || null,
    topicId: topicContext?.topicId || null,
    topicName: topicContext?.topicName || null,
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch { /* ignore */ }
  }
  return (
    <button
      onClick={() => { void handleCopy() }}
      title={copied ? 'Copied!' : 'Copy'}
      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--color-text-muted)', display: 'flex', alignItems: 'center' }}
    >
      {copied ? <Check size={13} style={{ color: 'var(--color-success, #22c55e)' }} /> : <Copy size={13} />}
    </button>
  )
}

const MdContent = memo(function MdContent({ text }: { text: string }) {
  if (!text) return null
  return <MarkdownRenderer content={text} />
})

export interface ActiveStudyTopic {
  pillar: Pillar
  topic: Pillar['topics'][number]
}

interface GeneratedCard {
  front: string
  back: string
}

interface PopupState {
  text: string
  top: number
  left: number
}

interface SectionStatus {
  completedSections: string[]
  emptySections: string[]
}

interface LearningChatProps {
  activeTopic?: ActiveStudyTopic | null
  onCommitClick?: (messages: ChatMessage[], topicContext: CommitTopicContext | null) => void
  routeKitSlug?: string | null
}

/**
 * LearningChat — full-page AI chat with named, per-Kit session history.
 */
export default function LearningChat({ activeTopic, onCommitClick, routeKitSlug }: LearningChatProps) {
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)
  const { kit, kitSlug, skeleton, sectionsByPillar, capabilities, tutor } = useActiveKit()
  const effectiveKitSlug = routeKitSlug || kitSlug || getActiveKitSlugForRequest()
  const storageScope = effectiveKitSlug || 'system-design'
  const isCustomKit = Boolean(kit && skeleton.identity.slug !== 'system-design')

  const activePersonas = useMemo(
    () => buildPersonasForKit(tutor, isCustomKit),
    [tutor, isCustomKit],
  )
  const defaultStarters = useMemo(
    () => getStarterPromptsForKit(tutor, isCustomKit),
    [tutor, isCustomKit],
  )

  // Sessions state
  const [sessions, setSessions] = useState<Record<string, ChatSession>>({})
  const [currentId, setCurrentId] = useState<string | null>(null)
  const [loadedScope, setLoadedScope] = useState<string | null>(null)
  const isLoaded = loadedScope === storageScope

  // Derive current session
  const currentSession = currentId ? sessions[currentId] || null : null
  const emptyMessages = useMemo<ChatMessage[]>(() => [], [])
  const messages = currentSession?.messages || emptyMessages

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [starters, setStarters] = useState<string[]>(() => getStarterPromptsForKit(tutor, isCustomKit))
  const [loadingStarters, setLoadingStarters] = useState(false)
  const [generatingMap, setGeneratingMap] = useState(false)
  const [personaId, setPersonaId] = useState<PersonaId>('socratic')

  const [sectionStatus, setSectionStatus] = useState<SectionStatus | null>(null)

  // Flashcards state
  const [popupState, setPopupState] = useState<PopupState | null>(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [generatedCards, setGeneratedCards] = useState<GeneratedCard[]>([])
  const [isGeneratingCards, setIsGeneratingCards] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const currentIdRef = useRef(currentId)
  useEffect(() => { currentIdRef.current = currentId }, [currentId])
  const sessionsRef = useRef(sessions)
  useEffect(() => { sessionsRef.current = sessions }, [sessions])

  const activeTopicIdRef = useRef<string | undefined>(activeTopic?.topic?.id)

  // Load from API & migrate Kit-scoped local data if needed whenever active Kit changes
  useEffect(() => {
    let cancelled = false
    setLoadedScope(null)
    setSessions({})
    setCurrentId(null)
    setSectionStatus(null)
    setErrorMsg(null)
    activeTopicIdRef.current = undefined

    async function initSessions() {
      try {
        const backendSessions = ((await chatApi.getSessions()) || {}) as Record<string, ChatSession>
        if (cancelled) return
        const localSessions = loadSessions(storageScope)

        let needsMigration = false
        const toMigrate: Record<string, ChatSession> = {}
        for (const [id, s] of Object.entries(localSessions)) {
          if (!backendSessions[id]) {
            needsMigration = true
            toMigrate[id] = s
          }
        }

        let finalSessions: Record<string, ChatSession> = { ...backendSessions }
        if (needsMigration) {
          await chatApi.migrateBulk(toMigrate)
          if (cancelled) return
          finalSessions = ((await chatApi.getSessions()) || {}) as Record<string, ChatSession>
          if (cancelled) return
        }

        // Bootstrap if empty
        if (Object.keys(finalSessions).length === 0) {
          const first = makeSession()
          finalSessions = { [first.id]: first }
          await chatApi.saveSession(first)
          if (cancelled) return
        }

        setSessions(finalSessions)

        const saved = loadCurrentId(storageScope)
        if (saved && finalSessions[saved]) {
          setCurrentId(saved)
        } else {
          const ids = Object.keys(finalSessions).sort(
            (a, b) =>
              new Date(finalSessions[b]?.createdAt ?? 0).getTime() -
              new Date(finalSessions[a]?.createdAt ?? 0).getTime(),
          )
          setCurrentId(ids[0] ?? null)
        }
        setLoadedScope(storageScope)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to load chat sessions', err)
        addToast({ message: 'Error loading sessions', type: 'error' })
        setLoadedScope(storageScope)
      }
    }

    void initSessions()
    return () => { cancelled = true }
  }, [storageScope, addToast])

  // Persist sessions whenever they change (strictly gated on matching loadedScope)
  useEffect(() => {
    if (!isLoaded) return
    saveSessions(storageScope, sessions)

    const timer = setTimeout(() => {
      const currId = currentIdRef.current
      if (currId && sessions[currId]) {
        chatApi.saveSession(sessions[currId]).catch((err: unknown) => console.error('Failed to sync session', err))
      }
    }, 1500)

    return () => clearTimeout(timer)
  }, [sessions, isLoaded, storageScope])

  useEffect(() => {
    if (isLoaded && currentId) saveCurrentId(storageScope, currentId)
  }, [currentId, isLoaded, storageScope])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Keep scroll pinned to bottom on container resize
  useEffect(() => {
    const container = messagesContainerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return

    let lastScrollHeight = container.scrollHeight
    let lastClientHeight = container.clientHeight

    const handleResize = () => {
      const scrollOffset = lastScrollHeight - container.scrollTop - lastClientHeight
      const wasAtBottom = scrollOffset < 30

      if (wasAtBottom) {
        container.style.scrollBehavior = 'auto'
        container.scrollTop = container.scrollHeight - container.clientHeight
        void container.offsetHeight
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

  // Pick up a draft handed over by the BotE Calculator export
  useEffect(() => {
    const importDraft = () => {
      try {
        const draft = sessionStorage.getItem('toolbox_chat_draft')
        if (draft) {
          sessionStorage.removeItem('toolbox_chat_draft')
          setInput(draft)
          inputRef.current?.focus()
        }
      } catch {
        // Session storage unavailable — nothing to import
      }
    }
    importDraft()
    window.addEventListener('toolbox-chat-draft', importDraft)
    return () => window.removeEventListener('toolbox-chat-draft', importDraft)
  }, [])

  // Handle text selection for flashcard generation
  const checkSelection = useCallback((e: MouseEvent | null) => {
    const targetEl = e?.target instanceof Element ? e.target : null
    if (
      targetEl?.closest('#flashcard-popup') ||
      targetEl?.closest('input') ||
      targetEl?.closest('textarea') ||
      targetEl?.closest('.flashcard-modal-ignore')
    ) {
      return
    }

    const selection = window.getSelection()
    const text = selection?.toString().trim() ?? ''

    if (selection && selection.rangeCount > 0 && text.length > 10) {
      const anchor = selection.anchorNode
      const msgContainer = anchor?.parentElement?.closest('.learning-chat-messages')
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
    document.addEventListener('mouseup', checkSelection)

    let selectionTimer: ReturnType<typeof setTimeout> | undefined
    const handleSelectionChange = () => {
      if (selectionTimer) clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => checkSelection(null), 300)
    }
    document.addEventListener('selectionchange', handleSelectionChange)

    return () => {
      document.removeEventListener('mouseup', checkSelection)
      document.removeEventListener('selectionchange', handleSelectionChange)
      if (selectionTimer) clearTimeout(selectionTimer)
    }
  }, [checkSelection])

  const handleGenerateAdHocFlashcard = async () => {
    if (!popupState?.text) return
    setIsGeneratingCards(true)
    const textToGen = popupState.text
    setPopupState(null)

    try {
      const topicName = activeTopic?.topic?.name || currentSession?.topicName || undefined

      let sessionContext = ''
      if (messages.length > 0) {
        const recentMsgs = messages.slice(-4)
        sessionContext = recentMsgs
          .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content.slice(0, 300)}`)
          .join('\n')
      }

      const res = (await chatApi.generateFlashcards({
        text: textToGen,
        topicName,
        model: selectedModel,
        sessionContext,
      })) as { cards?: GeneratedCard[] }
      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({ type: 'info', message: 'No flashcards could be generated from that selection.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to generate flashcard.' })
    } finally {
      setIsGeneratingCards(false)
    }
  }

  const handleGenerateSessionFlashcards = async () => {
    if (messages.length === 0 || isGeneratingCards) return
    setIsGeneratingCards(true)

    try {
      const topicName = activeTopic?.topic?.name || currentSession?.topicName || undefined

      const fullSessionText = messages
        .filter((m) => m.content.trim().length > 0)
        .map((m) => `${m.role === 'user' ? 'Student' : 'Tutor'}: ${m.content}`)
        .join('\n\n')

      const res = (await chatApi.generateFlashcards({
        text: fullSessionText,
        topicName,
        model: selectedModel,
        sessionContext: '',
      })) as { cards?: GeneratedCard[] }

      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({ type: 'info', message: 'No flashcards could be generated from this session.' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Failed to generate flashcards.' })
    } finally {
      setIsGeneratingCards(false)
    }
  }

  // Update messages for current session
  const setMessages = useCallback((updaterOrMessages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    setSessions((prev) => {
      if (!currentId) return prev
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

  const handleSend = useCallback(async (customText?: string, overrideHistory: ChatMessage[] | null = null) => {
    const text = typeof customText === 'string' ? customText.trim() : input.trim()
    if (!text || isLoading) return

    const currentHistory = overrideHistory || messages
    const currentPersonaObj = activePersonas[personaId] || activePersonas.socratic
    const userMessage: ChatMessage = { role: 'user', content: text, model: selectedModel, persona: currentPersonaObj }
    const newMessages = [...currentHistory, userMessage]
    setMessages(newMessages)
    if (typeof customText !== 'string') setInput('')
    setIsLoading(true)
    setErrorMsg(null)

    try {
      const aiPlaceholder: ChatMessage = { role: 'ai', content: '', model: selectedModel, persona: currentPersonaObj }
      setMessages([...newMessages, aiPlaceholder])

      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal

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

      const fullText = (await chatApi.stream(
        { message: text, context: currentPersona, history: currentHistory, model: selectedModel },
        (partialText: string) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', content: partialText, model: selectedModel, persona: currentPersonaObj }
            return updated
          })
        },
        () => {},
        signal,
      )) as string

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'ai', content: fullText, model: selectedModel, persona: currentPersonaObj }
        return updated
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Request failed'
      setErrorMsg(msg)
      setMessages([...newMessages, { role: 'ai', content: `Error: ${msg}. Please check your API key in Settings.` }])
    } finally {
      setIsLoading(false)
    }
  }, [input, isLoading, messages, selectedModel, setMessages, personaId, activePersonas, sectionStatus, activeTopic, currentSession])

  // Handle activeTopic changes (from to-do panel clicks)
  useEffect(() => {
    if (!activeTopic) {
      setTimeout(() => setStarters(defaultStarters), 0)
      return
    }

    const currId = currentIdRef.current
    const session = currId ? sessionsRef.current[currId] : undefined

    const topicCtx: CommitTopicContext = {
      pillarId: activeTopic.pillar.id,
      topicId: activeTopic.topic.id,
      topicName: activeTopic.topic.name,
    }

    if (activeTopicIdRef.current !== activeTopic.topic.id) {
      activeTopicIdRef.current = activeTopic.topic.id
      setTimeout(() => {
        if (session && session.messages.length > 0) {
          const s = makeSession(`Study: ${activeTopic.topic.name}`, topicCtx)
          setSessions((prev) => ({ ...prev, [s.id]: s }))
          setCurrentId(s.id)
        } else if (session && currId) {
          setSessions((prev) => ({
            ...prev,
            [currId]: {
              ...session,
              name: `Study: ${activeTopic.topic.name}`,
              pillarId: topicCtx.pillarId,
              topicId: topicCtx.topicId,
              topicName: topicCtx.topicName,
            },
          }))
        }
      }, 0)
    }

    const pillarSections = sectionsByPillar[activeTopic.pillar.id] || []
    if (pillarSections.length > 0) {
      guideContentApi.getForTopic(activeTopic.pillar.id, activeTopic.topic.id)
        .then((data: Record<string, { content?: string }> | null) => {
          const completed: string[] = []
          const empty: string[] = []
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
      setSectionStatus(null)
    }

    let active = true
    let settled = false
    const loadingTimer = setTimeout(() => {
      if (active && !settled) setLoadingStarters(true)
    }, 0)
    const activeSlug = effectiveKitSlug
    const params = new URLSearchParams({
      pillarId: activeTopic.pillar.id,
      topicId: activeTopic.topic.id,
      topicName: activeTopic.topic.name,
      model: selectedModel,
    })
    fetch(`/api/chat/starters?${params.toString()}`, {
      cache: 'no-store',
      headers: activeSlug ? { 'X-Toolbox-Kit': activeSlug } : undefined,
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { suggestions?: string[] } | null) => {
        if (active && data?.suggestions) {
          setStarters(data.suggestions)
        }
      })
      .catch((err: unknown) => console.error('Failed to fetch starters', err))
      .finally(() => {
        settled = true
        clearTimeout(loadingTimer)
        if (active) setLoadingStarters(false)
      })

    return () => {
      active = false
      clearTimeout(loadingTimer)
    }
  }, [activeTopic, selectedModel, sectionsByPillar, defaultStarters, effectiveKitSlug])

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
    }
  }

  const handleRetry = (index: number) => {
    const userMsg = messages[index]
    if (userMsg && userMsg.role === 'user') {
      const newHistory = messages.slice(0, index)
      setMessages(newHistory)
      setTimeout(() => { void handleSend(userMsg.content, newHistory) }, 50)
    }
  }

  const handleGenerateConceptMap = async () => {
    if (messages.length < 2 || generatingMap) return
    setGeneratingMap(true)
    setErrorMsg(null)

    try {
      const { response } = (await chatApi.generateConceptMap({
        history: messages,
        model: selectedModel,
      })) as { response: string }
      setMessages((prev) => [
        ...prev,
        { role: 'ai', content: `Here's a concept map summarizing what we just discussed:\n\n${response}` },
      ])
    } catch (err) {
      setErrorMsg(`Failed to generate concept map: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setGeneratingMap(false)
    }
  }

  // ── Session management ──────────────────────────────────────────────────────
  const createSession = useCallback((name?: string) => {
    const s = makeSession(name)
    setSessions((prev) => ({ ...prev, [s.id]: s }))
    setCurrentId(s.id)
    setInput('')
    setErrorMsg(null)
    chatApi.saveSession(s).catch(() => {})
    addToast({ type: 'info', message: `Started "${s.name}"` })
  }, [addToast])

  const switchSession = useCallback((id: string) => {
    setCurrentId(id)
    setInput('')
    setErrorMsg(null)
  }, [])

  const renameSession = useCallback((id: string, name: string) => {
    setSessions((prev) => {
      const existing = prev[id]
      if (!existing) return prev
      const nextSession = { ...existing, name }
      chatApi.saveSession(nextSession).catch(() => {})
      return { ...prev, [id]: nextSession }
    })
  }, [])

  const deleteSession = useCallback((id: string) => {
    chatApi.deleteSession(id).catch((err: unknown) => console.error('Failed to delete session', err))
    setSessions((prev) => {
      const next = { ...prev }
      delete next[id]
      if (id === currentId) {
        const remaining = Object.keys(next).sort(
          (a, b) =>
            new Date(next[b]?.createdAt ?? 0).getTime() -
            new Date(next[a]?.createdAt ?? 0).getTime(),
        )
        if (remaining.length > 0) {
          setCurrentId(remaining[0])
        } else {
          const fresh = makeSession()
          next[fresh.id] = fresh
          setCurrentId(fresh.id)
          chatApi.saveSession(fresh).catch(() => {})
        }
      }
      return next
    })
  }, [currentId])

  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (actionsMenuRef.current && e.target instanceof Node && !actionsMenuRef.current.contains(e.target)) {
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
          {capabilities.calculator !== false && (
            <button
              className="btn btn-ghost btn-icon"
              onClick={() => useAppStore.getState().setCalcModalOpen(true)}
              title="BotE Calculator (⌘E)"
              aria-label="Open BotE Calculator"
              id="chat-calc-btn"
            >
              <Calculator size={16} />
            </button>
          )}
          {messages.length > 0 && (
            <div style={{ position: 'relative' }} ref={actionsMenuRef}>
              <button
                className="btn btn-ghost btn-icon"
                onClick={() => setShowActionsMenu((p) => !p)}
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
                  overflow: 'hidden',
                }}>
                  <button
                    className="dropdown-item"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 16px', border: 'none', background: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)',
                      opacity: generatingMap ? 0.5 : 1,
                    }}
                    onClick={() => {
                      setShowActionsMenu(false)
                      void handleGenerateConceptMap()
                    }}
                    disabled={generatingMap}
                  >
                    <MapIcon size={14} style={{ animation: generatingMap ? 'spin 2s linear infinite' : 'none' }} />
                    {generatingMap ? 'Generating Map...' : 'Generate Map'}
                  </button>
                  <button
                    className="dropdown-item"
                    style={{
                      display: 'flex', alignItems: 'center', gap: '8px',
                      padding: '10px 16px', border: 'none', background: 'none',
                      cursor: 'pointer', textAlign: 'left',
                      color: 'var(--color-text-primary)', fontSize: 'var(--text-sm)',
                      opacity: isGeneratingCards ? 0.5 : 1,
                    }}
                    onClick={() => {
                      setShowActionsMenu(false)
                      void handleGenerateSessionFlashcards()
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
              onClick={() =>
                onCommitClick?.(
                  messages,
                  currentSession?.pillarId && currentSession?.topicId
                    ? {
                        pillarId: currentSession.pillarId,
                        topicId: currentSession.topicId,
                        topicName: currentSession.topicName || '',
                      }
                    : null,
                )
              }
              disabled={!currentSession?.pillarId}
              title={currentSession?.pillarId
                ? `Commit session to ${currentSession.topicName} guide`
                : 'Start a session from the Study Plan to enable commit'}
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
            gap: '4px',
          }}
        >
          <button
            className="btn btn-primary btn-sm"
            style={{ fontSize: '12px', padding: '8px 12px', minHeight: 36, whiteSpace: 'nowrap' }}
            onClick={() => { void handleGenerateAdHocFlashcard() }}
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
        topicName={activeTopic?.topic?.name || currentSession?.topicName || undefined}
        pillarId={activeTopic?.pillar?.id || currentSession?.pillarId || undefined}
        topicId={activeTopic?.topic?.id || currentSession?.topicId || undefined}
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
                  : 'Add your API key in Settings to start studying with AI.'}
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
                      border: '1px solid transparent',
                    }} />
                  ))
                ) : (
                  starters.map((p, i) => (
                    <button key={i} className="learning-starter-btn" onClick={() => { void handleSend(p) }}>{p}</button>
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
            <div className="learning-message-body" style={{ width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0' }}>
                <Skeleton style={{ width: '90%', height: 16 }} />
                <Skeleton style={{ width: '95%', height: 16 }} />
                <Skeleton style={{ width: '80%', height: 16 }} />
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
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
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
              const el = e.target
              el.style.height = 'auto'
              el.style.height = `${Math.min(el.scrollHeight, 320)}px`
            }}
            onKeyDown={handleKeyDown}
            rows={2}
            id="learning-chat-input"
          />
          <button
            className="chat-send-btn"
            onClick={() => { void handleSend() }}
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
