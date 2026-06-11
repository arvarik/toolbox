import { useState, useRef, useEffect } from 'react'
import { Send, X, Sparkles } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import { chatApi } from '../../utils/api'

/**
 * Reusable AI chat panel used in Guide, Builder, and Study pages.
 * @param {string} page - Which page this chat belongs to ('guide' | 'builder' | 'study')
 * @param {string} title - Panel title
 * @param {string} placeholder - Input placeholder text
 * @param {Array} initialMessages - Starting messages for context
 * @param {string} context - Additional context string for the AI
 */
export default function ChatPanel({ page, title = 'Ask AI', placeholder = 'Ask a question...', initialMessages = [], context = '' }) {
  const isOpen = useAppStore((s) => s.chatOpen[page])
  const toggleChat = useAppStore((s) => s.toggleChat)
  const apiKeyConfigured = useAppStore((s) => s.apiKeyConfigured)
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus()
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = async () => {
    if (!input.trim() || isLoading) return

    const userMessage = { role: 'user', content: input.trim() }
    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const contextString = context || `The user is on the ${page} page of a system design interview study tool.`
      const data = await chatApi.send({
        message: userMessage.content,
        context: contextString,
        history: messages,
      })
      setMessages((prev) => [
        ...prev,
        { role: 'ai', content: data.response },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          content: `Error: ${err.message}. Please check your API key in Settings.`,
        },
      ])
    } finally {
      setIsLoading(false)
    }
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  if (!isOpen) return null

  return (
    <div className="chat-panel" id={`chat-panel-${page}`}>
      {/* Header */}
      <div className="chat-panel-header">
        <div className="chat-panel-title">
          <span className="ai-dot" />
          <Sparkles size={14} />
          {title}
        </div>
        <button
          className="btn btn-ghost btn-icon"
          onClick={() => toggleChat(page)}
          aria-label="Close chat"
        >
          <X size={16} />
        </button>
      </div>

      {/* Messages */}
      <div className="chat-messages">
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
                : 'Add your Gemini API key in Settings to enable AI features.'}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`chat-message ${msg.role}`}>
            <div className={`chat-message-avatar ${msg.role}`}>
              {msg.role === 'ai' ? '✦' : 'U'}
            </div>
            <div className="chat-message-content">
              <div className="chat-message-text">{msg.content}</div>
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="chat-message ai">
            <div className="chat-message-avatar ai">✦</div>
            <div className="chat-message-content">
              <div className="chat-message-text" style={{ opacity: 0.5 }}>
                Thinking...
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="chat-input-area">
        <div className="chat-input-wrapper">
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
            onClick={handleSend}
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
