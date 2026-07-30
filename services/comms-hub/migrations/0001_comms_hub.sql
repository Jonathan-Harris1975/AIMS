PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comms_hub_contacts (
  id TEXT PRIMARY KEY,
  primary_email TEXT,
  display_name TEXT,
  phone TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_hub_contacts_email
  ON comms_hub_contacts(primary_email)
  WHERE primary_email IS NOT NULL AND primary_email <> '';

CREATE TABLE IF NOT EXISTS comms_hub_conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  workflow TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('open', 'pending', 'closed', 'quarantined')),
  contact_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  source_reference TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_message_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(contact_id) REFERENCES comms_hub_contacts(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_conversations_status_updated
  ON comms_hub_conversations(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_comms_hub_conversations_contact
  ON comms_hub_conversations(contact_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
  sender TEXT,
  recipients_json TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_text TEXT NOT NULL,
  body_html TEXT,
  provider_message_id TEXT NOT NULL UNIQUE,
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_messages_conversation_time
  ON comms_hub_messages(conversation_id, received_at ASC);

CREATE TABLE IF NOT EXISTS comms_hub_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_url TEXT NOT NULL,
  filename TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('reference_only', 'private_archived', 'failed', 'quarantined')),
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(message_id) REFERENCES comms_hub_messages(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_attachments_message
  ON comms_hub_attachments(message_id, created_at ASC);

CREATE TABLE IF NOT EXISTS comms_hub_intake_events (
  event_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  form_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  archive_status TEXT NOT NULL CHECK(archive_status IN ('pending', 'leased', 'complete', 'failed', 'quarantined')),
  archive_key TEXT NOT NULL,
  archive_attempts INTEGER NOT NULL DEFAULT 0 CHECK(archive_attempts >= 0),
  archive_next_attempt_at TEXT NOT NULL,
  archive_lease_owner TEXT,
  archive_lease_expires_at TEXT,
  archive_completed_at TEXT,
  archive_failure_class TEXT,
  archive_error TEXT,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  UNIQUE(provider, form_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_archive_queue
  ON comms_hub_intake_events(archive_status, archive_next_attempt_at, archive_lease_expires_at, processed_at ASC);

CREATE INDEX IF NOT EXISTS idx_comms_hub_intake_conversation
  ON comms_hub_intake_events(conversation_id, processed_at DESC);
