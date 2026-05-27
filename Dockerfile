# ============================================================
# AI Management Suite — Koyeb production image
# ============================================================
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    TZ=UTC \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=30000 \
    NPM_CONFIG_FETCH_TIMEOUT=60000 \
    RSS_INIT_ON_BOOT=false

WORKDIR /app

# Runtime essentials. Keep network operations bounded so remote builders fail fast
# instead of sitting in Koyeb's build phase with no useful signal.
RUN timeout 300s apt-get -o Acquire::Retries=3 \
    -o Acquire::http::Timeout=30 \
    -o Acquire::https::Timeout=30 update \
 && timeout 420s apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    ffmpeg \
 && rm -rf /var/lib/apt/lists/*

# Install production dependencies before copying the app for better build caching.
COPY .npmrc package.json package-lock.json ./
RUN env -i \
    PATH="$PATH" \
    HOME=/root \
    NODE_ENV=production \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=30000 \
    NPM_CONFIG_FETCH_TIMEOUT=60000 \
    sh -c 'timeout 600s npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force'

COPY . .

# Keep build validation deterministic. Koyeb can expose runtime env vars during
# image construction; do not allow Blotato/R2/API runtime settings to affect the
# Docker build stage. Runtime env is validated explicitly with npm run env:doctor.
RUN env -i \
    PATH="$PATH" \
    HOME=/root \
    NODE_ENV=production \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    npm run build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/health || exit 1

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
