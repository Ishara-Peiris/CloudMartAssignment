# ---- Stage 1: Install dependencies ----
FROM node:20-alpine AS builder

WORKDIR /build
COPY package*.json ./
RUN npm install --omit=dev

# ---- Stage 2: Runtime ----
FROM node:20-alpine

# Create non-root user
RUN addgroup -S appuser && adduser -S appuser -G appuser

WORKDIR /app

# Copy dependencies from builder
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./

# Copy application code
COPY src/ ./src/

# Switch to non-root user
USER appuser

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8002/health || exit 1

CMD ["node", "src/index.js"]
