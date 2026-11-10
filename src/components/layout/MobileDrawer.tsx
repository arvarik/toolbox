import { useEffect, useMemo } from 'react'
import { X, Settings, Sun, Moon, Blocks } from 'lucide-react'
import { NavLink, useLocation } from 'react-router'
import PomodoroWidget from './PomodoroWidget'
import { ActiveKitSwitcher, buildStudyNavItems, workspaceItems } from './Sidebar'
import ModelPicker from '../shared/ModelPicker'
import useAppStore from '../../stores/appStore'
import useKitStore, {
  extractKitSlugFromPathname,
  useActiveKit,
  useKitRoutePrefix,
} from '../../stores/useKitStore'
import { KitLogo } from '../ui'

export interface MobileDrawerProps {
  open: boolean
  onClose: () => void
}

const activeLinkStyle = {
  background: 'var(--color-surface-elevated)',
  color: 'var(--color-ink)',
  boxShadow: 'var(--shadow-hairline)',
} as const

export default function MobileDrawer({ open, onClose }: MobileDrawerProps) {
  const theme = useAppStore((s) => s.theme)
  const toggleTheme = useAppStore((s) => s.toggleTheme)
  const fetchAvailableModels = useAppStore((s) => s.fetchAvailableModels)
  const kits = useKitStore((s) => s.kits)
  const fetchKits = useKitStore((s) => s.fetchKits)
  const { skeleton, capabilities } = useActiveKit()
  const prefix = useKitRoutePrefix()
  const location = useLocation()
  const urlSlug = extractKitSlugFromPathname(location.pathname)

  const studyItems = useMemo(
    () => buildStudyNavItems(prefix, capabilities),
    [prefix, capabilities],
  )

  useEffect(() => {
    if (!open) return
    void fetchAvailableModels()
    void fetchKits()
  }, [open, fetchAvailableModels, fetchKits])

  if (!open) return null

  return (
    <div className="mobile-drawer-overlay mobile-overlay" onClick={onClose} id="mobile-nav-overlay">
      <div
        className="mobile-drawer"
        onClick={(e) => e.stopPropagation()}
        id="mobile-drawer"
        style={{
          background: 'var(--color-surface-low)',
          borderRight: '1px solid var(--color-line)',
        }}
      >
        <div
          className="mobile-drawer-header"
          style={{ borderBottom: '1px solid var(--color-line)' }}
        >
          <div className="sidebar-logo">
            <KitLogo size={20} />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <span className="sidebar-title text-[14px] font-semibold tracking-tight text-[var(--color-ink)]">
              Toolbox
            </span>
            <span className="truncate text-[10.5px] font-medium text-[var(--color-ink-faint)]">
              Tools for Thought
            </span>
          </div>
          <button
            type="button"
            className="mobile-drawer-close close-btn"
            onClick={onClose}
            aria-label="Close menu"
            id="mobile-nav-close"
          >
            <X size={20} />
          </button>
        </div>

        <nav className="mobile-drawer-nav" role="navigation" aria-label="mobile">
          {workspaceItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={Boolean(item.exact)}
                onClick={onClose}
                className={({ isActive }) =>
                  `mobile-drawer-link${isActive ? ' active' : ''}`
                }
                style={({ isActive }) => (isActive ? activeLinkStyle : undefined)}
                id={`drawer-${item.navId}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}

          {(kits.length > 0 || Boolean(urlSlug)) && (
            <div className="px-2 pt-2 pb-1">
              <ActiveKitSwitcher onAfterSelect={onClose} />
            </div>
          )}

          <div className="px-3 pt-3 pb-1 text-[11px] font-semibold tracking-wider text-[var(--color-ink-faint)] uppercase">
            {urlSlug ? skeleton.identity.name : 'Study'}
          </div>

          {studyItems.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={Boolean(item.exact)}
                onClick={onClose}
                className={({ isActive }) =>
                  `mobile-drawer-link${isActive ? ' active' : ''}`
                }
                style={({ isActive }) => (isActive ? activeLinkStyle : undefined)}
                id={`drawer-${item.navId}`}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </NavLink>
            )
          })}

          <div className="mt-auto flex flex-col gap-3 border-t border-[var(--color-line)] pt-4">
            <div className="px-3">
              <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-[var(--color-ink-faint)] uppercase">
                Model
              </div>
              <ModelPicker variant="sidebar" triggerId="drawer-model-picker-trigger" />
            </div>

            <PomodoroWidget />

            <button
              type="button"
              onClick={toggleTheme}
              className="mobile-drawer-link w-full cursor-pointer border-0 bg-transparent text-left"
              id="drawer-nav-theme"
            >
              {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
              <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
            </button>

            <NavLink
              to="/design-system"
              onClick={onClose}
              className={({ isActive }) =>
                `mobile-drawer-link${isActive ? ' active' : ''}`
              }
              style={({ isActive }) => (isActive ? activeLinkStyle : undefined)}
              id="drawer-nav-design-system"
            >
              <Blocks size={18} />
              <span>Component Library</span>
            </NavLink>

            <NavLink
              to="/settings"
              onClick={onClose}
              className={({ isActive }) =>
                `mobile-drawer-link${isActive ? ' active' : ''}`
              }
              style={({ isActive }) => (isActive ? activeLinkStyle : undefined)}
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
