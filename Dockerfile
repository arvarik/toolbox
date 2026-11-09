# ---- Build Stage ----
FROM node:24-trixie-slim AS builder

WORKDIR /app

# --ignore-scripts skips synthesized node-gyp rebuild (better-sqlite3 13+, sqlite-vec,
# and onnxruntime-node ship prebuilt Linux x64/arm64 binaries inside their tarballs)
COPY package*.json ./
RUN npm ci --ignore-scripts && rm -rf /root/.npm

# Copy source and build frontend
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:24-trixie-slim

WORKDIR /app

# Install production dependencies only (glibc required by sqlite-vec & onnxruntime-node)
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && test -f "node_modules/better-sqlite3/prebuilds/linux-$(node -p process.arch).node" \
    && rm -rf /root/.npm

# Copy server, shared, and operator scripts (Node 24 runs .ts natively)
COPY server/ ./server/
COPY shared/ ./shared/
COPY scripts/ ./scripts/

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Create private data directory owned by non-root `node` user
RUN mkdir -p /app/data && chmod 700 /app/data && chown -R node:node /app/data

# Environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/toolbox.db

# Drop root privileges for runtime process
USER node

EXPOSE 3100

# Health check using Node built-in fetch (no curl/wget needed in trixie-slim)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.ts"]
