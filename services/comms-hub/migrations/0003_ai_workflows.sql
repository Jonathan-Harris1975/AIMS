PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS comms_hub_ai_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('processing', 'complete', 'failed', 'quarantined')),
  intent TEXT,
  intent_confidence REAL,
  selected_workflow TEXT,
  workflow_mismatch INTEGER CHECK(workflow_mismatch IN (0, 1)),
  urgency REAL,
  commercial_value REAL,
  reputational_risk REAL,
  customer_impact REAL,
  priority_score INTEGER,
  priority_label TEXT,
  priority_factors_json TEXT NOT NULL DEFAULT '{}',
  priority_override_reasons_json TEXT NOT NULL DEFAULT '[]',
  sentiment TEXT,
  abuse_label TEXT,
  risk_level TEXT,
  provider TEXT,
  model TEXT,
  prompt_sha256 TEXT,
  response_sha256 TEXT,
  rationale TEXT,
  error TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_ai_runs_conversation
  ON comms_hub_ai_runs(conversation_id, started_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_conversation_state (
  conversation_id TEXT PRIMARY KEY,
  intent TEXT NOT NULL,
  intent_confidence REAL NOT NULL,
  selected_workflow TEXT NOT NULL,
  workflow_mismatch INTEGER NOT NULL DEFAULT 0 CHECK(workflow_mismatch IN (0, 1)),
  priority_score INTEGER NOT NULL,
  priority_label TEXT NOT NULL,
  priority_factors_json TEXT NOT NULL,
  priority_override_reasons_json TEXT NOT NULL,
  priority_overridden INTEGER NOT NULL DEFAULT 0 CHECK(priority_overridden IN (0, 1)),
  priority_override_reason TEXT,
  priority_overridden_by TEXT,
  priority_overridden_at TEXT,
  queue_key TEXT NOT NULL DEFAULT 'standard',
  escalation_required INTEGER NOT NULL DEFAULT 0 CHECK(escalation_required IN (0, 1)),
  sentiment TEXT NOT NULL,
  abuse_label TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  unresolved_actions_json TEXT NOT NULL,
  source_message_ids_json TEXT NOT NULL,
  source_links_json TEXT NOT NULL,
  next_action TEXT,
  last_ai_run_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(last_ai_run_id) REFERENCES comms_hub_ai_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_conversation_state_queue
  ON comms_hub_conversation_state(queue_key, priority_score DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS comms_hub_priority_overrides (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  previous_score INTEGER NOT NULL,
  previous_label TEXT NOT NULL,
  override_score INTEGER NOT NULL,
  override_label TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0, 1)),
  created_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_priority_overrides_conversation
  ON comms_hub_priority_overrides(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_ai_evidence (
  id TEXT PRIMARY KEY,
  ai_run_id TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  index_id TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  title TEXT,
  excerpt TEXT NOT NULL,
  relevance_score REAL,
  content_sha256 TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(ai_run_id) REFERENCES comms_hub_ai_runs(id),
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  UNIQUE(ai_run_id, source_reference, content_sha256)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_ai_evidence_conversation
  ON comms_hub_ai_evidence(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_approvals (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('reply_draft', 'moderation_action', 'workflow_action')),
  target_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected', 'expired')),
  risk_level TEXT NOT NULL,
  scope_sha256 TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  decided_by TEXT,
  decision_reason TEXT,
  requested_at TEXT NOT NULL,
  decided_at TEXT,
  expires_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_approvals_pending
  ON comms_hub_approvals(status, requested_at ASC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comms_hub_approvals_target_scope
  ON comms_hub_approvals(target_type, target_id, action_type, scope_sha256);

CREATE TABLE IF NOT EXISTS comms_hub_moderation_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  action_type TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('requested', 'pending_approval', 'processing', 'executed', 'failed', 'quarantined')),
  approval_id TEXT,
  payload_sha256 TEXT NOT NULL,
  provider_response_json TEXT,
  failure_class TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(approval_id) REFERENCES comms_hub_approvals(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_moderation_actions_conversation
  ON comms_hub_moderation_actions(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_reply_drafts (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  ai_run_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  policy_key TEXT NOT NULL,
  body_text TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('draft', 'pending_approval', 'approved', 'sent', 'rejected', 'quarantined')),
  risk_level TEXT NOT NULL,
  requires_approval INTEGER NOT NULL CHECK(requires_approval IN (0, 1)),
  evidence_ids_json TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  approval_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sent_at TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(ai_run_id) REFERENCES comms_hub_ai_runs(id),
  FOREIGN KEY(approval_id) REFERENCES comms_hub_approvals(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_reply_drafts_conversation
  ON comms_hub_reply_drafts(conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS comms_hub_follow_ups (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  ai_run_id TEXT,
  reason TEXT NOT NULL,
  due_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('scheduled', 'leased', 'cancelled', 'complete', 'failed', 'quarantined')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
  lease_owner TEXT,
  lease_expires_at TEXT,
  next_attempt_at TEXT NOT NULL,
  completed_at TEXT,
  cancelled_at TEXT,
  failure_class TEXT,
  error TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  FOREIGN KEY(ai_run_id) REFERENCES comms_hub_ai_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_follow_up_queue
  ON comms_hub_follow_ups(status, next_attempt_at, due_at, lease_expires_at);

CREATE TABLE IF NOT EXISTS comms_hub_workflow_runs (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  workflow_key TEXT NOT NULL,
  workflow_version INTEGER NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active', 'waiting', 'complete', 'quarantined')),
  idempotency_key TEXT NOT NULL UNIQUE,
  data_json TEXT NOT NULL DEFAULT '{}',
  next_action_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(conversation_id) REFERENCES comms_hub_conversations(id),
  UNIQUE(conversation_id, workflow_key)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_workflow_runs_due
  ON comms_hub_workflow_runs(status, next_action_at, updated_at);

CREATE TABLE IF NOT EXISTS comms_hub_workflow_events (
  id TEXT PRIMARY KEY,
  workflow_run_id TEXT NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  action_key TEXT NOT NULL,
  actor TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(workflow_run_id) REFERENCES comms_hub_workflow_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_comms_hub_workflow_events_run
  ON comms_hub_workflow_events(workflow_run_id, created_at ASC);
