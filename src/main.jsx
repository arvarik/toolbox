import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// React Flow base styles load first so index.css overrides win
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.jsx'
import { AuthGate } from './components/auth/AuthGate.tsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AuthGate>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AuthGate>
  </StrictMode>,
)
