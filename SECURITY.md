# AIMS security policy

**Status:** Production-controlled  
**Last reviewed:** 16 June 2026

AIMS is an authenticated background API. Store all API keys, provider tokens, webhook secrets and R2 credentials in Koyeb Secrets. Do not expose them through client-side JavaScript, logs or committed environment files.

Production controls include suite authentication, CORS allow-listing, request-rate and body limits, durable-state checks, non-root containers, build-stage environment isolation, secure response headers and CI secret scanning.

Webhook routes must validate their documented shared secret or bearer token. Cloudflare R2 credentials should be bucket-scoped and rotated after suspected exposure. Report vulnerabilities privately to the repository owner with endpoint, impact and reproducible evidence.
