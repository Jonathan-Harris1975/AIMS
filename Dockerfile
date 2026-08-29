# ============================================================
# AI Management Suite — Koyeb production image
# ============================================================
FROM node:22-alpine3.22 AS runtime

ENV NODE_ENV=production \
    TZ=UTC \
    NPM_CONFIG_REGISTRY=https://registry.npmjs.org/ \
    NPM_CONFIG_AUDIT=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_FETCH_RETRIES=2 \
    NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=10000 \
    NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=30000 \
    NPM_CONFIG_FETCH_TIMEOUT=60000 \
    RSS_INIT_ON_BOOT=false \
    CHROMIUM_PATH=/usr/bin/chromium \
    PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Koyeb's overlay-backed builder can reject dpkg's package replacement links with
# EXDEV ("Invalid cross-device link"). Use Alpine's apk runtime instead of Debian
# apt/dpkg so Chromium/FFmpeg installation does not exercise that failure path.
# Install GNU timeout first; the larger runtime package step and all later network
# steps retain both a soft TERM timeout and a hard KILL deadline.
RUN echo "[build] timeout utility" \
 && apk add --no-cache coreutils

RUN echo "[build] runtime packages" \
 && timeout --signal=TERM --kill-after=20s 600s apk add --no-cache \
    ca-certificates \
    curl \
    dumb-init \
    ffmpeg \
    chromium \
 && command -v chromium >/dev/null \
 && command -v ffmpeg >/dev/null \
 && command -v ffprobe >/dev/null \
 && command -v dumb-init >/dev/null

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
