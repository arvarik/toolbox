# ---- Build Stage ----
FROM node:24-trixie-slim AS builder

WORKDIR /app

# Install build dependencies for native modules if prebuilds miss
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build frontend
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:24-trixie-slim

WORKDIR /app

# Install production dependencies only (glibc required by sqlite-vec & onnxruntime-node)
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy server and shared TypeScript modules (Node 24 runs .ts natively)
COPY server/ ./server/
COPY shared/ ./shared/

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite, backups, uploads, models, and secret.key
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/toolbox.db

EXPOSE 3100

# Health check using Node built-in fetch (no curl/wget needed in trixie-slim)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.ts"]
