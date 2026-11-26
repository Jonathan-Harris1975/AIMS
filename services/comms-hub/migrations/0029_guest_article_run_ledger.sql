-- Durable identity and lease for each authorised Guest Article local-date run.
-- MAST remains the sole scheduler; this ledger fences duplicate or overlapping
-- triggers in AIMS and supports bounded recovery after a process restart.
CREATE TABLE comms_hub_guest_article_runs (
  occurrence_id TEXT PRIMARY KEY,
  local_date TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('leased','completed','completed_zero','blocked','failed')),
  trigger_run_key TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0 AND attempts <= 3),
  result_json TEXT,
  error_code TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_guest_article_run_lease ON comms_hub_guest_article_runs(status,lease_expires_at);
