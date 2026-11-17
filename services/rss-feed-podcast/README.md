# Podcast RSS support

This directory contains podcast RSS generation/support logic used by the production podcast workflow. It is not mounted as an independent HTTP service.

## Responsibilities

- Generate/update the Turing's Torch RSS XML from approved episode metadata.
- Preserve podcast-level metadata such as title, description, language, category, owner, artwork, funding and explicit/type declarations.
- Add episode enclosure/transcript/artwork metadata from the completed podcast pipeline.
- Store the resulting feed in the configured podcast RSS R2 bucket/public URL.

## Configuration

The contract is controlled by `PODCAST_*`, `PODCAST_RSS_*`, podcast RSS bucket/public-base settings and the final episode metadata produced by the script/podcast pipeline.

## PodSEO hopr.fm download measurement

Audio `<enclosure>` URLs in the published feed are prefixed with
`https://hopr.fm/k/e4dxbwh0/` for the owner's PodSEO account. The
underlying `podcastUrl` in R2 episode metadata remains the original HTTPS
audio asset, and episode-page, GUID, transcript and image URLs are unchanged.

The prefix is deliberately added in `generateFeed.js` to every published
episode, including the back catalogue, and the helper avoids double-prefixing.
Changing the account prefix requires a reviewed code change. If PodSEO is
disabled, remove the prefix through a reviewed rollback and republish RSS.
Run `node --test test/podcast-rss-contract.test.js` and validate an RSS
enclosure redirect before publication.
