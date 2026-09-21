# Headroom compression-only companion service for AIMS.
#
# The upstream 0.37.0 release publishes a python-slim image as its default
# runtime, but its own Dockerfile also defines a distroless Python runtime.
# Keep the validated Headroom release pinned to the digest observed by CI and
# copy only its runtime artefacts into a minimal distroless image. This avoids
# carrying apt/dpkg, perl, util-linux, ncurses and other packages that are not
# required by the AIMS compression sidecar.
ARG HEADROOM_VERSION=0.37.0
ARG HEADROOM_DIGEST=sha256:4e559273659ebc5ce8711a60278e288550fa596377af18a7058e10036d63ef0b

FROM ghcr.io/headroomlabs-ai/headroom:${HEADROOM_VERSION}@${HEADROOM_DIGEST} AS headroom-runtime

USER root

# Trivy identified these Python packages in the upstream image. Upgrade them in
# the staging layer before copying site-packages into the final runtime.
RUN python -m pip install --no-cache-dir --upgrade \
      "msgpack==1.2.1" \
      "setuptools==83.0.0" \
 && python -c 'from importlib.metadata import version; assert version("msgpack") == "1.2.1"; assert version("setuptools") == "83.0.0"'

FROM gcr.io/distroless/python3-debian13:nonroot

COPY --from=headroom-runtime /usr/local/lib/python3.13/site-packages /usr/local/lib/python3.13/site-packages
COPY --from=headroom-runtime /usr/local/bin/headroom-proxy /usr/local/bin/headroom-proxy

ENV PYTHONPATH=/usr/local/lib/python3.13/site-packages \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HEADROOM_HOST=0.0.0.0 \
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

WORKDIR /app
USER nonroot
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["python3", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/readyz', timeout=5)"]

ENTRYPOINT ["python3", "-m", "headroom.cli", "proxy"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
