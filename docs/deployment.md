# Toolbox v2 — Deployment Guide

Production self-hosting guide covering Docker Compose, multi-tenant security, reverse proxies, SearXNG web grounding, airgapped ONNX embeddings, and backups.

---

## Prerequisites

| Requirement | Minimum / Notes |
|-------------|-----------------|
| **Container Runtime** | Docker 24+ with Docker Compose v2 |
| **Bare-Metal Runtime** | Node.js ≥ 24 on a **glibc** OS (Debian 12/13, Ubuntu 22.04+, macOS) |
| **Memory & CPU** | **1 GB RAM** and **1.0 vCPU** (`sqlite-vec` + quantized ONNX embedding worker) |
| **Disk** | ~500 MB for container image + `${DATA_DIR}` for SQLite, backups, uploads, and ~90 MB ONNX model cache |

> **Why Debian `node:24-trixie-slim` instead of Alpine?** Native prebuilds for `better-sqlite3`, `sqlite-vec`, and `onnxruntime-node` require `glibc`. Running on `trixie-slim` avoids slow source compilation and musl runtime crashes.

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

---

## 2. Securing a Multi-Tenant Instance

By default (`AUTH_REQUIRED=false`), Toolbox starts in frictionless single-user mode under an implicit local owner (`local@toolbox.local`).

To run a shared or internet-facing instance:
1. Set `AUTH_REQUIRED=true` and `PUBLIC_URL=https://toolbox.example.com` in `.env` (or open **Settings → Instance Admin → Secure This Instance** in the UI to create the first admin account; creating any password account permanently enables auth).
2. Set an explicit 32-byte `TOOLBOX_SECRET_KEY` (`openssl rand -hex 32`) in `.env` **or** ensure `${DATA_DIR}/secret.key` is persisted on your volume. `secretBox` uses this key (`AES-256-GCM`) to encrypt provider API keys, user BYOK keys, OIDC client secrets, and SMTP passwords at rest.
3. **Passkeys (WebAuthn) & OIDC SSO**: Both derive the Relying Party ID and callback URLs from `PUBLIC_URL`. Set `PUBLIC_URL` to your exact external origin (no trailing path) and configure `TRUST_PROXY_HOPS=1` when behind Nginx/Caddy/Traefik.

---

## 3. Reverse Proxy Configuration

Streaming AI chat (`POST /api/chat/stream`) and Kit compilation (`POST /api/compiler/compile`) use **Server-Sent Events (SSE)**. Disable response buffering on your proxy.

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

Toolbox runs `Xenova/all-MiniLM-L6-v2` (quantized ONNX, 384 dimensions) locally inside a persistent worker thread. Weights are pinned by HuggingFace commit revision and verified by SHA-256 (`scripts/fetch-models.ts`).

To pre-populate weights for an airgapped environment:

```bash
# Pre-fetch and verify SHA-256 digests into ./data/models on a connected host
node scripts/fetch-models.ts ./data/models

# Or inside a running container before disconnecting egress
docker exec toolbox node scripts/fetch-models.ts /app/data/models

# Verify cached model integrity at any time
docker exec toolbox node scripts/fetch-models.ts --check /app/data/models
```

Then set `TRANSFORMERS_OFFLINE=1` in `.env` so the worker never attempts runtime HuggingFace downloads.

---

## 6. Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | HTTP listen port |
| `HOST` | `0.0.0.0` | Bind address |
| `NODE_ENV` | `production` | Serves built `dist/` SPA when `production` |
| `DATA_DIR` | `./data` | Root directory for DB, `secret.key`, `backups/`, `models/`, and uploads |
| `DB_PATH` | `${DATA_DIR}/toolbox.db` | SQLite database file path |
| `TOOLBOX_SECRET_KEY` | auto (`${DATA_DIR}/secret.key`) | 32-byte hex or base64 key for `AES-256-GCM` encryption at rest |
| `AUTH_REQUIRED` | `false` | Require login before any password account exists |
| `PUBLIC_URL` | — | Canonical `http(s)://host` origin for Passkeys, OIDC, and email links |
| `TRUST_PROXY_HOPS` | `0` | Trusted reverse-proxy hop count (`0`–`10`) |
| `ALLOWED_HOSTS` | — | Optional comma-separated hostnames or `.domain` suffixes (`hostGuard`) |
| `CORS_ORIGIN` | — | Optional trusted browser origin allowed to call `POST /api/mcp` |
| `GEMINI_API_KEY` | — | Instance Gemini API key |
| `OPENAI_API_KEY` | — | Instance OpenAI API key |
| `CLAUDE_API_KEY` | — | Instance Anthropic Claude API key |
| `SEARXNG_URL` | — | SearXNG base URL for grounded web search |
| `MODELS_DIR` | `${DATA_DIR}/models` | Directory for local ONNX embedding models |
| `TRANSFORMERS_OFFLINE` | — | Set `1` to forbid runtime HuggingFace network fetches |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | — | Optional OIDC SSO credentials (`OIDC_NAME`, `OIDC_MATCH_BY_EMAIL`) |
| `SMTP_URL` / `MAIL_FROM` / `MAIL_REPLY_TO` | — | Optional SMTP transport for invites, magic links, and resets |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` | `24` / `14` | Automated online SQLite snapshot cadence and retention count |

---

## 7. Data Persistence, Backups & Upgrading

All persistent state lives inside `${DATA_DIR}` (`/app/data` in Docker):
- `toolbox.db` (plus `-wal` / `-shm` journals while running)
- `secret.key` (critical if `TOOLBOX_SECRET_KEY` is not set in `.env` — back this up alongside `toolbox.db` so encrypted keys remain decryptable!)
- `backups/` (online SQLite snapshots created automatically or via **Settings → Instance Admin → Backups**)
- `sources/` (uploaded PDFs/files attached to Kits)
- `models/` (cached ONNX weights)

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
