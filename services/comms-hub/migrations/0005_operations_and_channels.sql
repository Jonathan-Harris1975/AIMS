PRAGMA foreign_keys = ON;

-- Expand the Phase 1 attachment lifecycle before adding private object storage.
-- Migration 0005 is applied once by the migration ledger, so this rebuild is
-- deterministic for both existing Phase 1/2 databases and fresh installs.
ALTER TABLE comms_hub_attachments RENAME TO comms_hub_attachments_legacy;
DROP INDEX IF EXISTS idx_comms_hub_attachments_message;
CREATE TABLE comms_hub_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reference_only','pending','stored','private_archived','failed','quarantined','deleted')),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(message_id) REFERENCES comms_hub_messages(id)
);
INSERT INTO comms_hub_attachments
  (id, message_id, provider, provider_url, filename, status, created_at, metadata_json)
SELECT id, message_id, provider, provider_url, filename, status, created_at, metadata_json
  FROM comms_hub_attachments_legacy;
DROP TABLE comms_hub_attachments_legacy;
CREATE INDEX idx_comms_hub_attachments_message
  ON comms_hub_attachments(message_id, created_at ASC);

CREATE TABLE IF NOT EXISTS comms_hub_conversation_operations (
  conversation_id TEXT PRIMARY KEY,
  operational_status TEXT NOT NULL DEFAULT 'open' CHECK(operational_status IN ('open','pending','snoozed','resolved','blocked','quarantined','archived','escalated')),
  owner_type TEXT CHECK(owner_type IS NULL OR owner_type IN ('person','team','automation')),
  owner_id TEXT,
  team_id TEXT,
  snoozed_until TEXT,
  response_due_at TEXT,
  resolution_due_at TEXT,
  first_response_at TEXT,
  resolved_at TEXT,
  escalation_level TEXT CHECK(escalation_level IS NULL OR escalation_level IN ('normal','high','critical')),
  escalation_reason TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_ops_queue ON comms_hub_conversation_operations(operational_status, response_due_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_comms_hub_ops_owner ON comms_hub_conversation_operations(owner_type, owner_id, operational_status);

CREATE TABLE IF NOT EXISTS comms_hub_contact_aliases (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  alias_type TEXT NOT NULL CHECK(alias_type IN ('email','phone','social','form','chat','external')),
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
CREATE INDEX IF NOT EXISTS idx_comms_hub_alias_contact ON comms_hub_contact_aliases(contact_id, active, updated_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_identity_links (
  id TEXT PRIMARY KEY,
  source_contact_id TEXT NOT NULL,
  target_contact_id TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
  status TEXT NOT NULL CHECK(status IN ('proposed','approved','rejected','reversed')),
  reason TEXT NOT NULL,
  proposed_by TEXT NOT NULL,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT,
  reversed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(source_contact_id) REFERENCES comms_hub_contacts(id),
  FOREIGN KEY(target_contact_id) REFERENCES comms_hub_contacts(id),
  CHECK(source_contact_id <> target_contact_id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_identity_links_status ON comms_hub_identity_links(status, created_at);

CREATE TABLE IF NOT EXISTS comms_hub_tags (
  id TEXT PRIMARY KEY,
  tag_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);
CREATE TABLE IF NOT EXISTS comms_hub_conversation_tags (
  conversation_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  applied_by TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  PRIMARY KEY(conversation_id, tag_id),
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(tag_id) REFERENCES comms_hub_tags(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_conversation_tags_tag ON comms_hub_conversation_tags(tag_id, applied_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_internal_notes (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  body_text TEXT NOT NULL CHECK(length(body_text) BETWEEN 1 AND 10000),
  author TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_notes_conversation ON comms_hub_internal_notes(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_mentions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  note_id TEXT,
  mentioned_actor TEXT NOT NULL,
  mentioned_by TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','dismissed')),
  created_at TEXT NOT NULL,
  read_at TEXT,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(note_id) REFERENCES comms_hub_internal_notes(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_mentions_actor ON comms_hub_mentions(mentioned_actor, status, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_saved_replies (
  id TEXT PRIMARY KEY,
  reply_key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'any',
  body_template TEXT NOT NULL CHECK(length(body_template) BETWEEN 1 AND 20000),
  variables_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1))
);

CREATE TABLE IF NOT EXISTS comms_hub_attachment_objects (
  id TEXT PRIMARY KEY,
  attachment_id TEXT NOT NULL UNIQUE,
  bucket_name TEXT NOT NULL,
  object_key TEXT NOT NULL UNIQUE,
  sha256 TEXT NOT NULL,
  size_bytes INTEGER NOT NULL CHECK(size_bytes >= 0),
  content_type TEXT NOT NULL,
  scan_status TEXT NOT NULL CHECK(scan_status IN ('pending','clean','infected','failed','quarantined')),
  scan_provider TEXT,
  scan_reference TEXT,
  scanned_at TEXT,
  stored_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(attachment_id) REFERENCES comms_hub_attachments(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_attachment_scan ON comms_hub_attachment_objects(scan_status, stored_at);

CREATE TABLE IF NOT EXISTS comms_hub_webhook_nonces (
  source TEXT NOT NULL,
  nonce TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY(source, nonce)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_webhook_nonce_expiry ON comms_hub_webhook_nonces(expires_at);

CREATE TABLE IF NOT EXISTS comms_hub_audit_events (
  id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  actor TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  conversation_id TEXT,
  request_id TEXT,
  outcome TEXT NOT NULL CHECK(outcome IN ('success','denied','failed')),
  before_sha256 TEXT,
  after_sha256 TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  chain_previous_sha256 TEXT,
  chain_sha256 TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_audit_conversation ON comms_hub_audit_events(conversation_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_hub_audit_object ON comms_hub_audit_events(object_type, object_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_workflow_definitions (
  id TEXT PRIMARY KEY,
  workflow_key TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version >= 1),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft','active','retired')),
  definition_json TEXT NOT NULL,
  definition_sha256 TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  retired_at TEXT,
  UNIQUE(workflow_key, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_hub_workflow_active ON comms_hub_workflow_definitions(workflow_key) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS comms_hub_routing_rules (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  priority INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL CHECK(status IN ('draft','active','disabled')),
  conditions_json TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  stop_processing INTEGER NOT NULL DEFAULT 0 CHECK(stop_processing IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_rules_active ON comms_hub_routing_rules(status, priority, updated_at);

CREATE TABLE IF NOT EXISTS comms_hub_delayed_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK(action_type IN ('reminder','reply','recheck','sla_warning','sla_breach','retention','notification','attachment_ingest')),
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
CREATE INDEX IF NOT EXISTS idx_comms_hub_delayed_due ON comms_hub_delayed_actions(status, next_attempt_at, due_at, lease_expires_at);

CREATE TABLE IF NOT EXISTS comms_hub_escalations (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('legal','safety','abuse','payment','media','high_value','security','other')),
  severity TEXT NOT NULL CHECK(severity IN ('high','critical')),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open','acknowledged','resolved','dismissed')),
  assigned_to TEXT,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  acknowledged_at TEXT,
  resolved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_escalations_open ON comms_hub_escalations(status, severity, created_at);

CREATE TABLE IF NOT EXISTS comms_hub_sla_policies (
  id TEXT PRIMARY KEY,
  policy_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'any',
  priority_label TEXT NOT NULL DEFAULT 'any',
  first_response_minutes INTEGER NOT NULL CHECK(first_response_minutes >= 1),
  resolution_minutes INTEGER NOT NULL CHECK(resolution_minutes >= 1),
  business_hours_json TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comms_hub_autonomous_reply_policies (
  id TEXT PRIMARY KEY,
  policy_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL,
  intent TEXT NOT NULL,
  maximum_risk REAL NOT NULL CHECK(maximum_risk >= 0 AND maximum_risk <= 1),
  minimum_confidence REAL NOT NULL CHECK(minimum_confidence >= 0 AND minimum_confidence <= 1),
  require_evidence INTEGER NOT NULL DEFAULT 1 CHECK(require_evidence IN (0,1)),
  allowed_hours_json TEXT NOT NULL DEFAULT '{}',
  maximum_per_hour INTEGER NOT NULL DEFAULT 5 CHECK(maximum_per_hour >= 1),
  status TEXT NOT NULL CHECK(status IN ('draft','active','disabled')),
  created_by TEXT NOT NULL,
  approved_by TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS comms_hub_retention_policies (
  id TEXT PRIMARY KEY,
  policy_key TEXT NOT NULL UNIQUE,
  channel TEXT NOT NULL DEFAULT 'any',
  retain_days INTEGER NOT NULL CHECK(retain_days >= 1),
  action TEXT NOT NULL CHECK(action IN ('archive','anonymise','delete')),
  legal_hold_tag TEXT,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS comms_hub_retention_jobs (
  id TEXT PRIMARY KEY,
  policy_id TEXT,
  contact_id TEXT,
  conversation_id TEXT,
  action TEXT NOT NULL CHECK(action IN ('export','archive','anonymise','delete')),
  status TEXT NOT NULL CHECK(status IN ('pending','processing','complete','failed','quarantined')),
  export_object_key TEXT,
  requested_by TEXT NOT NULL,
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(policy_id) REFERENCES comms_hub_retention_policies(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_retention_jobs ON comms_hub_retention_jobs(status, requested_at);

CREATE TABLE IF NOT EXISTS comms_hub_quarantine_items (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  conversation_id TEXT,
  failure_class TEXT NOT NULL CHECK(failure_class IN ('temporary','recoverable','permanent')),
  status TEXT NOT NULL CHECK(status IN ('quarantined','replay_pending','replayed','resolved','dismissed')),
  payload_reference TEXT,
  error_code TEXT,
  error_message TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE(source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_quarantine_status ON comms_hub_quarantine_items(status, failure_class, created_at);
CREATE TABLE IF NOT EXISTS comms_hub_quarantine_attempts (
  id TEXT PRIMARY KEY,
  quarantine_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL CHECK(attempt_number >= 1),
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('started','success','failed','blocked')),
  detail TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY(quarantine_id) REFERENCES comms_hub_quarantine_items(id),
  UNIQUE(quarantine_id, attempt_number)
);

CREATE TABLE IF NOT EXISTS comms_hub_notifications (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  conversation_id TEXT,
  type TEXT NOT NULL CHECK(type IN ('assignment','mention','escalation','sla_warning','sla_breach','failure','system')),
  title TEXT NOT NULL,
  body_text TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read','dismissed','sent')),
  email_requested INTEGER NOT NULL DEFAULT 0 CHECK(email_requested IN (0,1)),
  email_sent_at TEXT,
  created_at TEXT NOT NULL,
  read_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_notifications_actor ON comms_hub_notifications(actor, status, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_email_threads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  account_key TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  provider_thread_key TEXT NOT NULL,
  internet_message_id TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  last_uid INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  UNIQUE(account_key, mailbox, provider_thread_key)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_email_thread_message ON comms_hub_email_threads(internet_message_id);

CREATE TABLE IF NOT EXISTS comms_hub_chat_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  website_id TEXT NOT NULL,
  visitor_id TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'automation' CHECK(mode IN ('automation','takeover_requested','human','closed')),
  assigned_actor TEXT,
  takeover_requested_at TEXT,
  takeover_started_at TEXT,
  takeover_ended_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  UNIQUE(provider, website_id, provider_session_id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_chat_mode ON comms_hub_chat_sessions(mode, updated_at);

CREATE TABLE IF NOT EXISTS comms_hub_credentials (
  id TEXT PRIMARY KEY,
  credential_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  credential_type TEXT NOT NULL CHECK(credential_type IN ('password','api_key','oauth')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  disabled_at TEXT
);
CREATE TABLE IF NOT EXISTS comms_hub_oauth_tokens (
  credential_id TEXT PRIMARY KEY,
  access_ciphertext TEXT NOT NULL,
  access_iv TEXT NOT NULL,
  access_auth_tag TEXT NOT NULL,
  refresh_ciphertext TEXT,
  refresh_iv TEXT,
  refresh_auth_tag TEXT,
  token_type TEXT NOT NULL DEFAULT 'Bearer',
  scopes_json TEXT NOT NULL DEFAULT '[]',
  expires_at TEXT,
  refreshed_at TEXT,
  FOREIGN KEY(credential_id) REFERENCES comms_hub_credentials(id)
);

CREATE TABLE IF NOT EXISTS comms_hub_search_documents (
  id TEXT PRIMARY KEY,
  object_type TEXT NOT NULL CHECK(object_type IN ('contact','conversation','message','attachment','note')),
  object_id TEXT NOT NULL,
  conversation_id TEXT,
  contact_id TEXT,
  channel TEXT,
  searchable_text TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  UNIQUE(object_type, object_id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_search_scope ON comms_hub_search_documents(object_type, channel, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_hub_search_conversation ON comms_hub_search_documents(conversation_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_metrics_snapshots (
  id TEXT PRIMARY KEY,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  channel TEXT NOT NULL DEFAULT 'all',
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(period_start, period_end, channel)
);

CREATE TABLE IF NOT EXISTS comms_hub_channel_outbound_actions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK(channel IN ('email','chat','form','social')),
  action_type TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing','complete','failed','reconciliation_required','quarantined')),
  provider_message_id TEXT,
  provider_response_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts >= 1),
  failure_class TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_channel_outbound_conversation ON comms_hub_channel_outbound_actions(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_email_poll_state (
  account_key TEXT NOT NULL,
  mailbox TEXT NOT NULL,
  last_uid INTEGER NOT NULL DEFAULT 0 CHECK(last_uid >= 0),
  uid_validity INTEGER,
  last_success_at TEXT,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  failure_class TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(account_key, mailbox)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_email_poll_due ON comms_hub_email_poll_state(next_attempt_at, lease_expires_at);
