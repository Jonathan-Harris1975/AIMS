PRAGMA foreign_keys = OFF;

-- Durable retry lane for a fresh social comment whose provider webhook omitted
-- the source-post text/title. The retry resolves post context before any reply
-- is generated, preserving forward-only social ingestion while avoiding a
-- one-shot provider lookup becoming a permanent automation gap.
CREATE TABLE comms_hub_delayed_actions_v6 (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('reminder','reply','reply_draft','email_reply','form_reply','recheck','sla_warning','sla_breach','retention','notification','attachment_ingest','outreach_follow_up','outreach_reply_process','content_automation','chat_ai_retry','social_context_retry')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scheduled','leased','complete','cancelled','failed','quarantined')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  max_attempts INTEGER NOT NULL DEFAULT 8 CHECK(max_attempts >= 1),
  idempotency_key TEXT NOT NULL UNIQUE,
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  failure_class TEXT,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);

INSERT INTO comms_hub_delayed_actions_v6 (
  id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
  idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
  created_by, created_at, updated_at, completed_at
)
SELECT id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
  idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
  created_by, created_at, updated_at, completed_at
FROM comms_hub_delayed_actions;

DROP TABLE comms_hub_delayed_actions;
ALTER TABLE comms_hub_delayed_actions_v6 RENAME TO comms_hub_delayed_actions;
CREATE INDEX idx_comms_hub_delayed_due ON comms_hub_delayed_actions(status, next_attempt_at, due_at, lease_expires_at);

PRAGMA foreign_keys = ON;
