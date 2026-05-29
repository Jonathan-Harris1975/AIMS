# Podcast SEO Skill: Turing's Torch

Use this skill for the Jonathan Harris podcast pipeline only. It adapts generic podcast SEO guidance to the existing AIMS production flow, where the transcript is already published as HTML and links back to the audio version of the episode.

## Purpose

Turn each finished podcast episode into a stronger organic-search asset without weakening the audio pipeline or the Jonathan Harris brand voice.

This skill improves:

- episode title and description SEO
- episode keyword extraction
- transcript HTML metadata
- PodcastEpisode structured data
- RSS episode metadata quality
- future cross-linking between podcast, blog, newsletter and ebook/topic pages

## Correct pipeline position

Run podcast SEO after the final transcript and core metadata exist. Do not place this inside TTS chunking, SSML, audio editing, merging, intro logic or outro logic.

```text
Script generation
→ editorial pass
→ transcript saved
→ metadata generated
→ podcast SEO enrichment
→ transcript HTML generated
→ final podcast audio/meta updated
→ RSS publication
```

## Repository integration points

Primary production files:

- `services/script/utils/podcastHelper.js`
  - owns episode title, description, SEO keywords and artwork prompt
  - should encourage natural keyword use in title and description
  - must keep the no-hype Jonathan Harris tone

- `services/script/utils/generateTranscriptHtml.js`
  - owns transcript HTML page metadata
  - transcript page already links back to the audio episode
  - should use episode description, canonical URL and structured data

- `services/rss-feed-podcast/generateFeed.js`
  - maps stored episode metadata into RSS items
  - should preserve distinct links for episode page, audio enclosure and transcript HTML

- `services/rss-feed-podcast/xmlBuilder.js`
  - emits iTunes and Podcasting 2.0 fields
  - should not be used for broad copywriting logic

## Keyword policy

Keyword use is supportive, not spammy.

### Title

Where naturally possible, include one specific search phrase from the episode's actual subject matter.

Good title patterns:

- `Agentic AI, Dirty Data, and Governance Drift`
- `AI Models Meet the Benchmark Circus`
- `Workflow Automation Without the Fairy Dust`

Avoid:

- `AI Weekly`
- `Latest AI News`
- `Artificial Intelligence Trends`
- `This Week in AI`
- any title stuffed with repeated keywords

### Description

Episode descriptions should include 1 to 3 useful phrases where they read naturally, such as:

- artificial intelligence
- AI governance
- AI automation
- agentic AI
- AI models
- AI data governance
- AI podcast
- artificial intelligence news

The description still has to sound like Jonathan Harris: British, sceptical, practical, and readable by humans first.

## Metadata rules

Episode metadata must:

- mention Jonathan Harris once in the description
- describe what happened, what matters and what is probably noise
- avoid generic claims and hype words
- avoid raw URLs
- avoid mentioning RSS, transcripts, feeds, internal process or audio files inside the public description
- keep title length between 10 and 80 characters
- keep description length aligned to the planned runtime

## Transcript HTML rules

Transcript HTML pages are already valuable because they contain the full text and link back to the audio version. Do not duplicate that work elsewhere.

The transcript page should:

- use the episode description as the meta description source
- preserve canonical transcript URLs
- include Open Graph and Twitter metadata
- include PodcastEpisode JSON-LD where audio URL and episode metadata are available
- link back to the podcast hub, transcript archive, audio episode and newsletter
- avoid hiding the transcript from indexing

## Structured data rules

When generating JSON-LD, prefer bounded fields only:

- `PodcastEpisode.name`
- `PodcastEpisode.description`
- `PodcastEpisode.url`
- `PodcastEpisode.transcript`
- `PodcastEpisode.image`
- `PodcastEpisode.datePublished`
- `PodcastEpisode.duration`
- `PodcastEpisode.keywords`
- `PodcastEpisode.associatedMedia` as `AudioObject` only when a real audio URL is available
- `partOfSeries` set to Turing's Torch
- `author` set to Jonathan Harris

Do not invent guests, organisations, ratings, download counts, reviews or claims.

## Internal linking policy

Future linking should be evidence-led and safe:

- podcast transcript to podcast audio: already present
- podcast transcript to newsletter: allowed
- podcast transcript to podcast archive: allowed
- podcast or blog cross-links: only when the target URL is known and relevant
- ebook/topic links: only when the catalogue URL exists and the episode topic genuinely matches

## Fail-closed rules

Quarantine or fall back when:

- title is generic
- title contains `Episode`, emoji or noisy formatting
- description misses Jonathan Harris
- description contains raw URLs or internal process language
- metadata keywording reads like search-engine stuffing
- structured data would require invented facts
- canonical transcript/audio/episode URLs are ambiguous

## Output shape

A good podcast SEO enrichment sidecar can include:

```json
{
  "title": "",
  "description": "",
  "keywords": [],
  "seoKeywordCandidates": [],
  "episodeSlug": "",
  "transcriptHtmlUrl": "",
  "podcastUrl": "",
  "episodePageUrl": "",
  "schemaJsonLd": {}
}
```

This should remain a post-production enrichment layer, not a dependency that can break audio generation.
