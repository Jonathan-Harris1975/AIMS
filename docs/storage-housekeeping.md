# Governed storage housekeeping

MAST runs `storage-housekeeping-weekly` on Sunday at **05:30 Europe/London**, with a twelve-hour catch-up window. AIMS accepts an asynchronous authenticated job and persists a private coverage report. No LLM or additional inference provider is used.

## Scope and retention

| Resource | Retention and cleanup |
| --- | --- |
| `metasystem` | Preserve counters, live state, credit ledgers and outreach progress. Archive dated spend reports after 365 days and newsletter shadow evaluations after 180 days; retain three recent representatives. Existing bounded lease expiry remains in place. |
| `comms-hub` | Preserve receipts and message references. Comms owns archive-only conversation retention. |
| `comms-hub-private` | Comms owns checksummed audit archival and restore-before-rotation backup retention. No generic age expiry for message history, consent or private attachments. |
| `hive` | Private archive destination. Preserve files, archive payloads and maintenance state. |
| `hive-repositories` | Preserve open reviews, incomplete evidence, repository data and current reports. Archive explicitly GREEN CI evidence bundles after 180 days and weekly reports after 730 days; retain three recent representatives per report class/repository. Broad raw-evidence expiry rules are disabled. |
| `kdp/research/` | Preserve weekly state, cooldown history, control files and all publication-intent/replay receipts. Archive completed historical weekly snapshots after 365 days and dated readiness reports after 180 days, retaining recent representatives. |
| `kdp/metadata/` | Preserve current metadata and references indefinitely. |
| `kdp/audit/` | Archive completed successful dated audit reports after 365 days; protect `latest.json`, its referenced report and recent representatives. |
| All non-KDP D1 databases | Discover and report every database. Required ecosystem databases must be visible before cleanup begins. Retain all verified/resolved incident parent receipts permanently to prevent replay; archive and prune only their finished history after 180 days. Protect active leases, unfinished/recent attempts, held/open/escalated incidents and RAMS hand-offs. |
| HIVE operational D1 | Archive cost telemetry after 365 days. Archive orphan file chunks only after 30 days and only while no file catalogue entry references them. Preserve conversations, messages, files, ecosystem metadata, drill probes and unclassified durable tables. |
| Comms D1 and isolated restore D1 | Delegate to the established daily/monthly Comms manager. Never janitor a restored copy as if it were the source database. |
| KDP D1 | Excluded by both database name and UUID, before queries or mutations. |

The other KDP folders and all other R2 buckets are outside scope. Failed uploads are aborted after seven days in the fully governed buckets; KDP's existing lifecycle configuration is left untouched.

## Safety and recovery

Each removal requires a private archive written with create-once semantics and verified by reading the stored bytes back and checking SHA-256. Archives are retained indefinitely in `hive/housekeeping/archives/`. Public access on the archive bucket causes the job to fail closed.

D1 archives contain the source database identity, table definitions and exact rows. Conditional SQL compares the parent and child snapshot before pruning history. Parent replay barriers are retained. Cost/chunk removal compares every captured field and rechecks the orphan condition. A concurrent change leaves the current record in place.

R2 deletion is restricted to old, explicitly classified terminal report keys. Mutable state, metadata and publication receipts cannot be selected. Latest-pointer targets are protected, and object ETags are checked after archival. R2 does not enforce S3 conditional deletion; the maintenance code does not pretend otherwise or apply a blanket TTL to mixed-use prefixes. HIVE report generation no longer deletes broad raw-evidence trees; this retention job owns their retirement.

One durable R2 lease fences overlapping jobs. Local leases are forbidden. Runs are bounded by time, inventory size, object size, rows and archive count. Partial runs remain retryable; completed weeks are deduplicated. An authorised manual run can set `force: true` to recheck the current week. Retaining data because it is current, referenced, unresolved or unclassified is an explicit policy outcome, not a cleanup failure.

## Operations

- `GET /storage/housekeeping/status`: current coverage, freshness and last live report; HTTP 503 when missing, failed or older than eight days.
- `POST /storage/housekeeping/run`: defaults to preview. A mutating run requires JSON `{"dryRun":false,"confirmation":"run-governed-storage-housekeeping"}`. String booleans are rejected.
- Poll the returned `statusUrl`; success requires the terminal result's `ok` flag, not just HTTP 202 or a completed job wrapper.
- Reports: `hive/housekeeping/reports/YYYY-MM-DD/<run-id>.json`; current live report: `hive/housekeeping/latest.json`; preview: `hive/housekeeping/latest-preview.json`.
- Archive lookup: recovery/cost/chunk archives are grouped by kind and D1 UUID; R2 archives are grouped by source bucket and SHA-256 of the original object key. Payload hashes are part of immutable archive keys.

For recovery, first restore into an isolated database or temporary object prefix. Verify the archive hash, schema and records; decode R2 payloads from base64 and restore their recorded content type/metadata. Compare with the live receipt or object before any deliberate production reconciliation. Never replace the live database with an old archive automatically.
