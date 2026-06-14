import { useState, useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  MessageSquare,
  BookOpen,
  PenTool,
  GraduationCap,
  Settings,
  PanelLeftClose,
  Layers,
  BrainCircuit,
  Shuffle
} from 'lucide-react'
import useAppStore from '../../stores/appStore'
import PomodoroWidget from './PomodoroWidget'

const navItems = [
  {
    section: 'Study',
    items: [
      { to: '/chat', icon: MessageSquare, label: 'Chat', shortcut: '⌘1' },
      { to: '/guide', icon: BookOpen, label: 'Guide', shortcut: '⌘2' },
      { to: '/builder', icon: PenTool, label: 'Builder', shortcut: '⌘3' },
      { to: '/study', icon: GraduationCap, label: 'Flashcards', shortcut: '⌘4' },
      { to: '/feynman', icon: BrainCircuit, label: 'Feynman', shortcut: '⌘5' },
      { to: '/interleaved', icon: Shuffle, label: 'Interleaved', shortcut: '⌘6' },
    ],
  },
]

const bottomItems = [
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
]

export default function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const model = useAppStore((s) => s.model)
  const setModel = useAppStore((s) => s.setModel)
  const location = useLocation()

  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  return (
    <aside className={`sidebar${collapsed ? ' collapsed' : ''}${isMobile ? ' hidden-mobile' : ''}`} id="app-sidebar">
      {/* Header */}
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Layers size={16} />
        </div>
        <span className="sidebar-title">Toolbox</span>
      </div>

      {/* Navigation */}
      <nav className="sidebar-nav">
        {navItems.map((section) => (
          <div key={section.section}>
            <div className="sidebar-section-label">{section.section}</div>
            {section.items.map((item) => {
              const Icon = item.icon
              const isActive =
                location.pathname === item.to ||
                location.pathname.startsWith(item.to + '/')
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={`sidebar-link${isActive ? ' active' : ''}`}
                  id={`nav-${item.label.toLowerCase()}`}
                >
                  <Icon className="sidebar-link-icon" />
                  <span className="sidebar-link-label">{item.label}</span>
                  {!collapsed && item.shortcut && (
                    <span className="sidebar-shortcut">{item.shortcut}</span>
                  )}
                </NavLink>
              )
            })}
          </div>
        ))}

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Model Selection */}
        {!collapsed && (
          <div style={{ padding: '0 var(--space-4)', marginBottom: 'var(--space-2)' }}>
            <div className="sidebar-section-label" style={{ marginBottom: '4px' }}>Model</div>
            <select 
              value={model} 
              onChange={(e) => setModel(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--color-surface)',
                color: 'var(--color-text-secondary)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 8px',
                fontSize: '11px',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="gemini-3.5-flash">Gemini 3.5 Flash</option>
              <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro (High)</option>
            </select>
          </div>
        )}

        {/* Pomodoro Widget */}
        <PomodoroWidget />

        {/* Bottom nav items */}
        {bottomItems.map((item) => {
          const Icon = item.icon
          const isActive = location.pathname === item.to
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`sidebar-link${isActive ? ' active' : ''}`}
              id={`nav-${item.label.toLowerCase()}`}
            >
              <Icon className="sidebar-link-icon" />
              <span className="sidebar-link-label">{item.label}</span>
              {!collapsed && item.shortcut && (
                <span className="sidebar-shortcut">{item.shortcut}</span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* Collapse toggle */}
      <div className="sidebar-footer">
        <button
          className="sidebar-collapse-btn"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          id="sidebar-toggle"
        >
          <PanelLeftClose size={16} />
          {!collapsed && <span className="sidebar-link-label">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
