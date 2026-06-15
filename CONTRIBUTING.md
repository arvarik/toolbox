# Contributing to Toolbox

Thank you for your interest in contributing. Toolbox is a personal-use, self-hosted project. Contributions (bug fixes, quality improvements, documentation) are welcome.

---

## Getting Started

### Prerequisites

- Node.js ≥ 20
- npm ≥ 10
- A [Gemini API key](https://aistudio.google.com/apikey) for testing AI features

### Local Development Setup

```bash
git clone https://github.com/arvarik/toolbox.git
cd toolbox
cp .env.example .env
# Edit .env and add your GEMINI_API_KEY
npm install
npm run dev
```

This starts two processes concurrently:
- **Vite dev server** on `http://localhost:5173` (hot module reload)
- **Express server** on `http://localhost:3100` (auto-restarts on file changes with `--watch`)

Vite proxies all `/api/*` requests to the Express server, so you only open `localhost:5173` during development.

---

## Project Structure

See [`docs/architecture.md`](architecture.md) for the full directory layout and design rationale. Key entrypoints:

| Path | Purpose |
|------|---------|
| `server/index.js` | Express app, route registration |
| `server/db.js` | SQLite init, migrations |
| `server/routes/` | One file per API domain |
| `src/App.jsx` | React Router config |
| `src/pages/` | One file per feature page |
| `src/stores/` | Zustand global state |
| `src/utils/api.js` | All fetch calls — single source of truth |

---

## Coding Standards

> **Read [`docs/AGENTS.md`](AGENTS.md) before making any code changes.** It contains all critical rules and patterns for this codebase.

Key rules:

- **CSS only** — No Tailwind. Use existing CSS variables (e.g. `var(--color-primary)`) and utility classes from `src/index.css`.
- **Icons** — Use `lucide-react` only.
- **State** — All global state lives in Zustand stores under `src/stores/`. No prop drilling for global data.
- **API calls** — All `fetch` calls go through `src/utils/api.js`. Do not call `fetch` directly from components.
- **No new runtime dependencies** — think hard before adding any `npm` package. The dependency footprint should stay minimal.

---

## Running Tests

```bash
npm test            # Run all tests once
npm run test:watch  # Run in watch mode during development
```

Tests live in `src/__tests__/` and use Vitest + React Testing Library + jsdom.

When adding a feature, add or update the relevant test file.

---

## Linting

```bash
npm run lint
```

The project uses ESLint with the React Hooks and React Refresh plugins. Fix all lint errors before opening a PR.

---

## Making Changes

1. **Branch** from `main` with a descriptive name: `fix/srs-lapse-interval`, `feat/export-csv`
2. **Make small, focused commits** — one logical change per commit
3. **Test** — run `npm test` and verify nothing broke
4. **Lint** — run `npm run lint` with 0 errors
5. **Update docs** — if you added an endpoint, update `docs/api.md`; if you changed a UI feature, update `docs/user-guide.md`

---

## Adding a New API Endpoint

1. Add the route handler in the appropriate file under `server/routes/`
2. Register it in `server/index.js` if it's a new router
3. Add a corresponding fetch function in `src/utils/api.js`
4. Document the endpoint in `docs/api.md`

---

## Database Schema Changes

Migrations live inline in `server/db.js` inside the `migrate()` function. The pattern for **additive migrations** (new columns) is:

```javascript
try {
  db.exec(`ALTER TABLE my_table ADD COLUMN new_col TEXT DEFAULT NULL`)
} catch {
  // Column already exists — ignore
}
```

This is idempotent and safe to run on every startup. For destructive schema changes, discuss first.

---

## Submitting a PR

- Describe what changed and why in the PR description
- Include before/after screenshots for UI changes
- Reference any related issues

---

## Questions

Open a GitHub Issue for bugs, feature requests, or questions.
