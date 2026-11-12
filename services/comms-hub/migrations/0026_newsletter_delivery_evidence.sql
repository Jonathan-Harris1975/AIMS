-- Legacy status=sent and delivered_at mean SMTP submission, not inbox receipt.
ALTER TABLE newsletter_delivery_recipients ADD COLUMN smtp_response TEXT;
ALTER TABLE newsletter_delivery_recipients ADD COLUMN smtp_dsn_requested INTEGER NOT NULL DEFAULT 0 CHECK(smtp_dsn_requested IN (0,1));
ALTER TABLE newsletter_delivery_recipients ADD COLUMN smtp_accepted_at TEXT;
ALTER TABLE newsletter_delivery_recipients ADD COLUMN transport_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK(transport_status IN ('unknown','smtp_accepted','delay_reported','failure_reported','delivery_reported'));
ALTER TABLE newsletter_delivery_recipients ADD COLUMN transport_updated_at TEXT;
CREATE INDEX idx_newsletter_delivery_message ON newsletter_delivery_recipients(provider_message_id);
CREATE INDEX idx_newsletter_delivery_attempt ON newsletter_delivery_recipients(status,attempted_at);
CREATE TABLE newsletter_delivery_reports (
  report_id TEXT NOT NULL,
  issue_id TEXT NOT NULL,
  subscriber_id TEXT NOT NULL,
  action TEXT NOT NULL,
  enhanced_status TEXT NOT NULL,
  diagnostic TEXT,
  reporting_mta TEXT,
  remote_mta TEXT,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(report_id,issue_id,subscriber_id)
);
CREATE TABLE newsletter_delivery_monitor_state (
  mailbox TEXT PRIMARY KEY,
  uid_validity INTEGER,
  last_uid INTEGER NOT NULL DEFAULT 0,
  last_success_at TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT
);
-- Reports can arrive before SMTP acceptance has been persisted. Retain them
-- for bounded later reconciliation instead of losing them behind the IMAP cursor.
CREATE TABLE newsletter_delivery_report_inbox (
  report_id TEXT PRIMARY KEY,
  report_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  matched_at TEXT
);
CREATE INDEX idx_newsletter_report_pending ON newsletter_delivery_report_inbox(matched_at,last_attempt_at);
