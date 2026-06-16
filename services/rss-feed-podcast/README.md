> **Document status:** Production reference  
> **Last reviewed:** 16 June 2026  
> **Operational authority:** Current repository README, SECURITY policy and operations guide.

# Podcast RSS feed service

## Status

**Implemented as callable module.** This page documents behaviour backed by files in `services/rss-feed-podcast/`.

## Purpose

Builds the podcast RSS feed from episode metadata JSON stored in R2 and optionally notifies PodcastIndex.

## Routes

No direct Express route is mounted. The service is called by `services/podcast/runPodcastPipeline.js`.

## Main files

- `index.js`
- `generateFeed.js`
- `xmlBuilder.js`

## Workflow

- List metadata JSON files from R2 alias `meta`.
- Filter out non-episode metadata files.
- Map valid metadata to RSS items.
- Build RSS XML with Podcasting 2.0-compatible fields.
- Upload `turing-torch.xml` to R2 alias `podcastRss`.
- Notify PodcastIndex when configured and `AUTO_CALL=yes`.

## Environment variables

- `PODCAST_TITLE`, `PODCAST_AUTHOR`, `PODCAST_DESCRIPTION`, `PODCAST_LINK`, `PODCAST_LANGUAGE`, `PODCAST_IMAGE_URL`, categories, owner, locked and funding vars
- `PODCAST_RSS_FEED_URL`, `PODCAST_EPISODE_BASE_URL`, `SITE_BASE_URL`, `PODCAST_TRANSCRIPT_HTML_BASE_URL`
- `API_KEY_PODCAST_INDEX`, `API_SECRET_PODCAST_INDEX`, `PODCASTINDEX_USER_AGENT`, `AUTO_CALL`
- `R2_BUCKET_META`, `R2_BUCKET_PODCAST_RSS_FEEDS`, `R2_PUBLIC_BASE_URL_PODCAST_RSS`

## External integrations

- Cloudflare R2
- PodcastIndex hub notification

## Storage

Input: root JSON files in R2 alias `meta`. Output: `turing-torch.xml` in R2 alias `podcastRss`.

## Tests

`test/podcast-rss-contract.test.js`

## Common troubleshooting

- No episodes in feed: metadata must contain `sessionId`, `title` and `podcastUrl`.
- Missing canonical links: check `SITE_BASE_URL` or `PODCAST_EPISODE_BASE_URL`.
- PodcastIndex not called: check `AUTO_CALL` and credentials.

## Connections to other services

Called by podcast pipeline after final audio/metadata generation.
