> **Document status:** Production reference  
> **Last reviewed:** 21 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Cloudflare purge service

Routes are mounted under `/cloudflare`.

## Endpoints

- `GET /cloudflare/health`
- `POST /cloudflare/purge`

`POST /cloudflare/purge` requires the AIMS bearer token or `x-cloudflare-purge-secret: <CLOUDFLARE_PURGE_SHARED_SECRET>` in production. `CLOUDFLARE_PURGE_ALLOW_PUBLIC=true` is an explicit legacy escape hatch and should not be used for paid production.

The route still requires valid outbound Cloudflare credentials in the deployed environment. Empty webhook-style POST bodies are treated as `{"purge_everything": true}` because this endpoint is normally used as a cache-clear trigger rather than a form submission.

## Request body

Provide exactly one purge mode:

```json
{}
```

Defaults to:

```json
{ "purge_everything": true }
```

Explicit purge-all payload:

```json
{ "purge_everything": true }
```

```json
{ "files": ["https://example.com/page.html"] }
```

Also accepted:

```json
{ "urls": "https://example.com/page.html, https://example.com/feed.xml" }
```

```json
{ "tags": ["tag-name"] }
```

```json
{ "hosts": ["example.com"] }
```

```json
{ "prefixes": ["https://example.com/blog/"] }
```

## Environment variables

Preferred names:

- `CF_zone` or `CLOUDFLARE_ZONE_ID`
- `CF_purge` or `CLOUDFLARE_PURGE_API_TOKEN`
- `CLOUDFLARE_PURGE_SHARED_SECRET`, optional hook secret for non-bearer callers
- `CLOUDFLARE_PURGE_ALLOW_PUBLIC=false`, keep closed in production
- `CLOUDFLARE_PURGE_TIMEOUT_MS`, optional, default `15000`

Supported aliases:

- Zone: `CF_zone`, `CF_ZONE`, `CLOUDFLARE_ZONE_ID`, `CLOUDFLARE_ZONE`
- API token: `CF_purge`, `CF_PURGE`, `CLOUDFLARE_PURGE_API_TOKEN`, `CLOUDFLARE_API_TOKEN`, `CF_API_TOKEN`
- Legacy global key fallback: `CF_EMAIL` plus one of `CF_GLOBAL_API_KEY`, `CLOUDFLARE_GLOBAL_API_KEY`, `CF_API_KEY`

The code strips a leading `Bearer ` prefix from token values, so either a raw token or `Bearer <token>` will work.

## Koyeb note

Use a clean secret reference without spaces or hyphens in the secret name where possible:

```text
CF_purge={{secret.CF_PURGE}}
CF_zone={{secret.CF_ZONE}}
CLOUDFLARE_PURGE_SHARED_SECRET={{secret.CLOUDFLARE_PURGE_SHARED_SECRET}}
CLOUDFLARE_PURGE_ALLOW_PUBLIC=false
```

Avoid this shape for the token because it can remain unresolved and Cloudflare will reject it as a bad bearer token:

```text
CF_purge={{ secret.CF-purge }}
```

The health route now reports whether the Cloudflare credential variables resolved, and identifies the env key used without exposing secret values.
