import { Menu, BookOpen } from 'lucide-react'
import { useLocation } from 'react-router-dom'
import ModelPicker from '../shared/ModelPicker'
import { extractKitSlugFromPathname } from '../../stores/useKitStore'

export interface MobileHeaderProps {
  onToggleMenu: () => void
}

export default function MobileHeader({ onToggleMenu }: MobileHeaderProps) {
  const location = useLocation()
  const slug = extractKitSlugFromPathname(location.pathname)
  const subPath = location.pathname.replace(/^\/k\/[^/]+/, '') || '/'
  const isChat = subPath.startsWith('/chat')

  const getTitle = (): string => {
    if (isChat) return 'Chat'
    if (subPath.startsWith('/guide')) return 'Guide'
    if (subPath.startsWith('/canvas')) return 'Concept Map'
    if (subPath.startsWith('/builder')) return 'Builder'
    if (subPath.startsWith('/study')) return 'Flashcards'
    if (subPath.startsWith('/drills')) return 'Drills'
    if (subPath.startsWith('/feynman')) return 'Feynman'
    if (subPath.startsWith('/interleaved')) return 'Interleaved'
    if (subPath.startsWith('/graph')) return 'Graph'
    if (subPath.startsWith('/calculator')) return 'Calculator'
    if (subPath.startsWith('/review')) return 'Daily Review'
    if (subPath.startsWith('/shared')) return 'Shared Kits'
    if (subPath.startsWith('/settings')) return 'Settings'
    if (slug && subPath === '/') return 'Path'
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

      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
        <ModelPicker variant="header" />
        {isChat && (
          <button
            className="btn btn-secondary btn-sm"
            style={{
              fontSize: '11px',
              padding: '4px 8px',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              flexShrink: 0,
            }}
            onClick={() => window.dispatchEvent(new CustomEvent('toggle-study-plan'))}
          >
            <BookOpen size={12} />
            Plan
          </button>
        )}
      </div>
    </header>
  )
}
