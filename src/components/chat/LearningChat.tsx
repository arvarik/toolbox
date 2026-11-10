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
  BookOpen,
  Calculator,
  Check,
  Copy,
  GitCommit,
  Layers,
  Map as MapIcon,
  MoreHorizontal,
  RotateCcw,
  Send,
  Square,
  X,
} from 'lucide-react'
import type { Pillar } from '../../../shared/kits/kitSkeleton'
import MarkdownRenderer from '../shared/MarkdownRenderer'
import FlashcardReviewModal from '../shared/FlashcardReviewModal'
import Skeleton from '../shared/Skeleton'
import { KitAvatar } from '../ui'
import PersonaPicker from './PersonaPicker'
import { buildPersonasForKit, getStarterPromptsForKit, type PersonaId } from './personas'
import SessionPicker, { type ChatMessage, type ChatSession } from './SessionPicker'
import type { CommitTopicContext } from '../../stores/useCommitStore'
import useAppStore from '../../stores/appStore'
import { getActiveKitSlugForRequest, useActiveKit } from '../../stores/useKitStore'
import { chatApi, guideContentApi, type GeneratedFlashcardDraft } from '../../utils/api'

// ─── Session storage (scoped per Kit slug) ────────────────────────────────────
const SESSIONS_KEY = 'toolbox_learning_sessions'
const CURRENT_KEY = 'toolbox_learning_current'
const QUOTE_STORAGE_KEY = 'toolbox_chat_quote'
const MAX_MESSAGES = 120

const REQUIRED_DEFAULT_STARTERS = [
  'Explain consistent hashing with a concrete example and when I should use it',
  'Walk me through the tradeoffs of SQL vs NoSQL for a social feed at scale',
]

function buildFallbackStarters(raw: string[], isCustomKit: boolean): string[] {
  if (isCustomKit) return raw.slice(0, 3)
  const third = raw.find((item) => !REQUIRED_DEFAULT_STARTERS.includes(item))
  return third ? [...REQUIRED_DEFAULT_STARTERS, third] : [...REQUIRED_DEFAULT_STARTERS]
}

function consumeStoredQuote(): string | null {
  try {
    const raw = localStorage.getItem(QUOTE_STORAGE_KEY)
    if (raw && raw.trim()) {
      localStorage.removeItem(QUOTE_STORAGE_KEY)
      return raw.trim()
    }
  } catch {
    // ignore storage errors
  }
  return null
}

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
  } catch {
    /* ignore */
  }
  return {}
}

function saveSessions(slug: string | null | undefined, sessions: Record<string, ChatSession>): void {
  try {
    localStorage.setItem(sessionsStorageKey(slug), JSON.stringify(sessions))
  } catch {
    /* ignore */
  }
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
  } catch {
    /* ignore */
  }
}

function makeSession(name?: string, topicContext?: Partial<CommitTopicContext>): ChatSession {
  return {
    id: `session-${Date.now()}`,
    name:
      name ||
      `Session ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
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
    } catch {
      /* ignore */
    }
  }
  return (
    <button
      type="button"
      onClick={() => {
        void handleCopy()
      }}
      title={copied ? 'Copied!' : 'Copy'}
      aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
      className="inline-flex cursor-pointer items-center rounded p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
    >
      {copied ? (
        <Check size={13} className="text-[var(--color-ok)]" />
      ) : (
        <Copy size={13} />
      )}
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
  notebookOpen?: boolean
  onToggleNotebook?: () => void
  onSessionStateChange?: (state: { session: ChatSession | null; messages: ChatMessage[] }) => void
}

/**
 * LearningChat — full-page Socratic study stage authored by Kit with per-Kit session history.
 */
export default function LearningChat({
  activeTopic,
  onCommitClick,
  routeKitSlug,
  notebookOpen,
  onToggleNotebook,
  onSessionStateChange,
}: LearningChatProps) {
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const selectedModel = useAppStore((s) => s.model)
  const addToast = useAppStore((s) => s.addToast)
  const { kit, kitSlug, skeleton, sectionsByPillar, capabilities, tutor } = useActiveKit()
  const effectiveKitSlug = routeKitSlug || kitSlug || getActiveKitSlugForRequest()
  const storageScope = effectiveKitSlug || 'system-design'
  const isCustomKit = Boolean(
    (effectiveKitSlug && effectiveKitSlug !== 'system-design') ||
      (kit && skeleton.identity.slug !== 'system-design'),
  )

  const activePersonas = useMemo(
    () => buildPersonasForKit(tutor, isCustomKit),
    [tutor, isCustomKit],
  )
  const defaultStarters = useMemo(
    () => buildFallbackStarters(getStarterPromptsForKit(tutor, isCustomKit), isCustomKit),
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
  const [quotedSnippet, setQuotedSnippet] = useState<string | null>(() => consumeStoredQuote())
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const [starters, setStarters] = useState<string[]>(() =>
    buildFallbackStarters(getStarterPromptsForKit(tutor, isCustomKit), isCustomKit),
  )
  const [loadingStarters, setLoadingStarters] = useState(false)
  const [generatingMap, setGeneratingMap] = useState(false)
  const [personaId, setPersonaId] = useState<PersonaId>('socratic')

  const [sectionStatus, setSectionStatus] = useState<SectionStatus | null>(null)

  // Flashcards state
  const [popupState, setPopupState] = useState<PopupState | null>(null)
  const [showReviewModal, setShowReviewModal] = useState(false)
  const [generatedCards, setGeneratedCards] = useState<GeneratedFlashcardDraft[]>([])
  const [isGeneratingCards, setIsGeneratingCards] = useState(false)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const currentIdRef = useRef(currentId)
  useEffect(() => {
    currentIdRef.current = currentId
  }, [currentId])
  const sessionsRef = useRef(sessions)
  useEffect(() => {
    sessionsRef.current = sessions
  }, [sessions])

  const activeTopicIdRef = useRef<string | undefined>(activeTopic?.topic?.id)

  useEffect(() => {
    onSessionStateChange?.({ session: currentSession, messages })
  }, [currentSession, messages, onSessionStateChange])

  // Load from API & migrate legacy default-Kit local data if needed whenever active Kit changes
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
        const backendSessions =
          ((await chatApi.getSessions()) || {}) as Record<string, ChatSession>
        if (cancelled) return

        const canMigrateLegacy = !isCustomKit && storageScope === 'system-design'
        let finalSessions: Record<string, ChatSession> = { ...backendSessions }

        if (canMigrateLegacy) {
          const localSessions = loadSessions(storageScope)
          let needsMigration = false
          const toMigrate: Record<string, ChatSession> = {}
          for (const [id, s] of Object.entries(localSessions)) {
            if (!backendSessions[id]) {
              needsMigration = true
              toMigrate[id] = s
            }
          }

          if (needsMigration) {
            await chatApi.migrateBulk(toMigrate)
            if (cancelled) return
            finalSessions =
              ((await chatApi.getSessions()) || {}) as Record<string, ChatSession>
            if (cancelled) return
          }
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
    return () => {
      cancelled = true
    }
  }, [storageScope, isCustomKit, addToast])

  // Persist sessions whenever they change (strictly gated on matching loadedScope)
  useEffect(() => {
    if (!isLoaded) return
    saveSessions(storageScope, sessions)

    const timer = setTimeout(() => {
      const currId = currentIdRef.current
      if (currId && sessions[currId]) {
        chatApi
          .saveSession(sessions[currId])
          .catch((err: unknown) => console.error('Failed to sync session', err))
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
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Pick up docked quote from Guide / Inspector ('toolbox:ask-kit' or localStorage)
  useEffect(() => {
    const onAskKit = (e: Event) => {
      const detailQuote = (e as CustomEvent<{ quote?: string }>).detail?.quote
      const nextQuote = (detailQuote && detailQuote.trim()) || consumeStoredQuote()
      if (nextQuote) {
        try {
          localStorage.removeItem(QUOTE_STORAGE_KEY)
        } catch {
          /* ignore */
        }
        setQuotedSnippet(nextQuote)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('toolbox:ask-kit', onAskKit)
    return () => window.removeEventListener('toolbox:ask-kit', onAskKit)
  }, [])

  const clearQuote = useCallback(() => {
    setQuotedSnippet(null)
    try {
      localStorage.removeItem(QUOTE_STORAGE_KEY)
    } catch {
      /* ignore */
    }
  }, [])

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

      const res = await chatApi.generateFlashcards({
        text: textToGen,
        topicName,
        model: selectedModel,
        sessionContext,
      })
      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({
          type: 'info',
          message: 'No flashcards could be generated from that selection.',
        })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate flashcard.',
      })
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

      const res = await chatApi.generateFlashcards({
        text: fullSessionText,
        topicName,
        model: selectedModel,
        sessionContext: '',
      })

      if (res.cards && res.cards.length > 0) {
        setGeneratedCards(res.cards)
        setShowReviewModal(true)
      } else {
        addToast({ type: 'info', message: 'No flashcards could be generated from this session.' })
      }
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'Failed to generate flashcards.',
      })
    } finally {
      setIsGeneratingCards(false)
    }
  }

  // Update messages for current session
  const setMessages = useCallback(
    (updaterOrMessages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
      setSessions((prev) => {
        if (!currentId) return prev
        const session = prev[currentId]
        if (!session) return prev
        const newMessages =
          typeof updaterOrMessages === 'function'
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
    },
    [currentId],
  )

  const handleSend = useCallback(
    async (customText?: string, overrideHistory: ChatMessage[] | null = null) => {
      const baseText = typeof customText === 'string' ? customText.trim() : input.trim()
      const attachQuote = overrideHistory === null ? quotedSnippet : null
      if ((!baseText && !attachQuote) || isLoading) return

      const text = attachQuote
        ? `> ${attachQuote}\n\n${baseText || 'Explain this passage.'}`
        : baseText

      const currentHistory = overrideHistory || messages
      const currentPersonaObj = activePersonas[personaId] || activePersonas.socratic
      const userMessage: ChatMessage = {
        role: 'user',
        content: text,
        model: selectedModel,
        persona: currentPersonaObj,
      }
      const newMessages = [...currentHistory, userMessage]
      setMessages(newMessages)
      if (typeof customText !== 'string') setInput('')
      if (attachQuote) clearQuote()
      setIsLoading(true)
      setErrorMsg(null)

      try {
        const aiPlaceholder: ChatMessage = {
          role: 'ai',
          content: '',
          model: selectedModel,
          persona: currentPersonaObj,
        }
        setMessages([...newMessages, aiPlaceholder])

        abortControllerRef.current = new AbortController()
        const signal = abortControllerRef.current.signal

        let currentPersona = currentPersonaObj.context
        if (
          sectionStatus &&
          (sectionStatus.emptySections.length > 0 || sectionStatus.completedSections.length > 0)
        ) {
          const topicName =
            currentSession?.topicName || activeTopic?.topic?.name || 'this topic'
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
              updated[updated.length - 1] = {
                role: 'ai',
                content: partialText,
                model: selectedModel,
                persona: currentPersonaObj,
              }
              return updated
            })
          },
          () => {},
          signal,
        )) as string

        setMessages((prev) => {
          const updated = [...prev]
          updated[updated.length - 1] = {
            role: 'ai',
            content: fullText,
            model: selectedModel,
            persona: currentPersonaObj,
          }
          return updated
        })
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        const msg = err instanceof Error ? err.message : 'Request failed'
        setErrorMsg(msg)
        setMessages([
          ...newMessages,
          { role: 'ai', content: `Error: ${msg}. Please check your API key in Settings.` },
        ])
      } finally {
        setIsLoading(false)
      }
    },
    [
      input,
      quotedSnippet,
      clearQuote,
      isLoading,
      messages,
      selectedModel,
      setMessages,
      personaId,
      activePersonas,
      sectionStatus,
      activeTopic,
      currentSession,
    ],
  )

  // Handle activeTopic changes (from curriculum spine clicks)
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
      Promise.resolve(
        guideContentApi?.getForTopic?.(activeTopic.pillar.id, activeTopic.topic.id),
      )
        .then((data: Record<string, { content?: string }> | null | undefined) => {
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
          setStarters(data.suggestions.slice(0, 3))
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
      setTimeout(() => {
        void handleSend(userMsg.content, newHistory)
      }, 50)
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
        {
          role: 'ai',
          content: `Here's a concept map summarizing what we just discussed:\n\n${response}`,
        },
      ])
    } catch (err) {
      setErrorMsg(
        `Failed to generate concept map: ${err instanceof Error ? err.message : 'Unknown error'}`,
      )
    } finally {
      setGeneratingMap(false)
    }
  }

  // ── Session management ──────────────────────────────────────────────────────
  const createSession = useCallback(
    (name?: string) => {
      const s = makeSession(name)
      setSessions((prev) => ({ ...prev, [s.id]: s }))
      setCurrentId(s.id)
      setInput('')
      setErrorMsg(null)
      chatApi.saveSession(s).catch(() => {})
      addToast({ type: 'info', message: `Started "${s.name}"` })
    },
    [addToast],
  )

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

  const deleteSession = useCallback(
    (id: string) => {
      chatApi
        .deleteSession(id)
        .catch((err: unknown) => console.error('Failed to delete session', err))
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
    },
    [currentId],
  )

  const [showActionsMenu, setShowActionsMenu] = useState(false)
  const actionsMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        actionsMenuRef.current &&
        e.target instanceof Node &&
        !actionsMenuRef.current.contains(e.target)
      ) {
        setShowActionsMenu(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const aiMessages = messages.filter((m) => m.role === 'ai' && m.content.trim().length > 0)
  const visibleStarters = starters.slice(0, 3)

  return (
    <div className="learning-chat bg-[var(--color-surface)]" id="learning-chat">
      {/* ── Header ── */}
      <div className="learning-chat-header border-b border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="hide-on-mobile shrink-0">
            <KitAvatar size={20} state={isLoading ? 'thinking' : 'idle'} />
          </span>
          <SessionPicker
            sessions={sessions}
            currentId={currentId}
            onSelect={switchSession}
            onCreate={() => createSession()}
            onRename={renameSession}
            onDelete={deleteSession}
          />
          <PersonaPicker
            personas={activePersonas}
            activeId={personaId}
            onSelect={setPersonaId}
          />
          {messages.length > 0 && (
            <span className="hide-on-mobile shrink-0 rounded-full border border-[var(--color-line)] bg-[var(--color-surface-low)] px-2 py-0.5 font-mono text-[10.5px] text-[var(--color-ink-faint)] tabular-nums">
              {messages.length} msg
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {capabilities.calculator !== false && (
            <button
              type="button"
              className="btn btn-ghost btn-icon"
              onClick={() => useAppStore.getState().setCalcModalOpen(true)}
              title="BotE Calculator (⌘E)"
              aria-label="Open BotE Calculator"
              id="chat-calc-btn"
            >
              <Calculator size={15} />
            </button>
          )}

          {messages.length > 0 && (
            <div className="relative" ref={actionsMenuRef}>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setShowActionsMenu((p) => !p)}
                title="More Actions"
                aria-label="More Actions"
              >
                <MoreHorizontal size={16} />
              </button>
              {showActionsMenu && (
                <div className="animate-popover-enter absolute top-[calc(100%+4px)] right-0 z-50 flex min-w-[184px] flex-col overflow-hidden rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-1 shadow-[var(--shadow-float)]">
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                    onClick={() => {
                      setShowActionsMenu(false)
                      void handleGenerateConceptMap()
                    }}
                    disabled={generatingMap}
                  >
                    <MapIcon size={14} className="text-[var(--color-ink-muted)]" />
                    {generatingMap ? 'Generating Map...' : 'Generate Map'}
                  </button>
                  <button
                    type="button"
                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-hover)] disabled:opacity-50"
                    onClick={() => {
                      setShowActionsMenu(false)
                      void handleGenerateSessionFlashcards()
                    }}
                    disabled={isGeneratingCards}
                  >
                    <Layers size={14} className="text-[var(--color-ink-muted)]" />
                    {isGeneratingCards ? 'Generating Cards...' : 'Generate Flashcards'}
                  </button>
                </div>
              )}
            </div>
          )}

          {aiMessages.length > 0 && (
            <button
              type="button"
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--color-accent-fill)] px-3 text-[12.5px] font-semibold text-[var(--color-accent-ink)] transition-opacity hover:bg-[var(--color-accent-fill-hover)] disabled:cursor-not-allowed disabled:opacity-45"
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
              title={
                currentSession?.pillarId
                  ? `Commit session to ${currentSession.topicName} guide`
                  : 'Start a session from the Study Plan to enable commit'
              }
              id="commit-to-guide-btn"
            >
              <GitCommit size={13} />
              <span className="hide-on-mobile">Commit to Guide</span>
            </button>
          )}

          {onToggleNotebook && (
            <button
              type="button"
              aria-pressed={Boolean(notebookOpen)}
              onClick={onToggleNotebook}
              className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-[12.5px] font-medium transition-colors active:scale-[0.98] ${
                notebookOpen
                  ? 'border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] text-[var(--color-ink)]'
                  : 'border-transparent text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]'
              }`}
            >
              <BookOpen size={14} />
              <span>Notebook</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Selection Flashcard Popup ── */}
      {popupState && (
        <div
          id="flashcard-popup"
          className="flashcard-modal-ignore fixed z-50 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] p-1.5 shadow-[var(--shadow-float)]"
          style={{ top: popupState.top, left: popupState.left }}
        >
          <button
            type="button"
            className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--color-accent-fill)] px-3 text-[12px] font-semibold whitespace-nowrap text-[var(--color-accent-ink)] hover:bg-[var(--color-accent-fill-hover)] disabled:opacity-50"
            onClick={() => {
              void handleGenerateAdHocFlashcard()
            }}
            disabled={isGeneratingCards}
          >
            <Layers size={13} />
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
      />

      {/* ── Messages ── */}
      <div
        className="learning-chat-messages px-4 py-6 sm:px-8"
        id="learning-chat-messages"
        ref={messagesContainerRef}
      >
        {messages.length === 0 && (
          <div className="learning-chat-empty mx-auto flex w-full max-w-2xl flex-col justify-center py-8">
            <div className="mb-5 flex items-center gap-3.5">
              <KitAvatar size={28} state="idle" />
              <div>
                <h2 className="font-serif text-[23px] leading-snug font-normal text-[var(--color-ink)]">
                  {apiKeyConfigured ? 'What are we working through?' : 'Configure API Key First'}
                </h2>
                <p className="mt-0.5 text-[13.5px] text-[var(--color-ink-muted)]">
                  {apiKeyConfigured
                    ? activeTopic?.topic?.name
                      ? `Focused session on ${activeTopic.topic.name}.`
                      : 'Ask a question, test an idea, or synthesize Guide notes.'
                    : 'Add your API key in Settings to study with Kit.'}
                </p>
              </div>
            </div>

            {apiKeyConfigured && (
              <div className="learning-starter-prompts flex flex-wrap gap-2">
                {loadingStarters
                  ? Array.from({ length: 3 }).map((_, i) => (
                      <div
                        key={i}
                        className="h-9 w-56 animate-pulse rounded-full border border-[var(--color-line)] bg-[var(--color-surface-low)]"
                      />
                    ))
                  : visibleStarters.map((p, i) => (
                      <button
                        key={i}
                        type="button"
                        className="learning-starter-btn cursor-pointer rounded-full border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] px-3.5 py-2 text-left text-[13px] text-[var(--color-ink-muted)] transition-[transform,color,border-color] duration-120 hover:border-[var(--color-ink-faint)] hover:text-[var(--color-ink)] active:scale-[0.98]"
                        onClick={() => {
                          void handleSend(p)
                        }}
                      >
                        {p}
                      </button>
                    ))}
              </div>
            )}
          </div>
        )}

        <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
          {messages.map((msg, i) => {
            const isLast = i === messages.length - 1
            if (msg.role === 'user') {
              return (
                <div
                  key={i}
                  className="learning-message user ml-auto flex max-w-[85%] flex-col items-end !border-0 !bg-transparent !p-0"
                  data-role="user"
                >
                  <div className="rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-4 py-3 text-[15px] leading-relaxed text-[var(--color-ink)]">
                    <div className="learning-message-text">
                      <MdContent text={msg.content} />
                    </div>
                  </div>
                  {!isLoading && (
                    <div className="mt-1 flex justify-end">
                      <button
                        type="button"
                        onClick={() => handleRetry(i)}
                        className="inline-flex cursor-pointer items-center rounded p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
                        title="Retry this prompt"
                        aria-label="Retry this prompt"
                      >
                        <RotateCcw size={12} />
                      </button>
                    </div>
                  )}
                </div>
              )
            }

            const streamingThis = isLoading && isLast
            return (
              <div
                key={i}
                className="learning-message ai flex w-full items-start gap-3.5 !border-0 !bg-transparent !p-0"
                data-role="ai"
              >
                <div className="mt-0.5 shrink-0">
                  <KitAvatar size={24} state={streamingThis ? 'thinking' : 'idle'} />
                </div>
                <div className="learning-message-body min-w-0 flex-1 !border-0 !bg-transparent !p-0">
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[11.5px] text-[var(--color-ink-faint)]">
                    <span className="font-semibold text-[var(--color-ink)]">Kit</span>
                    {msg.persona?.name && (
                      <>
                        <span>·</span>
                        <span>{msg.persona.name}</span>
                      </>
                    )}
                    {msg.model && (
                      <span className="rounded bg-[var(--color-surface-low)] px-1.5 py-0.5 font-mono text-[10.5px]">
                        {msg.model}
                      </span>
                    )}
                  </div>

                  {streamingThis && !msg.content ? (
                    <div className="flex flex-col gap-2 py-1">
                      <Skeleton style={{ width: '88%', height: 15 }} />
                      <Skeleton style={{ width: '94%', height: 15 }} />
                      <Skeleton style={{ width: '72%', height: 15 }} />
                    </div>
                  ) : (
                    <div className="learning-message-text text-[15.5px] leading-[1.72] text-[var(--color-ink)]">
                      <MdContent text={msg.content} />
                    </div>
                  )}

                  {msg.content && (
                    <div className="mt-1.5 flex justify-end">
                      <CopyButton text={msg.content} />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          {isLoading && (messages.length === 0 || messages[messages.length - 1]?.role !== 'ai') && (
            <div
              className="learning-message ai flex w-full items-start gap-3.5 !border-0 !bg-transparent !p-0"
              data-role="ai"
            >
              <div className="mt-0.5 shrink-0">
                <KitAvatar size={24} state="thinking" />
              </div>
              <div className="learning-message-body min-w-0 flex-1">
                <div className="flex flex-col gap-2 py-1">
                  <Skeleton style={{ width: '88%', height: 15 }} />
                  <Skeleton style={{ width: '94%', height: 15 }} />
                  <Skeleton style={{ width: '72%', height: 15 }} />
                </div>
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="rounded-xl border border-[var(--color-err)]/30 bg-[var(--color-diff-del-bg)] px-4 py-2.5 text-[12.5px] text-[var(--color-err)]"
            >
              {errorMsg}
            </div>
          )}
        </div>
        <div ref={messagesEndRef} />
      </div>

      {/* ── Spacious Inviting Composer ── */}
      <div className="learning-chat-input-area relative border-t border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-3 sm:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-3 shadow-[var(--shadow-sheet)] transition-[border-color,box-shadow] duration-150 focus-within:border-[var(--color-brand)]/75">
            {quotedSnippet && (
              <div
                data-testid="learning-chat-quote"
                className="mb-2.5 flex items-start justify-between gap-2 rounded-lg border-l-2 border-[var(--color-brand)] bg-[var(--color-surface-low)] px-3 py-2 text-[13px] text-[var(--color-ink-muted)]"
              >
                <span className="line-clamp-2">“{quotedSnippet}”</span>
                <button
                  type="button"
                  aria-label="Remove quoted snippet"
                  onClick={clearQuote}
                  className="mt-0.5 shrink-0 cursor-pointer text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                >
                  <X size={13} />
                </button>
              </div>
            )}

            <div className="flex items-end gap-2.5">
              <textarea
                ref={inputRef}
                className="learning-chat-input min-h-[48px] flex-1 resize-none !border-0 !bg-transparent !p-0 text-[15px] leading-relaxed text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
                placeholder="Ask Kit a question, test an idea, or request an example..."
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

              {isLoading ? (
                <button
                  type="button"
                  onClick={handleStop}
                  aria-label="Stop generating"
                  className="inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-diff-del-bg)] px-3 text-[12.5px] font-medium text-[var(--color-err)] transition-opacity hover:opacity-90 active:scale-[0.97]"
                >
                  <Square fill="currentColor" size={10} />
                  <span>Stop</span>
                </button>
              ) : (
                <button
                  type="button"
                  className="chat-send-btn inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-[var(--color-accent-fill)] px-3 text-[12.5px] font-semibold text-[var(--color-accent-ink)] transition-[transform,background-color,opacity] duration-120 hover:bg-[var(--color-accent-fill-hover)] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45"
                  onClick={() => {
                    void handleSend()
                  }}
                  disabled={(!input.trim() && !quotedSnippet) || isLoading}
                  aria-label="Send message"
                >
                  <span className="hide-on-mobile">Ask Kit</span>
                  <Send size={13} />
                </button>
              )}
            </div>
          </div>

          <div className="mt-1.5 text-center text-[11px] text-[var(--color-ink-faint)]">
            Enter to send · Shift+Enter for new line
          </div>
        </div>
      </div>
    </div>
  )
}
