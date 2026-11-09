# Toolbox v2 — Agent Instructions & Architecture Reference

> **For AI agents**: Read this file before modifying the codebase.

---

## Project Identity

**Toolbox** is a self-hosted, multi-tenant AI study platform organized around a **Library** of portable, AI-synthesized learning **Kits** (with **System Design** seeded as an Official Starter Kit).

- By default (`AUTH_REQUIRED=false`), Toolbox runs with zero friction under an implicit local owner (`local@toolbox.local`).
- Operators can secure any instance into multi-user mode (`AUTH_REQUIRED=true` or **Settings → Secure This Instance**) with `scrypt` passwords, HttpOnly cookie sessions (`toolbox_session`), Passkeys (`@simplewebauthn/*`), OIDC SSO (`openid-client`), personal `tbk_` API tokens, online SQLite backups, and audit logging.

---

## Tech Stack

| Layer | Choice | Notes |
|---|---|---|
| Runtime | Node.js ≥ 24 (`node server/index.ts`) | Native TypeScript type-stripping — no server build step |
| Contracts | TypeScript + Zod v4 (`shared/`) | Runtime-pure (`no-restricted-imports` blocks `node:*` and `react`) |
| Frontend | React 19 + Vite 8 + React Router v7 | Zustand stores in `src/stores/` |
| Styling | Tailwind v4 semantic `@theme` (`src/theme.css`) + legacy CSS (`src/index.css`) | WCAG 2.1 AA contrast verified by `src/__tests__/theme_contrast.test.ts` |
| Icons | `lucide-react` | Consistent icon set |
| Diagrams | `@xyflow/react` + `dagre` | Canvas + Knowledge Graph DAG |
| Database | SQLite (`better-sqlite3`, WAL + `foreign_keys = ON`) | Tenant-scoped via branded `Scope` |
| Lint & Gates | `oxlint`, `tsc --noEmit`, `scripts/tenant-lint.mjs` | Run together via `npm run lint` |

---

## Modularity & Tenancy Rules (Enforced in CI)

1. **One-Way `platform/` Boundary**:
   - Reusable self-hosted infrastructure lives in `server/platform/*` and `shared/platform/*` (`auth`, `tenancy`, `crypto`, `audit`, `mail`, `settings`, `net`, `db`).
   - Toolbox domain code lives in `server/kits/*`, `server/srs/*`, `server/graph/*`, `server/ai/*`, `server/routes/*`, and `shared/kits/*`.
   - Domain imports `platform/`; **`platform/` never imports domain** (enforced by `.oxlintrc.json` and `scripts/tenant-lint.mjs`).
2. **Single `server/appConfig.ts` for Brand Constants**:
   - Keep app-specific identifiers (`APP_SLUG`, `SESSION_COOKIE`, `TOKEN_PREFIX = "tbk_"`, `SECRET_KEY_ENV = "TOOLBOX_SECRET_KEY"`, `DEFAULT_PORT = 3100`) centralized in `server/appConfig.ts`.
3. **Branded `Scope` + `tenant-lint` on Every Owned Table**:
   - Every HTTP route touching user-owned tables (`kits`, `guide_content`, `chat_starters`, `decks`, `flashcards`, `remediation_queue`, `drills`, `drill_attempts`, `boards`, `chat_sessions`, `kit_sources`, `kit_source_chunks`, `episodic_memory`, `study_sessions`, `user_learning_profile`, `user_ai_settings`) MUST extract `const scope = scopeOf(req)` and filter SQL with `ownerId = ?` (`scope.ownerId`).
   - `npm run lint:tenant` statically AST-checks every `db.prepare(...)` / `db.exec(...)` call in `server/**/*.ts`. Only add `// tenant-lint: allow <reason>` on genuine instance-wide admin/migration queries with a clear explanation.
4. **Encrypted Credentials at Rest (`secretBox`)**:
   - Never store plaintext API keys, OIDC secrets, or SMTP passwords in SQLite. Seal with `sealCredential()` / `secretBox.seal()` (`AES-256-GCM` keyed by `TOOLBOX_SECRET_KEY` or `<DATA_DIR>/secret.key`).
5. **Co-Located Subsystem Schemas**:
   - Platform tables live in `initPlatformSchema(db)` (`server/platform/db/platformSchema.ts`); Kit/study tables and legacy v1→v2 automatic migration live in `initKitsSchema(db)` (`server/kits/kitsSchema.ts`), orchestrated by `server/db.ts`.
6. **Semantic `@theme` Tokens & WCAG AA Contrast**:
   - New `.tsx` views use Contrack-compatible semantic Tailwind v4 tokens (`bg-surface`, `bg-surface-container`, `bg-surface-container-lowest`, `text-on-surface`, `text-on-surface-variant`, `bg-primary`, `text-on-primary`, `text-on-primary-wash`, `text-ai`, `text-on-ai-wash`, `border-outline-variant`, `text-danger`, `text-success`, `text-warning`).
   - Keep `src/theme.css` and `src/lib/themePalette.ts` synchronized; every text/surface and pill-wash pair must stay ≥ 4.5:1 in both dark and light modes.

---

## Key Directories

```
shared/
├── platform/auth.ts        # Shared Auth & Admin Zod v4 schemas
└── kits/
    ├── kitSkeleton.ts      # Canonical .toolbox-kit.json v1 schema + pure DAG helpers
    └── systemDesignKit.ts  # Official System Design Starter Kit skeleton

server/
├── appConfig.ts            # Centralized brand/cookie/env constants
├── app.ts                  # Express app factory (used by index.ts and supertest)
├── index.ts                # Production/dev HTTP server entrypoint
├── db.ts                   # SQLite initialization + subsystem schema runner
├── platform/               # Reusable auth, tenancy, secretBox, mail, audit, backup
├── kits/kitsSchema.ts      # Multi-tenant Kit tables + zero-data-loss v1 DB upgrader
├── ai/engine.ts            # Multi-provider AI engine (Gemini, Claude, OpenAI, BYOM)
├── srs/scheduler.ts        # SM-2 spaced repetition scheduler
├── graph/                  # Pure DAG health & prerequisite remediation planners
└── routes/                 # Tenant-scoped Express routers

src/
├── theme.css               # Tailwind v4 semantic @theme tokens (dark + light)
├── index.css               # Legacy design system classes (.btn, .card, .sidebar, etc.)
├── components/auth/        # AuthGate.tsx + useAuth() context
├── components/settings/    # Account, Passkeys, tbk_ Tokens & Instance Admin UI
├── pages/                  # Route-level page components
├── stores/                 # Zustand global state (appStore, useTimerStore, useCalcStore)
└── utils/                  # API clients (api.js, authApi.ts) & helpers
```

---

## Commands

```bash
npm run dev             # Concurrent Vite (:5173) + Express (:3100)
npm run lint            # oxlint + tsc --noEmit + tenant-lint
npm test                # Vitest unit + supertest integration suite
npm run test:coverage   # Vitest with v8 coverage
npm run build           # Production Vite frontend bundle
```

---

## Common Gotchas (Preserve These)

1. **SRS state after edits**: After saving card content via the card browser, re-fetch the full deck (`decksApi.get(deckId)`) to sync SRS state back to the UI.
2. **Board auto-save vs manual save**: Boards auto-save after 3 seconds of inactivity. New boards (`id.startsWith('board-')`) are NOT auto-saved until first manual save.
3. **Chat panel state**: Each page (`guide`, `builder`, `study`) has its own chat panel state in `appStore.chatOpen`. Toggle with `toggleChat(page)`.
4. **Streaming abort**: Always pass an `AbortController.signal` to `chatApi.stream()` so users can stop generation.
5. **Toast notifications**: Use `addToast({ type: 'success'|'error'|'info', message: '...' })` from `useAppStore` for user feedback. Never use `alert()`.
6. **Two board shapes**: `appStore` holds whiteboard state in React Flow shape (`position: {x,y}`, `data: {...}`, `source`/`target`), while SQLite and templates persist `{x, y, from, to}`. Convert ONLY at boundaries via `src/components/builder/boardModel.js`.
7. **Global `svg { max-width: 100% }` reset**: React Flow's edge SVGs collapse to zero width without `.react-flow svg { max-width: none }` in `src/index.css` — keep that override intact, and keep bare-element resets inside `@layer base` so Tailwind v4 utilities win cleanly.
