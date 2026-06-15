# Toolbox — Architecture

Technical architecture documentation for contributors and operators.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Tech Stack](#tech-stack)
3. [Frontend Architecture](#frontend-architecture)
4. [Backend Architecture](#backend-architecture)
5. [Database Schema](#database-schema)
6. [API Reference](#api-reference)
7. [AI Integration Layer](#ai-integration-layer)
8. [Data Flow Diagrams](#data-flow-diagrams)
9. [Build & Deployment Pipeline](#build--deployment-pipeline)

---

## System Overview

Toolbox is a **self-contained, single-binary-deployable** web application with no external services (except the optional Gemini API for AI features). Everything runs in one Docker container.

```
┌─────────────────────────────────────────────────┐
│                  Docker Container                │
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │         Express Server (Node.js)         │   │
│  │   - Serves built React SPA (static)     │   │
│  │   - REST API on /api/*                  │   │
│  │   - Server-Sent Events for streaming    │   │
│  └─────────────────────────────────────────┘   │
│                    │                           │
│  ┌─────────────────┴───────────────────────┐   │
│  │         SQLite (better-sqlite3)          │   │
│  │   - Single file: /app/data/toolbox.db   │   │
│  └─────────────────────────────────────────┘   │
│                                                 │
└─────────────────────────────────────────────────┘
                    │
                    │ HTTPS (Gemini API)
                    ▼
         Google Gemini API (external)
```

### Key Design Principles

1. **No auth, no cloud** — Designed for single-user, self-hosted deployment
2. **Offline-first state** — Critical state lives in the client (localStorage, Zustand)
3. **SQLite as the database** — Simple, zero-config, portable, backed up by copying one file
4. **Streaming AI** — All AI responses stream via Server-Sent Events for a real-time feel
5. **Graceful degradation** — The app is fully usable without an API key (AI features show prompts)

---

## Tech Stack

| Layer | Technology | Version | Role |
|-------|-----------|---------|------|
| **Frontend Framework** | React | 19 | UI rendering |
| **Build Tool** | Vite | 6 | Dev server, bundler |
| **Routing** | React Router DOM | 6 | Client-side routing |
| **State Management** | Zustand | 4 | Global state (persisted) |
| **Styling** | Vanilla CSS | — | CSS Variables design system |
| **Icons** | lucide-react | — | SVG icon library |
| **Markdown** | react-markdown + remark-gfm + KaTeX | — | Rendered AI responses |
| **Backend** | Node.js + Express | 18+ / 5 | API server |
| **Database** | better-sqlite3 (SQLite) | — | Synchronous SQLite bindings |
| **AI Client** | Google Generative AI SDK | — | Gemini API integration |
| **Container** | Docker (Alpine Linux) | — | Production container |
| **Testing** | Vitest + React Testing Library | — | Unit and integration tests |

---

## Frontend Architecture

### Directory Structure

```
src/
├── App.jsx                  # Root component + route definitions
├── main.jsx                 # React DOM entry point
├── index.css                # Global CSS design system (67KB)
│
├── pages/                   # Route-level page components
│   ├── ChatPage.jsx          # /chat — AI learning hub
│   ├── GuidePage.jsx         # /guide/* — Knowledge library
│   ├── BuilderPage.jsx       # /builder — Architecture whiteboard
│   ├── StudyPage.jsx         # /study — Flashcards hub
│   ├── FeynmanPage.jsx       # /feynman — Feynman technique
│   ├── InterleavedPage.jsx   # /interleaved — Cross-deck review
│   └── SettingsPage.jsx      # /settings — Configuration
│
├── components/
│   ├── layout/              # Global chrome (always visible)
│   │   ├── Layout.jsx        # Root layout wrapper + keyboard shortcuts
│   │   ├── Sidebar.jsx       # Navigation sidebar with model selector
│   │   ├── PomodoroWidget.jsx # Mini timer in sidebar
│   │   ├── PomodoroModal.jsx  # Full pomodoro timer modal
│   │   ├── BottomNav.jsx     # Mobile bottom navigation bar
│   │   ├── MobileHeader.jsx  # Mobile top header
│   │   └── MobileDrawer.jsx  # Mobile slide-out drawer
│   │
│   ├── chat/                # AI Chat page components
│   │   ├── LearningChat.jsx   # Full-page chat with session management
│   │   ├── LearningTodo.jsx   # Study plan sidebar (7-pillar progress)
│   │   └── CommitModal.jsx    # Chat → Guide commit flow
│   │
│   ├── guide/               # Guide/library components
│   │   ├── BlueprintShell.jsx # Content viewer + editor for topic blueprints
│   │   └── PillarNav.jsx      # Topic navigation within a pillar
│   │
│   ├── builder/             # Architecture whiteboard components
│   │   ├── Canvas.jsx         # SVG canvas with pan/zoom and node/edge rendering
│   │   ├── Toolbox.jsx        # Component palette sidebar
│   │   ├── BoardList.jsx      # Board tab bar
│   │   └── TemplateGallery.jsx # Pre-built template picker
│   │
│   ├── study/               # Flashcard components
│   │   ├── FlashcardView.jsx   # Card flip UI + SRS rating buttons
│   │   ├── DeckCard.jsx        # Deck tile in the grid view
│   │   ├── DeckEditor.jsx      # Create/edit deck form
│   │   ├── DeckOptionsModal.jsx # Per-deck SRS settings
│   │   ├── CardBrowser.jsx     # All-cards list view with inline editing
│   │   ├── StatsDashboard.jsx  # Per-deck analytics
│   │   ├── StudyHeatmap.jsx    # GitHub-style activity calendar
│   │   └── StudySessionSummary.jsx # Post-session results screen
│   │
│   └── shared/              # Reusable components
│       ├── ChatPanel.jsx      # Sliding AI chat panel (used in Guide/Builder/Study)
│       ├── MarkdownRenderer.jsx # Markdown + KaTeX renderer
│       ├── Modal.jsx          # Generic modal wrapper
│       ├── EmptyState.jsx     # Empty state placeholder
│       ├── AhaMoment.jsx      # "Aha!" micro-interaction overlay
│       └── Loading.jsx        # Loading spinners
│
├── stores/                  # Zustand global state
│   ├── appStore.js           # Theme, sidebar, chat state, model, API key, nodes/edges
│   └── useTimerStore.js      # Pomodoro timer state machine (persisted)
│
└── utils/
    ├── api.js                # Typed API client for all backend endpoints
    ├── constants.js          # PILLARS, BLUEPRINT_SECTIONS data
    ├── templates.js          # Pre-built architecture templates
    └── db.js                 # Client-side sync queue for offline handling
```

### Routing

All routes are nested under the `<Layout />` component which renders the sidebar, mobile nav, modals, and toast notifications.

```
/           → redirect to /chat
/chat       → ChatPage (Learning Hub)
/guide      → GuidePage (Library Landing)
/guide/:pillarId → GuidePage (Pillar view)
/guide/:pillarId/:topicId → GuidePage (Blueprint view)
/builder    → BuilderPage
/study      → StudyPage (Deck list)
/feynman    → FeynmanPage
/interleaved → InterleavedPage
/settings   → SettingsPage
```

### State Management

Two Zustand stores manage global state:

**`appStore.js`** — Non-persistent UI state:
- `theme` — `'dark' | 'light'` (persisted to localStorage)
- `model` — Active Gemini model (persisted to localStorage)
- `sidebarCollapsed` — Sidebar toggle state
- `chatOpen` — Per-page chat panel visibility `{ guide, builder, study }`
- `apiKeyConfigured` — Whether the Gemini key is valid
- `toasts` — Toast notification queue
- `nodes`, `edges` — Active whiteboard canvas state
- `ahaMomentActive` — Micro-interaction trigger

**`useTimerStore.js`** — Persisted timer state (via `zustand/middleware/persist`):
- `mode`, `status`, `timeLeft`, `endTime` — Timer state machine
- `durations` — Configurable Pomodoro/break lengths (persisted)
- `isStrictMode` — Strict focus mode flag (persisted)
- `taskName` — Current task label (persisted)
- `plantState` — 🌱→🌸→🥀 gamification state

### CSS Design System

The entire design system lives in `src/index.css`. It uses **CSS Custom Properties** (variables) for all tokens:

```css
/* Color palette */
--color-bg-primary
--color-bg-secondary
--color-bg-tertiary
--color-surface
--color-border
--color-accent          /* Indigo #818CF8 */
--color-accent-subtle
--color-text-primary
--color-text-secondary
--color-text-tertiary
--color-success
--color-error
--color-teal

/* Spacing scale */
--space-1 through --space-16

/* Typography */
--text-xs through --text-3xl
--font-sans  (Inter)
--font-mono

/* Elevation */
--shadow-sm, --shadow-md, --shadow-lg

/* Radius */
--radius-sm, --radius-md, --radius-lg, --radius-xl, --radius-full

/* Animation */
--duration-fast, --duration-normal, --duration-slow
```

Dark/light themes are controlled by `data-theme="dark|light"` on `<html>`.

### AI Streaming

The frontend uses a custom `chatApi.stream()` function that reads **Server-Sent Events** from the backend:

```javascript
// src/utils/api.js
stream: async (payload, onChunk, onDone, signal) => {
  const res = await fetch('/api/chat/stream', { method: 'POST', ... })
  const reader = res.body.getReader()
  // Accumulates streamed chunks and calls onChunk on each update
}
```

---

## Backend Architecture

### Directory Structure

```
server/
├── index.js              # Express app setup, middleware, route mounting
├── db.js                 # SQLite connection, schema creation, migrations
└── routes/
    ├── chat.js           # AI chat endpoints (streaming + starters)
    ├── decks.js          # Flashcard deck + card CRUD + SRS logic
    ├── boards.js         # Whiteboard board CRUD
    ├── guide_content.js  # Guide section content CRUD
    ├── config.js         # API key management
    ├── profile.js        # AI shadow memory
    ├── search.js         # Global search
    ├── study_sessions.js # Study session tracking
    └── system.js         # Health, stats, cache, export/import
```

### Express Setup

The Express server serves the built React app as static files and exposes a REST API under `/api/`:

```javascript
// index.js
app.use(express.static(path.join(__dirname, '../dist')))
app.use('/api/chat', chatRoutes)
app.use('/api/decks', deckRoutes)
// ...
app.get('*', (req, res) => res.sendFile('dist/index.html'))
```

### API Endpoints

The full API reference is in **[`docs/api.md`](api.md)**. Quick summary of route files:

| Route file | Prefix | Summary |
|------------|--------|---------|
| `chat.js` | `/api/chat` | AI streaming, starters, summarize, concept map, interceptor |
| `decks.js` | `/api/decks` | Deck + card CRUD, SRS review, due cards, interleaved |
| `boards.js` | `/api/boards` | Whiteboard board CRUD |
| `guide_content.js` | `/api/guide-content` | Guide section CRUD + progress + export |
| `profile.js` | `/api/profile` | Shadow memory read/write/clear |
| `config.js` | `/api/config` | Settings, API key test |
| `search.js` | `/api/search` | Cross-domain full-text search |
| `study_sessions.js` | `/api/study_sessions` | Study heatmap data |
| `system.js` | `/api/system` | Stats, cache flush, DB download |

---

## Database Schema

All tables are created in `server/db.js` with automatic migrations on startup. The schema is additive — new columns are added via `ALTER TABLE` and guarded with try/catch so they're safe to re-run.

```sql
-- App configuration (API keys, preferences)
CREATE TABLE config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Flashcard decks
CREATE TABLE decks (
  id TEXT PRIMARY KEY,          -- UUID v4
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  color_index INTEGER DEFAULT 0,
  tags TEXT DEFAULT '',         -- Comma-separated; added via migration
  settings TEXT DEFAULT '{}',  -- JSON: SRS config; added via migration
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Individual flashcards
CREATE TABLE flashcards (
  id TEXT PRIMARY KEY,          -- UUID v4
  deck_id TEXT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
  front TEXT NOT NULL,
  back TEXT NOT NULL,
  position INTEGER DEFAULT 0,
  -- SM-2 SRS fields (added via migration)
  ease_factor REAL DEFAULT 2.5,
  interval INTEGER DEFAULT 0,
  repetitions INTEGER DEFAULT 0,
  next_review TEXT DEFAULT NULL,
  last_reviewed TEXT DEFAULT NULL,
  state INTEGER DEFAULT 0,      -- 0=New 1=Learning 2=Review 3=Relearning
  learning_step INTEGER DEFAULT 0,
  prerequisite_id TEXT DEFAULT NULL,  -- Optional card dependency
  embedding TEXT DEFAULT NULL,        -- JSON float array for semantic search
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Whiteboard boards
CREATE TABLE boards (
  id TEXT PRIMARY KEY,          -- UUID v4
  name TEXT NOT NULL,
  data TEXT DEFAULT '{}',       -- JSON: { nodes: [...], edges: [...] }
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Study sessions (for activity heatmap) — one row per calendar day
CREATE TABLE study_sessions (
  date TEXT PRIMARY KEY,        -- 'YYYY-MM-DD'
  count INTEGER DEFAULT 0
);

-- Guide section content (committed learning notes)
CREATE TABLE guide_content (
  pillar_id   TEXT NOT NULL,
  topic_id    TEXT NOT NULL,
  section_id  TEXT NOT NULL,
  content     TEXT DEFAULT '',
  committed_at TEXT DEFAULT (datetime('now')),
  embedding TEXT DEFAULT NULL,  -- JSON float array; added via migration
  PRIMARY KEY (pillar_id, topic_id, section_id)
);

-- Shadow Memory — single-row user profile (id is always 1)
CREATE TABLE user_profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  profile_text TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Episodic memory stream — important learning events extracted by AI agent
CREATE TABLE episodic_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memory_text TEXT NOT NULL,
  importance_score INTEGER DEFAULT 0,
  embedding TEXT DEFAULT NULL,  -- JSON float array for semantic retrieval
  created_at TEXT DEFAULT (datetime('now'))
);

-- Cached AI-generated chat starters, invalidated by content hash
CREATE TABLE chat_starters (
  pillar_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  suggestions TEXT DEFAULT '[]',  -- JSON array of prompt strings
  content_hash TEXT DEFAULT '',   -- MD5 of guide+profile used to detect staleness
  updated_at TEXT DEFAULT (datetime('now')),
  PRIMARY KEY (pillar_id, topic_id)
);
```

### SRS Algorithm

The full SM-2 algorithm is documented in **[`docs/srs-algorithm.md`](srs-algorithm.md)**.

Brief summary: cards move through 4 states (New → Learning → Review → Relearning). The `ease_factor` and `interval` are updated on every review using the SM-2 formula with a custom **Hypercorrection Penalty** extension (harsher ease penalty when the user was highly confident but wrong).

---

## AI Integration Layer

All AI calls route through `server/routes/chat.js`. The integration uses the Google Generative AI Node.js SDK.

### Streaming Response

The streaming endpoint uses Express + SSE (Server-Sent Events) to stream Gemini's response token-by-token:

```javascript
// Pseudocode
const result = await model.generateContentStream([systemInstruction, ...history, userMessage])
for await (const chunk of result.stream) {
  const text = chunk.text()
  accumulated += text
  res.write(`data: ${JSON.stringify({ text: accumulated })}\n\n`)
}
res.write('data: [DONE]\n\n')
```

### AI Features

| Feature | Endpoint | System Prompt |
|---------|----------|---------------|
| Learning Chat | `/api/chat/stream` | Persona-based (Socratic/ELI5/Strict/Devil's Advocate) |
| Topic Starters | `/api/chat/starters` | Generates 6 study prompts for a given pillar/topic |
| Commit to Guide | `/api/chat/commit` | Extracts key facts and formats for each blueprint section |
| Concept Map | `/api/chat/concept-map` | Generates a Markdown concept map from chat history |
| Feynman Analysis | Used via `/api/chat/stream` directly | Strict evaluator with Missing Points / Jargon / Gaps format |
| Guide Q&A | `/api/chat/stream` (inline panel) | Context-primed with the topic being viewed |
| Architecture Verify | `/api/chat/stream` (builder panel) | Reviews whiteboard layout for completeness |
| Flashcard Generation | `/api/chat/stream` (study panel) | Generates Anki-style Q&A pairs |
| Shadow Memory Update | Auto-extracted from chat | Extracts user facts from conversation history |

### Shadow Memory

After certain AI interactions, the system sends an additional Gemini call to extract memorable user facts (interview timeline, strengths, goals) and updates the `user_profile` table. This profile text is prepended to all subsequent AI prompts.

---

## Build & Deployment Pipeline

### Development

```bash
npm run dev         # Starts both Vite (5173) and Express (3100) via concurrently
```

### Production Build

```bash
npm run build       # Runs vite build → outputs to dist/
npm start           # Starts only the Express server (serves dist/)
```

### Docker Multi-Stage Build

```dockerfile
# Stage 1: Build
FROM node:18-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY server ./server
CMD ["node", "server/index.js"]
```

### Test Suite

```bash
npm test           # Run all tests once (vitest run)
npm run test:watch # Watch mode for development
```

Tests live in `src/__tests__/` and use Vitest with React Testing Library. The test setup is in `vitest.setup.js`.
