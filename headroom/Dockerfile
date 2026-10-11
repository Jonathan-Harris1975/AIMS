# Headroom compression-only companion service for AIMS.
#
# Build Headroom into an isolated virtual environment with the same supported
# Python minor line used by the runtime image. Headroom 0.37 currently documents
# Python 3.13 for its ONNX-backed proxy dependencies. The floating Chainguard
# latest tag moved to Python 3.15 before onnxruntime published compatible wheels;
# Chainguard's 3.13 tags require registry access that public CI does not have.
#
# Keep Trivy's HIGH/CRITICAL OS, library and secret scan enabled. Do not add
# scanner exclusions to make a release pass.
ARG HEADROOM_VERSION=0.37.0
ARG MSGPACK_VERSION=1.2.1
ARG SETUPTOOLS_VERSION=83.0.0

FROM python:3.13-slim-trixie AS headroom-build

ARG HEADROOM_VERSION
ARG MSGPACK_VERSION
ARG SETUPTOOLS_VERSION

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

FROM python:3.13-slim-trixie

# Remove the system package installer and create an unprivileged runtime user.
RUN python -m pip uninstall --yes pip setuptools wheel \
 && ! command -v pip >/dev/null 2>&1 \
 && ! command -v pip3 >/dev/null 2>&1 \
 && groupadd --system --gid 65532 nonroot \
 && useradd --system --uid 65532 --gid 65532 --home-dir /nonexistent --shell /usr/sbin/nologin nonroot \
 && mkdir -p /app \
 && chown nonroot:nonroot /app

COPY --from=headroom-build --chown=nonroot:nonroot /opt/headroom /opt/headroom

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

WORKDIR /app
USER nonroot
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/opt/headroom/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/readyz', timeout=5)"]

ENTRYPOINT ["/opt/headroom/bin/python", "-m", "headroom.cli", "proxy"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
