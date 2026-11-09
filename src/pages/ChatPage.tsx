import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'
import type { Pillar } from '../../shared/kits/kitSkeleton'
import LearningChat, { type ActiveStudyTopic } from '../components/chat/LearningChat'
import LearningTodo from '../components/chat/LearningTodo'
import useIsMobile from '../hooks/useIsMobile'
import useCommitStore from '../stores/useCommitStore'
import { useActiveKit, useKitRoutePrefix } from '../stores/useKitStore'

interface MobileDrawerProps {
  open: boolean
  onClose: () => void
  children: ReactNode
}

/**
 * Bottom-sheet drawer for mobile — slides up from the bottom edge.
 * Used to expose the LearningTodo panel on small screens.
 */
function MobileDrawer({ open, onClose, children }: MobileDrawerProps) {
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
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4) var(--space-2)',
          flexShrink: 0,
        }}>
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
 */
export default function ChatPage() {
  const isMobile = useIsMobile()
  const prefix = useKitRoutePrefix()
  const { kitSlug } = useActiveKit()
  const routeKitSlug = prefix ? decodeURIComponent(prefix.slice(3)) : null

  const [todoDrawerOpen, setTodoDrawerOpen] = useState(false)
  const startAnalysis = useCommitStore((s) => s.startAnalysis)
  const [activeStudyTopic, setActiveStudyTopic] = useState<ActiveStudyTopic | null>(null)

  // Reset dangling topic selection & drawer when switching Kits on /k/:slug/chat
  useEffect(() => {
    setActiveStudyTopic(null)
    setTodoDrawerOpen(false)
  }, [prefix, kitSlug])

  useEffect(() => {
    const handler = () => setTodoDrawerOpen(true)
    window.addEventListener('toggle-study-plan', handler)
    return () => window.removeEventListener('toggle-study-plan', handler)
  }, [])

  const handleStudyTopic = useCallback((pillar: Pillar, topic: Pillar['topics'][number]) => {
    setTodoDrawerOpen(false)
    requestAnimationFrame(() => setActiveStudyTopic({ pillar, topic }))
  }, [])

  return (
    <div className="learning-hub-layout" id="chat-page">
      {!isMobile && (
        <LearningTodo onStudyTopic={handleStudyTopic} />
      )}

      <div className="learning-hub-main">
        <LearningChat
          activeTopic={activeStudyTopic}
          onCommitClick={startAnalysis}
          routeKitSlug={routeKitSlug}
        />
      </div>

      {isMobile && (
        <MobileDrawer open={todoDrawerOpen} onClose={() => setTodoDrawerOpen(false)}>
          <LearningTodo onStudyTopic={handleStudyTopic} />
        </MobileDrawer>
      )}
    </div>
  )
}
