import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileHeader from './MobileHeader'
import MobileDrawer from './MobileDrawer'
import ChatPanel from '../shared/ChatPanel'
import ToastContainer from '../shared/ToastContainer'
import ErrorBoundary from '../shared/ErrorBoundary'
import SearchDialog from '../shared/SearchDialog'
import useAppStore from '../../stores/appStore'
import useTimerStore from '../../stores/useTimerStore'
import useKeyboardShortcuts from '../../hooks/useKeyboardShortcuts'
import useIsMobile from '../../hooks/useIsMobile'
import { configApi } from '../../utils/api'

export default function Layout() {
  const location = useLocation()
  const isMobile = useIsMobile()
  const [menuOpen, setMenuOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const setApiKeyConfigured = useAppStore((s) => s.setApiKeyConfigured)
  const addToast = useAppStore((s) => s.addToast)

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

  // Global keyboard shortcuts
  useKeyboardShortcuts()

  // Open search with ⌘/ or Ctrl+/
  useEffect(() => {
    const handler = (e) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.key === '/') {
        e.preventDefault()
        setSearchOpen((prev) => !prev)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])



  useEffect(() => {
    configApi.get().then((data) => {
      if (data.api_key_configured) {
        setApiKeyConfigured(true)
      }
    }).catch(() => {})
  }, [setApiKeyConfigured])

  const getPageKey = () => {
    if (location.pathname.startsWith('/chat')) return 'chat'
    if (location.pathname.startsWith('/guide')) return 'guide'
    if (location.pathname.startsWith('/builder')) return 'builder'
    if (location.pathname.startsWith('/study')) return 'study'
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
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>
      {isMobile && <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />}
      {showMobileChatPanel && (
        <ChatPanel
          page={pageKey}
          title={pageKey === 'guide' ? 'Ask about System Design' : pageKey === 'builder' ? 'Verify Architecture' : 'AI Card Generator'}
        />
      )}
      <ToastContainer />
      <SearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
