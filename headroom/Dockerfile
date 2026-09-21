# Headroom compression-only companion service for AIMS.
#
# Build Headroom into an isolated virtual environment on Chainguard's hardened
# Python image, then copy only that environment into the minimal runtime image.
# The previous Debian distroless Python base still carried HIGH vulnerabilities
# with no Debian fixes available, so it could never satisfy AIMS' release gate.
#
# The final image is still scanned by Trivy for HIGH/CRITICAL OS, library and
# secret findings. Do not add scanner exclusions here to make a release pass.
ARG HEADROOM_VERSION=0.37.0
ARG MSGPACK_VERSION=1.2.1
ARG SETUPTOOLS_VERSION=83.0.0

FROM cgr.dev/chainguard/python:latest-dev AS headroom-build

ARG HEADROOM_VERSION
ARG MSGPACK_VERSION
ARG SETUPTOOLS_VERSION

USER root
WORKDIR /build

# pip vendors vulnerable msgpack/setuptools snapshots in its own runtime tree.
# It is a build tool, not a Headroom runtime dependency, so do not copy it
# into the production image or suppress the scanner findings it creates.
RUN python -m venv /opt/headroom \
 && /opt/headroom/bin/pip install --no-cache-dir --upgrade \
      "pip" \
      "setuptools==${SETUPTOOLS_VERSION}" \
 && /opt/headroom/bin/pip install --no-cache-dir \
      "headroom-ai[proxy,proxy-prod]==${HEADROOM_VERSION}" \
      "msgpack==${MSGPACK_VERSION}" \
 && /opt/headroom/bin/pip uninstall --yes pip \
 && /opt/headroom/bin/python -c 'from importlib.metadata import version; from importlib.util import find_spec; from pathlib import Path; assert version("headroom-ai") == "0.37.0"; assert version("msgpack") == "1.2.1"; assert version("setuptools") == "83.0.0"; assert find_spec("pip") is None; assert not any(Path("/opt/headroom/bin").glob("pip*")); from headroom._core import DiffCompressor, SmartCrusher'

FROM cgr.dev/chainguard/python:latest

COPY --from=headroom-build /opt/headroom /opt/headroom

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

# Chainguard's minimal runtime deliberately contains no shell/package manager.
# Use Python itself for the health probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["/opt/headroom/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/readyz', timeout=5)"]

ENTRYPOINT ["/opt/headroom/bin/python", "-m", "headroom.cli", "proxy"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
