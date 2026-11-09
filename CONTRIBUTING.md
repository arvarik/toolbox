# Contributing to Toolbox

Contributions (bug fixes, pedagogy improvements, security hardening, and documentation) are welcome.

> **Read [`docs/AGENTS.md`](docs/AGENTS.md) before modifying code.** It documents architectural boundaries and CI invariants enforced on every pull request.

---

## Prerequisites

- **Node.js ≥ 26**, the version in `.nvmrc` (server runs `.ts` directly via native Node type-stripping — no server build step)
- **npm ≥ 10**
- Optional: a Gemini, OpenAI, Claude, or local Ollama endpoint for testing live AI generation

## Local Development Setup

```bash
git clone https://github.com/arvarik/toolbox.git
cd toolbox
cp .env.example .env
npm ci
npm run dev
```

`npm run dev` runs two processes concurrently:
- **Vite dev server** on `http://localhost:5173` (HMR, proxies `/api/*` to `:3100`)
- **Express server** on `http://localhost:3100` (`node --watch server/index.ts`)

---

## Key Entrypoints

| Path | Purpose |
|------|---------|
| `server/index.ts` / `server/app.ts` | HTTP server entrypoint and Express app factory |
| `server/db.ts` | SQLite initialization (`platformSchema.ts` + `kitsSchema.ts` + hybrid search tables) |
| `server/platform/` | Reusable self-hosted infrastructure (auth, tenancy, `secretBox`, archive, workers, net) |
| `server/kits/`, `server/compiler/`, `server/srs/`, `server/graph/`, `server/mcp/`, `server/search/` | Toolbox v2 domain modules |
| `server/routes/` | Tenant-scoped Express route handlers |
| `shared/` | Runtime-pure TypeScript + Zod v4 schemas shared by server, client, and MCP |
| `src/App.tsx` | React Router route definitions (Library, `/k/:slug/*`, `/new`, `/review`, `/settings`) |
| `src/theme.css` & `src/index.css` | Tailwind v4 semantic `@theme` tokens + legacy CSS component classes |
| `src/stores/` | Zustand global state (`appStore`, `useKitStore`, `useTimerStore`, `useCalcStore`) |
| `src/utils/` | API clients (`api.ts` including `kitsApi`, `authApi.ts`, `compilerApi.ts`, `pedagogyApi.ts`, `aiSettingsApi.ts`) |

---

## Architectural & Coding Rules

1. **One-Way `platform/` Boundary**: `server/platform/*` and `shared/platform/*` must never import Toolbox domain modules (`kits`, `compiler`, `srs`, `graph`, `mcp`). Enforced by `scripts/tenant-lint.mjs`.
2. **Tenant Isolation (`Scope`)**: Every SQL query against a user-owned table must extract `const scope = scopeOf(req)` and filter by `ownerId = ?` (`scope.ownerId`). `npm run lint:tenant` checks every SQL string that names an owned table.
3. **Runtime-Pure `shared/`**: Files in `shared/` must not import `node:*` or `react`. Validate external payloads with Zod v4 schemas.
4. **Encrypted Secrets**: Never store plaintext API keys, OIDC client secrets, or SMTP credentials in SQLite. Seal them via `secretBox` (`AES-256-GCM`).
5. **Styling & Contrast**: New views use semantic Tailwind v4 `@theme` tokens (`src/theme.css`) clearing WCAG 2.1 AA (≥ 4.5:1) in both dark and light modes, verified by `npm run audit:contrast` and `src/__tests__/theme_contrast.test.ts`. Legacy component classes use CSS variables in `src/index.css`.
6. **Minimal Dependencies**: Prefer Node.js built-ins (`node:zlib`, `node:crypto`, `fetch`, `worker_threads`) before adding packages.

---

## Quality Gates & Testing

Run all checks locally before opening a pull request:

```bash
npm run lint           # Runs oxlint + tsc --noEmit + scripts/tenant-lint.mjs
npm run audit:contrast # Static WCAG 2.1 AA contrast audit across src/
npm test               # Vitest unit + Supertest API/security integration tests
npm run test:coverage  # Vitest with v8 coverage
npm run build          # Production Vite frontend build (also writes dist/THIRD-PARTY-LICENSES.md)
npm run test:e2e       # Playwright end-to-end browser suite (needs npm run build)
```

Before the first `npm run test:e2e`, install the Playwright browser once with `npx playwright install chromium`.

CI also runs `npm audit` and `npm audit signatures`, a Grype scan of the container image (it fails on fixed HIGH or CRITICAL CVEs), and a `workflow-lint` job (zizmor and actionlint). If the image scan fails on a new OS package CVE, bump the base image digest in the `Dockerfile`, or add the package to its `apt-get install --only-upgrade` line.

For locked-out self-hosted operators on `AUTH_REQUIRED=true` instances, recover account access via CLI:

```bash
npm run reset-password -- <username-or-email>
```

---

## Adding Routes or Schema Columns

### New API Endpoint
1. Define request/response Zod v4 schemas in `shared/` if shared across client/server.
2. Implement the handler in the relevant module or `server/routes/*.ts`, scoping all user-owned SQL queries with `scopeOf(req).ownerId`.
3. Mount the router in `server/app.ts` (or subsystem `*RoutesMount.ts`) behind `authed` (`[requireAuth, requirePasswordCurrent]`) or `requireAdmin`.
4. Add typed client methods in `src/utils/` and document the endpoint in [`docs/api.md`](docs/api.md).

### Database Migrations
- Platform tables belong in `server/platform/db/platformSchema.ts` (`initPlatformSchema`).
- Kit/study tables and additive column migrations belong in `server/kits/kitsSchema.ts` (`initKitsSchema`).
- Keep migrations idempotent (check `PRAGMA table_info(...)` before `ALTER TABLE`) so existing v1 and v2 SQLite files upgrade cleanly on startup.
- If you add a new user-owned table, register it in `scripts/tenant-lint.mjs` so tenant scoping is enforced.

---

## Pull Request Checklist

- Focused branch name (`feat/...`, `fix/...`, `docs/...`)
- `npm run lint`, `npm run audit:contrast`, `npm test`, and `npm run build` pass with zero errors
- Relevant tests added or updated (`src/__tests__/`, `server/**/__tests__/`, or `tests/e2e/`)
- Documentation updated (`docs/api.md`, `docs/architecture.md`, `docs/user-guide.md`) when behavior changes
- User-visible changes added to the top section of [`CHANGELOG.md`](CHANGELOG.md)

---

## Releases & Versioning

Toolbox follows [Semantic Versioning](https://semver.org/). A pre-release has a suffix, such as `2.0.0-alpha.1`.

1. Run `npm version <version> --no-git-tag-version`, rename the top `CHANGELOG.md` section to that version with the release date, and merge to `main`.
2. Tag that commit `v<version>` and push the tag. The **Publish Docker image to GHCR** workflow publishes the multi-arch image for the tag and creates a GitHub release with a signed source archive. A tag with a suffix becomes a pre-release.

Every push to `main` also publishes the `latest` image tag.
