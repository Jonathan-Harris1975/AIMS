# Headroom compression-only companion service for AIMS.
# Default to the current published stable release. Override the build arg only
# after validating a newer Headroom release against AIMS's compression contract.
ARG HEADROOM_VERSION=0.37.0
FROM ghcr.io/headroomlabs-ai/headroom:${HEADROOM_VERSION}

ENV HEADROOM_HOST=0.0.0.0 \
    HEADROOM_PORT=8787 \
    HEADROOM_COMPRESS_ALLOW_REMOTE=1 \
    HEADROOM_SAVINGS_PROFILE=balanced \
    HEADROOM_MODE=token \
    HEADROOM_TARGET_RATIO=0.30 \
    HEADROOM_COMPRESS_USER_MESSAGES=true \
    HEADROOM_COMPRESS_SYSTEM_MESSAGES=false \
    HEADROOM_PROTECT_RECENT=0 \
    HEADROOM_MIN_TOKENS=250 \
    HEADROOM_KOMPRESS_BACKEND=auto \
    HEADROOM_TELEMETRY=on \
    HEADROOM_STATELESS=true

EXPOSE 8787
