PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comms_hub_channel_identities (
  id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  credential_family TEXT NOT NULL CHECK(credential_family IN ('meta', 'video')),
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'youtube')),
  account_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  provider_contact_id TEXT,
  username TEXT,
  display_name TEXT,
  avatar_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(contact_id) REFERENCES comms_hub_contacts(id),
  UNIQUE(provider, credential_family, platform, account_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_channel_identities_contact
  ON comms_hub_channel_identities(contact_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_social_threads (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  credential_family TEXT NOT NULL CHECK(credential_family IN ('meta', 'video')),
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'youtube')),
  thread_type TEXT NOT NULL CHECK(thread_type IN ('dm', 'comment')),
  account_id TEXT NOT NULL,
  provider_thread_id TEXT NOT NULL,
  provider_post_id TEXT,
  root_comment_id TEXT,
  participant_id TEXT,
  provider_status TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  UNIQUE(provider, credential_family, platform, thread_type, account_id, provider_thread_id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_social_threads_provider
  ON comms_hub_social_threads(credential_family, platform, account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_social_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  credential_family TEXT NOT NULL CHECK(credential_family IN ('meta', 'video')),
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'youtube')),
  provider_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conversation_id TEXT,
  message_id TEXT,
  correlation_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('webhook', 'poll')),
  received_at TEXT NOT NULL,
  processed_at TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(message_id) REFERENCES comms_hub_messages(id),
  UNIQUE(provider, credential_family, provider_event_id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_social_events_conversation
  ON comms_hub_social_events(conversation_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_comms_hub_social_events_type_time
  ON comms_hub_social_events(credential_family, platform, event_type, processed_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_social_poll_jobs (
  id TEXT PRIMARY KEY,
  credential_family TEXT NOT NULL CHECK(credential_family IN ('meta', 'video')),
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'youtube')),
  resource TEXT NOT NULL CHECK(resource IN ('conversations', 'comments')),
  cursor TEXT,
  cycle_started_at TEXT,
  last_success_at TEXT,
  next_attempt_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  failure_class TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(credential_family, platform, resource)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_social_poll_due
  ON comms_hub_social_poll_jobs(next_attempt_at, lease_expires_at, updated_at ASC);

CREATE TABLE IF NOT EXISTS comms_hub_social_outbound_actions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  conversation_id TEXT NOT NULL,
  credential_family TEXT NOT NULL CHECK(credential_family IN ('meta', 'video')),
  platform TEXT NOT NULL CHECK(platform IN ('facebook', 'instagram', 'youtube')),
  action_type TEXT NOT NULL,
  request_sha256 TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing', 'complete', 'failed', 'reconciliation_required')),
  provider_response_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts >= 1),
  failure_class TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_social_outbound_conversation
  ON comms_hub_social_outbound_actions(conversation_id, created_at DESC);

INSERT OR IGNORE INTO comms_hub_social_poll_jobs
  (id, credential_family, platform, resource, next_attempt_at, attempts, created_at, updated_at)
VALUES
  ('poll_meta_facebook_conversations', 'meta', 'facebook', 'conversations', '1970-01-01T00:00:00.000Z', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('poll_meta_instagram_conversations', 'meta', 'instagram', 'conversations', '1970-01-01T00:00:00.000Z', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('poll_meta_facebook_comments', 'meta', 'facebook', 'comments', '1970-01-01T00:00:00.000Z', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('poll_meta_instagram_comments', 'meta', 'instagram', 'comments', '1970-01-01T00:00:00.000Z', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z'),
  ('poll_video_youtube_comments', 'video', 'youtube', 'comments', '1970-01-01T00:00:00.000Z', 0, '1970-01-01T00:00:00.000Z', '1970-01-01T00:00:00.000Z');
