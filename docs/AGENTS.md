# Toolbox — Agent Instructions & Design Reference

> **For future AI agents**: This file is your starting point. Read it in full before making any changes to this codebase.

---

## Project Identity

**Toolbox** is a self-hosted web application for preparing for software engineering system design interviews. It is a **single-user tool** with no authentication, designed to run as a self-contained Docker container.

**Live demo**: https://arvarik.com/toolbox

---

## Tech Stack (Non-Negotiable)

| Layer | Choice | Why |
|-------|--------|-----|
| Frontend | React 19 + Vite | Established in project |
| Routing | React Router DOM v6 | Established in project |
| State | Zustand (persisted stores) | Established in project |
| Styling | **Vanilla CSS only** | See CSS rules below |
| Icons | `lucide-react` only | Consistent icon set |
| Backend | Node.js + Express | Simple, matches dev experience |
| Database | SQLite (`better-sqlite3`) | Self-hostable, zero-config |
| AI | Google Gemini API | Via `@google/generative-ai` SDK |

---

## Critical Rules for Agents

### 1. 🚫 NO TAILWIND CSS

This project uses **Vanilla CSS with CSS Custom Properties**. Do not use:
- Tailwind utility classes (`flex`, `items-center`, `text-blue-500`, etc.)
- `@apply` directives
- Any Tailwind CDN or plugin

**Correct**: Use `className="card"`, `style={{ color: 'var(--color-accent)' }}`, or add new classes to `src/index.css`.

**Wrong**: `className="flex items-center gap-4 text-indigo-500"`

### 2. Icons: lucide-react Only

Always import icons from `lucide-react`. Never write custom SVGs or import from other libraries.

```jsx
// ✅ Correct
import { ArrowRight, Settings } from 'lucide-react'

// ❌ Wrong
import { FaArrowRight } from 'react-icons/fa'
```

### 3. Global State: Use Existing Zustand Stores

For features requiring cross-page persistence, use the existing stores:
- `src/stores/appStore.js` — Theme, sidebar, chat panels, API key, whiteboard nodes/edges, toasts
- `src/stores/useTimerStore.js` — Pomodoro timer state

Do not create new top-level stores unless the feature genuinely requires it and doesn't fit in either existing store.

### 4. Backend Changes: Update Both db.js and Routes

- Schema additions go in `server/db.js` (the migration runs automatically on startup)
- New endpoints go in `server/routes/` as new files, then mount in `server/index.js`
- Use synchronous `better-sqlite3` methods (`.run()`, `.get()`, `.all()`) — not async/await

### 5. UI Consistency: Use Design System Classes

These CSS classes are already defined in `src/index.css` — use them:

```css
/* Buttons */
.btn, .btn-primary, .btn-secondary, .btn-ghost, .btn-outline
.btn-sm, .btn-lg, .btn-icon

/* Inputs */
.input

/* Cards */
.card, .card-interactive

/* Typography */
.page-title, .page-subtitle, .page-description

/* Layout patterns */
.page-wrapper, .page-header
```

### 6. Responsiveness

The app is mobile-responsive with breakpoints at 768px. Check existing patterns:
- `MobileDrawer.jsx` for mobile slide-out panels
- `BottomNav.jsx` for mobile tab bar
- Media queries in `index.css` under `@media (max-width: 768px)`
- Always check `isMobile` state before rendering desktop-only elements

### 7. AI Streaming Pattern

All AI responses stream via SSE. Follow the existing pattern in `server/routes/chat.js` and the client in `src/utils/api.js`:

```javascript
// Server: use generateContentStream + SSE writes
// Client: use chatApi.stream(payload, onChunkCallback, onDoneCallback, abortSignal)
```

---

## Key Directories

```
src/
├── App.jsx              # Route definitions
├── index.css            # 🔑 Entire design system here
├── pages/               # Route-level page components
├── components/
│   ├── layout/          # Global chrome (sidebar, nav, modals)
│   ├── chat/            # AI Chat page components
│   ├── guide/           # Knowledge library components
│   ├── builder/         # Whiteboard canvas components
│   ├── study/           # Flashcard components
│   └── shared/          # Reusable across pages
├── stores/              # Zustand global state
└── utils/
    ├── api.js           # 🔑 All API calls — add new endpoints here
    ├── constants.js     # 🔑 Pillar/topic/section data structure
    └── templates.js     # Pre-built architecture templates

server/
├── index.js             # Express setup + route mounting
├── db.js                # 🔑 SQLite schema + migrations
└── routes/              # One file per feature domain
```

---

## Feature Map

| Feature | Page | Key Files |
|---------|------|-----------|
| AI Learning Chat | `/chat` | `ChatPage.jsx`, `LearningChat.jsx`, `LearningTodo.jsx`, `CommitModal.jsx` |
| Knowledge Library | `/guide` | `GuidePage.jsx`, `BlueprintShell.jsx`, `PillarNav.jsx` |
| Architecture Builder | `/builder` | `BuilderPage.jsx`, `Canvas.jsx`, `Toolbox.jsx`, `TemplateGallery.jsx` |
| Flashcards + SRS | `/study` | `StudyPage.jsx`, `FlashcardView.jsx`, `DeckEditor.jsx`, `CardBrowser.jsx`, `StatsDashboard.jsx` |
| Feynman Simulator | `/feynman` | `FeynmanPage.jsx` |
| Interleaved Review | `/interleaved` | `InterleavedPage.jsx` |
| Pomodoro Timer | Global modal | `PomodoroModal.jsx`, `PomodoroWidget.jsx`, `useTimerStore.js` |
| Settings | `/settings` | `SettingsPage.jsx` |

---

## Data Structure: Pillars & Blueprint Sections

The content structure is defined in `src/utils/constants.js`. The 7 pillars are:

1. `compute` — Compute & Infrastructure
2. `storage` — Storage & Data
3. `protocols` — Protocols & Communication
4. `observability` — Observability
5. `resiliency` — Resiliency & Reliability
6. `distributed` — Distributed Systems
7. `paradigms` — Architectural Paradigms

Each pillar has `topics`, and each topic has `BLUEPRINT_SECTIONS` — the structured set of study dimensions (scale, performance, trade-offs, etc.).

When adding new content, match these IDs exactly. The guide content API uses `pillar_id__topic_id__section_id` as composite keys.

---

## AI Integration Patterns

### Streaming Chat
```javascript
await chatApi.stream(
  { message, context: systemPrompt, history, model },
  (partialText) => { /* update UI with accumulated text */ }
)
```

### Non-Streaming (One-Shot)
For analysis tasks (Feynman, concept maps), use `chatApi.stream()` but collect the full response before updating state.

### API Key
- Stored server-side in SQLite `config` table
- Can also be set via `GEMINI_API_KEY` env var (env var takes precedence)
- Check `apiKeyConfigured` from `useAppStore` before showing AI features

---

## Running Tests

```bash
npm test              # Run all Vitest tests
npm run test:watch    # Watch mode
```

Tests are in `src/__tests__/` and use React Testing Library.

## Running Locally

```bash
npm install
npm run dev           # Starts Vite (port 5173) + Express (port 3100)
```

The Vite proxy config in `vite.config.js` forwards `/api/*` to the backend automatically.

---

## What NOT to Do

- ❌ Don't add a routing library other than React Router
- ❌ Don't add a CSS framework (Tailwind, Bootstrap, etc.)
- ❌ Don't add a state management library other than Zustand
- ❌ Don't add authentication or multi-user features
- ❌ Don't use async SQLite — use synchronous `better-sqlite3` calls
- ❌ Don't add a database ORM — use raw SQL with the `db` singleton
- ❌ Don't modify `vite.config.js` without understanding the proxy and alias setup
- ❌ Don't put API keys in the frontend code or commit them

---

## Common Gotchas

1. **SRS state after edits**: After saving card content via the card browser, always re-fetch the full deck (`decksApi.get(deckId)`) to sync SRS state back to the UI.

2. **Board auto-save vs manual save**: Boards auto-save after 3 seconds of inactivity. New boards (with `id.startsWith('board-')`) are NOT auto-saved until first manual save (which assigns a real DB ID).

3. **Chat panel state**: Each page (`guide`, `builder`, `study`) has its own chat panel state in `appStore.chatOpen`. Toggle with `toggleChat(page)`.

4. **Streaming abort**: Always pass an `AbortController.signal` to `chatApi.stream()` so users can stop generation. Check the LearningChat pattern.

5. **Mobile detection**: Don't use CSS-only responsive tricks for conditional rendering. Use the `isMobile` state pattern (window resize listener) that's established in each page component.

6. **Toast notifications**: Use `addToast({ type: 'success'|'error'|'info', message: '...' })` from `useAppStore` for user feedback. Never use `alert()`.
