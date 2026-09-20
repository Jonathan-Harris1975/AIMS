-- Durable background-worker heartbeat state.
-- One row per worker category/key/process instance keeps multi-instance and restart
-- activity observable without persisting message content, identities or secrets.
CREATE TABLE IF NOT EXISTS comms_hub_worker_heartbeats (
  worker_category TEXT NOT NULL,
  worker_key TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
  poll_interval_ms INTEGER NOT NULL CHECK(poll_interval_ms >= 0),
  registered_at TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  last_error_code TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(worker_category, worker_key, instance_id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_worker_heartbeat_freshness
  ON comms_hub_worker_heartbeats(worker_category, worker_key, enabled, last_success_at DESC, updated_at DESC);
