import { useState, useRef, useEffect } from 'react'
import { Send, X, Sparkles, Copy, Check, RotateCcw, Square } from 'lucide-react'
import MarkdownRenderer from './MarkdownRenderer'
import useAppStore from '../../stores/appStore'
import useIsMobile from '../../hooks/useIsMobile'
import { chatApi } from '../../utils/api'
import Skeleton from './Skeleton'

// Safe storage wrapper to prevent SSR or restricted environment crashes
const safeStorage = {
  getItem: (key) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(key)
      }
    } catch {
      // Ignore
    }
    return null
  },
  setItem: (key, value) => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, value)
      }
    } catch {
      // Ignore
    }
  },
}

// Helper functions for page history storage structure
const getHistoryForPage = (currentPage) => {
  const data = safeStorage.getItem('toolbox_chat_history')
  if (data) {
    try {
      const parsed = JSON.parse(data)
      if (parsed && typeof parsed === 'object') {
        const history = parsed[currentPage]
        if (Array.isArray(history)) {
          return history
        }
      }
    } catch {
      // Ignore
    }
  }
  return []
}

const MAX_HISTORY_PER_PAGE = 50

const saveHistoryForPage = (currentPage, messages) => {
  const data = safeStorage.getItem('toolbox_chat_history')
  let parsed = {}
  if (data) {
    try {
      parsed = JSON.parse(data)
      if (!parsed || typeof parsed !== 'object') {
        parsed = {}
      }
    } catch {
      // Ignore
    }
  }
  // Keep only the last N messages to prevent localStorage bloat
  parsed[currentPage] = messages.slice(-MAX_HISTORY_PER_PAGE)
  safeStorage.setItem('toolbox_chat_history', JSON.stringify(parsed))
}

// Subcomponent CopyButton with dynamic state-based visual feedback
function CopyButton({ text }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback
      const textarea = document.createElement('textarea')
      textarea.value = text
      document.body.appendChild(textarea)
      textarea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        // Ignore
      }
      document.body.removeChild(textarea)
    }
  }

  return (
    <button
      className="btn-copy-chat"
      onClick={handleCopy}
      aria-label={copied ? 'Copied!' : 'Copy to clipboard'}
      title={copied ? 'Copied!' : 'Copy to clipboard'}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '2px',
        display: 'flex',
        alignItems: 'center',
        color: 'var(--color-text-muted)',
      }}
    >
      {copied ? (
        <Check size={14} style={{ color: 'var(--color-success, #22c55e)' }} />
      ) : (
        <Copy size={14} />
      )}
    </button>
  )
}

function ChatPanelContent({ page, title = 'Ask AI', placeholder = 'Ask a question...', initialMessages = [], context = '' }) {
  const isOpen = useAppStore((s) => s.chatOpen[page])
  const toggleChat = useAppStore((s) => s.toggleChat)
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const selectedModel = useAppStore((s) => s.model)
  const canvasNodes = useAppStore((s) => s.nodes) || []
  const canvasEdges = useAppStore((s) => s.edges) || []

  const isMobile = useIsMobile()

  // Load width state from safeStorage
  const [width, setWidth] = useState(() => {
    const saved = safeStorage.getItem('toolbox_chat_width')
    const parsed = saved ? parseInt(saved, 10) : 350
    return isNaN(parsed) || parsed < 300 || parsed > 600 ? 350 : parsed
  })

  // Load initial messages from safeStorage if available
  const [messages, setMessages] = useState(() => {
    const history = getHistoryForPage(page)
    return Array.isArray(history) && history.length > 0 ? history : initialMessages
  })

  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  const timeoutRef = useRef(null)
  const hasTriggeredRef = useRef(false)
  const abortControllerRef = useRef(null)

  const handleSend = async (customText, overrideHistory = null) => {
    const text = typeof customText === 'string' ? customText : input.trim()
    // isLoading and empty text guard
    if (!text || isLoading) return

    const currentHistory = overrideHistory || messages
    const userMessage = { role: 'user', content: text }
    const newMessages = [...currentHistory, userMessage]
    setMessages(newMessages)
    
    // Clear input if we typed it
    if (typeof customText !== 'string') {
      setInput('')
    }
    
    setIsLoading(true)
    setErrorMsg(null)

    try {
      const contextString = (() => {
        if (context) return context
        if (page === 'builder' && canvasNodes.length > 0) {
          const nodeNames = canvasNodes.map((n) => `${n.name} (${n.category})`).join(', ')
          const edgeDescs = canvasEdges.map((e) => {
            const fromNode = canvasNodes.find((n) => n.id === e.from)
            const toNode = canvasNodes.find((n) => n.id === e.to)
            return `${fromNode?.name || 'Unknown'} → ${toNode?.name || 'Unknown'}`
          }).join(', ')
          let desc = `The user is designing a system architecture with ${canvasNodes.length} components: ${nodeNames}.`
          if (canvasEdges.length > 0) {
            desc += ` Connections: ${edgeDescs}.`
          }
          desc += ' Analyze this architecture, identify potential issues, and suggest improvements.'
          return desc
        }
        return `The user is on the ${page} page of a system design interview study tool.`
      })()

      // Add an empty AI message placeholder for streaming
      const aiPlaceholder = { role: 'ai', content: '' }
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
          // Update the AI message content incrementally
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'ai', content: partialText }
            return updated
          })
        },
        null,
        signal
      )

      // Final update with complete text
      setMessages((prev) => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'ai', content: fullText }
        return updated
      })
    } catch (err) {
      if (err.name === 'AbortError') return
      setErrorMsg(err.message)
      setMessages([...newMessages, {
        role: 'ai',
        content: `Error: ${err.message}. Please check your API key in Settings.`,
      }])
    } finally {
      setIsLoading(false)
    }
  }

  // Auto-focus input when panel opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Save history on changes
  useEffect(() => {
    saveHistoryForPage(page, messages)
  }, [messages, page])

  // Subscribe to nodes changes for auto-verification on builder page
  useEffect(() => {
    const hasComponents = canvasNodes.length > 0
    if (isOpen && page === 'builder' && messages.length === 0 && apiKeyConfigured && hasComponents && !hasTriggeredRef.current) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = setTimeout(() => {
        handleSend('Verify my architecture design')
        hasTriggeredRef.current = true
      }, 0)
    }
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, page, messages.length, apiKeyConfigured, canvasNodes])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
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

  const handleClear = () => {
    setMessages([])
    saveHistoryForPage(page, [])
    setErrorMsg(null)
  }

  const handleMouseDown = (e) => {
    if (isMobile) return
    e.preventDefault()
    const startX = e.clientX
    const startWidth = isNaN(width) ? 350 : width

    const handleMouseMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX
      let newWidth = startWidth - deltaX
      if (isNaN(newWidth) || typeof newWidth !== 'number') {
        newWidth = 350
      }
      if (newWidth < 300) newWidth = 300
      if (newWidth > 600) newWidth = 600
      setWidth(newWidth)
      safeStorage.setItem('toolbox_chat_width', String(newWidth))
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  const parseMarkdown = (text) => {
    if (!text) return null
    return <MarkdownRenderer content={text} />
  }

  if (!isOpen) return null

  // Contextual AI prompts — adapt based on page state
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
    // study page
    return [
      'Generate 5 flashcards about database sharding',
      'Quiz me on system design fundamentals',
      'Explain spaced repetition benefits',
      'Create cards for microservices patterns',
    ]
  })()

  const displayTitle = (page === 'builder' && title === 'Verify Architecture') 
    ? 'Ask about your architecture' 
    : title

  return (
    <div
      className={`chat-panel${isMobile ? ' mobile-fullscreen' : ''}`}
      id={`chat-panel-${page}`}
      style={isMobile ? { width: '100%' } : { width: `${width}px` }}
      data-testid="chat-panel-container"
    >
      {/* Resizable Drag Handle */}
      {!isMobile && (
        <div 
          className="chat-drag-handle" 
          data-testid="chat-drag-handle"
          onMouseDown={handleMouseDown}
          style={{ width: '8px', cursor: 'ew-resize', position: 'absolute', left: 0, top: 0, bottom: 0, zIndex: 10 }}
        />
      )}

      {/* Header */}
      <div className="chat-panel-header">
        <div className="chat-panel-title" data-testid="chat-title">
          <span className="ai-dot" />
          <Sparkles size={14} />
          {displayTitle}
        </div>
        <div className="chat-header-actions" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <button aria-label="Clear conversation" onClick={handleClear} className="btn-clear-chat" style={{ fontSize: 'var(--text-xs)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
            Clear
          </button>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => toggleChat(page)}
            aria-label="Close chat"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="chat-messages" data-testid="chat-messages-container">
        {messages.length === 0 && (
          <div className="empty-state" style={{ padding: 'var(--space-8) var(--space-4)' }}>
            <div className="empty-state-icon">
              <Sparkles size={24} />
            </div>
            <div className="empty-state-title" style={{ fontSize: 'var(--text-md)' }}>
              {apiKeyConfigured ? `Ask about ${page === 'guide' ? 'system design' : page === 'builder' ? 'your architecture' : 'flashcards'}` : 'Configure API Key'}
            </div>
            <div className="empty-state-description" style={{ fontSize: 'var(--text-xs)' }}>
              {apiKeyConfigured
                ? 'Type a question below to get started.'
                : 'Add your API key in Settings to enable AI features.'}
            </div>
            {apiKeyConfigured && (
              <div className="starter-prompts" data-testid="starter-prompts" style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {starterPrompts.map((prompt, i) => (
                  <button key={i} className="starter-prompt-btn" onClick={() => handleSend(prompt)} style={{ textAlign: 'left', width: '100%' }}>
                    {prompt}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`} data-testid={`message-${msg.role}`}>
            <div className={`chat-message-avatar ${msg.role}`}>
              {msg.role === 'ai' ? '✦' : 'U'}
            </div>
            <div className="chat-message-content">
              <div className="chat-message-text">{parseMarkdown(msg.content)}</div>
              {msg.role === 'ai' && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-2)' }}>
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
          <div className="chat-message ai loading" data-testid="chat-loading">
            <div className="chat-message-avatar ai">✦</div>
            <div className="chat-message-content" style={{ width: '100%' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Skeleton style={{ width: '90%', height: 16 }} />
                <Skeleton style={{ width: '95%', height: 16 }} />
                <Skeleton style={{ width: '80%', height: 16 }} />
              </div>
            </div>
          </div>
        )}

        {errorMsg && (
          <div role="alert" className="chat-error-alert" data-testid="chat-error" style={{ color: 'var(--color-error)', padding: 'var(--space-3)', margin: 'var(--space-2)', borderRadius: 'var(--radius-md)', background: 'rgba(239, 68, 68, 0.1)' }}>
            Error: {errorMsg}
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
          {isLoading && (
            <button
              onClick={handleStop}
              style={{
                position: 'absolute',
                top: '-32px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '4px 10px',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
                cursor: 'pointer',
                color: 'var(--color-text-secondary)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
                zIndex: 10
              }}
            >
              <Square fill="currentColor" size={10} /> Stop generating
            </button>
          )}
          <textarea
            ref={inputRef}
            className="chat-input"
            placeholder={placeholder}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            id={`chat-input-${page}`}
          />
          <button
            className="chat-send-btn"
            onClick={() => handleSend()}
            disabled={!input.trim() || isLoading}
            aria-label="Send message"
          >
            <Send size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ChatPanel(props) {
  return <ChatPanelContent key={props.page} {...props} />
}
