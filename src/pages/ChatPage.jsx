import { useState, useEffect, useCallback } from 'react'
import { BookOpen, X } from 'lucide-react'
import LearningChat from '../components/chat/LearningChat'
import LearningTodo from '../components/chat/LearningTodo'
import CommitModal from '../components/chat/CommitModal'

/**
 * Bottom-sheet drawer for mobile — slides up from the bottom edge.
 * Used to expose the LearningTodo panel on small screens.
 */
function MobileDrawer({ open, onClose, children }) {
  // Prevent body scroll when drawer is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0,0,0,0.5)',
          backdropFilter: 'blur(2px)',
          zIndex: 400,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.25s ease',
        }}
      />
      {/* Sheet */}
      <div
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0,
          background: 'var(--color-surface)',
          borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
          border: '1px solid var(--color-border)',
          borderBottom: 'none',
          zIndex: 401,
          height: '75vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          transform: open ? 'translateY(0)' : 'translateY(100%)',
          transition: 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1)',
          boxShadow: '0 -8px 40px rgba(0,0,0,0.3)',
        }}
      >
        {/* Drag handle + close */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4) var(--space-2)',
          flexShrink: 0,
        }}>
          {/* Visual pill handle */}
          <div style={{ width: 40, height: 4, borderRadius: 'var(--radius-full)', background: 'var(--color-border)', margin: 'auto' }} />
          <button
            className="btn btn-ghost btn-icon btn-sm"
            onClick={onClose}
            style={{ position: 'absolute', right: 'var(--space-3)', top: 'var(--space-3)' }}
          >
            <X size={16} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {children}
        </div>
      </div>
    </>
  )
}

/**
 * ChatPage — Dedicated study session page with AI chat.
 *
 * Layout:
 *  - Left sidebar: LearningTodo (study progress tracker)
 *  - Center: LearningChat (full-page AI conversation)
 *  - CommitModal: Bridge from chat → guide library
 *
 * This page is purely about STUDYING through conversation.
 * The Guide page (/guide) is the authoritative library for reference.
 */
export default function ChatPage() {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  )

  // Mobile drawer state (LearningTodo)
  const [todoDrawerOpen, setTodoDrawerOpen] = useState(false)

  // Commit modal state
  const [commitOpen, setCommitOpen] = useState(false)
  const [learningMessages, setLearningMessages] = useState([])
  const [commitTopicContext, setCommitTopicContext] = useState(null) // { pillarId, topicId, topicName }

  // Active topic for LearningChat to fetch starters
  const [activeStudyTopic, setActiveStudyTopic] = useState(null)

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const handleCommitClick = useCallback((messages, topicContext) => {
    setLearningMessages(messages)
    setCommitTopicContext(topicContext || null)
    setCommitOpen(true)
  }, [])

  const handleStudyTopic = useCallback((pillar, topic) => {
    // Close the drawer first on mobile so user sees the chat
    setTodoDrawerOpen(false)
    // Use a frame delay so the drawer close animation starts before chat fires
    requestAnimationFrame(() => setActiveStudyTopic({ pillar, topic }))
  }, [])

  return (
    <div className="learning-hub-layout" id="chat-page">
      {/* Left: Smart To-Do — desktop only */}
      {!isMobile && (
        <LearningTodo onStudyTopic={handleStudyTopic} />
      )}

      {/* Center: Full-page Learning Chat */}
      <div className="learning-hub-main">
        {/* Mobile: Progress FAB */}
        {isMobile && (
          <div style={{
            padding: 'var(--space-2) var(--space-3)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'flex-end',
            background: 'var(--color-bg-secondary)',
            flexShrink: 0,
          }}>
            <button
              className="btn btn-secondary"
              style={{ fontSize: 'var(--text-xs)', display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
              onClick={() => setTodoDrawerOpen(true)}
              id="open-todo-drawer-btn"
            >
              <BookOpen size={13} />
              Study Plan
            </button>
          </div>
        )}

        <LearningChat
          activeTopic={activeStudyTopic}
          onCommitClick={handleCommitClick}
        />
      </div>

      {/* Mobile: To-Do drawer (bottom sheet) */}
      {isMobile && (
        <MobileDrawer open={todoDrawerOpen} onClose={() => setTodoDrawerOpen(false)}>
          <LearningTodo onStudyTopic={handleStudyTopic} />
        </MobileDrawer>
      )}

      {/* Commit Modal */}
      <CommitModal
        open={commitOpen}
        onClose={() => setCommitOpen(false)}
        messages={learningMessages}
        topicContext={commitTopicContext}
        onCommitSuccess={() => {}}
      />
    </div>
  )
}
