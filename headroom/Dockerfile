# Headroom compression-only companion service for AIMS.
#
# Build current CPython against Ubuntu's security-maintained system libraries.
# The runtime image is pinned to an official Ubuntu 26.04 image digest and
# receives the current signed security repository packages at build time.
# The final image contains no build toolchain and runs as an unprivileged user.
ARG UBUNTU_IMAGE=ubuntu:26.04@sha256:3595d7fc4286a33fad0fd853a4063e654287a9c3787437d7937c94ca3f7a804e
ARG PYTHON_VERSION=3.14.8
ARG PYTHON_SHA256=c2215904f02b175596dc49351585104f4bc20341e1c47378b26a2c274360ce73
ARG PIP_VERSION=26.2.1
ARG HEADROOM_VERSION=0.37.0
ARG MSGPACK_VERSION=1.2.1
ARG SETUPTOOLS_VERSION=83.0.0

FROM ${UBUNTU_IMAGE} AS python-build
ARG PYTHON_VERSION
ARG PYTHON_SHA256
ARG PIP_VERSION
ARG HEADROOM_VERSION
ARG MSGPACK_VERSION
ARG SETUPTOOLS_VERSION

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      build-essential ca-certificates curl pkg-config \
      libbz2-dev libffi-dev libexpat1-dev liblzma-dev libncursesw6 \
      libreadline-dev libsqlite3-dev libssl-dev uuid-dev zlib1g-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /build
RUN curl --fail --location --silent --show-error \
      "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz" \
      --output Python.tar.xz \
 && echo "${PYTHON_SHA256}  Python.tar.xz" | sha256sum --check --status \
 && tar -xJf Python.tar.xz --strip-components=1 \
 && ./configure --prefix=/usr/local --enable-shared --with-system-expat --with-ensurepip=install \
 && make -j"$(nproc)" \
 && make altinstall \
 && ldconfig \
 && /usr/local/bin/python3.14 -c 'import ssl, sqlite3, bz2, lzma, zlib, xml.parsers.expat; assert xml.parsers.expat.EXPAT_VERSION'

RUN /usr/local/bin/python3.14 -m venv /opt/headroom \
 && /opt/headroom/bin/pip install --no-cache-dir --upgrade \
      "pip==${PIP_VERSION}" \
      "setuptools==${SETUPTOOLS_VERSION}" \
 && /opt/headroom/bin/pip install --no-cache-dir \
      "headroom-ai[proxy,proxy-prod]==${HEADROOM_VERSION}" \
      "msgpack==${MSGPACK_VERSION}" \
 && /opt/headroom/bin/pip uninstall --yes pip \
 && /opt/headroom/bin/python -c 'from importlib.metadata import version; from importlib.util import find_spec; from pathlib import Path; assert version("headroom-ai") == "0.37.0"; assert version("msgpack") == "1.2.1"; assert version("setuptools") == "83.0.0"; assert find_spec("pip") is None; assert not any(Path("/opt/headroom/bin").glob("pip*")); from headroom._core import DiffCompressor, SmartCrusher' \
 && rm -rf /usr/local/lib/python3.14/test /usr/local/lib/python3.14/ensurepip /usr/local/lib/python3.14/ensurepip-*.dist-info /usr/local/lib/python3.14/site-packages \
 && rm -f /usr/local/bin/pip /usr/local/bin/pip3 /usr/local/bin/pip3.14 /usr/local/bin/python3.14-config \
 && rm -rf /usr/local/include /usr/local/share /usr/local/lib/pkgconfig

FROM ${UBUNTU_IMAGE} AS headroom-runtime
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates passwd libbz2-1.0 libexpat1 libffi8 libgcc-s1 \
      libgomp1 liblzma5 libncursesw6 libreadline8 libsqlite3-0 \
      libssl3t64 libstdc++6 libuuid1 zlib1g \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /usr/bin/pebble \
 && groupadd --gid 10001 nonroot \
 && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin nonroot

COPY --from=python-build /usr/local/bin/python3.14 /usr/local/bin/python3.14
COPY --from=python-build /usr/local/lib/libpython3.14.so.1.0 /usr/local/lib/libpython3.14.so.1.0
COPY --from=python-build /usr/local/lib/python3.14 /usr/local/lib/python3.14
COPY --from=python-build --chown=10001:10001 /opt/headroom /opt/headroom

RUN LD_LIBRARY_PATH=/usr/local/lib /opt/headroom/bin/python -c 'import bz2, ctypes, lzma, readline, sqlite3, ssl, uuid, xml.parsers.expat, zlib; import sys; assert sys.version_info[:3] == (3, 14, 8); from headroom._core import DiffCompressor, SmartCrusher'

ENV LD_LIBRARY_PATH=/usr/local/lib \
    PATH=/opt/headroom/bin:/usr/local/bin:/usr/bin:/bin \
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
  CMD ["/opt/headroom/bin/python", "-c", "import json, urllib.request; status=json.load(urllib.request.urlopen('http://127.0.0.1:8787/readyz', timeout=5)); assert status.get('service') == 'headroom-proxy' and status.get('ready') is True"]

ENTRYPOINT ["/opt/headroom/bin/python", "-m", "headroom.cli", "proxy"]
CMD ["--host", "0.0.0.0", "--port", "8787"]
