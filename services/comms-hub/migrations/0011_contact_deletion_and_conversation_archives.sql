PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comms_hub_conversation_archives (
  conversation_id TEXT PRIMARY KEY,
  contact_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  provider TEXT NOT NULL,
  workflow TEXT NOT NULL,
  subject TEXT NOT NULL,
  closed_at TEXT NOT NULL,
  archived_at TEXT NOT NULL,
  snapshot_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_conversation_archives_time
  ON comms_hub_conversation_archives(archived_at DESC, closed_at DESC);

CREATE INDEX IF NOT EXISTS idx_comms_hub_conversation_archives_contact
  ON comms_hub_conversation_archives(contact_id, archived_at DESC);
