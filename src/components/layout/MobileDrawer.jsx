import { X, Layers, BookOpen, PenTool, GraduationCap, Settings } from 'lucide-react'
import { NavLink } from 'react-router-dom'

const navItems = [
  { to: '/guide', icon: BookOpen, label: 'Guide' },
  { to: '/builder', icon: PenTool, label: 'Builder' },
  { to: '/study', icon: GraduationCap, label: 'Flashcards' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

export default function MobileDrawer({ open, onClose }) {
  if (!open) return null

  return (
    <div className="mobile-drawer-overlay mobile-overlay" onClick={onClose} id="mobile-nav-overlay">
      <div 
        className="mobile-drawer" 
        onClick={(e) => e.stopPropagation()}
        id="mobile-drawer"
      >
        <div className="mobile-drawer-header">
          <div className="sidebar-logo">
            <Layers size={16} />
          </div>
          <span className="sidebar-title">Toolbox</span>
          <button 
            className="mobile-drawer-close close-btn" 
            onClick={onClose}
            aria-label="Close menu"
            id="mobile-nav-close"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="mobile-drawer-nav" role="navigation" aria-label="mobile">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={onClose}
                className={({ isActive }) =>
                  `mobile-drawer-link${isActive ? ' active' : ''}`
                }
                id={`drawer-nav-${item.label.toLowerCase()}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}
        </nav>
      </div>
    </div>
  )
}
