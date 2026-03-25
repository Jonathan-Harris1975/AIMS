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
# Runtime
# ============================================================
EXPOSE 3000

# dumb-init ensures proper signal handling (SIGTERM, SIGINT)
ENTRYPOINT ["dumb-init", "--"]

# Bootstrap initializes supporting services and launches server.js
CMD ["node", "scripts/bootstrap.js"]
