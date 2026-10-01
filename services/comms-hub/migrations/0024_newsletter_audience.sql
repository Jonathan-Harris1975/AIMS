CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  email_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','unsubscribed','erased')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS newsletter_subscriptions (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','active','unsubscribed')),
  source TEXT NOT NULL,
  subscribed_at TEXT,
  unsubscribed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(subscriber_id, publication_id)
);
CREATE TABLE IF NOT EXISTS newsletter_consent_events (
  id TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL,
  publication_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  lawful_basis TEXT NOT NULL DEFAULT 'consent',
  purpose TEXT NOT NULL,
  consent_text_version TEXT NOT NULL,
  privacy_notice_version TEXT NOT NULL,
  source TEXT NOT NULL,
  source_reference TEXT,
  occurred_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_newsletter_consent_subscriber ON newsletter_consent_events(subscriber_id, occurred_at);
CREATE TABLE IF NOT EXISTS newsletter_suppressions (
  email_hash TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS newsletter_verification_tokens (
  token_hash TEXT PRIMARY KEY,
  subscriber_id TEXT NOT NULL REFERENCES newsletter_subscribers(id) ON DELETE CASCADE,
  publication_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose IN ('confirm','unsubscribe')),
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_newsletter_tokens_subscriber ON newsletter_verification_tokens(subscriber_id, purpose);
CREATE TABLE IF NOT EXISTS newsletter_delivery_recipients (
  issue_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed','reconciliation_required')),
  attempted_at TEXT,
  delivered_at TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  PRIMARY KEY(issue_id, subscriber_id)
);
