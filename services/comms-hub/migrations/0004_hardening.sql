PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comms_hub_provider_health (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  adapter TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('healthy', 'degraded', 'rate_limited', 'unavailable', 'unknown')),
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_status_code TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  observed_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_provider_health_latest
  ON comms_hub_provider_health(provider, adapter, observed_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_backup_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('exporting', 'archiving', 'complete', 'validating', 'validated', 'failed', 'quarantined')),
  source_database_id TEXT NOT NULL,
  restore_database_id TEXT,
  export_bookmark TEXT,
  export_sha256 TEXT,
  manifest_sha256 TEXT,
  r2_export_key TEXT,
  r2_manifest_key TEXT,
  linked_object_count INTEGER NOT NULL DEFAULT 0,
  validation_status TEXT,
  validation_details_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  validated_at TEXT,
  failure_class TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_backup_runs_started
  ON comms_hub_backup_runs(started_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_backup_objects (
  id TEXT PRIMARY KEY,
  backup_run_id TEXT NOT NULL,
  bucket_name TEXT NOT NULL,
  object_key TEXT NOT NULL,
  archive_object_key TEXT NOT NULL,
  size_bytes INTEGER,
  etag TEXT,
  sha256 TEXT,
  status TEXT NOT NULL CHECK(status IN ('recorded', 'verified', 'missing', 'mismatch')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(backup_run_id) REFERENCES comms_hub_backup_runs(id),
  UNIQUE(backup_run_id, bucket_name, object_key),
  UNIQUE(backup_run_id, archive_object_key)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_backup_objects_run
  ON comms_hub_backup_objects(backup_run_id, status);
