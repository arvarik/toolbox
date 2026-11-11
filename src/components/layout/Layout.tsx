import { lazy, useState, useEffect, Suspense } from 'react'
import { Outlet, useLocation } from 'react-router'
import Sidebar from './Sidebar'
import MobileHeader from './MobileHeader'
import MobileDrawer from './MobileDrawer'
import ToastContainer from '../shared/ToastContainer'

const ChatPanel = lazy(() => import('../shared/ChatPanel'))
import ErrorBoundary from '../shared/ErrorBoundary'
import SearchDialog from '../shared/SearchDialog'
import useAppStore from '../../stores/appStore'
import useKitStore, {
  extractKitSlugFromPathname,
  useActiveKit,
} from '../../stores/useKitStore'
import useTimerStore from '../../stores/useTimerStore'
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts'
import useIsMobile from '../../hooks/useIsMobile'
import KeyboardShortcutsModal from '../shared/KeyboardShortcutsModal'
import { configApi } from '../../utils/api'

export function PageFallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '50vh',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          border: '2px solid var(--color-border)',
          borderTopColor: 'var(--color-accent)',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }}
      />
    </div>
  )
}

export default function Layout() {
  const location = useLocation()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const searchOpen = useAppStore((s) => s.searchOpen)
  const setSearchOpen = useAppStore((s) => s.setSearchOpen)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const setApiKeysConfigured = useAppStore((s) => s.setApiKeysConfigured)
  const addToast = useAppStore((s) => s.addToast)
  const selectKitBySlug = useKitStore((s) => s.selectKitBySlug)
  const { skeleton } = useActiveKit()

  useEffect(() => {
    const slug = extractKitSlugFromPathname(location.pathname)
    void selectKitBySlug(slug)
  }, [location.pathname, selectKitBySlug])

  useEffect(() => {
    if (searchOpen) setShortcutsOpen(false)
  }, [searchOpen])

  // Pomodoro timer state
  const tick = useTimerStore((s) => s.tick)
  const status = useTimerStore((s) => s.status)
  const isStrictMode = useTimerStore((s) => s.isStrictMode)
  const killPlant = useTimerStore((s) => s.killPlant)

  // Timer Tick
  useEffect(() => {
    if (status !== 'running') return
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [status, tick])

  // Strict Mode Visibility
  useEffect(() => {
    if (status !== 'running' || !isStrictMode) return

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        killPlant()
        addToast({ type: 'error', message: 'You left the app! Your Focus Plant died.' })
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [status, isStrictMode, killPlant, addToast])

  // Global keyboard shortcuts (handles ⌘K, ⌘/, ⌘1–8, etc.)
  useKeyboardShortcuts()

  // Open keyboard shortcuts cheat sheet with ⌘? / Ctrl+? (Shift+/)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && (e.key === '?' || (e.key === '/' && e.shiftKey))) {
        e.preventDefault()
        setShortcutsOpen((prev) => {
          const next = !prev
          if (next) setSearchOpen(false)
          return next
        })
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [setSearchOpen])

  useEffect(() => {
    configApi
      .get()
      .then((data) => {
        if (data.api_keys_configured) {
          setApiKeysConfigured(data.api_keys_configured)
        }
      })
      .catch(() => {})
  }, [setApiKeysConfigured])

  const getPageKey = (): 'chat' | 'guide' | 'builder' | 'study' | null => {
    const subPath = location.pathname.replace(/^\/k\/[^/]+/, '') || '/'
    if (subPath.startsWith('/chat')) return 'chat'
    if (subPath.startsWith('/guide')) return 'guide'
    if (subPath.startsWith('/builder') || subPath.startsWith('/canvas')) return 'builder'
    if (subPath.startsWith('/study')) return 'study'
    return null
  }

  const pageKey = getPageKey()

  // Chat page handles its own full-page chat — no need for the slide-out ChatPanel
  const showMobileChatPanel = isMobile && pageKey && pageKey !== 'chat'

  return (
    <div className="app-layout" id="app-layout">
      {isMobile && <MobileHeader onToggleMenu={() => setMenuOpen(true)} />}
      <Sidebar />
      <main className="app-main">
        <div className="app-content">
          <ErrorBoundary>
            <Suspense fallback={<PageFallback />}>
              <Outlet />
            </Suspense>
          </ErrorBoundary>
        </div>
      </main>
      {isMobile && <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />}
      {showMobileChatPanel && (
        <Suspense fallback={null}>
          <ChatPanel
            page={pageKey}
            title={
              pageKey === 'guide'
                ? `Ask about ${skeleton.identity.name}`
                : pageKey === 'builder'
                  ? 'Verify Architecture'
                  : 'AI Card Generator'
            }
          />
        </Suspense>
      )}
      <ToastContainer />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
