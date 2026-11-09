import { useEffect, useMemo } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import {
  MessageSquare,
  BookOpen,
  PenTool,
  GraduationCap,
  Settings,
  PanelLeftClose,
  Layers,
  BrainCircuit,
  Shuffle,
  Waypoints,
  Calculator,
  Sun,
  Moon,
  LogOut,
  Globe,
  FolderKanban,
} from 'lucide-react'
import useAppStore from '../../stores/appStore'
import useKitStore, {
  extractKitSlugFromPathname,
  useActiveKit,
  useKitRoutePrefix,
} from '../../stores/useKitStore'
import PomodoroWidget from './PomodoroWidget'
import ModelPicker from '../shared/ModelPicker'
import useIsMobile from '../../hooks/useIsMobile'
import { useAuth } from '../auth/AuthGate.tsx'

const workspaceItems = [
  { to: '/', icon: FolderKanban, label: 'Library', navId: 'nav-library' },
  { to: '/shared', icon: Globe, label: 'Shared Kits', navId: 'nav-shared' },
]

const bottomItems = [
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,' },
]

export function buildStudyNavItems(prefix, capabilities) {
  const inKit = Boolean(prefix)
  const items = [
    { to: `${prefix}/chat`, icon: MessageSquare, label: 'Chat', shortcut: '⌘1', navId: 'nav-chat' },
    { to: `${prefix}/guide`, icon: BookOpen, label: 'Guide', shortcut: '⌘2', navId: 'nav-guide' },
  ]

  if (!inKit || capabilities?.canvas !== 'none') {
    const isConcept = inKit && capabilities?.canvas === 'concept'
    items.push({
      to: isConcept ? `${prefix}/canvas` : `${prefix}/builder`,
      icon: PenTool,
      label: isConcept ? 'Concept Map' : 'Builder',
      shortcut: '⌘3',
      navId: 'nav-builder',
    })
  }

  items.push(
    { to: `${prefix}/study`, icon: GraduationCap, label: 'Flashcards', shortcut: '⌘4', navId: 'nav-flashcards' },
    { to: `${prefix}/feynman`, icon: BrainCircuit, label: 'Feynman', shortcut: '⌘5', navId: 'nav-feynman' },
    { to: `${prefix}/interleaved`, icon: Shuffle, label: 'Interleaved', shortcut: '⌘6', navId: 'nav-interleaved' },
    { to: `${prefix}/graph`, icon: Waypoints, label: 'Graph', shortcut: '⌘7', navId: 'nav-graph' },
  )

  if (!inKit || capabilities?.calculator !== false) {
    items.push({
      to: `${prefix}/calculator`,
      icon: Calculator,
      label: 'Calculator',
      shortcut: '⌘8',
      navId: 'nav-calculator',
    })
  }

  return items
}

export default function Sidebar() {
  const collapsed = useAppStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useAppStore((s) => s.toggleSidebar)
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels)
  const kits = useKitStore((s) => s.kits)
  const fetchKits = useKitStore((s) => s.fetchKits)
  const { skeleton, capabilities } = useActiveKit()
  const prefix = useKitRoutePrefix()
  const { authRequired, user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()

  const isMobile = useIsMobile()
  const urlSlug = extractKitSlugFromPathname(location.pathname)

  // Fetch available models & kits on mount
  useEffect(() => {
    fetchAvailableModels()
    fetchKits()
  }, [fetchAvailableModels, fetchKits])

  const studyItems = useMemo(
    () => buildStudyNavItems(prefix, capabilities),
    [prefix, capabilities],
  )

  const handleSwitchKit = (nextSlug) => {
    if (!nextSlug) {
      navigate('/')
      return
    }
    const subPath = location.pathname.replace(/^\/k\/[^/]+/, '') || '/guide'
    const firstSeg = subPath.split('/').filter(Boolean)[0] || 'guide'
    navigate(`/k/${encodeURIComponent(nextSlug)}/${firstSeg}`)
  }

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
        <div>
          <div className="sidebar-section-label">Workspace</div>
          {workspaceItems.map((item) => {
            const Icon = item.icon
            const isActive =
              item.to === '/'
                ? location.pathname === '/'
                : location.pathname === item.to ||
                  location.pathname.startsWith(item.to + '/')
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`sidebar-link${isActive ? ' active' : ''}`}
                id={item.navId}
              >
                <Icon className="sidebar-link-icon" />
                <span className="sidebar-link-label">{item.label}</span>
              </NavLink>
            )
          })}

          {!collapsed && (kits.length > 0 || urlSlug) && (
            <div style={{ padding: '6px var(--space-3) 2px' }}>
              <select
                aria-label="Active Study Kit"
                value={urlSlug || ''}
                onChange={(e) => handleSwitchKit(e.target.value)}
                className="w-full rounded-lg border border-outline-variant bg-surface-container-low text-on-surface text-xs px-2.5 py-1.5 cursor-pointer"
              >
                <option value="">All Kits (Library)</option>
                {kits.map((k) => (
                  <option key={k.id} value={k.slug}>
                    {k.icon ? `${k.icon} ` : ''}{k.name}
                  </option>
                ))}
                {urlSlug && !kits.some((k) => k.slug === urlSlug) && (
                  <option value={urlSlug}>
                    {skeleton.identity.icon ? `${skeleton.identity.icon} ` : ''}
                    {skeleton.identity.name}
                  </option>
                )}
              </select>
            </div>
          )}
        </div>

        <div>
          <div className="sidebar-section-label">
            {urlSlug ? skeleton.identity.name : 'Study'}
          </div>
          {studyItems.map((item) => {
            const Icon = item.icon
            const isActive =
              location.pathname === item.to ||
              location.pathname.startsWith(item.to + '/')
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`sidebar-link${isActive ? ' active' : ''}`}
                id={item.navId}
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

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Model Selection */}
        {!collapsed && (
          <div style={{ padding: '0 var(--space-4)', marginBottom: 'var(--space-2)' }}>
            <div className="sidebar-section-label" style={{ marginBottom: '4px' }}>Model</div>
            <ModelPicker variant="sidebar" />
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

      {/* Collapse & theme toggles */}
      <div className="sidebar-footer">
        {authRequired && user && (
          <button
            className="sidebar-collapse-btn"
            onClick={() => void logout()}
            aria-label={`Sign out ${user.username}`}
            title={`Signed in as @${user.username} — click to sign out`}
            style={{ marginBottom: '4px' }}
          >
            <LogOut size={16} />
            {!collapsed && (
              <span className="sidebar-link-label">
                @{user.username} · Sign out
              </span>
            )}
          </button>
        )}
        <button
          className="sidebar-collapse-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme (⌘D)' : 'Switch to dark theme (⌘D)'}
          id="theme-toggle-btn"
          data-testid="theme-toggle"
          style={{ marginBottom: '4px' }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {!collapsed && <span className="sidebar-link-label">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>}
        </button>
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
