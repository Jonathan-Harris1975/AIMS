# ============================================================
# Base image
# ============================================================
FROM node:22-bookworm-slim AS runtime

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
COPY .npmrc package.json package-lock.json ./

RUN npm config set registry https://registry.npmjs.org/ \
 && npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

# ============================================================
# Application source
# ============================================================
COPY . .

# ============================================================
# Runtime
# ============================================================
EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
