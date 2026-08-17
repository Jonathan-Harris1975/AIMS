-- Guest-article outreach automation state and delayed reply/revision actions.
CREATE TABLE IF NOT EXISTS comms_hub_outreach_targets (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  email TEXT NOT NULL,
  recipient_type TEXT NOT NULL DEFAULT 'unknown',
  state TEXT NOT NULL DEFAULT 'discovered',
  conversation_id TEXT,
  source_url TEXT,
  source_title TEXT,
  follow_up_count INTEGER NOT NULL DEFAULT 0 CHECK(follow_up_count >= 0),
  last_sent_at TEXT,
  last_reply_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_hub_outreach_target_email ON comms_hub_outreach_targets(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_comms_hub_outreach_target_state ON comms_hub_outreach_targets(state, updated_at);

CREATE TABLE IF NOT EXISTS comms_hub_outreach_suppression (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_outreach_suppression_email ON comms_hub_outreach_suppression(LOWER(email));
CREATE INDEX IF NOT EXISTS idx_comms_hub_outreach_suppression_domain ON comms_hub_outreach_suppression(LOWER(domain));

CREATE TABLE IF NOT EXISTS comms_hub_outreach_articles (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  word_count INTEGER NOT NULL DEFAULT 0 CHECK(word_count >= 0),
  review_score REAL,
  r2_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(target_id) REFERENCES comms_hub_outreach_targets(id),
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_hub_outreach_article_version ON comms_hub_outreach_articles(target_id, version);

-- SQLite CHECK constraints require a rebuild to add Outreach delayed actions.
CREATE TABLE comms_hub_delayed_actions_v3 (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('reminder','reply','reply_draft','email_reply','form_reply','recheck','sla_warning','sla_breach','retention','notification','attachment_ingest','outreach_follow_up','outreach_reply_process')),
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
INSERT INTO comms_hub_delayed_actions_v3 (
  id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
  idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
  created_by, created_at, updated_at, completed_at
)
SELECT id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
  idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
  created_by, created_at, updated_at, completed_at
FROM comms_hub_delayed_actions;
DROP TABLE comms_hub_delayed_actions;
ALTER TABLE comms_hub_delayed_actions_v3 RENAME TO comms_hub_delayed_actions;
CREATE INDEX idx_comms_hub_delayed_due ON comms_hub_delayed_actions(status, next_attempt_at, due_at, lease_expires_at);
