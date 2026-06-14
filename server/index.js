import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'

import configRoutes from './routes/config.js'
import deckRoutes from './routes/decks.js'
import boardRoutes from './routes/boards.js'
import chatRoutes from './routes/chat.js'
import studySessionRoutes from './routes/study_sessions.js'
import guideContentRoutes from './routes/guide_content.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const PORT = process.env.PORT || 3100
const isProduction = process.env.NODE_ENV === 'production'

// Middleware
app.use(cors())
app.use(express.json({ limit: '10mb' }))

// API routes
app.use('/api/config', configRoutes)
app.use('/api/decks', deckRoutes)
app.use('/api/boards', boardRoutes)
app.use('/api/chat', chatRoutes)
app.use('/api/study_sessions', studySessionRoutes)
app.use('/api/guide-content', guideContentRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// In production, serve the built frontend
if (isProduction) {
  const distPath = path.join(__dirname, '..', 'dist')
  app.use(express.static(distPath))

  // SPA fallback — serve index.html for all non-API routes
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(distPath, 'index.html'))
    }
  })
}

// Error handler
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[server] Error:', err.message)
  res.status(500).json({ message: 'Internal server error' })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  🧰 Toolbox server running at http://localhost:${PORT}`)
  console.log(`  📦 Mode: ${isProduction ? 'production' : 'development'}`)
  console.log(`  💾 Database: ${process.env.DB_PATH || './data/toolbox.db'}\n`)
})
