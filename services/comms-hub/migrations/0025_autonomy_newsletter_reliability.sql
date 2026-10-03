-- One current split per conversation, independent of repeated AI runs/retries.
CREATE TABLE IF NOT EXISTS comms_hub_autonomy_outcomes (
  conversation_id TEXT PRIMARY KEY REFERENCES comms_hub_conversations(id) ON DELETE CASCADE,
  channel TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('held_for_review','auto_sent')),
  reason TEXT,
  first_decided_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_autonomy_period ON comms_hub_autonomy_outcomes(first_decided_at, channel, outcome);

-- SMTP cannot guarantee exactly-once acceptance. Never replay an uncertain send.
CREATE TABLE IF NOT EXISTS newsletter_confirmation_deliveries (
  request_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK(status IN ('sending','sent','failed','reconciliation_required')),
  attempts INTEGER NOT NULL DEFAULT 1,
  retryable INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
