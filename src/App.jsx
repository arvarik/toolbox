import { useEffect } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import ChatPage from './pages/ChatPage'
import GuidePage from './pages/GuidePage'
import BuilderPage from './pages/BuilderPage'
import StudyPage from './pages/StudyPage'
import SettingsPage from './pages/SettingsPage'
import FeynmanPage from './pages/FeynmanPage'
import InterleavedPage from './pages/InterleavedPage'
import { processSyncQueue } from './utils/db'
import AhaMoment from './components/shared/AhaMoment'

export default function App() {
  useEffect(() => {
    const handleOnline = () => {
      console.log('[sync] Back online. Processing sync queue...')
      processSyncQueue()
    }
    
    window.addEventListener('online', handleOnline)
    
    // Attempt to process queue on initial load if online
    if (navigator.onLine) {
      processSyncQueue()
    }

    return () => window.removeEventListener('online', handleOnline)
  }, [])

  return (
    <>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/guide/:pillarId" element={<GuidePage />} />
          <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
          <Route path="/builder" element={<BuilderPage />} />
          <Route path="/study" element={<StudyPage />} />
          <Route path="/feynman" element={<FeynmanPage />} />
          <Route path="/interleaved" element={<InterleavedPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Routes>
      <AhaMoment />
    </>
  )
}
