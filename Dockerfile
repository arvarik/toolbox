# ---- Build Stage ----
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build frontend
COPY . .
RUN npm run build

# ---- Production Stage ----
FROM node:22-alpine

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy server code
COPY server/ ./server/

# Copy shared constants for server use
COPY src/utils/constants.js ./src/utils/constants.js

# Copy built frontend
COPY --from=builder /app/dist ./dist

# Create data directory for SQLite
RUN mkdir -p /app/data

# Environment
ENV NODE_ENV=production
ENV PORT=3100
ENV DB_PATH=/app/data/toolbox.db

EXPOSE 3100

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3100/api/health || exit 1

CMD ["node", "server/index.js"]
