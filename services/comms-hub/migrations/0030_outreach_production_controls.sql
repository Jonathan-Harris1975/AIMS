-- Durable, fail-closed controls for Book Feature controlled testing.
-- This migration is additive. Existing campaigns, suppression records and
-- communications remain untouched and outbound delivery stays disabled.

ALTER TABLE book_feature_configuration RENAME TO book_feature_configuration_legacy;
CREATE TABLE book_feature_configuration (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  mode TEXT NOT NULL DEFAULT 'assessment' CHECK(mode IN ('disabled','assessment','controlled_test','pilot','suspended')),
  kill_switch INTEGER NOT NULL DEFAULT 1 CHECK(kill_switch IN (0,1)),
  test_recipients_json TEXT NOT NULL DEFAULT '[]',
  per_run_cap INTEGER NOT NULL DEFAULT 1 CHECK(per_run_cap BETWEEN 1 AND 5),
  daily_cap INTEGER NOT NULL DEFAULT 1 CHECK(daily_cap BETWEEN 1 AND 10),
  approval_actor TEXT,
  approval_reason TEXT,
  approved_at TEXT,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);
INSERT INTO book_feature_configuration
  (singleton,mode,kill_switch,test_recipients_json,per_run_cap,daily_cap,updated_at,updated_by,version)
SELECT singleton,
  CASE WHEN mode IN ('disabled','suspended') THEN mode ELSE 'assessment' END,
  1,'[]',1,1,updated_at,'0030-safe-migration',version + 1
FROM book_feature_configuration_legacy;
DROP TABLE book_feature_configuration_legacy;

ALTER TABLE book_feature_organisations ADD COLUMN legal_name TEXT;
ALTER TABLE book_feature_organisations ADD COLUMN identity_evidence_key TEXT;
ALTER TABLE book_feature_organisations ADD COLUMN identity_expires_at TEXT;

ALTER TABLE book_feature_opportunities ADD COLUMN score_components_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE book_feature_opportunities ADD COLUMN evidence_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE book_feature_opportunities ADD COLUMN contact_id TEXT;

ALTER TABLE book_feature_outbox ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0);
ALTER TABLE book_feature_outbox ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3 CHECK(max_attempts BETWEEN 1 AND 5);
ALTER TABLE book_feature_outbox ADD COLUMN next_attempt_at TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN accepted_at TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN delivered_at TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN failure_class TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN last_error_code TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN subject TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN body_key TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN campaign_type TEXT NOT NULL DEFAULT 'book_feature';
ALTER TABLE book_feature_outbox ADD COLUMN delivery_recipient TEXT;
ALTER TABLE book_feature_outbox ADD COLUMN run_key TEXT;
CREATE INDEX idx_book_feature_outbox_run_key ON book_feature_outbox(run_key,status);

CREATE TABLE outreach_target_reservations (
  id TEXT PRIMARY KEY,
  target_key TEXT NOT NULL UNIQUE,
  campaign_type TEXT NOT NULL CHECK(campaign_type IN ('guest_article','book_feature')),
  opportunity_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','released','expired','suppressed')),
  reserved_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  released_at TEXT,
  reason TEXT,
  CHECK(expires_at > reserved_at)
);
CREATE INDEX idx_outreach_reservations_active ON outreach_target_reservations(status,expires_at);

CREATE TABLE book_feature_contacts (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES book_feature_organisations(id),
  email TEXT NOT NULL,
  normalised_email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL,
  recipient_type TEXT NOT NULL CHECK(recipient_type IN ('named_person','role_address')),
  source_url TEXT NOT NULL,
  source_title TEXT,
  validation_provider TEXT NOT NULL,
  validation_result TEXT NOT NULL CHECK(validation_result IN ('valid','invalid','unknown','risky')),
  validated_at TEXT NOT NULL,
  validation_expires_at TEXT NOT NULL,
  jurisdiction TEXT,
  lawful_basis TEXT,
  assessment_key TEXT,
  consent_status TEXT NOT NULL DEFAULT 'not_required' CHECK(consent_status IN ('confirmed','not_required','missing','revoked')),
  eligibility_status TEXT NOT NULL CHECK(eligibility_status IN ('eligible','ineligible','expired','unknown')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(validation_expires_at > validated_at)
);
CREATE INDEX idx_book_feature_contacts_org ON book_feature_contacts(organisation_id,eligibility_status);

CREATE TABLE book_feature_pitch_versions (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES book_feature_opportunities(id),
  version INTEGER NOT NULL CHECK(version > 0),
  subject TEXT NOT NULL,
  body_key TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  model_route TEXT NOT NULL,
  input_tokens INTEGER,
  output_tokens INTEGER,
  measured_cost_usd REAL,
  created_at TEXT NOT NULL,
  UNIQUE(opportunity_id,version)
);

CREATE TABLE book_feature_qa_reviews (
  id TEXT PRIMARY KEY,
  pitch_version_id TEXT NOT NULL REFERENCES book_feature_pitch_versions(id),
  rubric_version TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK(passed IN (0,1)),
  score INTEGER NOT NULL CHECK(score BETWEEN 0 AND 100),
  gates_json TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  reviewer_route TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_book_feature_qa_pitch ON book_feature_qa_reviews(pitch_version_id,created_at);

CREATE TABLE outreach_delivery_events (
  id TEXT PRIMARY KEY,
  outbox_id TEXT NOT NULL REFERENCES book_feature_outbox(id),
  provider_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL CHECK(event_type IN ('submitted','accepted','delivered','delayed','bounced','failed','unknown','reconciled')),
  provider_message_id TEXT,
  occurred_at TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_outreach_delivery_outbox ON outreach_delivery_events(outbox_id,occurred_at);

CREATE TABLE outreach_inbound_events (
  id TEXT PRIMARY KEY,
  provider_event_id TEXT NOT NULL UNIQUE,
  provider_message_id TEXT,
  opportunity_id TEXT REFERENCES book_feature_opportunities(id),
  contact_id TEXT,
  category TEXT NOT NULL CHECK(category IN ('positive','question','decline','opt_out','out_of_office','paid_placement','revision','publication','bounce','uncertain','malformed')),
  authenticated INTEGER NOT NULL CHECK(authenticated IN (0,1)),
  body_evidence_key TEXT,
  occurred_at TEXT NOT NULL,
  processed_at TEXT,
  action_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_outreach_inbound_opportunity ON outreach_inbound_events(opportunity_id,occurred_at);

CREATE TABLE outreach_cost_ledger (
  id TEXT PRIMARY KEY,
  campaign_type TEXT NOT NULL CHECK(campaign_type IN ('guest_article','book_feature')),
  campaign_id TEXT,
  opportunity_id TEXT,
  stage TEXT NOT NULL,
  provider TEXT NOT NULL,
  model_route TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  measured_cost_usd REAL,
  cost_status TEXT NOT NULL CHECK(cost_status IN ('measured','unreported','unavailable')),
  cache_status TEXT CHECK(cache_status IN ('hit','miss','not_applicable','unknown')),
  attempts INTEGER NOT NULL DEFAULT 1 CHECK(attempts > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_outreach_cost_campaign ON outreach_cost_ledger(campaign_type,campaign_id,created_at);
