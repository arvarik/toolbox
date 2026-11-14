import { useState, useRef, useEffect, useCallback } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { X, Copy, Check, RotateCcw } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import { InvitingComposer, KitAvatar } from '../ui'
import useAppStore from '../../stores/appStore'
import useKitStore, {
  extractKitSlugFromPathname,
  useActiveKit,
} from '../../stores/useKitStore'
import useIsMobile from '../../hooks/useIsMobile'
import { chatApi } from '../../utils/api'
import Skeleton from './Skeleton'

export interface ChatPanelMessage {
  role: 'user' | 'ai'
  content: string
}

export interface ChatPanelProps {
  page: string
  title?: string
  placeholder?: string
  initialMessages?: ChatPanelMessage[]
  context?: string
}

const QUOTE_STORAGE_KEY = 'toolbox_chat_quote'

// Safe storage wrapper to prevent SSR or restricted environment crashes
const safeStorage = {
  getItem: (key: string): string | null => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key)
      }
    } catch {
      // Ignore
    }
    return null
  },
  setItem: (key: string, value: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value)
      }
    } catch {
      // Ignore
    }
  },
  removeItem: (key: string): void => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key)
      }
    } catch {
      // Ignore
    }
  },
}

const getHistoryForKey = (storageKey: string): ChatPanelMessage[] => {
  const data = safeStorage.getItem('toolbox_chat_history')
  if (data) {
    try {
      const parsed = JSON.parse(data) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const history = (parsed as Record<string, unknown>)[storageKey]
        if (Array.isArray(history)) {
          return history.filter(
            (m): m is ChatPanelMessage =>
              Boolean(m) &&
              typeof m === 'object' &&
              'role' in m &&
              (m.role === 'user' || m.role === 'ai') &&
              typeof (m as { content?: unknown }).content === 'string',
          )
        }
      }
    } catch {
      // Ignore
    }
  }
  return []
}

const MAX_HISTORY_PER_PAGE = 50

const saveHistoryForKey = (storageKey: string, messages: ChatPanelMessage[]): void => {
  const data = safeStorage.getItem('toolbox_chat_history')
  let parsed: Record<string, unknown> = {}
  if (data) {
    try {
      const raw = JSON.parse(data) as unknown
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        parsed = raw as Record<string, unknown>
      }
    } catch {
      // Ignore
    }
  }
  parsed[storageKey] = messages.slice(-MAX_HISTORY_PER_PAGE)
  safeStorage.setItem('toolbox_chat_history', JSON.stringify(parsed))
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    }
  }, [])

  const scheduleCopiedReset = () => {
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => {
      setCopied(false)
      copyTimerRef.current = null
    }, 2000)
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      scheduleCopiedReset()
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        scheduleCopiedReset()
      } catch {
        // Ignore
      }
      document.body.removeChild(textarea)
    }
  }

  return (
    <button
      type="button"
      className="btn-copy-chat inline-flex cursor-pointer items-center rounded p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
      onClick={() => void handleCopy()}
      aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
    >
      {copied ? (
        <Check size={14} className="text-[var(--color-ok)]" />
      ) : (
        <Copy size={14} />
      )}
    </button>
  )
}

interface ChatPanelContentProps extends ChatPanelProps {
  storageKey: string
  kitName: string | null
}

function ChatPanelContent({
  page,
  storageKey,
  kitName,
  title = 'Ask AI',
  placeholder = 'Ask a question...',
  initialMessages = [],
  context = '',
}: ChatPanelContentProps) {
  const isOpen = useAppStore((s) => Boolean(s.chatOpen[page]))
  const toggleChat = useAppStore((s) => s.toggleChat)
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const selectedModel = useAppStore((s) => s.model)
  const canvasNodes = useAppStore((s) => s.nodes)
  const canvasEdges = useAppStore((s) => s.edges)

  const isMobile = useIsMobile()

  const [width, setWidth] = useState(() => {
    const saved = safeStorage.getItem('toolbox_chat_width')
    const parsed = saved ? parseInt(saved, 10) : 350
    return Number.isNaN(parsed) || parsed < 300 || parsed > 600 ? 350 : parsed
  })

  const [messages, setMessages] = useState<ChatPanelMessage[]>(() => {
    const history = getHistoryForKey(storageKey)
    return history.length > 0 ? history : initialMessages
  })

  const [input, setInput] = useState('')
  const [quotedSnippet, setQuotedSnippet] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasTriggeredRef = useRef(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Abort any in-flight SSE stream or pending retry timer if the panel unmounts or switches Kits/pages
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
    }
  }, [])

  const clearQuote = useCallback(() => {
    setQuotedSnippet(null)
    safeStorage.removeItem(QUOTE_STORAGE_KEY)
  }, [])

  // Consume stored quote when panel opens or when 'toolbox:ask-kit' fires
  useEffect(() => {
    if (isOpen) {
      const stored = safeStorage.getItem(QUOTE_STORAGE_KEY)
      if (stored && stored.trim()) {
        safeStorage.removeItem(QUOTE_STORAGE_KEY)
        setQuotedSnippet(stored.trim())
      }
      inputRef.current?.focus()
    }
  }, [isOpen])

  useEffect(() => {
    const onAskKit = (e: Event) => {
      if (!isOpen) return
      const detailQuote = (e as CustomEvent<{ quote?: string }>).detail?.quote
      const stored = safeStorage.getItem(QUOTE_STORAGE_KEY)
      const nextQuote = (detailQuote && detailQuote.trim()) || (stored && stored.trim()) || null
      if (nextQuote) {
        safeStorage.removeItem(QUOTE_STORAGE_KEY)
        setQuotedSnippet(nextQuote)
        inputRef.current?.focus()
      }
    }
    window.addEventListener('toolbox:ask-kit', onAskKit)
    return () => window.removeEventListener('toolbox:ask-kit', onAskKit)
  }, [isOpen])

  const handleSend = async (
    customText?: string,
    overrideHistory: ChatPanelMessage[] | null = null,
    skipQuote = false,
  ) => {
    const baseText = typeof customText === 'string' ? customText : input.trim()
    const attachQuote = overrideHistory === null && !skipQuote ? quotedSnippet : null
    if ((!baseText && !attachQuote) || isLoading) return

    const text = attachQuote
      ? `> ${attachQuote}\n\n${baseText || 'Explain this passage.'}`
      : baseText

    const currentHistory = overrideHistory ?? messages
    const userMessage: ChatPanelMessage = { role: 'user', content: text }
    const newMessages: ChatPanelMessage[] = [...currentHistory, userMessage]
    setMessages(newMessages)

    if (typeof customText !== 'string') {
      setInput('')
    }
    if (attachQuote) {
      clearQuote()
    }

    setIsLoading(true)
    setErrorMsg(null)

    try {
      const contextString = (() => {
        if (context) return context
        if (page === 'builder' && canvasNodes.length > 0) {
          const nodeNames = canvasNodes
            .map((n) => `${n.data?.name ?? 'Node'} (${n.data?.category ?? 'General'})`)
            .join(', ')
          const edgeDescs = canvasEdges
            .map((e) => {
              const fromNode = canvasNodes.find((n) => n.id === e.source)
              const toNode = canvasNodes.find((n) => n.id === e.target)
              return `${fromNode?.data?.name || 'Unknown'} → ${toNode?.data?.name || 'Unknown'}`
            })
            .join(', ')
          let desc = `The user is designing a diagram with ${canvasNodes.length} components: ${nodeNames}.`
          if (canvasEdges.length > 0) {
            desc += ` Connections: ${edgeDescs}.`
          }
          desc += ' Analyze this diagram, identify potential issues, and suggest improvements.'
          return desc
        }
        if (kitName) {
          return `The user is on the ${page} page studying the "${kitName}" learning kit.`
        }
        return `The user is on the ${page} page of a system design interview study tool.`
      })()

      const aiPlaceholder: ChatPanelMessage = { role: 'ai', content: '' }
      setMessages([...newMessages, aiPlaceholder])

      abortControllerRef.current = new AbortController()
      const signal = abortControllerRef.current.signal

      const fullText = await chatApi.stream(
        {
          message: text,
          context: contextString,
          history: currentHistory,
          model: selectedModel,
        },
        (partialText) => {
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', content: partialText }
            return updated
          })
        },
        null,
        signal,
      )

      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'ai', content: fullText }
        return updated
      })
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      const msg = err instanceof Error ? err.message : 'Request failed'
      setErrorMsg(msg)
      setMessages([
        ...newMessages,
        {
          role: 'ai',
          content: `Error: ${msg}. Please check your API key in Settings.`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendRef = useRef(handleSend)
  handleSendRef.current = handleSend

  useEffect(() => {
    const prefersReduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    messagesEndRef.current?.scrollIntoView({
      behavior: isLoading || prefersReduced ? 'auto' : 'smooth',
    })
  }, [messages, isLoading])

  useEffect(() => {
    saveHistoryForKey(storageKey, messages)
  }, [messages, storageKey])

  useEffect(() => {
    const hasComponents = canvasNodes.length > 0
    if (
      isOpen &&
      page === 'builder' &&
      messages.length === 0 &&
      apiKeyConfigured &&
      hasComponents &&
      !hasTriggeredRef.current
    ) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        void handleSendRef.current('Verify my architecture design', null, true)
        hasTriggeredRef.current = true
      }, 0)
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [isOpen, page, messages.length, apiKeyConfigured, canvasNodes])

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      setIsLoading(false)
      setMessages((prev) => {
        const last = prev[prev.length - 1]
        return last && last.role === 'ai' && !last.content ? prev.slice(0, -1) : prev
      })
    }
  }

  const handleRetry = (index: number) => {
    const userMsg = messages[index]
    if (userMsg && userMsg.role === 'user') {
      const newHistory = messages.slice(0, index)
      setMessages(newHistory)
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current)
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        void handleSend(userMsg.content, newHistory, true)
      }, 50)
    }
  }

  const handleClear = () => {
    setMessages([])
    saveHistoryForKey(storageKey, [])
    setErrorMsg(null)
  }

  const resizeCleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    return () => {
      resizeCleanupRef.current?.()
      resizeCleanupRef.current = null
    }
  }, [])

  const handleMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (isMobile) return
    e.preventDefault()
    resizeCleanupRef.current?.()
    const startX = e.clientX
    const startWidth = width

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = moveEvent.clientX - startX
      let newWidth = startWidth - deltaX
      if (newWidth < 300) newWidth = 300
      if (newWidth > 600) newWidth = 600
      setWidth(newWidth)
      safeStorage.setItem('toolbox_chat_width', String(newWidth))
    }

    const cleanup = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      if (resizeCleanupRef.current === cleanup) {
        resizeCleanupRef.current = null
      }
    }

    const handleMouseUp = () => {
      cleanup()
    }

    resizeCleanupRef.current = cleanup
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  if (!isOpen) return null

  const starterPrompts = (() => {
    if (page === 'guide') {
      return [
        'Explain the CAP Theorem with real examples',
        'How does consistent hashing work?',
        'Compare message queues: Kafka vs RabbitMQ vs SQS',
        'What is the difference between horizontal and vertical scaling?',
      ]
    }
    if (page === 'builder') {
      if (canvasNodes.length > 0) {
        return [
          'Verify my architecture for single points of failure',
          'Suggest improvements for scalability',
          `What protocols should connect my ${canvasNodes.length} components?`,
          'Estimate the throughput of this design',
        ]
      }
      return [
        'Help me design a URL shortener',
        'What components do I need for a chat system?',
        'Design a notification service architecture',
      ]
    }
    return [
      'Generate 5 flashcards about database sharding',
      'Quiz me on system design fundamentals',
      'Explain spaced repetition benefits',
      'Create cards for microservices patterns',
    ]
  })()

  const displayTitle =
    page === 'builder' && title === 'Verify Architecture'
      ? 'Ask about your architecture'
      : title

  const guideSubjectLabel = kitName ?? 'system design'

  return (
    <div
      className={`chat-panel border-l border-[var(--color-line)] bg-[var(--color-surface)]${
        isMobile ? ' mobile-fullscreen' : ''
      }`}
      id={`chat-panel-${page}`}
      style={isMobile ? { width: '100%' } : { width: `${width}px` }}
      data-testid="chat-panel-container"
    >
      {!isMobile && (
        <div
          className="chat-drag-handle"
          data-testid="chat-drag-handle"
          onMouseDown={handleMouseDown}
          style={{
            width: '8px',
            cursor: 'ew-resize',
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: 10,
          }}
        />
      )}

      <div className="chat-panel-header border-b border-[var(--color-line)] bg-[var(--color-surface-low)]">
        <div
          className="chat-panel-title flex items-center gap-2 text-[13.5px] font-medium text-[var(--color-ink)]"
          data-testid="chat-title"
        >
          <KitAvatar size={20} state={isLoading ? 'thinking' : 'idle'} />
          <span>{displayTitle}</span>
        </div>
        <div className="chat-header-actions flex items-center gap-1.5">
          <button
            type="button"
            aria-label="Clear conversation"
            onClick={handleClear}
            className="btn-clear-chat inline-flex min-h-[44px] cursor-pointer items-center rounded px-2.5 py-1 text-[12px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)] sm:min-h-0 sm:px-2"
          >
            Clear
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-icon h-11 w-11 sm:h-8 sm:w-8"
            onClick={() => toggleChat(page)}
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="chat-messages" data-testid="chat-messages-container">
        {messages.length === 0 && (
          <div className="empty-state px-4 py-8">
            <div className="mb-3 flex justify-center">
              <KitAvatar size={28} state="idle" />
            </div>
            <div className="empty-state-title font-serif text-[17px] text-[var(--color-ink)]">
              {apiKeyConfigured
                ? `Ask about ${
                    page === 'guide'
                      ? guideSubjectLabel
                      : page === 'builder'
                        ? 'your architecture'
                        : 'flashcards'
                  }`
                : 'Configure API Key'}
            </div>
            <div className="empty-state-description mt-1 text-[12.5px] text-[var(--color-ink-muted)]">
              {apiKeyConfigured
                ? 'Type a question below to get started.'
                : 'Add your API key in Settings to enable AI features.'}
            </div>
            {apiKeyConfigured && (
              <div
                className="starter-prompts mt-4 flex flex-col gap-2"
                data-testid="starter-prompts"
              >
                {starterPrompts.map((prompt, i) => (
                  <button
                    key={i}
                    type="button"
                    className="starter-prompt-btn w-full cursor-pointer rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] px-3 py-2 text-left text-[12.5px] text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
                    onClick={() => void handleSend(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1
          const showSkeleton = msg.role === 'ai' && isLast && isLoading && !msg.content
          if (msg.role === 'ai' && !msg.content && !showSkeleton) {
            return null
          }
          return (
            <div
              key={i}
              className={`chat-message ${msg.role}${showSkeleton ? ' loading' : ''}`}
              data-testid={`message-${msg.role}`}
            >
              {msg.role === 'ai' ? (
                <div className="mt-0.5 shrink-0">
                  <KitAvatar
                    size={20}
                    state={isLoading && isLast ? 'thinking' : 'idle'}
                  />
                </div>
              ) : (
                <div className="chat-message-avatar user">U</div>
              )}
              <div className={showSkeleton ? 'chat-message-content w-full' : 'chat-message-content'}>
                {showSkeleton ? (
                  <div className="flex flex-col gap-2" data-testid="chat-loading">
                    <Skeleton style={{ width: '90%', height: 16 }} />
                    <Skeleton style={{ width: '95%', height: 16 }} />
                    <Skeleton style={{ width: '80%', height: 16 }} />
                  </div>
                ) : (
                  <div className="chat-message-text">
                    <MarkdownRenderer content={msg.content} />
                  </div>
                )}
                {msg.role === 'ai' && Boolean(msg.content) && !showSkeleton && (
                  <div className="mt-1.5 flex justify-end">
                    <CopyButton text={msg.content} />
                  </div>
                )}
                {msg.role === 'user' && !isLoading && (
                  <div className="mt-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleRetry(i)}
                      className="btn-ghost inline-flex cursor-pointer items-center rounded p-1 text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-ink)]"
                      title="Retry this prompt"
                      aria-label="Retry this prompt"
                    >
                      <RotateCcw size={13} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {errorMsg && (
          <div
            role="alert"
            className="chat-error-alert m-2 rounded-lg border border-[var(--color-err)]/30 bg-[var(--color-diff-del-bg)] p-3 text-[12.5px] text-[var(--color-err)]"
            data-testid="chat-error"
          >
            Error: {errorMsg}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      <div className="chat-input-area border-t border-[var(--color-line)] bg-[var(--color-surface)] p-3">
        <InvitingComposer
          compact
          value={input}
          onChange={setInput}
          onSubmit={() => void handleSend()}
          placeholder={placeholder}
          textareaId={`chat-input-${page}`}
          textareaRef={inputRef}
          textareaClassName="chat-input"
          sendButtonClassName="chat-send-btn"
          submitLabel=""
          streaming={isLoading}
          onStop={handleStop}
          quotedHighlight={quotedSnippet}
          quoteTestId="chat-quoted-snippet"
          onClearQuote={clearQuote}
        />
      </div>
    </div>
  )
}

export default function ChatPanel(props: ChatPanelProps) {
  const activeKitSlug = useKitStore((s) => s.activeKitSlug)
  const { kit } = useActiveKit()
  const effectiveKitSlug =
    extractKitSlugFromPathname(window.location.pathname) || activeKitSlug
  const storageKey = effectiveKitSlug ? `${effectiveKitSlug}:${props.page}` : props.page
  const isCustomKit = Boolean(
    effectiveKitSlug &&
      effectiveKitSlug !== 'system-design' &&
      kit &&
      (kit as { slug?: string }).slug !== 'system-design',
  )
  const kitName = isCustomKit && kit ? kit.name : null

  return (
    <ChatPanelContent
      key={storageKey}
      {...props}
      storageKey={storageKey}
      kitName={kitName}
    />
  )
}
