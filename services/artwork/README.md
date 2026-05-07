# Artwork service

## Status

**Implemented.** This page documents behaviour backed by files in `services/artwork/`.

## Purpose

Generates and stores image assets for direct artwork requests, podcast episodes and blog posts using OpenRouter image-capable providers.

## Routes

- `POST /artwork/create` stores a JSON request in R2.
- `POST /artwork/generate` generates a PNG and stores it in R2.

## Main files

- `routes/createArtwork.js`
- `routes/generateArtwork.js`
- `createBlogArtwork.js`
- `createPodcastArtwork.js`
- `utils/artwork.js`
- `utils/openrouterProviders.js`

## Workflow

- Resolve provider/model chain from shared `ai-config.js`.
- Send image prompt to OpenRouter chat/completions endpoint.
- Extract base64 image data from provider response.
- Upload PNG to the correct R2 alias.
- Podcast artwork can return a configured fallback URL if generation fails.

## Environment variables

- `OPENROUTER_API_KEY`, `OPENROUTER_API_KEY_ART`, `OPENROUTER_API_KEY_ART_BACKUP`
- `AI_MODEL_IMAGE`, `OPENROUTER_ART`, `OPENROUTER_ART_BACKUP`
- `OPENROUTER_BASE_URL` or `OPENROUTER_API_BASE`
- `ARTWORK_TIMEOUT_MS`, `BLOG_ARTWORK_TIMEOUT_MS`, `PODCAST_ARTWORK_TIMEOUT_MS`
- `R2_BUCKET_ART`, `R2_PUBLIC_BASE_URL_ART`
- `R2_BUCKET_BLOG_IMAGES`, `R2_PUBLIC_BASE_URL_BLOG_IMAGES`
- `PODCAST_FALLBACK_IMAGE_URL`, `PODCAST_FALLBACK_EPISODE_IMAGE_URL`, `BLOG_FALLBACK_IMAGE_URL`

## External integrations

- OpenRouter image-capable models
- Cloudflare R2

## Storage

- Direct and podcast images: R2 alias `art`, key `<sessionId>.png`.
- Blog images: R2 alias `blogImages`, key optionally prefixed by the caller.
- Artwork create requests: R2 alias `art`, key `artwork/requests/<timestamp>.json`.

## Tests

No dedicated artwork test file was found. Artwork behaviour is indirectly exercised by blog and podcast flows where tests cover surrounding package logic.

## Common troubleshooting

- No providers configured: set at least one image model and API key.
- No image data returned: inspect provider response shape and model capability.
- R2 upload failure: check bucket/public URL env for `art` or `blogImages`.

## Connections to other services

Used by podcast pipeline and blog weekly/social publishing. Shared AI config controls provider selection.
