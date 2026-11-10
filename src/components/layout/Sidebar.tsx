import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router'
import {
  MessageSquare,
  BookOpen,
  PenTool,
  GraduationCap,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  BrainCircuit,
  Shuffle,
  Waypoints,
  Calculator,
  Sun,
  Moon,
  LogOut,
  Globe,
  FolderKanban,
  Compass,
  Target,
  Flame,
  Blocks,
  ChevronDown,
  Check,
  Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { KitSkeletonV1 } from '../../../shared/kits/kitSkeleton'
import useAppStore from '../../stores/appStore'
import useCommitStore from '../../stores/useCommitStore'
import useKitStore, {
  extractKitSlugFromPathname,
  useActiveKit,
  useKitRoutePrefix,
} from '../../stores/useKitStore'
import PomodoroWidget from './PomodoroWidget'
import ModelPicker from '../shared/ModelPicker'
import useIsMobile from '../../hooks/useIsMobile'
import { useAuth } from '../auth/AuthGate'
import { DomainGlyph, Kbd, KitLogo, resolveKitGlyph } from '../ui'

export interface StudyNavItem {
  to: string
  icon: LucideIcon
  label: string
  shortcut?: string
  navId: string
  exact?: boolean
}

export const workspaceItems: readonly StudyNavItem[] = [
  { to: '/', icon: FolderKanban, label: 'Library', navId: 'nav-library', exact: true },
  { to: '/review', icon: Flame, label: 'Daily Review', navId: 'nav-review' },
  { to: '/shared', icon: Globe, label: 'Shared Kits', navId: 'nav-shared' },
]

export const bottomItems: readonly StudyNavItem[] = [
  {
    to: '/design-system',
    icon: Blocks,
    label: 'Component Library',
    navId: 'nav-design-system',
  },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '⌘,', navId: 'nav-settings' },
]

const KIT_SUBROUTES = new Set([
  'chat',
  'guide',
  'drills',
  'builder',
  'canvas',
  'study',
  'feynman',
  'interleaved',
  'graph',
  'calculator',
])

export function buildStudyNavItems(
  prefix: string,
  capabilities?: Partial<KitSkeletonV1['capabilities']> | null,
): StudyNavItem[] {
  const inKit = Boolean(prefix)
  const items: StudyNavItem[] = []

  if (inKit) {
    items.push({
      to: prefix,
      icon: Compass,
      label: 'Path',
      navId: 'nav-path',
      exact: true,
    })
  }

  items.push(
    { to: `${prefix}/chat`, icon: MessageSquare, label: 'Learn', shortcut: '⌘1', navId: 'nav-chat' },
    { to: `${prefix}/guide`, icon: BookOpen, label: 'Guide', shortcut: '⌘2', navId: 'nav-guide' },
    { to: `${prefix}/drills`, icon: Target, label: 'Drills', navId: 'nav-drills' },
  )

  if (!inKit || capabilities?.canvas !== 'none') {
    const isConcept = inKit && capabilities?.canvas === 'concept'
    items.push({
      to: isConcept ? `${prefix}/canvas` : `${prefix}/builder`,
      icon: PenTool,
      label: isConcept ? 'Concept Map' : 'Architecture',
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

interface SwitcherOption {
  kind: 'library' | 'kit' | 'new'
  slug: string
  label: string
  glyphHint: string
}

export function ActiveKitSwitcher({ onAfterSelect }: { onAfterSelect?: () => void }) {
  const kits = useKitStore((s) => s.kits)
  const { skeleton } = useActiveKit()
  const location = useLocation()
  const navigate = useNavigate()
  const urlSlug = extractKitSlugFromPathname(location.pathname)

  const [open, setOpen] = useState(false)
  const [focusIdx, setFocusIdx] = useState(0)
  const wrapRef = useRef<HTMLDivElement>(null)
  const listboxId = useId()

  const options = useMemo<SwitcherOption[]>(() => {
    const list: SwitcherOption[] = [
      { kind: 'library', slug: '', label: 'All Kits (Library)', glyphHint: 'notebook' },
      ...kits.map((k) => ({
        kind: 'kit' as const,
        slug: k.slug,
        label: k.name,
        glyphHint: `${k.slug} ${k.name} ${k.icon ?? ''}`,
      })),
    ]
    if (urlSlug && !kits.some((k) => k.slug === urlSlug)) {
      list.push({
        kind: 'kit',
        slug: urlSlug,
        label: skeleton.identity.name,
        glyphHint: `${urlSlug} ${skeleton.identity.name} ${skeleton.identity.icon ?? ''}`,
      })
    }
    list.push({ kind: 'new', slug: '__new__', label: '+ New Study Kit', glyphHint: 'notebook' })
    return list
  }, [kits, urlSlug, skeleton.identity.name, skeleton.identity.icon])

  const activeEntry = urlSlug ? options.find((o) => o.kind === 'kit' && o.slug === urlSlug) : null
  const activeLabel = activeEntry ? activeEntry.label : 'All Kits (Library)'
  const activeGlyph = activeEntry ? resolveKitGlyph(activeEntry.glyphHint) : 'notebook'

  useEffect(() => {
    if (!open) return
    const onDocPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onDocPointer)
    document.addEventListener('keydown', onEsc)
    return () => {
      document.removeEventListener('pointerdown', onDocPointer)
      document.removeEventListener('keydown', onEsc)
    }
  }, [open])

  const selectOption = (opt: SwitcherOption) => {
    setOpen(false)
    if (opt.kind === 'new') {
      navigate('/new')
      onAfterSelect?.()
      return
    }
    if (!opt.slug) {
      navigate('/')
      onAfterSelect?.()
      return
    }
    const subPath = location.pathname.replace(/^\/k\/[^/]+/, '')
    const firstSeg = subPath.split('/').filter(Boolean)[0]
    navigate(
      firstSeg && KIT_SUBROUTES.has(firstSeg)
        ? `/k/${encodeURIComponent(opt.slug)}/${firstSeg}`
        : `/k/${encodeURIComponent(opt.slug)}`,
    )
    onAfterSelect?.()
  }

  const toggleOpen = () => {
    const idx = Math.max(
      0,
      options.findIndex((o) => (urlSlug ? o.slug === urlSlug : o.kind === 'library')),
    )
    setFocusIdx(idx)
    setOpen((prev) => !prev)
  }

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleOpen()
      }
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusIdx((i) => (i + 1) % options.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusIdx((i) => (i - 1 + options.length) % options.length)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const picked = options[focusIdx]
      if (picked) selectOption(picked)
    }
  }

  return (
    <div ref={wrapRef} onKeyDown={handleKeyDown} className="relative">
      <button
        type="button"
        aria-label={`Active Study Kit: ${activeLabel}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        onClick={toggleOpen}
        className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border border-[var(--color-line-strong)] bg-[var(--color-surface-elevated)] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--color-ink)] shadow-[var(--shadow-hairline)] transition-colors hover:bg-[var(--color-surface-hover)] active:scale-[0.98]"
      >
        <span className="flex min-w-0 items-center gap-2">
          <DomainGlyph kind={activeGlyph} size={14} className="text-[var(--color-ink-muted)]" />
          <span className="truncate">{activeLabel}</span>
        </span>
        <ChevronDown
          size={13}
          className={`shrink-0 text-[var(--color-ink-faint)] transition-transform duration-150 ${
            open ? 'rotate-180 text-[var(--color-ink)]' : ''
          }`}
        />
      </button>

      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Study Kits"
          className="animate-popover-enter absolute top-[calc(100%+6px)] right-0 left-0 z-50 max-h-72 overflow-y-auto rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface-card)] p-1 shadow-[var(--shadow-float)]"
        >
          {options.map((opt, idx) => {
            const isSelected =
              opt.kind === 'library'
                ? !urlSlug && location.pathname !== '/new'
                : opt.kind === 'kit' && opt.slug === urlSlug
            const isFocused = idx === focusIdx

            return (
              <div key={`${opt.kind}-${opt.slug}`}>
                {opt.kind === 'new' && (
                  <div className="my-1 border-t border-[var(--color-line)]" role="separator" />
                )}
                <button
                  role="option"
                  type="button"
                  aria-selected={isSelected}
                  onMouseEnter={() => setFocusIdx(idx)}
                  onClick={() => selectOption(opt)}
                  className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors ${
                    isFocused ? 'bg-[var(--color-surface-hover)]' : ''
                  } ${
                    opt.kind === 'new'
                      ? 'font-medium text-[var(--color-ink)]'
                      : 'text-[var(--color-ink)]'
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {opt.kind === 'library' ? (
                      <FolderKanban size={14} className="shrink-0 text-[var(--color-ink-muted)]" />
                    ) : opt.kind === 'new' ? (
                      <Plus size={14} className="shrink-0 text-[var(--color-brand)]" />
                    ) : (
                      <DomainGlyph
                        kind={resolveKitGlyph(opt.glyphHint)}
                        size={14}
                        className="text-[var(--color-ink-muted)]"
                      />
                    )}
                    <span className="truncate">{opt.label}</span>
                  </span>
                  {isSelected && (
                    <Check size={13} strokeWidth={2.4} className="shrink-0 text-[var(--color-brand)]" />
                  )}
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const activeLinkStyle = {
  background: 'var(--color-surface-elevated)',
  color: 'var(--color-ink)',
  boxShadow: 'var(--shadow-hairline)',
} as const

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

  const isMobile = useIsMobile()
  const urlSlug = extractKitSlugFromPathname(location.pathname)

  useEffect(() => {
    void fetchAvailableModels()
    void fetchKits()
  }, [fetchAvailableModels, fetchKits])

  const studyItems = useMemo(
    () => buildStudyNavItems(prefix, capabilities),
    [prefix, capabilities],
  )

  const handleSignOut = () => {
    useAppStore.getState().resetWorkspaceState()
    useCommitStore.getState().closeCompletely()
    useKitStore.setState({ kits: [], activeKitSlug: null, activeKit: null, kitCache: {} })
    void logout()
  }

  return (
    <aside
      className={`sidebar${collapsed ? ' collapsed' : ''}${isMobile ? ' hidden-mobile' : ''}`}
      id="app-sidebar"
      style={{
        background: 'var(--color-surface-low)',
        borderRight: '1px solid var(--color-line)',
      }}
    >
      <div
        className="sidebar-header"
        style={{ borderBottom: '1px solid var(--color-line)' }}
      >
        <div className="sidebar-logo">
          <KitLogo size={20} />
        </div>
        {!collapsed && (
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="sidebar-title text-[14px] font-semibold tracking-tight text-[var(--color-ink)]">
              Toolbox
            </span>
            <span className="truncate text-[10.5px] font-medium text-[var(--color-ink-faint)]">
              Tools for Thought
            </span>
          </div>
        )}
      </div>

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
                style={isActive ? activeLinkStyle : undefined}
                id={item.navId}
              >
                <Icon className="sidebar-link-icon" />
                <span className="sidebar-link-label">{item.label}</span>
              </NavLink>
            )
          })}

          {!collapsed && (kits.length > 0 || Boolean(urlSlug)) && (
            <div className="px-2 pt-2 pb-1">
              <ActiveKitSwitcher />
            </div>
          )}
        </div>

        <div>
          <div className="sidebar-section-label">
            {urlSlug ? skeleton.identity.name : 'Study'}
          </div>
          {studyItems.map((item) => {
            const Icon = item.icon
            const isActive = item.exact
              ? location.pathname === item.to
              : location.pathname === item.to ||
                location.pathname.startsWith(item.to + '/')
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={Boolean(item.exact)}
                className={`sidebar-link${isActive ? ' active' : ''}`}
                style={isActive ? activeLinkStyle : undefined}
                id={item.navId}
              >
                <Icon className="sidebar-link-icon" />
                <span className="sidebar-link-label">{item.label}</span>
                {!collapsed && item.shortcut && (
                  <Kbd className="ml-auto">{item.shortcut}</Kbd>
                )}
              </NavLink>
            )
          })}
        </div>

        <div className="flex-1" />

        {!collapsed && (
          <div className="mb-2 px-3">
            <div className="sidebar-section-label" style={{ padding: '4px 4px 6px' }}>
              Model
            </div>
            <ModelPicker variant="sidebar" />
          </div>
        )}

        <PomodoroWidget />

        <div className="mt-1 border-t border-[var(--color-line)] pt-2">
          {bottomItems.map((item) => {
            const Icon = item.icon
            const isActive =
              location.pathname === item.to || location.pathname.startsWith(item.to + '/')
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`sidebar-link${isActive ? ' active' : ''}`}
                style={isActive ? activeLinkStyle : undefined}
                id={item.navId}
              >
                <Icon className="sidebar-link-icon" />
                <span className="sidebar-link-label">{item.label}</span>
                {!collapsed && item.shortcut && (
                  <Kbd className="ml-auto">{item.shortcut}</Kbd>
                )}
              </NavLink>
            )
          })}
        </div>
      </nav>

      <div
        className="sidebar-footer"
        style={{ borderTop: '1px solid var(--color-line)' }}
      >
        {authRequired && user && (
          <button
            type="button"
            className="sidebar-collapse-btn"
            onClick={handleSignOut}
            aria-label={collapsed ? `Sign out ${user.username}` : undefined}
            title={`Signed in as @${user.username} — click to sign out`}
            style={{ marginBottom: '4px' }}
          >
            <LogOut size={16} />
            {!collapsed && (
              <span className="sidebar-link-label">@{user.username} · Sign out</span>
            )}
          </button>
        )}
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleTheme}
          aria-label={
            collapsed
              ? theme === 'dark'
                ? 'Switch to light theme'
                : 'Switch to dark theme'
              : undefined
          }
          title={theme === 'dark' ? 'Switch to light theme (⌘D)' : 'Switch to dark theme (⌘D)'}
          id="theme-toggle-btn"
          data-testid="theme-toggle"
          style={{ marginBottom: '4px' }}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {!collapsed && (
            <span className="sidebar-link-label">
              {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            </span>
          )}
        </button>
        <button
          type="button"
          className="sidebar-collapse-btn"
          onClick={toggleSidebar}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          id="sidebar-toggle"
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          {!collapsed && <span className="sidebar-link-label">Collapse</span>}
        </button>
      </div>
    </aside>
  )
}
