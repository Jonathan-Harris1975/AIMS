# ============================================================
# Base image
# ============================================================
FROM node:20-bookworm-slim AS base

ENV NODE_ENV=production

# ============================================================
# System dependencies (ffmpeg + audio stack)
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
# Dependencies (deterministic)
# ============================================================
# Copy only package files first for layer caching
COPY package.json package-lock.json ./

# npm ci requires package-lock.json (by design)
RUN npm ci --omit=dev && npm cache clean --force

# ============================================================
# Application source
# ============================================================
COPY . .

# ============================================================
# Safety: ensure no accidental env access crept in
# (fails build if process.env is used outside bootstrap)
# ============================================================
RUN grep -R "process\.env" -n --include="*.js" . \
    | grep -v "scripts/envBootstrap.js" \
    && (echo "❌ process.env usage outside envBootstrap.js" && exit 1) \
    || echo "✅ ENV-only rule enforced"

# ============================================================
# Runtime
# ============================================================
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server.js"]
