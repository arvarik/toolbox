import { Menu, BookOpen } from 'lucide-react'
import { useLocation } from 'react-router-dom'

export default function MobileHeader({ onToggleMenu }) {
  const location = useLocation()
  const isChat = location.pathname.startsWith('/chat')

  // Determine page title
  const getTitle = () => {
    if (isChat) return 'Chat'
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
      
      {isChat ? (
        <button
          className="btn btn-secondary btn-sm"
          style={{ fontSize: '11px', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: '4px' }}
          onClick={() => window.dispatchEvent(new CustomEvent('toggle-study-plan'))}
        >
          <BookOpen size={12} />
          Plan
        </button>
      ) : (
        <div style={{ width: 36 }} />
      )}
    </header>
  )
}
