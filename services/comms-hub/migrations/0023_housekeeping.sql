PRAGMA foreign_keys = ON;

-- A conservative policy makes the retention worker useful on a fresh install
-- without destroying or anonymising customer data. Operators can replace or
-- disable it through the existing retention-policy API.
INSERT OR IGNORE INTO comms_hub_retention_policies (
  id, policy_key, channel, retain_days, action, legal_hold_tag, active,
  created_by, created_at, updated_at
) VALUES (
  'ret_baseline_archive_365', 'baseline_archive_365', 'any', 365, 'archive',
  NULL, 1, 'migration:0023', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comms_hub_housekeeping_runs (
  id TEXT PRIMARY KEY,
  window_key TEXT NOT NULL UNIQUE,
  run_type TEXT NOT NULL CHECK(run_type IN ('daily','monthly','quarantine_review','manual')),
  status TEXT NOT NULL CHECK(status IN ('running','complete','partial','failed')),
  dry_run INTEGER NOT NULL DEFAULT 0 CHECK(dry_run IN (0,1)),
  actor TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  stages_json TEXT NOT NULL DEFAULT '[]',
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_housekeeping_runs_started
  ON comms_hub_housekeeping_runs(run_type, started_at DESC);

-- Audit rows are archived as immutable, checksummed JSON before removal. The
-- checkpoint keeps the original hash chain verifiable across archive segments.
CREATE TABLE IF NOT EXISTS comms_hub_audit_archive_segments (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  first_event_id TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  first_occurred_at TEXT NOT NULL,
  last_occurred_at TEXT NOT NULL,
  first_previous_sha256 TEXT,
  last_chain_sha256 TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK(event_count >= 1),
  payload_sha256 TEXT NOT NULL UNIQUE,
  archived_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_audit_archive_checkpoint
  ON comms_hub_audit_archive_segments(last_occurred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_comms_hub_messages_email_uid
  ON comms_hub_messages(CAST(json_extract(metadata_json, '$.uid') AS INTEGER), received_at)
  WHERE direction = 'inbound' AND json_extract(metadata_json, '$.uid') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comms_hub_attachment_object_housekeeping
  ON comms_hub_attachment_objects(deleted_at, scan_status, stored_at);

CREATE INDEX IF NOT EXISTS idx_comms_hub_audit_archive_age
  ON comms_hub_audit_events(occurred_at ASC, id ASC);
