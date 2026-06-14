import { Menu, Sparkles } from 'lucide-react'
import useAppStore from '../../stores/appStore'
import { useLocation } from 'react-router-dom'

export default function MobileHeader({ onToggleMenu }) {
  const location = useLocation()
  const chatOpen = useAppStore((s) => s.chatOpen)
  const toggleChat = useAppStore((s) => s.toggleChat)

  // Determine which page we are on and if it has a chat panel
  const getPageKey = () => {
    if (location.pathname.startsWith('/chat')) return 'chat'
    if (location.pathname.startsWith('/guide')) return 'guide'
    if (location.pathname.startsWith('/builder')) return 'builder'
    if (location.pathname.startsWith('/study')) return 'study'
    return null
  }

  const pageKey = getPageKey()
  // Chat page has its own full-page chat — no toggle needed
  const hasChat = !!pageKey && pageKey !== 'chat'
  const isChatOpen = pageKey ? chatOpen[pageKey] : false

  // Determine page title
  const getTitle = () => {
    if (location.pathname.startsWith('/chat')) return 'Chat'
    if (location.pathname.startsWith('/guide')) return 'Guide'
    if (location.pathname.startsWith('/builder')) return 'Builder'
    if (location.pathname.startsWith('/study')) return 'Flashcards'
    if (location.pathname.startsWith('/settings')) return 'Settings'
    return 'Toolbox'
  }

  return (
    <header className="mobile-header">
      <button
        className="mobile-menu-btn hamburger-menu"
        onClick={onToggleMenu}
        aria-label="Toggle menu"
        id="mobile-menu-btn"
      >
        <Menu size={20} />
      </button>

      <div className="mobile-header-title">{getTitle()}</div>

      {hasChat ? (
        <button
          className={`mobile-chat-btn${isChatOpen ? ' active' : ''}`}
          onClick={() => toggleChat(pageKey)}
          aria-label="Toggle AI chat"
          id="mobile-chat-toggle"
        >
          <Sparkles size={18} />
        </button>
      ) : (
        <div style={{ width: 36 }} /> // Spacer to balance the layout
      )}
    </header>
  )
}
