import { X, Layers, BookOpen, PenTool, GraduationCap, Settings, BrainCircuit, Shuffle, MessageSquare } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import PomodoroWidget from './PomodoroWidget'
import useAppStore from '../../stores/appStore'

const navItems = [
  { to: '/chat', icon: MessageSquare, label: 'Chat' },
  { to: '/guide', icon: BookOpen, label: 'Guide' },
  { to: '/builder', icon: PenTool, label: 'Builder' },
  { to: '/study', icon: GraduationCap, label: 'Flashcards' },
  { to: '/feynman', icon: BrainCircuit, label: 'Feynman' },
  { to: '/interleaved', icon: Shuffle, label: 'Interleaved' },
]

export default function MobileDrawer({ open, onClose }) {
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)

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
          
          <div style={{ marginTop: 'auto', paddingTop: 'var(--space-4)', borderTop: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            
            <div style={{ padding: '0 var(--space-4)' }}>
              <div className="sidebar-section-label" style={{ marginBottom: '4px', fontSize: '11px', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>Model</div>
              <select 
                value={model} 
                onChange={(e) => setModel(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--color-surface)',
                  color: 'var(--color-text-secondary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '6px 8px',
                  fontSize: '13px',
                  outline: 'none',
                  cursor: 'pointer'
                }}
              >
                <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
                <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (High)</option>
              </select>
            </div>

            <PomodoroWidget />

            <NavLink
              to="/settings"
              onClick={onClose}
              className={({ isActive }) =>
                `mobile-drawer-link${isActive ? ' active' : ''}`
              }
              id="drawer-nav-settings"
            >
              <Settings size={18} />
              <span>Settings</span>
            </NavLink>
          </div>
        </nav>
      </div>
    </div>
  )
}
