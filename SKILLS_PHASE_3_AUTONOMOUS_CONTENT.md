# Phase 3: automated brand-safe content pipeline

Phase 3 is configured as **auto-review, auto-publish, fail-closed**.

## Scope

The implementation covers:

- RSS article rewrites
- weekly blog generation
- daily social blog generation
- automated quality metadata
- R2 quarantine reports for failed content

## Gates

Content only publishes when it passes the Phase 3 gate bundle:

1. Brand tone
2. British English
3. Source integrity
4. SEO/GEO/AEO structure
5. Readability and TTS suitability
6. Image prompt safety/brand constraints
7. Social contract checks where relevant

## Fail-closed behaviour

Failed content is not published, not scheduled, not merged into manifests and not pushed into RSS feeds. Where R2 is available, the failed payload is written under:

```text
phase-3-quarantine/<content-type>/<timestamp>-<id>.json
```

## Environment controls

```bash
PHASE3_AUTOPUBLISH_MIN_SCORE=85
PHASE3_SOURCE_MIN_CHARS=180
PHASE3_MAX_SENTENCE_WORDS=34
PHASE3_MAX_PODCAST_SENTENCE_WORDS=26
```

## Important governance note

Phase 3 automation may publish source-backed content that passes the gates. It still may not change DNS, Cloudflare routing, paid service configuration, or mass-send outreach.
