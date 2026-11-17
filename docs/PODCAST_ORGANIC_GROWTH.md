# Podcast Organic Growth Evidence (free-only)

## Safety

Adds a read-only, deterministic public podcast search collector to authenticated AIMS ops.
No changes to RSS, PodSEO hopr.fm, podcast publishing, Zernio schedule, KDP pricing,
Headroom, model selection or advertising. No paid API and no additional AI inference.

## Ops endpoints

- GET /ops/podcast-growth/status : local readiness without external calls
- GET /ops/podcast-growth/latest : latest private snapshot or HTTP 404
- GET /ops/podcast-growth/book-sales-evidence : inspect downloaded KDP workbook availability; no invented royalty totals
- POST /ops/podcast-growth/snapshot : reuse a same-day successful/partial snapshot; unavailable days may retry

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

## Book sales source integrity

The authenticated, read-only book-sales evidence endpoint inspects the existing
private KDP R2 prefix reports/royalties/. A downloaded workbook with a metadata
sidecar may prove a royalty source exists, but the endpoint intentionally returns
null for actual sold units, royalties and sales attribution until a verified
parser and reconciliation are available. Missing workbooks are not zero sales.
This endpoint does not initiate KDP login, download, pricing or publishing.

Concurrent POST calls within one AIMS process share a single in-flight collection. The private dated snapshot limits sequential repeats across instances, but simultaneous first-time requests on different instances may still race; do not fire parallel cross-instance cron triggers.

KDP storage writes metadata beside each workbook using the existing convention workbook-key + .json. A missing sidecar is logged as partial source evidence. A null workbook count means storage was inaccessible (unknown), while zero means an accessible empty report prefix. Neither establishes sales volume.
