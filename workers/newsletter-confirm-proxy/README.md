# Newsletter confirmation proxy

This Cloudflare Worker provides the branded hostname used by AI Edge email confirmation links. It forwards only GET and HEAD requests matching `/newsletter/confirm/:token` with a 43-character URL-safe token to the existing AIMS Koyeb app. Other paths return 404; other methods on the confirmation path return 405.

The custom domain is `confirm.jonathan-harris.online`. Cloudflare manages its DNS record and TLS certificate. The AIMS app keeps its Koyeb hostname, and Jotform webhook delivery continues to use `COMMS_HUB_PUBLIC_BASE_URL`.

AIMS creates confirmation links using `NEWSLETTER_CONFIRMATION_BASE_URL`, with `COMMS_HUB_PUBLIC_BASE_URL` as the fallback. The production default is the branded confirmation origin.

Deploy or update this Worker with:

```sh
npx wrangler deploy --config workers/newsletter-confirm-proxy/wrangler.toml
```

The upstream origin and route policy are deliberately fixed in `worker.js`; change them only with a reviewed code update.
