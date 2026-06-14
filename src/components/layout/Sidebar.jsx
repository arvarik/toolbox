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
  Sun,
  Moon,
  BrainCircuit,
  Shuffle,
  Timer
} from 'lucide-react'
import useAppStore from '../../stores/appStore'

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
      { to: '/flow', icon: Timer, label: 'Flow', shortcut: '⌘7' },
    ],
  },
]

const bottomItems = [
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
]

export default function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
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

        {/* Theme toggle */}
        <button
          className="sidebar-link"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          id="theme-toggle"
          style={{ border: 'none', background: 'none', width: '100%', textAlign: 'left' }}
        >
          {theme === 'dark' ? (
            <Sun className="sidebar-link-icon" />
          ) : (
            <Moon className="sidebar-link-icon" />
          )}
          <span className="sidebar-link-label">
            {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
          </span>
        </button>

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
