# Blotato Service

AIMS integration layer for Blotato social publishing, source extraction, and AI story video generation.

## Environment

```env
Blotato_API_key=
BLOTATO_API_BASE=https://backend.blotato.com/v2
BLOTATO_TIMEOUT_MS=30000
BLOTATO_NEWS_SHORT_MAX_TOKENS=2200
BLOTATO_DEFAULT_TEMPLATE_ID=5903fe43-514d-40ee-a060-0d6628c5f8fd
BLOTATO_DEFAULT_CHANNELS=instagram,youtube
BLOTATO_NEWS_RSS_URL=
BLOTATO_RSS_PREFER_R2=true
BLOTATO_RSS_BUCKET_ALIAS=rss
BLOTATO_RSS_JSON_KEY=feed.json
BLOTATO_RSS_PICK_MODE=latest
BLOTATO_INSTAGRAM_ACCOUNT_ID=
BLOTATO_YOUTUBE_ACCOUNT_ID=
BLOTATO_YOUTUBE_PRIVACY_STATUS=public
BLOTATO_SOURCE_POLL_TIMEOUT_MS=180000
BLOTATO_SOURCE_POLL_INTERVAL_MS=3000
BLOTATO_VISUAL_POLL_TIMEOUT_MS=420000
BLOTATO_VISUAL_POLL_INTERVAL_MS=5000
BLOTATO_POST_POLL_TIMEOUT_MS=180000
BLOTATO_POST_POLL_INTERVAL_MS=5000
```

`Blotato_API_key` is the canonical key name used by this service. `BLOTATO_API_KEY` is accepted only as a fallback alias.

The default Blotato template is the AI story video template:

```text
base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
```

The service extracts the bare UUID before calling Blotato because the API expects `5903fe43-514d-40ee-a060-0d6628c5f8fd`, not the full template path.

## Public one-call route

`POST /blotato/shorts/news-insight/publish-now` is intentionally public and does **not** require the AIMS bearer token. It is designed for simple webhook/testing use.

It automatically:

1. Picks a usable article from the configured RSS feed when no body is supplied.
2. Uses the existing rewritten RSS article as source context.
3. Builds a Jonathan Harris AI-news insight short pack.
4. Creates a video using the AI story video template.
5. Publishes immediately to Instagram and YouTube by default.
6. Stores progress/results under `GET /blotato/jobs/:sessionId`, which is also public for this Blotato lane.

Default RSS loading order:

1. `rss/feed.json` from R2, using `BLOTATO_RSS_BUCKET_ALIAS` and `BLOTATO_RSS_JSON_KEY`.
2. `BLOTATO_NEWS_RSS_URL`, `BLOTATO_RSS_FEED_URL`, `RSS_FEED_URL`, or `R2_PUBLIC_BASE_URL_RSS/feed.xml`.
3. `https://ai-news.jonathan-harris.online/feed.xml` as the final public fallback.

The default pick mode is `latest`. Set `BLOTATO_RSS_PICK_MODE=random` only when you deliberately want random RSS selection.

No body is required:

```bash
curl -X POST "https://YOUR-AIMS-DOMAIN/blotato/shorts/news-insight/publish-now"
```

Manual article inputs remain accepted for testing:

```json
{ "articleUrl": "https://example.com/your-ai-news-article" }
```

Also accepted:

```json
{ "url": "https://example.com/your-ai-news-article" }
```

```json
{ "article": "Full pasted article text here..." }
```

```json
{
  "article": {
    "title": "AI story title",
    "summary": "Useful summary or article body",
    "link": "https://example.com/story"
  }
}
```

## Protected routes

All other Blotato/admin routes remain behind the normal AIMS bearer middleware.

| Route | Purpose |
| --- | --- |
| `GET /blotato/health` | Local config and route check. Health-style route remains public. |
| `GET /blotato/accounts?platform=instagram` | Fetch connected social account IDs. Protected. |
| `GET /blotato/accounts/:accountId/subaccounts` | Fetch Facebook or LinkedIn page IDs. Protected. |
| `GET /blotato/templates?search=AI&fields=id,name,description,inputs` | Fetch visual templates and expected inputs. Protected. |
| `POST /blotato/visuals` | Create a Blotato visual from a template. Protected. |
| `GET /blotato/visuals/:id` | Poll visual creation status. Protected. |
| `DELETE /blotato/visuals/:id` | Delete a visual creation. Protected. |
| `POST /blotato/posts` | Publish or schedule a social post. Protected. |
| `GET /blotato/posts/:postSubmissionId` | Poll publish status. Protected. |
| `POST /blotato/shorts/news-insight` | Build a current AI-news short pack, optionally create the Blotato visual. Protected. |
| `POST /blotato/shorts/news-insight/publish-now` | Public one-call background pipeline. |
| `GET /blotato/jobs/:sessionId` | Public status lookup for the one-call background pipeline. |

## Test curl: post immediately

```bash
curl -X POST "https://YOUR-AIMS-DOMAIN/blotato/shorts/news-insight/publish-now"
```

The response includes `statusUrl`, for example:

```bash
curl "https://YOUR-AIMS-DOMAIN/blotato/jobs/BLT-blotato-1760000000000"
```

## Optional overrides for testing

```json
{
  "articleUrl": "https://example.com/your-ai-news-article",
  "sessionId": "blotato-trial-001",
  "theme": "what-it-means",
  "durationSeconds": 45,
  "channels": ["instagram", "youtube"]
}
```
