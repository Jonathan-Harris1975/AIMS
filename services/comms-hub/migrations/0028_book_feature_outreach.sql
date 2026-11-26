-- Book Feature Outreach owns its campaign state but shares the Comms Hub D1
-- suppression and conversation identity tables. All outbound operations remain
-- gated in application code and require a later separately reviewed release.
CREATE TABLE book_feature_configuration (
  singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
  mode TEXT NOT NULL DEFAULT 'assessment' CHECK(mode IN ('disabled','assessment','shadow','controlled_production','production','suspended')),
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1)
);
INSERT INTO book_feature_configuration (singleton,mode,updated_at,updated_by)
VALUES (1,'assessment',datetime('now'),'migration');

CREATE TABLE book_feature_campaigns (
  id TEXT PRIMARY KEY,
  iso_week TEXT NOT NULL UNIQUE,
  ebook_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  cover_url TEXT NOT NULL,
  manuscript_key TEXT NOT NULL,
  manuscript_sha256 TEXT,
  selection_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK(state IN ('selected','assessment','shadow','blocked','expired','suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE book_feature_occurrences (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES book_feature_campaigns(id),
  local_date TEXT NOT NULL,
  weekday TEXT NOT NULL CHECK(weekday IN ('Tue','Thu')),
  status TEXT NOT NULL CHECK(status IN ('leased','completed','completed_zero','blocked','failed')),
  lease_owner TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  report_key TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_book_feature_occurrence_status ON book_feature_occurrences(status,lease_expires_at);

CREATE TABLE book_feature_organisations (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  official_domain TEXT,
  identity_status TEXT NOT NULL CHECK(identity_status IN ('unverified','verified','obsolete','suppressed')),
  source_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_book_feature_org_domain ON book_feature_organisations(lower(official_domain)) WHERE official_domain IS NOT NULL;

CREATE TABLE book_feature_evidence (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES book_feature_campaigns(id),
  organisation_id TEXT REFERENCES book_feature_organisations(id),
  manuscript_sha256 TEXT NOT NULL,
  pdf_page INTEGER NOT NULL CHECK(pdf_page > 0),
  text_offset INTEGER NOT NULL CHECK(text_offset >= 0),
  passage TEXT NOT NULL,
  validation TEXT NOT NULL CHECK(validation IN ('candidate','validated','rejected')),
  evidence_class TEXT NOT NULL CHECK(evidence_class IN ('direct','inference')),
  created_at TEXT NOT NULL
);
CREATE INDEX idx_book_feature_evidence_campaign ON book_feature_evidence(campaign_id,pdf_page);

CREATE TABLE book_feature_opportunities (
  id TEXT PRIMARY KEY,
  campaign_id TEXT NOT NULL REFERENCES book_feature_campaigns(id),
  organisation_id TEXT NOT NULL REFERENCES book_feature_organisations(id),
  state TEXT NOT NULL CHECK(state IN ('discovered','validated','qualified','awaiting_contact','eligible','drafted','qa_passed','queued','sent','awaiting_reply','engaged','developing','outcome_verified','declined','suppressed','expired','blocked')),
  tier TEXT CHECK(tier IN ('A','B','C','D')),
  score INTEGER CHECK(score BETWEEN 0 AND 100),
  rubric_version TEXT,
  gate_json TEXT NOT NULL DEFAULT '{}',
  next_action_at TEXT,
  reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(campaign_id,organisation_id)
);
CREATE INDEX idx_book_feature_opportunity_state ON book_feature_opportunities(state,next_action_at);

CREATE TABLE book_feature_permissions (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL REFERENCES book_feature_organisations(id),
  statement TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  approver_identity TEXT NOT NULL,
  authority_evidence_key TEXT NOT NULL,
  approved_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  CHECK(expires_at IS NULL OR expires_at > approved_at)
);

CREATE TABLE book_feature_outbox (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL REFERENCES book_feature_opportunities(id),
  contact_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('queued','leased','accepted','delivered','unknown','bounced','cancelled','quarantined')),
  provider_message_id TEXT,
  lease_owner TEXT,
  lease_expires_at TEXT,
  not_before TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  qa_version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK(expires_at > not_before)
);
CREATE INDEX idx_book_feature_outbox_due ON book_feature_outbox(status,not_before,lease_expires_at);

CREATE TABLE book_feature_audit (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_book_feature_audit_entity ON book_feature_audit(entity_type,entity_id,created_at);
