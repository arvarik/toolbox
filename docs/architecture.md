# Toolbox v2 — Architecture

Technical architecture reference for contributors and operators.

---

## System Overview

Toolbox v2 runs as a single Node.js 26 process serving the compiled React SPA, tenant-scoped REST API, Server-Sent Events (SSE) streams, and a stateless Streamable HTTP MCP endpoint (`/api/mcp`), backed by a single SQLite database (`better-sqlite3` + `sqlite-vec` + `FTS5`) and an isolated CPU worker thread (`worker_threads`).

```
┌───────────────────────────────────────────────────────────────────────────┐
│                      Docker Container (node:26-trixie-slim)               │
│                                                                           │
│  ┌─────────────────────────────────────────────────────────────────────┐  │
│  │               Express 5 Server (node server/index.ts)               │  │
│  │  • Static SPA (dist/)               • Auth, Passkeys, OIDC, Admin   │  │
│  │  • Tenant-scoped REST (/api/*)      • Stateless MCP (POST /api/mcp) │  │
│  │  • SSE AI streaming & Kit Compiler  • Zero-dep ZIP archive verifier │  │
│  └──────────────────┬──────────────────────────────────┬───────────────┘  │
│                     │ synchronous SQL                  │ IPC              │
│                     ▼                                  ▼                  │
│  ┌─────────────────────────────────────┐  ┌────────────────────────────┐  │
│  │ SQLite (/app/data/toolbox.db, WAL)  │  │ Persistent CPU Worker      │  │
│  │ • Platform & Kit relational tables  │  │ • ONNX all-MiniLM-L6-v2    │  │
│  │ • FTS5 lexical index                │  │ • unpdf text extraction    │  │
│  │ • sqlite-vec 384-d cosine vectors   │  │ • Deterministic fallback   │  │
│  └─────────────────────────────────────┘  └────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
         │                                               │
         ▼ HTTPS (optional)                              ▼ HTTP (optional)
  Gemini / OpenAI / Claude / BYOM                  Self-hosted SearXNG
```

---

## Tech Stack

| Layer | Technology | Role |
|-------|------------|------|
| **Server Runtime** | Node.js ≥ 26 + Express 5 | Native `.ts` execution via type-stripping (no server build step) |
| **Shared Contracts** | TypeScript + Zod v4 (`shared/`) | Runtime-pure schemas shared by server, client, and MCP |
| **Frontend** | React 19 + Vite 8 + React Router 8 | Lazy-loaded multi-Kit SPA |
| **State** | Zustand 5 (`src/stores/`) | UI state, active Kit context, Pomodoro timer, calculator |
| **Styling** | Tailwind CSS v4 (`src/theme.css`) + CSS variables (`src/index.css`) | WCAG 2.1 AA dark/light semantic `@theme` tokens |
| **Diagrams & Math** | `@xyflow/react` + `dagre`, `mermaid` (strict), `language-svg` sanitizer, `katex` | Knowledge Graph DAG, dual-mode Canvas, inline figures, offline LaTeX |
| **Database** | `better-sqlite3` + `sqlite-vec` + SQLite `FTS5` | WAL-mode relational store + hybrid lexical/vector search |
| **Local ML / Docs** | `@huggingface/transformers` (`onnxruntime-node`) + `unpdf` | 384-dim `Xenova/all-MiniLM-L6-v2` embeddings & PDF parsing in worker |
| **AI & MCP** | Vercel AI SDK (`ai`) + `@modelcontextprotocol/sdk` | Multi-provider routing, structured outputs, Streamable HTTP MCP |
| **Auth & Security** | `scrypt`, `@simplewebauthn/server`, `openid-client`, `AES-256-GCM` | Passwords, Passkeys, OIDC SSO, encrypted credentials at rest |
| **Quality Gates** | `oxlint`, `tsc --noEmit`, `scripts/tenant-lint.mjs`, Vitest, Playwright | Lint, typecheck, AST tenant-isolation enforcement, unit/API/E2E tests |

---

## Modularity & Boundary Rules

1. **One-Way `platform/` Boundary**:
   - `server/platform/*` and `shared/platform/*` hold reusable self-hosted infrastructure: authentication, sessions, Passkeys, OIDC, `tbk_` API tokens, `Scope` tenancy, `secretBox` encryption, audit log, SMTP mail, online SQLite backups, SSRF/DNS-rebinding guards, `node:zlib` ZIP verification, `cpuHost` workers, and AI provider key storage.
   - Domain directories (`server/kits/`, `server/compiler/`, `server/srs/`, `server/graph/`, `server/mcp/`, `server/search/`, `server/ai/`, `server/routes/`, `shared/kits/`) import from `platform/`, while **`platform/` never imports domain modules** (`scripts/tenant-lint.mjs` fails on `platform/` imports of `kits`, `srs`, `compiler`, `graph`, or `src`).
2. **Runtime-Pure `shared/`**:
   - `shared/` contains zero `node:*` or `react` imports (tenant-lint `boundary:shared-impure-import`), allowing identical Zod v4 validation in browser bundles and server routes.
3. **Lint-Enforced Multi-Tenancy (`Scope`)**:
   - `attachPrincipal` + `attachRequestContext` resolve the caller (session cookie, `tbk_` bearer token, or implicit `local@toolbox.local` when `AUTH_REQUIRED=false`) into a branded `Scope { ownerId }`.
   - `scripts/tenant-lint.mjs` scans every string literal in `server/**/*.ts` that names a user-owned table (skipping DDL) and fails CI if it omits `ownerId`.

---

## Frontend Architecture

### Route Hierarchy (`src/App.tsx`)

All pages render inside `<Layout />` (collapsible sidebar, Kit switcher, Pomodoro widget, mobile navigation, global `⌘K` search, and keyboard shortcuts):

- **Global Library & Review**:
  - `/` → `LibraryHomePage` (personal Kits, import `.toolbox-kit.json` / `.toolbox-backup.zip`, starter Kits)
  - `/shared` → `SharedLibraryPage` (instance-wide published Kits)
  - `/new` → `NewKitStudioPage` (Deep Research Kit Compiler in 3 UI steps over the 4 API stages)
  - `/review` → `ReviewPage` (cross-Kit FSRS-6 due queue)
  - `/settings` → `SettingsPage` (Account, Passkeys, BYOK, Capability Router, `tbk_` MCP tokens, Instance Admin)
- **Kit-Scoped Workspace (`/k/:slug/*`)** *(also mounted at legacy top-level paths `/chat`, `/guide`, etc. for active/default Kit compatibility)*:
  - `/k/:slug` → `KitPathPage` (Mastery Path overview, readiness, Living Kit expansion)
  - `/k/:slug/chat` → `ChatPage` (persona tutor, Hybrid RAG + SearXNG web citations, Commit-to-Guide)
  - `/k/:slug/guide`, `/k/:slug/guide/:pillarId/:topicId` → `GuidePage` (structured blueprint reader/editor)
  - `/k/:slug/drills` → `DrillsPage` (attempt-gated drills & `⚡ Challenge Node`)
  - `/k/:slug/builder` & `/k/:slug/canvas` → `BuilderPage` (`architecture` whiteboard or Novakian `concept` map)
  - `/k/:slug/study` → `StudyPage` (decks, card browser, deck options, stats)
  - `/k/:slug/interleaved` → `InterleavedPage` (shuffled Kit-wide due session)
  - `/k/:slug/feynman` → `FeynmanPage` (voice/text first-principles evaluator)
  - `/k/:slug/graph` → `GraphPage` (React Flow + `dagre` prerequisite DAG with live retrievability heatmap)
  - `/k/:slug/calculator` → `CalculatorPage` (BotE sizing sandbox; the sidebar link and `⌘8`/`⌘E` shortcuts appear when `kit.capabilities.calculator !== false`)

### Active Kit Resolution

Client requests send `X-Toolbox-Kit: <kitId-or-slug>` (managed by `useKitStore` + `src/utils/api.ts`). On the server, `resolveActiveKit(req, db, scope)` (`server/kits/kitContext.ts`) resolves the header, `?kitId=`, `?kit=`, or a body `kitId`. With no selector, it falls back to the user's System Design Starter Kit (lazily provisioned on first access). An unknown selector returns `404`.

---

## Database Schema

SQLite runs with `journal_mode = WAL`, `synchronous = NORMAL`, `foreign_keys = ON`, and `busy_timeout = 5000`. Existing v1 databases (`user_profile`, un-scoped `decks`/`flashcards`/`boards`/`guide_content`) are automatically upgraded in place on startup with zero data loss and assigned to the local owner's System Design Kit.

### Platform Tables (`server/platform/db/platformSchema.ts`)

| Table | Purpose |
|-------|---------|
| `users` | Accounts (`email`, `passwordHash`, `role`, `disabledAt`, `mustChangePassword`) |
| `sessions` | Cookie sessions (`id` = SHA-256 of the cookie secret, `userId`, `expiresAt`, `lastSeenAt`, `userAgent`, `method`) |
| `app_settings` | Instance-wide settings & `secretBox`-encrypted provider/OIDC/SMTP configs |
| `user_settings` | Per-user preferences JSON |
| `api_tokens` | Personal `tbk_` bearer tokens (SHA-256 `tokenHash`, `readOnly` flag, expiry) |
| `invitations` | Admin-issued invite links |
| `audit_log` | Security & admin event trail |
| `passkeys` | WebAuthn credentials (`id` = credential ID, `publicKey`, counter, transports) |
| `auth_challenges` | Short-lived WebAuthn & OIDC PKCE/state challenges |
| `auth_links` | Single-use hashed magic-link & password-reset tokens |
| `user_identities` | Linked external OIDC subject mappings |
| `jobs` | Background job records |

### Domain, Kit & Hybrid Search Tables (`server/kits/kitsSchema.ts`, `server/search/hybridSearch.ts`)

- **Instance / Shared Tables**:
  - `config`, `model_catalog`, `custom_endpoints` (instance AI configuration & live model discovery cache)
  - `shared_kits`, `shared_kit_versions` (published Kits visible to authenticated instance users)
- **Tenant-Owned Tables (`ownerId`-scoped, enforced by `tenant-lint`)**:
  - `kits` (`slug`, `name`, `skeleton_json` including capabilities, `forked_from_shared_id`, `forked_version`)
  - `guide_content` (committed blueprint notes; notes whose section leaves the skeleton stay in the table and show as Archived Notes)
  - `chat_sessions`, `chat_starters`
  - `decks`, `flashcards` (FSRS-6 `stability`, `difficulty`, `repetitions`, `lapses`, `state`, `learning_step`, legacy `ease_factor`/`interval`, `node_id` DAG link), `remediation_queue`
  - `drills`, `drill_attempts` (rubric, progressive hints, attempt history, anti-sycophancy scores)
  - `boards` (persisted `{ nodes, edges }`; the canvas mode comes from the Kit's `capabilities.canvas`)
  - `kit_sources`, `kit_source_chunks` (uploaded PDFs/Markdown/text/URLs for compiler & RAG)
  - `user_learning_profile`, `episodic_memory`, `study_sessions`, `user_ai_settings` (encrypted BYOK keys & tier overrides)
  - `rag_chunks` + virtual tables `rag_chunks_fts` (`FTS5` `porter unicode61` with `ownerTok`, `kitTok`, `kindTok`) and `rag_chunks_vec` (`sqlite-vec` `vec0` with `ownerId TEXT PARTITION KEY` and `FLOAT[dim] distance_metric=cosine`)

---

## Persistent CPU Worker & Hybrid Search

### Worker Isolation (`server/platform/workers/cpuHost.ts`)
- Heavy CPU/native work — PDF extraction (`unpdf`) and local 384-dimensional embeddings (`@huggingface/transformers` running quantized `Xenova/all-MiniLM-L6-v2` via `onnxruntime-node`) — runs inside a single background `worker_threads` worker so the Express event loop never blocks.
- **Native ONNX Lifecycle Rule**: Once `onnxruntime-node` initializes inside the worker, the worker is kept alive for the lifetime of the server process (never terminated/respawned on individual task timeouts), preventing V8 native-addon re-registration crashes.
- **Offline / Airgapped Fallback**: Models are pinned by HuggingFace commit SHA (`server/platform/workers/protocol.ts`). `scripts/fetch-models.ts` writes a `.sha256` file next to each download and checks later runs against it. If weights are unavailable and `TRANSFORMERS_OFFLINE=1` (or network is unreachable), embedding calls degrade cleanly to a deterministic normalized token-hash vector so search and tests continue operating without crashing.

### Reciprocal Rank Fusion (`server/search/hybridSearch.ts`)
Queries execute both lexical BM25 (`rag_chunks_fts`, weight `1.0`) and partitioned cosine KNN (`rag_chunks_vec` filtered by `ownerId = ?`, weight `1.2`) across guide notes, flashcards, uploaded Kit sources, and episodic memory, merging candidates via Reciprocal Rank Fusion (`RRF_K = 15`):

$$\text{score}(d) = \sum_{s \in \{\text{fts}, \text{vec}\}} \frac{w_s}{15 + \text{rank}_s(d)}$$

`/api/search` also matches board names with a separate SQL query.

---

## Archive Verifier & Content Security

### Zero-Dependency ZIP Verifier (`server/platform/archive/zip.ts`, `server/kits/kitExportImport.ts`)
Mode 2 full backups (`<slug>.toolbox-backup.zip`) are read and written using Node's built-in `node:zlib` (promisified `deflateRaw` / `inflateRaw` and `crc32`) with strict structural validation before touching SQLite:
- Rejects multi-disk archives, ZIP64 records, encrypted entries, symlinks (`0o120000`), special files, path traversal (`..`, leading `/`, `\`, NUL bytes), overlapping local file byte ranges, and Local-vs-Central-Directory header mismatches.
- Enforces hard ceilings: max **500 entries**, **100 MB** archive size, **150 MB** total uncompressed bytes (`maxOutputLength` decompression-bomb guard), and CRC-32 verification on every entry.
- Enforces a closed entry allowlist (`kit.json`, `userdata.json`, and `files/<sourceId>/<safeBasename>`) and remaps every imported Kit, deck, card, board, session, and source to fresh UUIDs under the importing `Scope`.

### Constructive Diagrams, Math & Prompt Boundaries
- **Inline SVG (`src/utils/sanitizeSvg.ts`)**: `language-svg` code blocks are parsed with `DOMParser` (`image/svg+xml`) against a 22-element static geometry allowlist (`svg`, `g`, `path`, `rect`, `circle`, `text`, etc.), capped at 100 KB / 1,000 elements / depth 64. Scripts, `on*` handlers, `<foreignObject>`, external URLs, `<!DOCTYPE`/`<!ENTITY` XXE preambles, and `<use>` reference chains are stripped or rejected, and internal `id`/`url(#...)` tokens are per-diagram prefixed to prevent DOM ID collisions.
- **Mermaid (`src/components/shared/MermaidRenderer.tsx`)**: Initialized with `securityLevel: 'strict'` and locked `secure` keys so per-diagram directives cannot downgrade sandboxing.
- **KaTeX**: Rendered via `remark-math` + `rehype-katex` with bundled local CSS/fonts (zero runtime CDN requests).
- **Untrusted Input Fencing**: Learner drill/Feynman submissions are wrapped in `<untrusted_submission>` tags (`server/routes/drills.ts`, `server/routes/feynman.ts`, with the matching model instruction in `antiSycophancy.ts`) and MCP responses wrap user-authored prose in `<untrusted_data>` (`toolboxMcpTools.ts`) to resist prompt injection.
