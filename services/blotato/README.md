# Blotato Service

AIMS integration layer for Blotato social publishing and visual generation.

## Environment

```bash
Blotato_API_key=
BLOTATO_API_BASE=https://backend.blotato.com/v2
BLOTATO_TIMEOUT_MS=30000
BLOTATO_NEWS_SHORT_MAX_TOKENS=2200
```

`Blotato_API_key` is the canonical key name used by this service. `BLOTATO_API_KEY` is accepted only as a fallback alias.

## Routes

All routes are mounted behind the suite auth middleware.

| Route | Purpose |
|---|---|
| `GET /blotato/health` | Local config and route check. Does not call Blotato. |
| `GET /blotato/accounts?platform=tiktok` | Fetch connected social account IDs. |
| `GET /blotato/accounts/:accountId/subaccounts` | Fetch Facebook or LinkedIn page IDs. |
| `GET /blotato/templates?search=AI&fields=id,name,description,inputs` | Fetch visual templates and expected inputs. |
| `POST /blotato/visuals` | Create a Blotato visual from a template. |
| `GET /blotato/visuals/:id` | Poll visual creation status. |
| `DELETE /blotato/visuals/:id` | Delete a visual creation. |
| `POST /blotato/posts` | Publish or schedule a social post. |
| `GET /blotato/posts/:postSubmissionId` | Poll publish status. |
| `POST /blotato/shorts/news-insight` | Build a current AI-news short pack, optionally create the Blotato visual. |

## Trial flow

1. Set `Blotato_API_key`.
2. Call `/blotato/accounts` and record account IDs.
3. Call `/blotato/templates?search=AI` and pick the best video template.
4. Generate a dry-run news insight pack with `/blotato/shorts/news-insight`.
5. Re-run with `createVisual: true`, `dryRun: false`, and the chosen `templateId`.
6. Poll `/blotato/visuals/:id` until status is `done`.
7. Publish the returned `mediaUrl` with `/blotato/posts`.

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
