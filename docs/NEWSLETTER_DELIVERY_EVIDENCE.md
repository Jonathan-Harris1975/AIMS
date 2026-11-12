# Newsletter delivery evidence and monitoring

## Problem

On 12 November 2026 AIMS recorded SMTP acceptance for the monitoring subscriber, while the subscriber reported no copy in Gmail. The sender client had received one.com's final 250 response, but that response was discarded. The `sent`/`delivered_at` receipt meant submission acceptance. It could not establish remote handover or inbox placement. Only Info was polled for incoming mail, leaving Newsletter delivery reports unseen.

The supplied bounce subsequently established Gmail rejection `550 5.7.26`: SPF and DKIM did not pass. Cloudflare contained `v=spf1 include:_spf.one.com a mx ~all`, and no one.com DKIM selectors. At 13:41 UTC on 12 November, the SPF include was corrected in place to the provider-documented `_custspf.one.com`, preserving `a mx ~all`; the record TTL was set to 300 seconds. Google public DNS subsequently returned the corrected SPF record. Its `_custspf.one.com` include publishes `ip6:2a02:2350::/32`, covering the rejected sender address `2a02:2350:1f:125::1`; the old include did not cover that address. Other recursive caches may retain the old 3600-second TTL. DKIM requires the four domain-specific CNAME values from one.com support. Existing Mailchimp DKIM records and MX/DMARC records were left intact. A new send has not been used to claim successful Gmail receipt.

## Implemented requirements

| Requirement | Code behaviour |
| --- | --- |
| Preserve submission evidence | Store the final one.com SMTP response, Message-ID, acceptance timestamp and whether DSN was requested per recipient. The response may contain the provider's queue reference. |
| Request reports when supported | Newsletter sends request SUCCESS, FAILURE and DELAY reports with headers-only returns when one.com advertises the RFC 3461 DSN extension. Without the extension, normal SMTP submission continues. Other mail callers retain their existing behaviour. |
| Monitor the sending mailbox | A dedicated worker reads the existing Newsletter INBOX every five minutes through EXAMINE and BODY.PEEK. It runs outside business hours too. It does not import conversations, invoke models, reply, move or delete mail. |
| Match evidence precisely | Parse RFC 3464 multipart delivery reports and match both original Message-ID and recipient to exactly one stored submission. Retain action, enhanced status, diagnostic and reporting/remote MTA in D1. Subjects and human-readable prose cannot update receipts. |
| Keep honest states | `transport_status` records unknown, SMTP accepted, delay reported, failure reported or delivery reported. A relay report does not establish final delivery. `inboxConfirmed` stays false. |
| Handle uncertainty | After one hour, an issue with accepted submissions but no matched report creates one durable Comms Hub warning. Absence of a report is not a delivery failure. Matching failures/delays and unmatched/malformed reports create separate notices. Gmail 5.7.26 creates a specific SPF/DKIM authentication incident. |
| Detect monitor failures | Dedicated worker heartbeat, runtime start/stop wiring and independent GitHub worker-watch inventory detect missing, stale or disabled monitoring. Poll failures create an in-app incident. Alerts do not depend on successful email delivery. |
| Survive restarts | D1 UIDVALIDITY/cursor and a 15-minute mailbox lease protect concurrent pollers. A poll handles at most 25 messages. First activation/mailbox replacement inspects the latest 100 UID positions, then drains across polls. Cursor advances only after evidence and notices persist. Parsed unmatched reports are held in a private D1 correlation inbox for up to seven days; each poll rechecks up to 25, covering reports that arrived before acceptance persistence. |
| Prevent duplicates | Existing submission claims and sent receipts remain authoritative. Reported failure, timeout or uncertainty never automatically resends accepted mail or changes subscriber consent/suppression. |

DSNs are reports, not authenticated proof of inbox placement. Exact matching prevents accidental attribution, but does not make a forged report trustworthy. Reports only change descriptive transport evidence; they cannot trigger mail, suppression, account changes or content publication.

## Operator visibility

`GET /newsletter/campaigns/:campaignId/status` retains legacy submission counts and adds `transportCounts`, `deliveryMonitor.lastSuccessAt`, `deliveryAssurance` and `inboxConfirmed: false`. The existing authenticated Comms Hub notifications show warning/failure incidents. `/comms-hub/workers/health` includes `newsletter_delivery:default`, covered by the independent worker watch.

The legacy `status=sent` and `delivered_at` fields remain submission receipts for compatibility and duplicate prevention. Historic rows begin with `transport_status=unknown`; no SMTP responses or remote delivery evidence are invented for old sends. Today's missing message therefore still needs a one.com trace or a matched bounce.

## Configuration and rollout acceptance

Migration `0026_newsletter_delivery_evidence` is required by the existing migration manifest and automatic schema recovery. Production defaults enable monitoring with the existing `ONECOM_NEWSLETTER_PASSWORD`. `NEWSLETTER_DELIVERY_MONITOR_POLL_MS` defaults to 300000; `NEWSLETTER_DELIVERY_UNCONFIRMED_MS` defaults to 3600000. No new model calls or provider key are needed.

After release, verify the deployed revision and applied migration; confirm the Newsletter IMAP poll and dedicated heartbeat are fresh. Inspect initial backfill results and notices. On the next normal send, verify that its actual SMTP response and DSN capability result are saved. Do not replay the campaign to test this. The code/CI tests are not a substitute for these production checks.

Provider attribution remains evidence-based: use saved queue references and Message-ID to obtain one.com's trace, inspect the remote SMTP response and compare it with any DSN. The `reporting_mta`/`remote_mta` fields are reported server names, not independently verified assertions.

## Remaining requirement for end-to-end Gmail confirmation

A read-only, authorised connection to the monitoring Gmail mailbox is required to observe the actual message by Message-ID and record its arrival/folder. This change does not have that access and does not claim inbox verification. A provider trace is required when neither a report nor recipient-side evidence explains the missing copy. These gaps remain explicit rather than being labelled successful delivery.

Protocol references: RFC 3461 (SMTP DSN extension), RFC 3464 (delivery report format).

Provider DNS instructions: https://help.one.com/hc/en-us/articles/17038200070545-Why-do-my-emails-end-up-in-spam-when-using-external-name-servers
