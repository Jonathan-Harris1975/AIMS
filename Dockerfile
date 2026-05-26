# ============================================================
# AI Management Suite - Koyeb production image
# ============================================================
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    TZ=UTC \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_PROGRESS=false \
    NPM_CONFIG_FETCH_RETRIES=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=60000 \
    NPM_CONFIG_FETCH_TIMEOUT=60000

# ============================================================
# System dependencies (ffmpeg + runtime essentials)
# ============================================================
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
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
# Dependencies (deterministic production install)
# ============================================================
COPY .npmrc package.json package-lock.json ./

RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm cache clean --force

# ============================================================
# Application source
# ============================================================
COPY . .

# ============================================================
# Runtime
# ============================================================
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT:-3000}/health" || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
