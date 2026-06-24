import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { MessageSquare } from 'lucide-react'
import PillarNav from '../components/guide/PillarNav'
import BlueprintShell from '../components/guide/BlueprintShell'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'
import useIsMobile from '../hooks/useIsMobile'

/**
 * GuidePage — The authoritative library of system design knowledge.
 *
 * This page serves as a read/reference experience:
 *  - /guide → Library overview with pillar cards and progress
 *  - /guide/:pillarId → Topics within a pillar
 *  - /guide/:pillarId/:topicId → Blueprint sections with committed content
 *
 * For interactive study sessions, use the Chat page (/chat).
 */
export default function GuidePage() {
  const { pillarId } = useParams()
  const chatOpen = useAppStore((s) => s.chatOpen.guide)
  const toggleChat = useAppStore((s) => s.toggleChat)

  const isMobile = useIsMobile()

  // ── Library layout — always show PillarNav + BlueprintShell ────────────────
  return (
    <div className="guide-layout" id="guide-page">
      {/* Left: Pillar navigation */}
      {pillarId && <PillarNav />}

      {/* Center: Blueprint content (or library overview if no pillar) */}
      <div className="guide-content">
        {/* Floating Ask AI button — only in blueprint view on desktop */}
        {!isMobile && !chatOpen && pillarId && (
          <button
            className="btn btn-primary floating-chat-btn"
            onClick={() => toggleChat('guide')}
          >
            <MessageSquare size={16} />
            Ask AI
          </button>
        )}

        <BlueprintShell />
      </div>

      {/* Right: AI Chat panel — only when viewing a specific pillar/topic */}
      {!isMobile && pillarId && (
        <ChatPanel
          page="guide"
          title="Ask about System Design"
          placeholder="Ask about this component..."
        />
      )}
    </div>
  )
}
