# Koyeb blog-social and podcast fixes

## Findings

### Blog social
The 12 June 2026 Koyeb run returned from `blog.social.daily.build` in roughly one second, before any AI generation or artwork work began. The duplicate check used `published_at` as a fallback content date. A post for content date `2026-06-10`, created on `2026-06-11`, could therefore block the next run for content date `2026-06-11`.

Fixes:
- Duplicate detection now uses the deterministic daily ID, `date_label`, or date-prefixed slug.
- It no longer treats the later publication timestamp as the content date.
- Skip paths now log an info-level reason visible in normal Koyeb production logs.
- Generic async completion logs now expose `outcome`, `skipped`, `quarantined`, and `reason`.

### Podcast
The podcast generated its script successfully, but initial structure validation rejected the valid phrase `a.m. to` as a broken lowercase punctuation join. Because the same validation also found long spoken sentences, the false punctuation error prevented the existing formatting and sentence-splitting repair pass from running.

Fixes:
- `a.m.` and `p.m.` are accepted abbreviations in the punctuation-join validator.
- A regression test protects both forms.

## Secondary observation
The podcast loaded 34 feed items and made 37 model calls. This was not the direct failure, but it makes the run slow and increases synthesis size. No article-selection or batching behaviour was changed in this repair package.

## Validation
- `npm run build`: passed.
- Repository smoke/test command: passed.
- Focused blog-social and script-validation tests: 13 passed, 0 failed.

## Recommended production reruns after deployment
- Rebuild the missed social post with body: `{ "date": "2026-06-11", "days": 1, "force": true }`.
- Rerun the podcast using the normal scheduled session ID or a fresh session ID.
