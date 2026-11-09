# ---- Build Stage ----
FROM node:24-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build frontend
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:24-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server and shared TypeScript modules (Node 24 runs .ts natively)
COPY server/ ./server/
COPY shared/ ./shared/

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite, backups, and secret.key
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3100
ENV DATA_DIR=/app/data
ENV DB_PATH=/app/data/toolbox.db

EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3100/api/health || exit 1

CMD ["node", "server/index.ts"]
