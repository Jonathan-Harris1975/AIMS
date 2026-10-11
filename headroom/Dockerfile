# Headroom compression-only companion service for AIMS.
#
# Build and run Headroom on the same supported Python patch release. Docker's
# maintained Debian 13 hardened runtime removes the unresolved Bookworm/Trixie
# OS findings while retaining the strict HIGH/CRITICAL image scan.
#
# Pin the production runtime by immutable digest. The build-only image uses the
# matching fixed Python release and never ships in the final image.
# Keep Trivy's HIGH/CRITICAL OS, library and secret scan enabled.
ARG HEADROOM_VERSION=0.37.0
ARG MSGPACK_VERSION=1.2.1
ARG SETUPTOOLS_VERSION=83.0.0

FROM dhi.io/python:3.14.8-debian13-dev AS headroom-build

ARG HEADROOM_VERSION
ARG MSGPACK_VERSION
ARG SETUPTOOLS_VERSION

USER root
WORKDIR /build

# pip and its build-time dependencies are used only to create this venv. Remove
# pip from the venv before copying it into the runtime image.
RUN python -m venv /opt/headroom \
 && /opt/headroom/bin/pip install --no-cache-dir --upgrade \
      "pip" \
      "setuptools==${SETUPTOOLS_VERSION}" \
 && /opt/headroom/bin/pip install --no-cache-dir \
      "headroom-ai[proxy,proxy-prod]==${HEADROOM_VERSION}" \
      "msgpack==${MSGPACK_VERSION}" \
 && /opt/headroom/bin/pip uninstall --yes pip \
 && /opt/headroom/bin/python -c 'from importlib.metadata import version; from importlib.util import find_spec; from pathlib import Path; assert version("headroom-ai") == "0.37.0"; assert version("msgpack") == "1.2.1"; assert version("setuptools") == "83.0.0"; assert find_spec("pip") is None; assert not any(Path("/opt/headroom/bin").glob("pip*")); from headroom._core import DiffCompressor, SmartCrusher'

FROM dhi.io/python:3.14.8-debian13@sha256:3629601491dfd68543fe32b762165f5913b8c7c8b322d86ef06111499aac9151

COPY --from=headroom-build --chown=65532:65532 /opt/headroom /opt/headroom

ENV PATH=/opt/headroom/bin \
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

WORKDIR /tmp
USER nonroot
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/opt/headroom/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/readyz', timeout=5)"]

ENTRYPOINT ["/opt/headroom/bin/python", "-m", "headroom.cli", "proxy"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
