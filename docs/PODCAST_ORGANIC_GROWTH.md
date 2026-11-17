# Podcast Organic Growth Evidence (free-only)

## Safety

Adds a read-only, deterministic public podcast search collector to authenticated AIMS ops.
No changes to RSS, PodSEO hopr.fm, podcast publishing, Zernio schedule, KDP pricing,
Headroom, model selection or advertising. No paid API and no additional AI inference.

## Ops endpoints

- GET /ops/podcast-growth/status : local readiness without external calls
- GET /ops/podcast-growth/latest : latest private snapshot or HTTP 404
- POST /ops/podcast-growth/snapshot : collect search evidence once daily; repeats reuse existing data

The existing suite bearer-auth middleware protects all ops routes. Do not call
the collection endpoint from the public website.

Snapshots are kept in the private audits R2 bucket at:
- audits/podcast-growth/discovery/YYYY-MM-DD.json
- audits/podcast-growth/discovery/latest.json

The collector queries three terms against Apple's GB public iTunes Search API and
existing Podcast Index integration if credentials are present. Maximum five terms,
25 results per API sample, 3.2-second spacing between Apple queries, and 8-second
Apple request timeout. External source failures become explicit partial/unavailable
reports instead of zero ranking or invented reach.

## Interpretation

The ownPositionInSample field is a one-based index within the returned API
results. A null position means only that the show was not observed in that sample.
The Apple GB storefront is not proof of a UK listener or a ranking in Apple Podcasts,
Spotify, Amazon Music or any other in-app chart. Podcast Index search is not a chart.
The APIs do not expose private listening analytics or KDP royalties.

Continue using PodSEO Free as the primary podcast tracking tool and existing
first-party Apple, Spotify and YouTube dashboards where connected.
The endpoint is available on demand; no new production cron or publishing
job is introduced by this change. For weekly collection, first verify
deployment, rate limits and scheduler permissions.

Monthly content audits can use the latest dated snapshot as supplemental evidence
without blocking publication or treating absent snapshots as zero performance.
