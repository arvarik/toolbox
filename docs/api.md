# Toolbox v2 — API & MCP Reference

Complete reference for Toolbox v2's HTTP REST API (`/api/*`) and Stateless Streamable HTTP Model Context Protocol server (`POST /api/mcp`).

---

## Conventions, Auth & Tenancy

- **Base URL**: `http://localhost:3100/api`
- **Content-Type**: `application/json` (`10mb` body limit), except multipart source/archive uploads and binary `.zip` / `.db` downloads.
- **Authentication Modes**:
  1. **Local Owner Mode (`AUTH_REQUIRED=false`, no password accounts created yet)**: Requests authenticate implicitly as `local@toolbox.local` (admin role).
  2. **Session Cookie (`toolbox_session`)**: `HttpOnly`, `SameSite=Lax` cookie issued by `/api/auth/login`, `/api/auth/setup`, Passkey verify, Magic Link, or OIDC callback. Cross-site write requests (`Origin` mismatch) are rejected (`refuseCrossSiteWrites`).
  3. **Personal Bearer Token (`Authorization: Bearer tbk_<secret>`)**: Created in **Settings → Model Context Protocol (MCP) Server** (`/api/auth/tokens`). Tokens created with `readOnly: true` cannot execute mutating HTTP verbs (`guardReadOnlyToken`) or mutating MCP tools.
- **Kit Context Selection**: Kit-scoped workspace endpoints (`/api/decks`, `/api/boards`, `/api/guide-content`, `/api/chat`, `/api/graph`, `/api/drills`, `/api/feynman`) resolve the target Kit from `X-Toolbox-Kit: <kitId-or-slug>`, `?kitId=`, `?kit=`, or a body `kitId`, defaulting to the caller's System Design Starter Kit. `/api/search` and `/api/decks/all/cards/due` cover every Kit the caller owns when no Kit is selected.
- **Standard Error Shape**: `{ "message": "...", "error": { "code": "...", "message": "...", "requestId": "...", "details": ... } }` (`details` is optional). Legacy routes send `{ "message": "..." }`.

---

## 1. Health

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/health` | Public | Returns `{ "status": "ok", "timestamp": "<ISO-8601>" }`. Used by Docker healthcheck. |

---

## 2. Authentication & Account (`/api/auth`)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/api/auth/status` | Public | Instance auth state (`authRequired`, `authenticated`, `setupRequired`, `hasAccounts`, `user`, `deviceItems`, `registrationOpen`, `mailConfigured`, `magicLinkSignIn`, `localOwnerPresent`, `publicUrl`, `oidc`, `instanceName`). |
| `POST` | `/api/auth/setup` | Public (once) | Bootstrap initial admin account (`{ email, username, password, displayName? }`) and enable multi-tenant auth. |
| `POST` | `/api/auth/register` | Public (if enabled) | Self-register account when open registration is enabled (same fields as setup; password of 8+ characters). |
| `POST` | `/api/auth/login` | Public | Password login (`{ identifier, password, remember? }`, where `identifier` is a username or email); sets `toolbox_session`. |
| `POST` | `/api/auth/logout` | Public | Revoke the current session (if any) and clear the cookie. |
| `POST` | `/api/auth/invitations/check` | Public | Check that an invitation token (`{ token }`) is valid; returns `{ ok: true }`. |
| `POST` | `/api/auth/accept-invitation` | Public | Claim an admin-issued invitation (`{ token, email, username, password, displayName? }`). |
| `POST` | `/api/auth/password-reset/request` | Public | Send password-reset email link (requires SMTP). |
| `POST` | `/api/auth/password-reset/complete` | Public | Complete password reset (`{ token, password }`). |
| `POST` | `/api/auth/magic-link/request` | Public | Request passwordless sign-in link via email. |
| `POST` | `/api/auth/magic-link/complete` | Public | Redeem magic-link token and establish session. |
| `GET` | `/api/auth/me` | Session | Current user profile, role, and security flags. |
| `PATCH` | `/api/auth/me` | Session | Update `displayName` or initiate email change. |
| `DELETE` | `/api/auth/email-change` | Session | Cancel pending email change. |
| `POST` | `/api/auth/email-change/complete` | Public | Confirm email change token. |
| `POST` | `/api/auth/change-password` | Session | Rotate password (`{ currentPassword, newPassword }`) and revoke other sessions. |
| `GET` | `/api/auth/sessions` | Session | List active browser sessions for current user. |
| `DELETE` | `/api/auth/sessions` | Session | Revoke all other sessions. |
| `GET` | `/api/auth/tokens` | Session | List personal `tbk_` API/MCP tokens (metadata only; plaintext shown once on creation). |
| `POST` | `/api/auth/tokens` | Session | Mint `tbk_` token (`{ name, readOnly?: boolean, expiresInDays?: number }`). |
| `DELETE` | `/api/auth/tokens/:id` | Session | Revoke a personal `tbk_` token. |
| `POST` | `/api/auth/passkeys/register/options` | Session | Generate WebAuthn registration challenge (`PUBLIC_URL` sets RP ID behind proxies). |
| `POST` | `/api/auth/passkeys/register/verify` | Session | Verify attestation and store Passkey credential. |
| `GET` | `/api/auth/passkeys` | Session | List registered Passkeys. |
| `PATCH` | `/api/auth/passkeys/:id` | Session | Rename a Passkey (`{ name }`). |
| `DELETE` | `/api/auth/passkeys/:id` | Session | Remove a Passkey. |
| `POST` | `/api/auth/passkeys/login/options` | Public | Generate WebAuthn authentication challenge. |
| `POST` | `/api/auth/passkeys/login/verify` | Public | Verify assertion and issue `toolbox_session`. |
| `POST` | `/api/auth/passkey-nudge/dismiss` | Session | Dismiss Passkey enrollment prompt. |
| `GET` | `/api/auth/oidc/start` | Public | Redirect to OIDC Identity Provider (PKCE + state). |
| `POST` | `/api/auth/oidc/link` | Session | Initiate OIDC account-linking flow for signed-in user. |
| `GET` | `/api/auth/oidc/callback` | Public | Complete OIDC authorization code exchange. |
| `GET` | `/api/auth/identities` | Session | List linked external OIDC identities. |
| `DELETE` | `/api/auth/identities/:id` | Session | Unlink an external OIDC identity. |

---

## 3. Instance Administration (`/api/admin`)

Requires `role === "admin"` and a session cookie (or the implicit local owner while sign-in is off). A `tbk_` token gets `403 SESSION_REQUIRED`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/admin/users` | List all instance users. |
| `POST` | `/api/admin/users` | Create user directly (`{ email, username, role?, displayName?, temporaryPassword? }`). |
| `GET` | `/api/admin/users/:id` | Inspect user details. |
| `PATCH` | `/api/admin/users/:id` | Update user role or profile fields. |
| `POST` | `/api/admin/users/:id/reset-password` | Set temporary password (`mustChangePassword = 1`). |
| `POST` | `/api/admin/users/:id/reset-link` | Generate one-time password-reset URL. |
| `POST` | `/api/admin/users/:id/disable` | Disable user login & revoke active sessions. |
| `POST` | `/api/admin/users/:id/enable` | Re-enable disabled user. |
| `DELETE` | `/api/admin/users/:id` | Delete user and cascade-remove owned tenant rows. The body must be `{ "decision": "purge" }`, or the server returns `409`. |
| `GET` | `/api/admin/invitations` | List pending/claimed invitations. |
| `POST` | `/api/admin/invitations` | Create invitation (`{ email?, role?, expiresInDays?, send? }`; `send` emails it via SMTP). |
| `DELETE` | `/api/admin/invitations/:id` | Revoke invitation. |
| `GET` / `PUT` | `/api/admin/settings` | Read/update instance policies (open registration, session TTL, backup schedule). |
| `GET` / `PUT` | `/api/admin/integrations` | Read/update OIDC SSO configuration (`secretBox`-encrypted client secret). |
| `GET` / `PUT` / `DELETE` | `/api/admin/mail` | Read/configure/clear SMTP mail transport. |
| `POST` | `/api/admin/mail/test` | Send test email using configured SMTP settings. |
| `GET` | `/api/admin/backups` | List online SQLite backup snapshots in `${DATA_DIR}/backups`. |
| `POST` | `/api/admin/backups` | Create a verified online SQLite backup (`sqlite.backup()`) now, then delete the oldest backups beyond `BACKUP_KEEP`. |
| `GET` | `/api/admin/backups/:filename` | Download backup SQLite file. |
| `GET` | `/api/admin/audit` | Query security & admin `audit_log` entries. |

---

## 4. Kits & Shared Library (`/api/kits`, `/api/shared-kits`)

### Personal Kits (`/api/kits`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/kits` | List caller's Kits with node counts, mastery stats, and upstream update status. |
| `GET` | `/api/kits/:id` | Fetch full Kit metadata, `KitSkeleton`, and capabilities (`id` or `slug`). |
| `PATCH` / `PUT` | `/api/kits/:id` | Update Kit metadata (`name`, `description`, `icon`, `color`, `slug`). |
| `DELETE` | `/api/kits/:id` | Delete Kit and cascade-delete its decks, drills, boards, sessions, and RAG chunks. |
| `POST` | `/api/kits/:id/touch` | Update `lastOpenedAt` timestamp for Library sorting. |
| `GET` | `/api/kits/:id/export-kit` | **Mode 1 Export**: Download clean `<slug>.toolbox-kit.json` curriculum skeleton (zero personal progress/files; alias `GET /:id/export?mode=kit`). |
| `GET` | `/api/kits/:id/export-backup` | **Mode 2 Export**: Stream `<slug>.toolbox-backup.zip` containing `kit.json`, `userdata.json` (decks, FSRS state, notes, drills, boards, chats), and `files/<sourceId>/<name>` (`GET /:id/export?mode=backup`). |
| `POST` | `/api/kits/import-kit` | Import `.toolbox-kit.json` (`onCollision`: `"error" \| "copy" \| "replace" \| "update"`). |
| `POST` | `/api/kits/import-backup` | Upload & verify `.toolbox-backup.zip` (`multipart/form-data` field `file`, up to 100 MB; fresh UUID remapping). `POST /api/kits/import` accepts the same upload or a JSON skeleton. |
| `GET` | `/api/kits/:id/archived-notes` | List `guide_content` notes soft-archived during a skeleton update. |
| `POST` | `/api/kits/:id/archived-notes/refile` | Re-attach an archived note to a current `(pillarId, topicId, sectionId)`. |
| `DELETE` | `/api/kits/:id/archived-notes` | Permanently delete archived notes. |
| `POST` | `/api/kits/:id/publish` | Publish or push a new version of this Kit to the instance Shared Library. |
| `POST` | `/api/kits/:id/sync` | With no body, pull upstream skeleton updates from `shared_kits` while preserving personal SRS & notes (alias `POST /:id/sync-upstream`). With `{ skeleton }`, apply a local skeleton update and soft-archive orphaned `guide_content`. |
| `GET` | `/api/kits/:id/sources/:sourceId/file` | Download an uploaded source document attached to the Kit. |

### Shared Library (`/api/shared-kits`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/shared-kits` | List Kits published to the instance Shared Library. |
| `GET` | `/api/shared-kits/:slug` | Inspect published Kit skeleton and version history. |
| `POST` | `/api/shared-kits/:slug/fork` | Clone a Shared Kit into the caller's personal Library. |

---

## 5. 4-Stage Deep Research Kit Compiler & Living Kits (`/api/compiler`)

| Method | Endpoint | Stage & Description |
|--------|----------|---------------------|
| `POST` | `/api/compiler/sources` | **Stage 1 (Ingest)**: Multipart upload of PDFs (`unpdf` worker), Markdown/text files, or `{ urls: [...] }` (SSRF-guarded fetch). Returns `stagedId` chunks (alias `POST /ingest`). |
| `DELETE` | `/api/compiler/sources/:stagedId` | Discard a staged source before compilation. |
| `POST` | `/api/compiler/calibrate` | **Stage 2 (Calibrate)**: `{ topicPrompt, depth?: "quick" \| "standard" \| "deep", stagedSourceIds?, urls?, pastedText?, model? }` → generates 3 diagnostic calibration questions and capability recommendations (`canvas`: `'architecture' \| 'concept' \| 'none'`, `calculator`, `webResearchDefault`, `enableSvgDiagrams`). |
| `POST` | `/api/compiler/compile` | **Stage 3 (Synthesize)**: `{ topicPrompt, calibrationAnswers?, enableWebResearch?, ... }` → runs optional SearXNG web grounding + `deep`/`research` synthesis and returns JSON `{ skeleton, pool, citedSourceIds, dagRepair, stagedSources }` with a validated acyclic `KitSkeleton` DAG. |
| `POST` | `/api/compiler/refine` | **Stage 4a (Refine)**: Apply natural-language edits (`{ skeleton, instruction }`) while re-validating DAG acyclicity and schema constraints. |
| `POST` | `/api/compiler/commit` | **Stage 4b (Commit)**: Persist the compiled `KitSkeleton` as a new Kit, attach staged sources, index Hybrid RAG chunks, and kick off initial flashcard/starter seeding. |
| `GET` | `/api/compiler/kits/:id/seed-status` | Poll background card/guide seeding progress for a newly committed Kit. |
| `POST` | `/api/compiler/kits/:id/expand` | **Living Kit Expansion**: `{ prompt, enableWebResearch?, stagedSourceIds?, urls?, pastedText?, model? }` — researches and splices new sub-DAG nodes + edges (the model is asked for 4–12) into an existing Kit without disturbing existing notes or FSRS state. |

---

## 6. AI Capability Router, BYOK & Provider Endpoints

### Per-User AI & BYOK (`/api/ai-settings`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/ai-settings` | Effective capability routing (`quick`, `deep`, `research`), configured instance/BYOK providers, custom endpoints, and available model catalog. |
| `PUT` | `/api/ai-settings` | Save per-user `secretBox`-encrypted BYOK API keys (`gemini`, `openai`, `claude`), capability tier model overrides, or `webSearchEngine` (`provider`, `searxng`, or `combined`). |
| `POST` | `/api/ai-settings/test-key` | Test a provider API key (`{ provider, key }`) and save it as a BYOK key if the test passes. |
| `POST` | `/api/ai-settings/endpoints/test` | Test an OpenAI-compatible BYOM base URL (SSRF-checked in multi-tenant mode). |
| `POST` / `PUT` / `DELETE` | `/api/ai-settings/endpoints` (`/:id`) | Manage user-scoped OpenAI-compatible endpoints (Ollama, vLLM, OpenRouter, etc.). |

### Instance AI Router & Embeddings (`/api/admin/ai-settings`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` / `PUT` | `/api/admin/ai-settings` | Configure instance-wide provider keys, default `quick`/`deep`/`research` models, the `embeddings` provider (`local` ONNX, `gemini`, `openai`, or `custom`), and `webSearch.searxngUrl`. |
| `POST` | `/api/admin/ai-settings/test-searxng` | Probe SearXNG JSON search connectivity (`{ searxngUrl? }`, defaulting to the saved URL). |
| `POST` | `/api/admin/ai-settings/reindex-embeddings` | Embed up to 500 chunks whose vectors are missing or stale (for example after switching embedding models). Repeat until the response has `reindexed: 0`. |

*(Legacy instance compatibility routes `/api/config` and `/api/endpoints` remain mounted for existing UI workflows.)*

---

## 7. Hybrid Search (`/api/search`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/search?q=<query>&kitId=<id>&kinds=<list>&limit=10` | Executes Reciprocal Rank Fusion (`RRF_K = 15`) across `FTS5` BM25 (weight `1.0`) and `sqlite-vec` cosine KNN (weight `1.2`) over guide notes, flashcards, boards, Kit sources, and episodic memory within the caller's `Scope`. Without a Kit selector it searches every Kit. `limit` defaults to 10 (max 50). |

---

## 8. Pedagogy: Drills, Challenge Node, Feynman & FSRS-6 Decks

### Guided Drills & `⚡ Challenge Node` (`/api/drills`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/drills?nodeId=<id>` | List generated drills and attempt summaries for the active Kit (optionally filtered by `nodeId`). |
| `POST` | `/api/drills/generate` | Generate an attempt-gated drill (`{ nodeId, difficulty?: 1 \| 2 \| 3, model? }`) with rubric items, 3 progressive hints, and a worked solution. |
| `GET` | `/api/drills/:id` | Fetch the drill (prompt, hints, rubric, `workedSolution`) and past attempts. The web app hides the worked solution until the first attempt. |
| `POST` | `/api/drills/:id/submit` | Grade learner `{ submission, hintsUsed?, viewedWorkedSolution?, model? }` with errors-first anti-sycophancy guardrails. Unassisted passes (`score >= 0.8`) propagate FIRe upward credit; failures (`score < 0.6`) queue downward prerequisite remediation. |
| `GET` | `/api/drills/challenge/:nodeId` | Fetch or generate a difficulty-3 `⚡ Challenge Node` diagnostic + Feynman first-principles prompt. |
| `POST` | `/api/drills/challenge/:nodeId` | Submit `{ drillId, drillSubmission, feynmanExplanation, model? }`. Unassisted `score >= 0.85` with zero errors commits the explanation into `guide_content`, graduates node flashcards (`S = 21`, `interval = 21d`), and propagates FIRe upward credit. |

### Feynman Evaluator (`/api/feynman`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/feynman/evaluate` | Structured anti-sycophancy evaluation of a learner's plain-language concept explanation (`{ explanation, nodeId?, pillarId?, topicId?, conceptName?, model? }`), returning extracted claims, errors, jargon flags, Socratic follow-up, and score. |

### Flashcard Decks & FSRS-6 Reviews (`/api/decks`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/decks` | List decks in the active Kit with `card_count` and `due_count`. |
| `GET` | `/api/decks/stats` | Review statistics for the active Kit's decks. |
| `GET` | `/api/decks/all/cards/due` | Interleaved due queue across every Kit (or the selected Kit), prioritizing `remediation_queue` cards first (alias `GET /api/decks/interleaved/due`). `GET /api/review/due` and `GET /api/srs/due` return the cross-Kit queue for `/review`. |
| `POST` / `GET` / `PUT` / `DELETE` | `/api/decks` (`/:id`) | Create, inspect, update, or delete a deck. |
| `PUT` | `/api/decks/:deckId/settings` | Update per-deck FSRS-6 settings (`new_limit`, `review_limit`, `steps`, `lapse_steps`, `easy_bonus`, `desired_retention`). |
| `GET` / `POST` | `/api/decks/:deckId/cards` | List cards or create a card (`{ front, back, node_id?, prerequisite_id? }`). |
| `GET` | `/api/decks/:deckId/cards/due` | Due cards for a single deck (remediation cards prioritized). |
| `POST` | `/api/decks/:deckId/cards/check-duplicates` | Lexical duplicate check (`{ cards: [{ front, back }] }`, trigram similarity above `0.55`) before adding cards. |
| `PUT` / `DELETE` | `/api/decks/:deckId/cards/:cardId` | Edit card content/links or delete card. |
| `PUT` / `POST` | `/api/decks/:deckId/cards/:cardId/review` | Submit FSRS-6 review `{ quality: 0..5, confidence? }` (alias `/api/decks/cards/:cardId/review`). `confidence: "guessed"` caps a passing grade at Hard, and `"high"` shortens relearning after a miss. Returns updated DSR card fields (`stability`, `difficulty`, `repetitions`, `lapses`, `interval`, `next_review`), `srs_previews`, a downward `remediation` summary, and `implicit_credit_count`. |

---

## 9. Workspace: Canvas, Guide, Chat, Graph, Calculator & System

- **Dual-Mode Canvas (`/api/boards`)**:
  - `GET /`, `GET /:id`, `POST /`, `PUT /:id`, `PATCH /reorder`, `PATCH /:id/rename`, `DELETE /:id`
  - `POST /api/boards/:id/critique`: Structured AI rubric critique tailored to board mode — **Architecture mode** checks single points of failure, bottlenecks, data flow consistency, and trade-offs; **Novakian Concept mode** checks proposition accuracy (`[Concept A] —linking phrase→ [Concept B]`), missing linking phrases, hierarchy, and cross-links.
- **Knowledge Guide (`/api/guide-content`)**:
  - `GET /progress`, `GET /export` (Markdown bundle), `GET /:pillarId/:topicId`, `GET|PUT|DELETE /:pillarId/:topicId/:sectionId` (automatically re-indexes `rag_chunks`).
- **AI Tutor Chat (`/api/chat`)**:
  - `POST /stream` (SSE token + citation events, optional `webResearch: true` via SearXNG + Hybrid RAG grounding), `POST /` (non-streaming), `GET /starters`
  - `POST /commit` & `POST /commit/save` (extract & commit chat insights into Guide blueprint sections)
  - `POST /generate-flashcards`, `POST /generate-reverse-cards`, `POST /summarize`, `POST /evaluate-interceptor`, `POST /concept-map`
  - `GET /sessions`, `POST /sessions`, `POST /sessions/bulk`, `DELETE /sessions/:id`
- **Knowledge Graph (`/api/graph`)**:
  - `GET /` (Kit DAG nodes, edges, learning tracks, and live FSRS-6 retrievability health; alias `GET /health`), `GET /nodes/:id`, `POST /nodes/:id/session`, `POST /tracks/:id/session`
- **BotE Calculator (`/api/calculator`)**:
  - `POST /audit` — Structured AI math & bottleneck audit for capacity estimations.
- **Learner Profile & Telemetry (`/api/profile`, `/api/study_sessions`, `/api/system`)**:
  - `GET|PUT|DELETE /api/profile` (Shadow Memory profile), `GET /api/study_sessions` (daily review counts `{ date, count }` for the heatmap), `GET /api/system/stats`, `POST /api/system/clear-cache`, `GET /api/system/export-db` (admin-only raw SQLite snapshot).

---

## 10. Stateless Streamable HTTP MCP Server (`POST /api/mcp`)

External AI clients (Claude Desktop, Cursor, Claude Code, custom MCP hosts) connect directly to `POST /api/mcp` using a personal `tbk_` bearer token:

```json
{
  "mcpServers": {
    "toolbox": {
      "type": "http",
      "url": "https://toolbox.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer tbk_your_personal_token_here"
      }
    }
  }
}
```

### Transport & Security Guarantees
- **Stateless per request**: Every `POST /api/mcp` instantiates a fresh `McpServer` + `StreamableHTTPServerTransport({ sessionIdGenerator: undefined })` scoped to the token owner's `Scope`. `GET /api/mcp` and `DELETE /api/mcp` return `405 Method Not Allowed` (`Allow: POST`).
- **Origin & Rate Guards**: Browser `Origin` headers pass only when they match this server's own origin (`Host`, `PUBLIC_URL`) or the one exact origin in `CORS_ORIGIN`; non-browser CLI/desktop MCP clients omit `Origin` and pass cleanly. Requests are rate-limited (`120 req/min` per token user) and bounded by the global `10mb` JSON body limit and a 5,000-element limit on tool input (array items plus object keys).
- **Read-Only Token Enforcement**: Read-only `tbk_` tokens omit mutating tools from `tools/list` and block write calls at execution time. User-authored prose in tool outputs is wrapped in `<untrusted_data>` tags.

### MCP Tools (`7`)

| Tool | Access | Arguments | Description |
|------|--------|-----------|-------------|
| `list_kits` | Read | `{ status?: "ready"\|"compiling"\|"failed" }` | List caller's Kits with slugs, capabilities, node counts, and due counts. |
| `get_kit_path` | Read | `{ kit: string }` | Return a Kit's pillars, prerequisite DAG nodes, and live FSRS-6 retrievability health. |
| `search_kit` | Read | `{ query: string, kit?: string, kinds?: string[], limit?: 1–30 }` | Hybrid `FTS5` + `sqlite-vec` RRF search across one Kit or the caller's entire Library. |
| `get_due_cards` | Read | `{ kit?: string, limit?: number }` | Fetch due flashcards (prioritizing `remediation_queue` cards) across one or all Kits. |
| `create_flashcards` | Write (`add`) | `{ kit: string, deckId?: string, cards: [{ front, back, nodeId?, pillarId?, topicId?, sectionId?, prerequisiteCardId? }] }` | Create 1–50 flashcards inside a Kit deck (auto-creates deck if needed). |
| `review_card` | Write (`add`) | `{ cardId: string, rating?: 1\|2\|3\|4, quality?: 0–5, confidence?: "low"\|"medium"\|"high" }` | Record an FSRS-6 review, triggering FIRe upward credit or downward remediation. |
| `commit_guide_note` | Write (`change`, idempotent) | `{ kit: string, pillarId: string, topicId: string, sectionId: string, content: string, mode?: "append"\|"replace" }` | Append or replace Markdown notes in a Kit's Guide section and re-index Hybrid RAG. |

### MCP Resources (`4`) & Prompts (`2`)

- **Resources**:
  - `toolbox://library/overview` — JSON summary of all Kits and due counts in the caller's Library
  - `toolbox://kits/{slug}/skeleton` — Canonical `.toolbox-kit.json` skeleton for `{slug}`
  - `toolbox://kits/{slug}/guide` — Exported Markdown study guide notes for `{slug}`
  - `toolbox://kits/{slug}/due-cards` — Due FSRS-6 flashcards for `{slug}`
- **Prompts**:
  - `study_briefing({ kit })` — Summarizes weak/due nodes and proposes a focused study plan
  - `socratic_drill({ kit, topic })` — Runs an interactive, anti-sycophancy Socratic drill grounded in the Kit's notes
