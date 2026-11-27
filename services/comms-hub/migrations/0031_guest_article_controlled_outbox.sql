-- Separate Guest Article campaign queue, sharing the existing versioned Outreach
-- controlled-test configuration and handoff audit ledger. No live send is enabled.
CREATE TABLE guest_article_controlled_outbox (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL,
  opportunity_key TEXT NOT NULL UNIQUE,
  intended_email TEXT NOT NULL,
  official_domain TEXT NOT NULL,
  delivery_recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  qa_score REAL NOT NULL,
  qa_version TEXT NOT NULL,
  configuration_version INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  validation_expires_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','leased','accepted','delivered','unknown','bounced','cancelled','quarantined')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  provider_message_id TEXT,
  accepted_at TEXT,
  delivered_at TEXT,
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idx_guest_article_controlled_due ON guest_article_controlled_outbox(status,created_at);
CREATE UNIQUE INDEX idx_guest_article_controlled_provider ON guest_article_controlled_outbox(provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE guest_article_controlled_events (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES guest_article_controlled_outbox(id),
  category TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Existing queued items cannot inherit a new operator approval.
ALTER TABLE book_feature_outbox ADD COLUMN configuration_version INTEGER;
