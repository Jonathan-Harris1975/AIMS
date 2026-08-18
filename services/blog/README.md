# Blog service

**Live route prefix:** `/blog`

Builds the weekly long-form article, daily social posts that drive traffic to blog content, and the public blog RSS feed.

## HTTP contract

- `POST /blog/weekly/build` — generate and publish the weekly article.
- `GET /blog/weekly/jobs/:lane/:sessionId` — inspect weekly job state.
- `POST /blog/social/daily/build` — generate daily blog-social content.
- `GET /blog/social/jobs/:lane/:sessionId` — inspect social job state.
- `POST /blog/social/rss/rebuild` — rebuild blog-social RSS.
- `POST /blog/rss/rebuild` — rebuild the main blog RSS.

## Behaviour

Generation uses the shared Jonathan Harris voice and content-quality gates. Weekly output is source-grounded, structured for search/readability and published only after validation. Blog-social output is judged for hook, article fidelity, CTA/link integrity and platform suitability. Relevant controls include `BLOG_WEEK_DAYS`, `BLOG_PREFIX`, `BLOG_SOCIAL_*`, RSS publication settings and blog R2 bucket/public-base variables.

## Implementation

The service entry point, route modules and domain utilities are contained in this directory. Calls from AIMS operational windows use the same authenticated HTTP contract as external suite triggers, which keeps job logging, validation and failure handling consistent.

## Operational rules

- Treat `config/production.defaults.env`, `env.template`, `config/thresholds.js` and the relevant service config module as the configuration sources of truth.
- Secrets belong in the deployment secret store and must not be committed.
- Production HTTP access is protected by the AIMS bearer-auth middleware unless a route explicitly implements a narrower public status/redirect contract.
- Retries are for transient failures only; validation, policy and source-integrity failures fail closed.
- Generated public content must pass its content-quality gates before publication or delivery.
- Durable artefacts and job state use the configured R2/state utilities rather than process memory where a durable store is required.
