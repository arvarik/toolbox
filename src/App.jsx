import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import GuidePage from './pages/GuidePage'
import BuilderPage from './pages/BuilderPage'
import StudyPage from './pages/StudyPage'
import SettingsPage from './pages/SettingsPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Navigate to="/guide" replace />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/guide/:pillarId" element={<GuidePage />} />
        <Route path="/guide/:pillarId/:topicId" element={<GuidePage />} />
        <Route path="/builder" element={<BuilderPage />} />
        <Route path="/study" element={<StudyPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  )
}
