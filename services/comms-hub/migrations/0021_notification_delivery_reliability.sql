PRAGMA foreign_keys = OFF;

-- Production notification contract and durable system-notification email delivery.
-- Preserve historical migration checksums; advance the schema with forward rebuilds.

-- Callback-email capture is a production path in humanContactService. Migration 0005
-- predates that alias type, so extend the contract without mutating migration history.
CREATE TABLE comms_hub_contact_aliases_v2 (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK(alias_type IN ('email','phone','social','form','chat','external','callback_email')),
  alias_value TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 1 CHECK(confidence >= 0 AND confidence <= 1),
  verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN (0,1)),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(contact_id) REFERENCES comms_hub_contacts(id),
  UNIQUE(alias_type, alias_value, provider)
);
INSERT INTO comms_hub_contact_aliases_v2
  (id, contact_id, alias_type, alias_value, provider, confidence, verified, active, created_at, updated_at, metadata_json)
SELECT id, contact_id, alias_type, alias_value, provider, confidence, verified, active, created_at, updated_at, metadata_json
  FROM comms_hub_contact_aliases;
DROP TABLE comms_hub_contact_aliases;
ALTER TABLE comms_hub_contact_aliases_v2 RENAME TO comms_hub_contact_aliases;
CREATE INDEX idx_comms_hub_alias_contact ON comms_hub_contact_aliases(contact_id, active, updated_at DESC);

CREATE TABLE comms_hub_notifications_v2 (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  conversation_id TEXT,
  type TEXT NOT NULL CHECK(type IN (
    'assignment','mention','escalation','sla_warning','sla_breach','failure','system',
    'human_handoff_requested','human_callback','content_quality_review'
  )),
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','dismissed','sent')),
  email_requested INTEGER NOT NULL DEFAULT 0 CHECK(email_requested IN (0,1)),
  email_delivery_status TEXT NOT NULL DEFAULT 'not_requested' CHECK(email_delivery_status IN (
    'not_requested','pending','sending','retry_pending','sent','reconciliation_required','quarantined'
  )),
  email_sent_at TEXT,
  email_provider_message_id TEXT,
  email_failure_class TEXT,
  email_error TEXT,
  email_last_attempt_at TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

INSERT INTO comms_hub_notifications_v2 (
  id, actor, conversation_id, type, title, body_text, severity, status,
  email_requested, email_delivery_status, email_sent_at, created_at, read_at, metadata_json
)
SELECT id, actor, conversation_id, type, title, body_text, severity, status,
       email_requested,
       CASE
         WHEN email_sent_at IS NOT NULL THEN 'sent'
         WHEN email_requested = 1 THEN 'pending'
         ELSE 'not_requested'
       END,
       email_sent_at, created_at, read_at, metadata_json
  FROM comms_hub_notifications;

DROP TABLE comms_hub_notifications;
ALTER TABLE comms_hub_notifications_v2 RENAME TO comms_hub_notifications;
CREATE INDEX idx_comms_hub_notifications_actor ON comms_hub_notifications(actor, status, created_at DESC);
CREATE INDEX idx_comms_hub_notifications_email_delivery ON comms_hub_notifications(email_delivery_status, created_at ASC);

-- Reuse the existing durable delayed-action lease/retry/quarantine architecture for
-- notification email. System notifications may not belong to a conversation, so
-- conversation_id becomes nullable while existing foreign-key semantics are retained.
CREATE TABLE comms_hub_delayed_actions_v7 (
  id TEXT PRIMARY KEY,
  conversation_id TEXT,
  action_type TEXT NOT NULL CHECK(action_type IN (
    'reminder','reply','reply_draft','email_reply','form_reply','recheck','sla_warning','sla_breach',
    'retention','notification','notification_email','attachment_ingest','outreach_follow_up',
    'outreach_reply_process','content_automation','chat_ai_retry','social_context_retry'
  )),
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

INSERT INTO comms_hub_delayed_actions_v7 (
  id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
  idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
  created_by, created_at, updated_at, completed_at
)
SELECT id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
       idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
       created_by, created_at, updated_at, completed_at
  FROM comms_hub_delayed_actions;

DROP TABLE comms_hub_delayed_actions;
ALTER TABLE comms_hub_delayed_actions_v7 RENAME TO comms_hub_delayed_actions;
CREATE INDEX idx_comms_hub_delayed_due ON comms_hub_delayed_actions(status, next_attempt_at, due_at, lease_expires_at);

-- Backfill durable work for notifications that requested email before this migration
-- but never recorded successful delivery. The idempotency key matches the runtime
-- contract so a subsequent application-level enqueue remains a no-op.
INSERT INTO comms_hub_delayed_actions (
  id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
  idempotency_key, lease_owner, lease_expires_at, next_attempt_at, failure_class, error,
  created_by, created_at, updated_at, completed_at
)
SELECT
  'delay_notification_email_' || id,
  NULL,
  'notification_email',
  json_object('notificationId', id),
  created_at,
  'scheduled',
  0,
  6,
  'notification-email:' || id,
  NULL,
  NULL,
  created_at,
  NULL,
  NULL,
  'migration:0021',
  created_at,
  created_at,
  NULL
FROM comms_hub_notifications
WHERE email_requested = 1
  AND email_sent_at IS NULL
ON CONFLICT(idempotency_key) DO NOTHING;

PRAGMA foreign_keys = ON;
