import { Menu, Search } from 'lucide-react'
import { useLocation } from 'react-router'
import ModelPicker from '../shared/ModelPicker'
import useAppStore from '../../stores/appStore'
import { extractKitSlugFromPathname } from '../../stores/useKitStore'
import { KitLogo } from '../ui/KitLogo'

export interface MobileHeaderProps {
  onToggleMenu: () => void
}

export default function MobileHeader({ onToggleMenu }: MobileHeaderProps) {
  const location = useLocation()
  const setSearchOpen = useAppStore((s) => s.setSearchOpen)
  const slug = extractKitSlugFromPathname(location.pathname)
  const subPath = location.pathname.replace(/^\/k\/[^/]+/, '') || '/'
  const isChat = subPath.startsWith('/chat')

  const getTitle = (): string => {
    if (isChat) return 'Learn'
    if (subPath.startsWith('/guide')) return 'Guide'
    if (subPath.startsWith('/canvas')) return 'Concept Map'
    if (subPath.startsWith('/builder')) return 'Architecture'
    if (subPath.startsWith('/study')) return 'Flashcards'
    if (subPath.startsWith('/drills')) return 'Drills'
    if (subPath.startsWith('/feynman')) return 'Feynman'
    if (subPath.startsWith('/interleaved')) return 'Interleaved'
    if (subPath.startsWith('/graph')) return 'Graph'
    if (subPath.startsWith('/calculator')) return 'Calculator'
    if (subPath.startsWith('/review')) return 'Daily Review'
    if (subPath.startsWith('/shared')) return 'Shared Kits'
    if (subPath.startsWith('/design-system')) return 'Component Library'
    if (subPath.startsWith('/settings')) return 'Settings'
    if (slug && subPath === '/') return 'Path'
    return 'Toolbox'
  }

  return (
    <header
      className="mobile-header"
      style={{
        background: 'var(--color-surface-low)',
        borderBottom: '1px solid var(--color-line)',
      }}
    >
      <button
        type="button"
        className="mobile-menu-btn hamburger-menu"
        onClick={onToggleMenu}
        aria-label="Toggle menu"
        id="mobile-menu-btn"
      >
        <Menu size={20} />
      </button>

      <div className="mobile-header-title flex min-w-0 flex-1 items-center gap-1.5 px-1">
        <KitLogo size={18} ariaHidden />
        <span className="truncate">{getTitle()}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={() => setSearchOpen(true)}
          aria-label="Open search"
          id="mobile-search-btn"
        >
          <Search size={18} />
        </button>
        <ModelPicker variant="header" triggerId="mobile-header-model-trigger" />
      </div>
    </header>
  )
}
