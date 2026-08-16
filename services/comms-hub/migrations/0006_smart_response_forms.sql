CREATE TABLE IF NOT EXISTS comms_hub_form_requests (
  id TEXT PRIMARY KEY,
  source_conversation_id TEXT NOT NULL,
  source_contact_id TEXT,
  form_key TEXT NOT NULL CHECK(form_key IN ('contact','case_study','podcast_enquiry')),
  form_id TEXT NOT NULL,
  form_url TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('sent','submitted','processed','replied','expired','cancelled')),
  reason TEXT,
  sent_via_channel TEXT NOT NULL,
  sent_draft_id TEXT,
  sent_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  submission_conversation_id TEXT,
  submission_id TEXT,
  submitted_at TEXT,
  match_method TEXT,
  processed_at TEXT,
  replied_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_conversation_id) REFERENCES comms_hub_conversations(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_form_requests_pending
  ON comms_hub_form_requests(form_id, status, expires_at, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_hub_form_requests_source
  ON comms_hub_form_requests(source_conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_comms_hub_form_requests_submission
  ON comms_hub_form_requests(submission_conversation_id, submitted_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_form_processing (
  conversation_id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  form_key TEXT NOT NULL CHECK(form_key IN ('contact','case_study','podcast_enquiry')),
  status TEXT NOT NULL CHECK(status IN ('digest_ready','processing','draft_ready','pending_approval','replied','review_required','failed')),
  matched_form_request_id TEXT,
  digest_json TEXT NOT NULL,
  ai_run_id TEXT,
  reply_draft_id TEXT,
  reply_sent_at TEXT,
  failure_class TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(matched_form_request_id) REFERENCES comms_hub_form_requests(id)
);
CREATE INDEX IF NOT EXISTS idx_comms_hub_form_processing_status
  ON comms_hub_form_processing(status, updated_at DESC);
