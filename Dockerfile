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

# Runtime essentials. Every network/package step has both a soft TERM timeout and
# a hard KILL deadline. GNU timeout without --kill-after can otherwise leave a
# wedged child process alive indefinitely, which presents in Koyeb as a Deployment
# stuck in Provisioning.
RUN echo "[build] apt index" \
 && timeout --signal=TERM --kill-after=20s 300s apt-get \
    -o Acquire::Retries=3 \
    -o Acquire::http::Timeout=30 \
    -o Acquire::https::Timeout=30 update \
 && echo "[build] apt runtime packages" \
 && DEBIAN_FRONTEND=noninteractive timeout --signal=TERM --kill-after=20s 600s apt-get \
    -o Dpkg::Use-Pty=0 \
    install -y --no-install-recommends \
    ca-certificates \
    curl \
    dumb-init \
    ffmpeg \
    chromium \
 && rm -rf /var/lib/apt/lists/*

# Install production dependencies before copying the app for better build caching.
# Do not wipe the builder environment for this network step: hosted builders may
# supply networking/CA variables. Application install scripts are disabled, so
# runtime AIMS variables cannot execute code during npm ci.
COPY .npmrc package.json package-lock.json ./
RUN echo "[build] npm production dependencies" \
 && timeout --signal=TERM --kill-after=20s 600s npm ci \
    --omit=dev \
    --ignore-scripts \
    --no-audit \
    --no-fund \
 && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p /app/local-data && chown -R node:node /app/local-data

# Keep build validation deterministic. Koyeb can expose runtime env vars during
# image construction; do not allow Blotato/R2/API runtime settings to affect the
# Docker build stage. Runtime env is validated explicitly with npm run env:doctor.
RUN echo "[build] AIMS source validation" \
 && env -i \
    PATH="$PATH" \
    HOME=/root \
    NODE_ENV=production \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    timeout --signal=TERM --kill-after=10s 120s npm run build

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=45s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT:-3000}/livez || exit 1

USER node

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
