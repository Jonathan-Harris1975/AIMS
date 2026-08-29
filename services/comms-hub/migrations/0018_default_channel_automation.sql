PRAGMA foreign_keys = ON;

-- Owner-authorised default automation profile for all customer-facing Comms Hub
-- channels. Runtime intelligence, moderation, conduct, prompt-security, human
-- assignment, approval and rate-limit gates remain authoritative.
INSERT INTO comms_hub_autonomous_reply_policies
  (id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
   allowed_hours_json, maximum_per_hour, status, created_by, approved_by, created_at, approved_at, updated_at)
VALUES
  ('arp-full-chat-low-risk', 'full-chat-low-risk', 'chat', 'any', 0.20, 0.86, 0, '{}', 30, 'active',
   'deployment:default-channel-automation', 'owner-activation', datetime('now'), datetime('now'), datetime('now')),
  ('arp-full-email-low-risk', 'full-email-low-risk', 'email', 'any', 0.05, 0.94, 1, '{}', 10, 'active',
   'deployment:default-channel-automation', 'owner-activation', datetime('now'), datetime('now'), datetime('now')),
  ('arp-full-social-low-risk', 'full-social-low-risk', 'social', 'any', 0.15, 0.88, 0, '{}', 30, 'active',
   'deployment:default-channel-automation', 'owner-activation', datetime('now'), datetime('now'), datetime('now'))
ON CONFLICT(policy_key) DO UPDATE SET
  channel=excluded.channel,
  intent=excluded.intent,
  maximum_risk=excluded.maximum_risk,
  minimum_confidence=excluded.minimum_confidence,
  require_evidence=excluded.require_evidence,
  allowed_hours_json=excluded.allowed_hours_json,
  maximum_per_hour=excluded.maximum_per_hour,
  status='active',
  approved_by='owner-activation',
  approved_at=datetime('now'),
  updated_at=datetime('now');
