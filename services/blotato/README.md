# Blotato Service

AIMS integration layer for Blotato social publishing, visual generation, and one-call AI news short publishing.

## Environment

```bash
Blotato_API_key=
BLOTATO_API_BASE=https://backend.blotato.com/v2
BLOTATO_TIMEOUT_MS=30000
BLOTATO_NEWS_SHORT_MAX_TOKENS=2200
BLOTATO_NEWS_TEMPLATE_ID=/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
BLOTATO_NEWS_RSS_URL=https://ai-news.jonathan-harris.online/feed.xml
BLOTATO_RSS_PREFER_R2=true
BLOTATO_RSS_BUCKET_ALIAS=rss
BLOTATO_RSS_JSON_KEY=feed.json
BLOTATO_RSS_PICK_MODE=latest
BLOTATO_DEFAULT_CHANNELS=instagram,youtube
BLOTATO_INSTAGRAM_ACCOUNT_ID=
BLOTATO_YOUTUBE_ACCOUNT_ID=
BLOTATO_VIDEO_POLL_ATTEMPTS=90
BLOTATO_VIDEO_POLL_INTERVAL_MS=3000
BLOTATO_POST_POLL_ATTEMPTS=60
BLOTATO_POST_POLL_INTERVAL_MS=3000
BLOTATO_YOUTUBE_PRIVACY_STATUS=public
BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS=false
BLOTATO_INSTAGRAM_SHARE_TO_FEED=true
```

`Blotato_API_key` is the canonical key name used by this service. `BLOTATO_API_KEY` is accepted only as a fallback alias.

## Public one-call trigger

This route is intentionally public so it can be triggered without an AIMS bearer token:

```bash
curl -X POST "https://Jonathan-harris.online/blotato/shorts/news-insight/publish-now"
```

It does everything itself:

1. Selects the latest usable article from the RSS feed.
2. Builds an AI news insight short pack.
3. Creates a Blotato video using `/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1`.
4. Polls Blotato until the video render is complete.
5. Publishes immediately to Instagram and YouTube.
6. Stores job status under `GET /blotato/jobs/:sessionId`.

The trigger returns quickly with a queued/running job. The heavy Blotato work runs in the background.

## Routes

Most routes are mounted behind the suite auth middleware. The public exceptions are the publish-now trigger and its job status route.

| Route | Auth | Purpose |
|---|---|---|
| `GET /blotato/health` | Public | Local config and route check. Does not call Blotato. |
| `POST /blotato/shorts/news-insight/publish-now` | Public | Zero-body RSS-to-video-to-Instagram/YouTube trigger. |
| `GET /blotato/jobs/:sessionId` | Public | Read publish-now job status. |
| `GET /blotato/accounts?platform=tiktok` | AIMS bearer | Fetch connected social account IDs. |
| `GET /blotato/accounts/:accountId/subaccounts` | AIMS bearer | Fetch Facebook or LinkedIn page IDs. |
| `GET /blotato/templates?search=AI&fields=id,name,description,inputs` | AIMS bearer | Fetch visual templates and expected inputs. |
| `POST /blotato/visuals` | AIMS bearer | Create a Blotato visual from a template. |
| `GET /blotato/visuals/:id` | AIMS bearer | Poll visual creation status. |
| `DELETE /blotato/visuals/:id` | AIMS bearer | Delete a visual creation. |
| `POST /blotato/posts` | AIMS bearer | Publish or schedule a social post. |
| `GET /blotato/posts/:postSubmissionId` | AIMS bearer | Poll publish status. |
| `POST /blotato/shorts/news-insight` | AIMS bearer | Build a current AI-news short pack, optionally create the Blotato visual. |

## Trial flow

1. Set `Blotato_API_key`.
2. Connect Instagram and YouTube inside Blotato.
3. Either set `BLOTATO_INSTAGRAM_ACCOUNT_ID` and `BLOTATO_YOUTUBE_ACCOUNT_ID`, or let AIMS pick the first connected account for each platform.
4. Trigger `POST /blotato/shorts/news-insight/publish-now`.
5. Check the returned status URL until the job becomes `completed` or `failed`.

## Example visual request

```json
{
  "templateId": "template-id-from-blotato",
  "inputs": {},
  "prompt": "Create a polished faceless vertical AI news short...",
  "render": true,
  "isDraft": false
}
```

## Example post request

```json
{
  "accountId": "98432",
  "platform": "tiktok",
  "text": "AI news, minus the circus. #ArtificialIntelligence #AINews",
  "mediaUrls": ["https://example.com/video.mp4"],
  "target": { "targetType": "tiktok" }
}
```

For Facebook Pages, include `target.pageId` from the subaccounts endpoint.
