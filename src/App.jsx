import { useEffect, lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import { processSyncQueue } from './utils/db'
import AhaMoment from './components/shared/AhaMoment'
import CommitModal from './components/chat/CommitModal'
import TaskWorkingBar from './components/shared/TaskWorkingBar'
import CalculatorModal from './components/calculator/CalculatorModal'

const ChatPage = lazy(() => import('./pages/ChatPage'))
const GuidePage = lazy(() => import('./pages/GuidePage'))
const BuilderPage = lazy(() => import('./pages/BuilderPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const FeynmanPage = lazy(() => import('./pages/FeynmanPage'))
const InterleavedPage = lazy(() => import('./pages/InterleavedPage'))
const CalculatorPage = lazy(() => import('./pages/CalculatorPage'))
const GraphPage = lazy(() => import('./pages/GraphPage'))

function PageFallback() {
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
      <Suspense fallback={<PageFallback />}>
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
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </Suspense>
      <AhaMoment />
      <CommitModal />
      <TaskWorkingBar />
      <CalculatorModal />
    </>
  )
}
