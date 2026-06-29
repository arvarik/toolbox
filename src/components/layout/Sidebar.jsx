import { useEffect } from 'react'
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
import useIsMobile from '../../hooks/useIsMobile'

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
  const availableModels = useAppStore((s) => s.availableModels)
  const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels)
  const location = useLocation()

  const isMobile = useIsMobile()

  // Fetch available models on mount
  useEffect(() => {
    fetchAvailableModels()
  }, [fetchAvailableModels])

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
              {availableModels.length > 0 ? (
                availableModels.map((group) => (
                  <optgroup key={group.provider.id} label={group.provider.name}>
                    {group.models.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </optgroup>
                ))
              ) : (
                <option value={model}>{model}</option>
              )}
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
