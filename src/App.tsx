import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router'
import Layout, { PageFallback } from './components/layout/Layout'
import AhaMoment from './components/shared/AhaMoment'
import TaskWorkingBar from './components/shared/TaskWorkingBar'
import useAppStore from './stores/appStore'
import useCommitStore from './stores/useCommitStore'

const CommitModal = lazy(() => import('./components/chat/CommitModal'))
const CalculatorModal = lazy(() => import('./components/calculator/CalculatorModal'))

const LibraryHomePage = lazy(() => import('./pages/LibraryHomePage'))
const SharedLibraryPage = lazy(() => import('./pages/SharedLibraryPage'))
const ReviewPage = lazy(() => import('./pages/ReviewPage'))
const KitPathPage = lazy(() => import('./pages/KitPathPage'))
const DrillsPage = lazy(() => import('./pages/DrillsPage'))
const ChatPage = lazy(() => import('./pages/ChatPage'))
const GuidePage = lazy(() => import('./pages/GuidePage'))
const BuilderPage = lazy(() => import('./pages/BuilderPage'))
const StudyPage = lazy(() => import('./pages/StudyPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const FeynmanPage = lazy(() => import('./pages/FeynmanPage'))
const InterleavedPage = lazy(() => import('./pages/InterleavedPage'))
const CalculatorPage = lazy(() => import('./pages/CalculatorPage'))
const GraphPage = lazy(() => import('./pages/GraphPage'))
const NewKitStudioPage = lazy(() => import('./pages/NewKitStudioPage'))
const DesignSystemPage = lazy(() => import('./pages/DesignSystemPage'))

export default function App() {
  const calcModalOpen = useAppStore((s) => s.calcModalOpen)
  const commitActive = useCommitStore(
    (s) => s.isOpen || s.isMinimized || s.phase !== 'idle',
  )

  return (
    <>
      <Suspense fallback={<PageFallback />}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<LibraryHomePage />} />
            <Route path="/shared" element={<SharedLibraryPage />} />
            <Route path="/review" element={<ReviewPage />} />

            {/* Multi-Kit Workspace Routes */}
            <Route path="/k/:slug" element={<KitPathPage />} />
            <Route path="/k/:slug/chat" element={<ChatPage />} />
            <Route path="/k/:slug/guide" element={<GuidePage />} />
            <Route path="/k/:slug/guide/:pillarId" element={<GuidePage />} />
            <Route path="/k/:slug/guide/:pillarId/:topicId" element={<GuidePage />} />
            <Route path="/k/:slug/drills" element={<DrillsPage />} />
            <Route path="/k/:slug/builder" element={<BuilderPage />} />
            <Route path="/k/:slug/canvas" element={<BuilderPage />} />
            <Route path="/k/:slug/study" element={<StudyPage />} />
            <Route path="/k/:slug/feynman" element={<FeynmanPage />} />
            <Route path="/k/:slug/interleaved" element={<InterleavedPage />} />
            <Route path="/k/:slug/calculator" element={<CalculatorPage />} />
            <Route path="/k/:slug/graph" element={<GraphPage />} />

            {/* Legacy Top-Level Workspace Routes */}
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/guide" element={<GuidePage />} />
            <Route path="/guide/:pillarId" element={<GuidePage />} />
            <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
            <Route path="/drills" element={<DrillsPage />} />
            <Route path="/builder" element={<BuilderPage />} />
            <Route path="/study" element={<StudyPage />} />
            <Route path="/feynman" element={<FeynmanPage />} />
            <Route path="/interleaved" element={<InterleavedPage />} />
            <Route path="/calculator" element={<CalculatorPage />} />
            <Route path="/graph" element={<GraphPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/new" element={<NewKitStudioPage />} />
            <Route path="/design-system" element={<DesignSystemPage />} />
          </Route>
        </Routes>
      </Suspense>
      <AhaMoment />
      {commitActive && (
        <Suspense fallback={null}>
          <CommitModal />
        </Suspense>
      )}
      <TaskWorkingBar />
      {calcModalOpen && (
        <Suspense fallback={null}>
          <CalculatorModal />
        </Suspense>
      )}
    </>
  )
}
