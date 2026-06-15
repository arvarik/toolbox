# Toolbox — Deployment Guide

This guide covers all deployment options for Toolbox, from local development to production self-hosting.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Local Development](#local-development)
3. [Docker Compose (Recommended)](#docker-compose-recommended)
4. [Docker Manual Build](#docker-manual-build)
5. [Proxmox LXC Deployment](#proxmox-lxc-deployment)
6. [Reverse Proxy Setup (Nginx/Caddy)](#reverse-proxy-setup)
7. [Environment Variables Reference](#environment-variables-reference)
8. [Data Persistence & Backups](#data-persistence--backups)
9. [Upgrading](#upgrading)
10. [Health Checks](#health-checks)
11. [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| Docker 20+ | For containerized deployment |
| Node.js 18+ | For local development only |
| Gemini API Key | Get free at [Google AI Studio](https://aistudio.google.com/apikey) |
| 512MB RAM | Minimum. The Docker Compose sets a 512MB limit. |

---

## Local Development

```bash
# 1. Clone the repository
git clone https://github.com/arvarik/toolbox.git
cd toolbox

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env and optionally add your GEMINI_API_KEY

# 4. Start the development server
npm run dev
```

This starts:
- **Frontend**: Vite dev server at `http://localhost:5173` (with HMR)
- **Backend**: Express API at `http://localhost:3100`

The frontend proxies API requests to the backend automatically.

> **API Key via UI**: You can skip the `.env` step and set your API key through the Settings page after the app launches.

---

## Docker Compose (Recommended)

This is the recommended production deployment method.

### 1. Prepare Your Environment

```bash
git clone https://github.com/arvarik/toolbox.git
cd toolbox

cp .env.example .env
```

Edit `.env` and set your API key:

```env
GEMINI_API_KEY=AIza...your-key-here
PORT=3100
DB_PATH=./data/toolbox.db
```

### 2. Start the Application

```bash
docker compose up -d
```

The app will be available at `http://your-server:3100`.

### 3. Verify It's Running

```bash
docker compose ps
docker compose logs -f toolbox
```

### docker-compose.yml Overview

The included `docker-compose.yml` is pre-configured with:
- **Named volume** (`toolbox-data`) for database persistence
- **Health check** using `curl http://127.0.0.1:3100/api/health` (uses `127.0.0.1` not `localhost` to avoid IPv6 issues in LXC/Alpine containers)
- **CPU limit**: `0.5` cores
- **Memory limit**: `512M`
- **Watchtower label**: `com.centurylinklabs.watchtower.enable=true` for auto-updates

---

## Docker Manual Build

For environments where Docker Compose isn't available:

```bash
# Build the image
docker build -t toolbox .

# Run the container
docker run -d \
  --name toolbox \
  -p 3100:3100 \
  -v toolbox-data:/app/data \
  -e GEMINI_API_KEY=your-key-here \
  toolbox
```

The `Dockerfile` uses a **multi-stage build**:
1. **Build stage**: Installs all dependencies and runs `vite build`
2. **Production stage**: Copies only the built assets and production dependencies, resulting in a lean image

---

## Proxmox LXC Deployment

Toolbox is optimized for Proxmox LXC containers.

### Container Setup

1. Create a new LXC container (Debian 12 or Ubuntu 22.04)
2. Enable **nesting** in container options (required for Docker)
3. Recommended specs:
   - CPU: 1-2 cores
   - RAM: 512MB (1GB recommended)
   - Storage: 4GB

### Install Docker in LXC

```bash
# Inside the LXC container
apt update && apt install -y curl
curl -fsSL https://get.docker.com | sh
systemctl enable docker
```

### Deploy Toolbox

```bash
git clone https://github.com/arvarik/toolbox.git
cd toolbox
cp .env.example .env
# Edit .env
docker compose up -d
```

### Known LXC Quirks

> **IPv6 Loopback Workaround**: The health check in `docker-compose.yml` uses `127.0.0.1` instead of `localhost`. This prevents Docker health checks from failing due to IPv6 DNS resolution issues common in Alpine-based containers inside LXC.

> **Kernel Restrictions**: Some older Proxmox kernels may prevent certain Docker networking features. If you encounter issues, try adding `keyctl=1` and `nesting=1` to the container's LXC config file.

---

## Reverse Proxy Setup

### Nginx

```nginx
server {
    listen 80;
    server_name toolbox.yourdomain.com;
    
    # Redirect to HTTPS
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name toolbox.yourdomain.com;
    
    ssl_certificate /etc/letsencrypt/live/toolbox.yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/toolbox.yourdomain.com/privkey.pem;
    
    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
        
        # Required for Server-Sent Events (AI streaming)
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 300s;
    }
}
```

> **Important**: The `proxy_buffering off` setting is required for the streaming AI responses to work correctly.

### Caddy

```caddy
toolbox.yourdomain.com {
    reverse_proxy localhost:3100 {
        flush_interval -1
    }
}
```

Caddy handles HTTPS automatically via Let's Encrypt.

---

## Environment Variables Reference

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3100` | TCP port the server listens on |
| `DB_PATH` | `./data/toolbox.db` | Absolute or relative path for the SQLite database file |
| `GEMINI_API_KEY` | — | Google Gemini API key (can also be set via the Settings UI) |
| `NODE_ENV` | `production` | Set to `development` for verbose logging |

---

## Data Persistence & Backups

All user data is stored in a single SQLite file at `DB_PATH` (default: `./data/toolbox.db`).

### What's Stored

- Flashcard decks and cards (with SRS state)
- Whiteboard boards and their data
- Guide section content (committed notes)
- User profile / AI shadow memory
- Cached AI starter prompts
- API key and configuration

### Backup

```bash
# Simple file backup
cp ./data/toolbox.db ./backups/toolbox-$(date +%Y%m%d).db

# Or export via the UI: Settings → Export All Data
```

### Restore

```bash
# Stop the container
docker compose down

# Replace the database file
cp backup.db ./data/toolbox.db

# Restart
docker compose up -d
```

Or use the **Import Data** button in the Settings UI to restore from a JSON export.

---

## Upgrading

### Docker Compose

```bash
# Pull the latest image
docker compose pull

# Restart with the new image
docker compose up -d
```

Database migrations run automatically on startup — no manual migration steps needed.

### With Watchtower

If you have [Watchtower](https://containrrr.dev/watchtower/) running, Toolbox is pre-labeled for automatic updates:

```yaml
labels:
  - "com.centurylinklabs.watchtower.enable=true"
```

Watchtower will automatically pull and restart when a new image is published.

---

## Health Checks

The server exposes a health endpoint:

```
GET /api/health
```

Response:
```json
{ "status": "ok" }
```

The Docker health check runs every 30 seconds with a 10-second timeout. A container is considered unhealthy after 3 consecutive failures.

---

## Troubleshooting

### Container Won't Start

```bash
# Check logs
docker compose logs toolbox

# Common cause: DB_PATH directory doesn't exist
mkdir -p data
```

### AI Features Not Working

1. Check the API key is set: **Settings → Gemini API Key** should show "Connected"
2. Verify the key is valid by clicking "Save & Verify"
3. Check the server logs for Gemini API errors:
   ```bash
   docker compose logs toolbox | grep -i gemini
   ```

### Streaming Responses Cut Off

This is usually a reverse proxy timeout issue. Ensure your proxy config has:
- `proxy_buffering off` (Nginx)
- `proxy_read_timeout 300s` (Nginx)
- `flush_interval -1` (Caddy)

### Database Locked Error

If multiple instances are running against the same database file, SQLite will throw a "database locked" error. Ensure only one container accesses the database at a time.

### Permission Denied on DB File

```bash
# Fix permissions on the data directory
chown -R 1000:1000 ./data
```
