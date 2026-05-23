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

## Routes

| Route | Purpose |
| --- | --- |
| `GET /blotato/health` | Local config and route check. Does not call Blotato. |
| `GET /blotato/accounts?platform=instagram` | Fetch connected social account IDs. |
| `GET /blotato/accounts/:accountId/subaccounts` | Fetch Facebook or LinkedIn page IDs. |
| `GET /blotato/templates?search=AI&fields=id,name,description,inputs` | Fetch visual templates and expected inputs. |
| `POST /blotato/visuals` | Create a Blotato visual from a template. |
| `GET /blotato/visuals/:id` | Poll visual creation status. |
| `DELETE /blotato/visuals/:id` | Delete a visual creation. |
| `POST /blotato/posts` | Publish or schedule a social post. |
| `GET /blotato/posts/:postSubmissionId` | Poll publish status. |
| `POST /blotato/shorts/news-insight` | Build a current AI-news short pack, optionally create the Blotato visual. |
| `POST /blotato/shorts/news-insight/publish-now` | One-call background pipeline: extract article/source, create AI news short, post immediately to Instagram and YouTube. |
| `GET /blotato/jobs/:sessionId` | Poll the one-call background pipeline status. |

## One-call AI news short pipeline

`POST /blotato/shorts/news-insight/publish-now` starts a background `blotato` job and returns `202` immediately. The job then:

1. Resolves an article/source through Blotato when `articleUrl` or `source` is provided.
2. Builds a Jonathan Harris AI-news insight short pack.
3. Creates a Blotato visual using the AI story video template.
4. Polls until the video is rendered.
5. Publishes immediately to Instagram Reels and YouTube Shorts.
6. Polls until Blotato reports the posts as published or failed.
7. Stores the result in `/blotato/jobs/:sessionId`.

If `BLOTATO_INSTAGRAM_ACCOUNT_ID` and `BLOTATO_YOUTUBE_ACCOUNT_ID` are set, those account IDs are used. Otherwise the service calls Blotato's accounts endpoint and uses the first connected account for each platform.

## Test curl

```bash
curl -X POST "https://YOUR-AIMS-DOMAIN/blotato/shorts/news-insight/publish-now" \
  -H "Authorization: Bearer YOUR_AIMS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "blotato-trial-001",
    "articleUrl": "https://example.com/your-ai-news-article",
    "theme": "what-it-means",
    "durationSeconds": 45
  }'
```

Then check:

```bash
curl "https://YOUR-AIMS-DOMAIN/blotato/jobs/BLT-blotato-trial-001" \
  -H "Authorization: Bearer YOUR_AIMS_API_KEY"
```
