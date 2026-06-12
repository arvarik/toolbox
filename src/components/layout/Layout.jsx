import { useState, useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import MobileHeader from './MobileHeader'
import BottomNav from './BottomNav'
import MobileDrawer from './MobileDrawer'
import ChatPanel from '../shared/ChatPanel'
import ToastContainer from '../shared/ToastContainer'
import useAppStore from '../../stores/appStore'
import { configApi } from '../../utils/api'

export default function Layout() {
  const location = useLocation()
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' ? window.innerWidth < 768 : false)
  const [menuOpen, setMenuOpen] = useState(false)
  const setApiKeyConfigured = useAppStore((s) => s.setApiKeyConfigured)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768)
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    configApi.get().then((data) => {
      if (data.api_key_configured) {
        setApiKeyConfigured(true)
      }
    }).catch(() => {})
  }, [setApiKeyConfigured])

  const getPageKey = () => {
    if (location.pathname.startsWith('/guide')) return 'guide'
    if (location.pathname.startsWith('/builder')) return 'builder'
    if (location.pathname.startsWith('/study')) return 'study'
    return null
  }

  const pageKey = getPageKey()

  return (
    <div className="app-layout" id="app-layout">
      {isMobile && <MobileHeader onToggleMenu={() => setMenuOpen(true)} />}
      <Sidebar />
      <main className="app-main">
        <div className="app-content">
          <Outlet />
        </div>
      </main>
      {isMobile && <BottomNav />}
      {isMobile && <MobileDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />}
      {isMobile && pageKey && (
        <ChatPanel
          page={pageKey}
          title={pageKey === 'guide' ? 'Ask about System Design' : pageKey === 'builder' ? 'Verify Architecture' : 'AI Card Generator'}
        />
      )}
      <ToastContainer />
    </div>
  )
}
