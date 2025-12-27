# ============================================================
# Base image
# ============================================================
FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV TZ=UTC

# ============================================================
# System dependencies (ffmpeg + runtime essentials)
# ============================================================
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    dumb-init \
 && rm -rf /var/lib/apt/lists/*

# ============================================================
# App directory
# ============================================================
WORKDIR /app

# ============================================================
# Dependencies (deterministic, production only)
# ============================================================
COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
 && npm cache clean --force

# ============================================================
# Application source
# ============================================================
COPY . .

# ============================================================
# Repo hygiene enforcement
# - ENV access ONLY via envBootstrap
# - Fails build if violated
# ============================================================
RUN grep -R "process\.env" -n --include="*.js" . \
    | grep -v "scripts/envBootstrap.js" \
    && (echo "❌ process.env usage outside envBootstrap.js" && exit 1) \
    || echo "✅ ENV-only rule enforced"

# ============================================================
# Runtime
# ============================================================
EXPOSE 3000

# dumb-init ensures proper signal handling (SIGTERM, SIGINT)
ENTRYPOINT ["dumb-init", "--"]

# 🚀 IMPORTANT:
# Bootstrap is the canonical entrypoint.
# It runs envBootstrap, RSS init, checks, then launches server.js
CMD ["node", "scripts/bootstrap.js"]
