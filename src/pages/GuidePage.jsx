import { MessageSquare } from 'lucide-react'
import PillarNav from '../components/guide/PillarNav'
import BlueprintShell from '../components/guide/BlueprintShell'
import ChatPanel from '../components/shared/ChatPanel'
import useAppStore from '../stores/appStore'

export default function GuidePage() {
  const chatOpen = useAppStore((s) => s.chatOpen.guide)
  const toggleChat = useAppStore((s) => s.toggleChat)

  return (
    <div className="guide-layout" id="guide-page">
      {/* Left: Pillar navigation */}
      <PillarNav />

      {/* Center: Blueprint content */}
      <div className="guide-content">
        {/* Floating Ask AI button */}
        {!chatOpen && (
          <button
            className="btn btn-primary"
            onClick={() => toggleChat('guide')}
            id="guide-ask-ai-btn"
            style={{
              position: 'absolute',
              bottom: 'var(--space-6)',
              right: 'var(--space-6)',
              zIndex: 'var(--z-dropdown)',
              boxShadow: 'var(--shadow-lg), var(--shadow-glow)',
              borderRadius: 'var(--radius-full)',
              padding: 'var(--space-3) var(--space-5)',
              gap: 'var(--space-2)',
            }}
          >
            <MessageSquare size={16} />
            Ask AI
          </button>
        )}

        <BlueprintShell />
      </div>

      {/* Right: AI Chat panel */}
      <ChatPanel
        page="guide"
        title="Ask about System Design"
        placeholder="Ask about this component..."
      />
    </div>
  )
}
