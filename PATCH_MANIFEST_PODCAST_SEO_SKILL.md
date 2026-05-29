# Podcast SEO Skill Patch

## Purpose

Adapt the generic podcast SEO skill to the existing Turing's Torch AIMS podcast setup.

## Changes

- Added `.agents/skills/podcast-seo/SKILL.md` as the Jonathan Harris podcast SEO operating guide.
- Registered `podcast-seo` as Phase 5D organic enrichment in `.agents/phase-5-skills.json`.
- Updated the Phase 5 skill pack to include podcast SEO as a post-production enhancement.
- Updated podcast metadata generation to detect topic-based SEO keyword candidates from the main content.
- Updated the title/description prompt so suitable keywords can appear naturally in the episode title and description.
- Updated keyword generation so it uses title, description and main-content context, not description alone.
- Stored `seoKeywordCandidates` in podcast metadata for auditability and later reuse.
- Updated transcript HTML output to use the episode description for page metadata and social previews.
- Added bounded `PodcastEpisode` JSON-LD to transcript HTML when metadata is available.
- Added tests for podcast SEO metadata, transcript structured data and Phase 5 skill registration.

## Safety notes

- No TTS, SSML, audio editing, merge processing, intro or outro code was changed.
- Transcript HTML already links back to the audio version, so this patch enriches metadata rather than duplicating audio links elsewhere.
- Keyword handling is supportive only and fails back to existing branded metadata if generated metadata becomes generic or off-brand.
