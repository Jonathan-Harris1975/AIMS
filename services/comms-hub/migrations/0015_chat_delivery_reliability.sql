-- AIMS Comms Hub production chat delivery reliability.
-- Aligns the active website-chat autonomous policy with the deterministic
-- Smart Response gate (0.86 confidence) while retaining moderation, conduct,
-- security, approval, response-intelligence and rate-limit protections.
-- This removes an unnecessarily stricter second confidence gate that caused
-- safe drafts to be generated but never delivered.

INSERT INTO comms_hub_autonomous_reply_policies
  (id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
   allowed_hours_json, maximum_per_hour, status, created_by, approved_by, created_at, approved_at, updated_at)
VALUES
  ('arp-full-chat-low-risk', 'full-chat-low-risk', 'chat', 'any', 0.20, 0.86, 0, '{}', 30, 'active',
   'deployment:chat-delivery-reliability', 'owner-activation', datetime('now'), datetime('now'), datetime('now'))
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
