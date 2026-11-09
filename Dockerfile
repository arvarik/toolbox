# ---- Build Stage ----
# Both stages pin the base image by digest. Dependabot (docker ecosystem) bumps
# the digest when the 26-trixie-slim tag moves.
FROM node:26-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS builder

WORKDIR /app

# --ignore-scripts skips synthesized node-gyp rebuild (better-sqlite3 13+, sqlite-vec,
# and onnxruntime-node ship prebuilt Linux x64/arm64 binaries inside their tarballs)
COPY package*.json ./
RUN npm ci --ignore-scripts && rm -rf /root/.npm

# Copy source and build frontend
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:26-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072

# Debian security fix that the pinned base image does not ship yet: zlib1g
# 1:1.3.dfsg+really1.3.1-1+deb13u1 (CVE-2026-76844, CVE-2026-85091, CVE-2026-27171).
# ponytail: one named package; delete this layer once the base digest ships deb13u1.
RUN apt-get update \
    && apt-get install -y --no-install-recommends --only-upgrade zlib1g \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install server runtime dependencies only and prune unused multi-OS/browser payloads
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && ort=node_modules/onnxruntime-node/bin/napi-v6 \
    && keep="linux/$(node -p process.arch)" \
    && test -f "$ort/$keep/onnxruntime_binding.node" \
    && find "$ort" -mindepth 2 -maxdepth 2 -type d ! -path "$ort/$keep" -exec rm -rf {} + \
    && find "$ort" -mindepth 1 -maxdepth 1 -type d -empty -delete \
    && bsq=node_modules/better-sqlite3/prebuilds \
    && bsq_keep="linux-$(node -p process.arch).node" \
    && test -f "$bsq/$bsq_keep" \
    && find "$bsq" -maxdepth 1 -type f ! -name "$bsq_keep" -delete \
    && rm -rf /root/.npm package-lock.json \
         node_modules/onnxruntime-web \
         node_modules/better-sqlite3/deps \
         node_modules/better-sqlite3/src \
         node_modules/zod/src \
         node_modules/@huggingface/transformers/src \
         node_modules/@huggingface/transformers/types \
         node_modules/cheerio/node_modules/undici \
         node_modules/parse5* \
    && find node_modules/@huggingface/transformers/dist -type f ! -name 'transformers.node.mjs' -delete \
    && find node_modules -type f \( -name '*.d.ts' -o -name '*.d.mts' -o -name '*.d.cts' -o -name '*.map' -o -name '*.md' \) ! -iname '*licen[cs]e*' ! -iname '*notice*' ! -path '*/sharp-libvips-*/README.md' -delete

# Copy server, shared, and operator CLI scripts (Node 26 runs .ts natively)
COPY server/ ./server/
COPY shared/ ./shared/
COPY scripts/reset-password.ts scripts/fetch-models.ts ./scripts/

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Environment
ENV NODE_ENV=production \
    NODE_COMPILE_CACHE=/app/.compile-cache \
    HOST=0.0.0.0 \
    PORT=3100 \
    DATA_DIR=/app/data \
    DB_PATH=/app/data/toolbox.db

# Verify the trimmed production module graph loads cleanly and warm NODE_COMPILE_CACHE
RUN mkdir -p /tmp/smoke-data /app/.compile-cache \
    && DATA_DIR=/tmp/smoke-data DB_PATH=/tmp/smoke-data/toolbox.db DISABLE_BACKGROUND_JOBS=true \
       node --input-type=module -e 'await import("./server/app.ts"); await import("unpdf"); await import("@huggingface/transformers"); process.exit(0)' \
    && rm -rf /tmp/smoke-data \
    && mkdir -p /app/data && chmod 700 /app/data \
    && chown -R node:node /app/data /app/.compile-cache \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx

# Drop root privileges for runtime process
USER node

EXPOSE 3100

# Health check using Node built-in fetch (no curl/wget needed in trixie-slim)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:3100/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.ts"]
