import { useState, useEffect } from 'react'
import { MessageSquare } from 'lucide-react'
import PillarNav from '../components/guide/PillarNav'
import BlueprintShell from '../components/guide/BlueprintShell'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'

export default function GuidePage() {
  const chatOpen = useAppStore((s) => s.chatOpen.guide)
  const toggleChat = useAppStore((s) => s.toggleChat)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <div className="guide-layout" id="guide-page">
      {/* Left: Pillar navigation */}
      <PillarNav />

      {/* Center: Blueprint content */}
      <div className="guide-content">
        {/* Floating Ask AI button */}
        {!isMobile && !chatOpen && (
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

      {/* Right: AI Chat panel */}
      {!isMobile && (
        <ChatPanel
          page="guide"
          title="Ask about System Design"
          placeholder="Ask about this component..."
        />
      )}
    </div>
  )
}
