# Production Headroom

AIMS production defaults enable Headroom at the private Koyeb companion address `http://headroom:8787`. Its deployment overlay binds `HEADROOM_PROXY_TOKEN`; provider inference credentials are never forwarded to compression.

The explicit Restore Headroom production release verifies a single healthy companion in the AIMS app before applying additive service settings. It keeps at least one companion instance running, disables sleeping and disables Headroom's external anonymous beacon. Local savings statistics remain available. Missing or unhealthy companion infrastructure is reported as a deployment verification failure rather than being hidden by a green application build.

After exact-SHA application deployment, a synthetic check must demonstrate positive compression savings and preservation of system/message shape and the latest protected instruction. It never calls an LLM. The workflow checks the success marker because Koyeb exec can report success even when a remote command fails.

Production tasks keep their existing content protections: image/visual QA and exact-source paths retain their existing handling; invalid compression cannot replace protected content. A transient proxy failure retains original input under the existing recovery policy rather than silently changing the configured enabled flag. The deployment check independently reports loss of Headroom availability.

The companion image uses `headroom/Dockerfile`; its settings are documented in `config/headroom.koyeb.env.template`. Existing persistent storage at `/var/lib/headroom` should be retained for native savings history. Do not publish provider tokens or prompt bodies in deployment logs.
