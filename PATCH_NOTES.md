# Koyeb log noise and blog artwork fix

Updated files:
- server.js
- env.template
- services/artwork/createBlogArtwork.js
- services/blog/weekly/buildWeeklyBlogPost.js
- services/blog/utils/weeklyPackage.js

What changed:
1. /favicon.ico is handled before pino-http, redirecting to the brand asset favicon.
2. Common WordPress/Git scanner probes are answered before pino-http, keeping Koyeb logs clean.
3. Blog artwork timeout now uses BLOG_ARTWORK_TIMEOUT_MS and defaults to 120000ms.
4. Blog publishing no longer succeeds with an empty image URL unless a configured fallback image is used.
5. Blog manifest/post metadata now records image_generation_status and image_generation_error.

Required env recommendation:
- BLOG_ARTWORK_TIMEOUT_MS=120000
- BLOG_FALLBACK_IMAGE_URL=<a stable wide fallback blog image URL>
