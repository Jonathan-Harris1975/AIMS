# Blotato Service

AIMS integration layer for Blotato social publishing, visual generation, and one-call AI short-video publishing.

## Weekly short-video lanes

The automated social-video week uses five lanes:

| Day | Lane | Purpose |
|---|---|---|
| Monday | `news-insight` | Current AI news item, why it matters, who it affects, practical takeaway. |
| Tuesday | `model-verdict` | Practical verdict on one AI model, tool, feature, or release. |
| Wednesday | `ai-at-work` | What the AI story changes for real workflows, creators, teams, or small businesses. |
| Thursday | `reality-check` | What the headline means, what it does not mean, risk and opportunity. |
| Friday | `ai-playbook` | Practical how-to or mini workflow the audience can use. |

All lanes target at least 30 seconds of voiceover, structured Blotato scenes, faceless editorial visuals, and platform-safe captions.

## Environment

```bash
Blotato_API_key=
BLOTATO_API_BASE=https://backend.blotato.com/v2
BLOTATO_TIMEOUT_MS=30000
BLOTATO_NEWS_SHORT_MAX_TOKENS=2200
BLOTATO_NEWS_DURATION_SECONDS=45
BLOTATO_NEWS_TEMPLATE_ID=/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1
BLOTATO_NEWS_RSS_URL=https://ai-news.jonathan-harris.online/feed.xml
BLOTATO_RSS_PREFER_R2=true
BLOTATO_RSS_BUCKET_ALIAS=rss
BLOTATO_RSS_JSON_KEY=feed.json
BLOTATO_RSS_PICK_MODE=latest
BLOTATO_DEFAULT_CHANNELS=instagram,youtube,tiktok,facebook
BLOTATO_INSTAGRAM_ACCOUNT_ID=48812
BLOTATO_YOUTUBE_ACCOUNT_ID=37622
BLOTATO_TIKTOK_ACCOUNT_ID=44263
BLOTATO_FACEBOOK_ACCOUNT_ID=34013
BLOTATO_FACEBOOK_PAGE_ID=562160556971997
BLOTATO_VIDEO_POLL_ATTEMPTS=90
BLOTATO_VIDEO_POLL_INTERVAL_MS=3000
BLOTATO_POST_POLL_ATTEMPTS=60
BLOTATO_POST_POLL_INTERVAL_MS=3000
BLOTATO_YOUTUBE_PRIVACY_STATUS=public
BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS=false
BLOTATO_INSTAGRAM_SHARE_TO_FEED=true
```

`Blotato_API_key` is the canonical key name used by this service. `BLOTATO_API_KEY` is accepted only as a fallback alias.

## Public one-call triggers

These routes are intentionally public so controlled hooks can trigger them without an AIMS bearer token:

```bash
curl -X POST "https://Jonathan-harris.online/blotato/shorts/news-insight/publish-now"
curl -X POST "https://Jonathan-harris.online/blotato/shorts/model-verdict/publish-now"
curl -X POST "https://Jonathan-harris.online/blotato/shorts/ai-at-work/publish-now"
curl -X POST "https://Jonathan-harris.online/blotato/shorts/reality-check/publish-now"
curl -X POST "https://Jonathan-harris.online/blotato/shorts/ai-playbook/publish-now"
```

Each trigger does the full flow:

1. Selects the latest usable article from the RSS feed.
2. Builds the selected weekly lane pack.
3. Creates a structured Blotato video using `/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1`.
4. Polls Blotato until the video render is complete.
5. Publishes immediately to Instagram, YouTube, TikTok, and Facebook.
6. Stores job status under `GET /blotato/jobs/:sessionId`.

The trigger returns quickly with a queued/running job. The heavy Blotato work runs in the background unless `BLOTATO_INLINE_PUBLISH_JOBS=true`.

## Routes

Most routes are mounted behind the suite auth middleware. The public exceptions are the publish-now triggers and the job status route.

| Route | Auth | Purpose |
|---|---|---|
| `GET /blotato/health` | Public | Local config and route check. Does not call Blotato. |
| `GET /blotato/shorts/lanes` | AIMS bearer | List the five weekly short-video lanes. |
| `POST /blotato/shorts/news-insight/publish-now` | Public | Backwards-compatible Monday trigger. |
| `POST /blotato/shorts/:lane/publish-now` | Public | Trigger any weekly lane. |
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
| `POST /blotato/shorts/:lane` | AIMS bearer | Build any weekly lane pack, optionally create the Blotato visual. |

## Trial flow

1. Set `Blotato_API_key` as a Koyeb secret.
2. Keep the non-secret defaults in `config/production.defaults.env`.
3. Connect Instagram, YouTube, TikTok, and Facebook inside Blotato.
4. Keep the configured IDs:
   - TikTok account: `44263`
   - Facebook account: `34013`
   - Facebook Page: `562160556971997`
5. Trigger one lane manually.
6. Check the returned status URL until the job becomes `completed` or `failed`.
7. Review the created Blotato visual before enabling unattended scheduling.

## Example visual request

```json
{
  "templateId": "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1",
  "inputs": {
    "scenes": [
      {
        "mediaSource": "Faceless dark editorial AI newsroom with workflow cards moving through a clean dashboard.",
        "script": "AI agents are moving from chat to chores."
      }
    ],
    "aspectRatio": "9:16",
    "captionPosition": "bottom"
  },
  "prompt": "Create a polished faceless vertical AI social video...",
  "render": true,
  "isDraft": false
}
```

## Example post request

```json
{
  "accountId": "44263",
  "platform": "tiktok",
  "text": "AI news, minus the fog. #ArtificialIntelligence #AINews",
  "mediaUrls": ["https://example.com/video.mp4"],
  "target": { "targetType": "tiktok" }
}
```

For Facebook Pages, include `target.pageId` from the subaccounts endpoint. This repo defaults to `562160556971997`.
