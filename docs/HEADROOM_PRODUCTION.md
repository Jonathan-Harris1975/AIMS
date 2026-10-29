# Production Headroom

AIMS uses HIVE's existing inline Headroom installation through authenticated HTTPS `POST /v1/compress`. This avoids paying for a separate companion service. The AIMS service key is reused solely to authenticate compression; it does not grant HIVE administrator access.

The explicit Restore Headroom production release verifies the configured AIMS and HIVE identities and HIVE deployment health before applying additive settings. HIVE stays at a minimum of one instance with Headroom enabled. The external anonymous beacon is disabled while local savings metrics remain available. Existing HIVE service/storage capacity is reused.

The AIMS deployment overlay binds `HEADROOM_PROXY_TOKEN` to the existing `AIMS_API_KEY` secret. Source defaults remain free of secret values/references; build-time validation checks the declared overlay binding, and deployed verification checks real authentication.

After exact-SHA deployment, the synthetic probe must demonstrate positive compression savings and preservation of message/system shape and the latest protected instruction. It makes no LLM inference request. The workflow checks an explicit success marker rather than relying on Koyeb exec exit status.

Content protections, exact-source and visual handling, and transient recovery retain their existing behaviour. Missing/unsafe compression cannot replace the original input. The production check exposes unavailability rather than silently turning the configured enabled flag off.
