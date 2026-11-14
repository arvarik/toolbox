# Toolbox v2 — Deployment Guide

Production self-hosting guide covering Docker Compose, multi-tenant security, reverse proxies, SearXNG web grounding, airgapped ONNX embeddings, and backups.

---

## Prerequisites

| Requirement | Minimum / Notes |
|-------------|-----------------|
| **Container Runtime** | Docker 24+ with Docker Compose v2 |
| **Bare-Metal Runtime** | Node.js ≥ 26 on Linux with **glibc** (Debian 12/13, Ubuntu 22.04+) or macOS |
| **Memory & CPU** | **1 GB RAM** and **1.0 vCPU** (`sqlite-vec` + quantized ONNX embedding worker) |
| **Disk** | ~500 MB for container image + `${DATA_DIR}` for SQLite, backups, uploads, and ~90 MB ONNX model cache |

> **Why Debian `node:26-trixie-slim` instead of Alpine?** Native prebuilds for `better-sqlite3`, `sqlite-vec`, and `onnxruntime-node` require `glibc`. Running on `trixie-slim` avoids slow source compilation and musl runtime crashes.

---

## 1. Docker Compose (Recommended)

```bash
git clone https://github.com/arvarik/toolbox.git
cd toolbox
cp .env.example .env
# Edit .env (set API keys, PUBLIC_URL, or AUTH_REQUIRED as needed)
docker compose up -d
```

Verify container health:

```bash
docker compose ps
docker compose logs -f toolbox
```

Both `Dockerfile` and `docker-compose.yml` run a zero-dependency Node `fetch` healthcheck against `http://127.0.0.1:3100/api/health` (no `curl` or `wget` binary required in `trixie-slim`, and `127.0.0.1` avoids IPv6 loopback quirks in LXC).

Docker Compose passes every variable in `.env` into the container, so variables from [section 6](#6-environment-variables-reference), such as `OIDC_ISSUER` or `TRANSFORMERS_OFFLINE`, work there too. The values under `environment:` in `docker-compose.yml` take precedence.

The `latest` image tag follows the `main` branch. Each release tag `vX.Y.Z` also publishes the image as `X.Y.Z`.

### Run without Docker

```bash
git clone https://github.com/arvarik/toolbox.git
cd toolbox
cp .env.example .env   # npm start reads .env
npm ci
npm run build
npm start              # http://127.0.0.1:3100
```

`HOST` defaults to `127.0.0.1`, so only this machine can connect. To accept other machines, set `HOST=0.0.0.0` and `AUTH_REQUIRED=true`, or put a reverse proxy in front.

---

## 2. Securing a Multi-Tenant Instance

By default (`AUTH_REQUIRED=false`), Toolbox starts in frictionless single-user mode under an implicit local owner (`local@toolbox.local`).

To run a shared or internet-facing instance:
1. Set `AUTH_REQUIRED=true` and `PUBLIC_URL=https://toolbox.example.com` in `.env` (or open **Settings → Instance Admin → Secure This Instance** in the UI to create the first admin account; creating any password account permanently enables auth).
2. Set an explicit `TOOLBOX_SECRET_KEY` of 64 hex characters (`openssl rand -hex 32`; other formats stop the server at startup) in `.env` **or** ensure `${DATA_DIR}/secret.key` is persisted on your volume. `secretBox` uses this key (`AES-256-GCM`) to encrypt provider API keys, user BYOK keys, OIDC client secrets, and SMTP passwords at rest.
3. **Passkeys (WebAuthn) & OIDC SSO**: Both derive the Relying Party ID and callback URLs from `PUBLIC_URL`. Set `PUBLIC_URL` to your exact external origin (no trailing path) and configure `TRUST_PROXY_HOPS=1` when behind Nginx/Caddy/Traefik.

### Recover a Locked-Out Account

The command prints a temporary password, signs the account out everywhere, and requires a new password at the next sign-in:

```bash
# Docker (the image has no npm)
docker exec -it toolbox node scripts/reset-password.ts <username-or-email>

# Source install
npm run reset-password -- <username-or-email>
```

---

## 3. Reverse Proxy Configuration

Streaming AI chat (`POST /api/chat/stream`) uses **Server-Sent Events (SSE)**, and Kit compilation (`POST /api/compiler/compile`) can run for minutes. Disable response buffering and allow long reads on your proxy.

### Nginx

```nginx
server {
    listen 443 ssl http2;
    server_name toolbox.example.com;

    ssl_certificate     /etc/letsencrypt/live/toolbox.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/toolbox.example.com/privkey.pem;
    client_max_body_size 110M; # Allows up to 100 MB .toolbox-backup.zip imports

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE streaming & MCP HTTP responses
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

Set `TRUST_PROXY_HOPS=1` and `PUBLIC_URL=https://toolbox.example.com` in `.env`.

### Caddy

```caddy
toolbox.example.com {
    request_body {
        max_size 110MB
    }
    reverse_proxy 127.0.0.1:3100 {
        flush_interval -1
    }
}
```

---

## 4. Grounded Web Research with SearXNG

To enable live web citations in AI Chat and Stage 3 of the Deep Research Kit Compiler:
1. Run a self-hosted [SearXNG](https://docs.searxng.org/) container on the same Docker network.
2. Enable the `json` output format in SearXNG's `settings.yml`:
   ```yaml
   search:
     formats:
       - html
       - json
   ```
3. Set `SEARXNG_URL=http://searxng:8080` in `.env` (or configure and test it in **Settings → Instance Admin → AI & Embeddings**).

---

## 5. Airgapped / Offline Local Embeddings

Toolbox runs `Xenova/all-MiniLM-L6-v2` (quantized ONNX, 384 dimensions) locally inside a persistent worker thread. Weights are pinned by HuggingFace commit revision. `scripts/fetch-models.ts` records each file's SHA-256 on first download and verifies it on later runs.

To pre-populate weights for an airgapped environment:

```bash
# Pre-fetch and verify SHA-256 digests into ./data/models on a connected host
node scripts/fetch-models.ts ./data/models

# Or inside a running container before disconnecting egress
docker exec toolbox node scripts/fetch-models.ts /app/data/models

# Verify cached model integrity at any time
docker exec toolbox node scripts/fetch-models.ts --check /app/data/models
```

Then set `TRANSFORMERS_OFFLINE=1` so the worker never attempts runtime HuggingFace downloads (in `.env`, which both a source install and Docker Compose read).

---

## 6. Environment Variables Reference

A source install reads these from `.env` (see [`.env.example`](../.env.example)). Docker Compose also passes `.env` to the container, and the values under `environment:` in `docker-compose.yml` take precedence.

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | HTTP listen port |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the Docker image) | Bind address |
| `NODE_ENV` | — (`npm start` and the Docker image set `production`) | Serves built `dist/` SPA when `production` |
| `DATA_DIR` | `./data` | Root directory for DB, `secret.key`, `backups/`, `models/`, and `uploads/` |
| `DB_PATH` | `${DATA_DIR}/toolbox.db` | SQLite database file path |
| `TOOLBOX_SECRET_KEY` | auto (`${DATA_DIR}/secret.key`) | 64 hex characters (32 bytes) for `AES-256-GCM` encryption at rest |
| `AUTH_REQUIRED` | `false` | Require login before any password account exists |
| `PUBLIC_URL` | — | Canonical `http(s)://host` origin for Passkeys, OIDC, and email links |
| `TRUST_PROXY_HOPS` | `0` | Trusted reverse-proxy hop count (`0`–`10`) |
| `ALLOWED_HOSTS` | — | Optional comma-separated hostnames or `.domain` suffixes (`hostGuard`) |
| `CORS_ORIGIN` | — | Optional trusted browser origin allowed to call `POST /api/mcp` |
| `GEMINI_API_KEY` | — | Instance Gemini API key |
| `OPENAI_API_KEY` | — | Instance OpenAI API key |
| `CLAUDE_API_KEY` | — | Instance Anthropic Claude API key |
| `ALLOW_PRIVATE_BYOK_ENDPOINTS` | `false` | Set `true` to let every user, not only admins, add OpenAI-compatible endpoints on private network addresses (for example a LAN Ollama server). This turns off an SSRF guard, so use it only when you trust every account. Toolbox checks the target on every call, so removing the variable also blocks private endpoints that users saved earlier |
| `SEARXNG_URL` | — | SearXNG base URL for grounded web search |
| `MODELS_DIR` | `${DATA_DIR}/models` | Directory for local ONNX embedding models |
| `TRANSFORMERS_OFFLINE` | — | Set `1` to forbid runtime HuggingFace network fetches |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | Optional OIDC SSO credentials (`OIDC_NAME`, `OIDC_MATCH_BY_EMAIL`) |
| `OIDC_ALLOW_PRIVATE` | `false` | Set `true` to allow OIDC discovery and token/userinfo fetches to private or loopback network addresses (for example a self-hosted LAN Authentik or Keycloak IdP); blocked by default to prevent SSRF |
| `SMTP_URL` / `MAIL_FROM` / `MAIL_REPLY_TO` | — | Optional SMTP transport for invitations. Password-reset, sign-in, and email-change emails link to pages the web app does not have yet |
| `BACKUP_KEEP` | `7` | Number of SQLite backups to keep (`1`–`50`); older ones are deleted after each new backup |
| `BACKUP_INTERVAL_HOURS` | `24` | Hours between automatic SQLite backups (`0`–`168`, `0` turns them off). When unset, the admin setting applies. See [section 7](#7-data-persistence-backups--upgrading) |

---

## 7. Data Persistence, Backups & Upgrading

All persistent state lives inside `${DATA_DIR}` (`/app/data` in Docker):
- `toolbox.db` (plus `-wal` / `-shm` journals while running)
- `secret.key` (critical if `TOOLBOX_SECRET_KEY` is not set in `.env` — back this up alongside `toolbox.db` so encrypted keys remain decryptable!)
- `backups/` (verified online SQLite backups created with **Create Verified Backup** in **Settings → Instance Admin**, or `POST /api/admin/backups`)
- `uploads/` (uploaded PDFs/files attached to Kits)
- `models/` (cached ONNX weights)

Toolbox takes an automatic backup when the newest snapshot in `backups/` is older than `BACKUP_INTERVAL_HOURS` (default 24). It checks 15 minutes after start and then every 15 minutes, so a restart neither skips nor repeats a backup. Each backup is verified, and snapshots beyond `BACKUP_KEEP` are deleted, oldest first. A failed backup is logged and retried at the next check.

To restore a snapshot:
1. Stop Toolbox.
2. Copy the snapshot over `${DATA_DIR}/toolbox.db`.
3. Delete `toolbox.db-wal` and `toolbox.db-shm` if they exist. A stale WAL file corrupts the restored database.
4. Start Toolbox.

### Per-Kit Portable Backups
Individual users can export any Kit from the Library without admin access:
- **Export Kit (`.toolbox-kit.json`)**: Clean, shareable curriculum skeleton with zero personal state.
- **Export Full Backup (`.toolbox-backup.zip`)**: Complete portable archive of the Kit skeleton, flashcards + FSRS-6 state, committed Guide notes, drills, boards, chat sessions, and uploaded source files.

### Upgrading from v1 or Earlier v2 Releases

```bash
docker compose pull
docker compose up -d
```

Startup migrations in `server/db.ts` (`initPlatformSchema` + `initKitsSchema`) automatically upgrade v1 SQLite databases in place — preserving existing decks, SM-2 progress (lazily bootstrapped into FSRS-6), Guide notes, boards, and Shadow Memory inside the local owner's System Design Kit.

---

## 8. Proxmox LXC Notes

- Use a Debian 12/13 LXC template with **Nesting** enabled (`nesting=1`), **1–2 vCPUs**, **1 GB+ RAM**, and **8 GB+ disk**.
- Healthchecks use `127.0.0.1` via Node's built-in `fetch`, avoiding Alpine/LXC IPv6 `localhost` resolution failures.
