-- AIMS Comms Hub v2.14.1 runtime reliability policy refinement.
-- Simple social-engagement messages can be answered autonomously without a
-- website-evidence hit, while the existing global social policy remains strict
-- for factual/general enquiries. Security, conduct, response-intelligence,
-- risk, approval and rate-limit gates continue to apply before delivery.

INSERT INTO comms_hub_autonomous_reply_policies
  (id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
   allowed_hours_json, maximum_per_hour, status, created_by, approved_by, created_at, approved_at, updated_at)
VALUES
  ('arp-social-engagement-safe', 'social-engagement-safe', 'social', 'social_engagement', 0.05, 0.90, 0, '{}', 30, 'active', 'deployment:v2.14.1', 'owner-activation', datetime('now'), datetime('now'), datetime('now'))
ON CONFLICT(policy_key) DO UPDATE SET
  channel=excluded.channel, intent=excluded.intent, maximum_risk=excluded.maximum_risk,
  minimum_confidence=excluded.minimum_confidence, require_evidence=excluded.require_evidence,
  allowed_hours_json=excluded.allowed_hours_json, maximum_per_hour=excluded.maximum_per_hour,
  status='active', approved_by='owner-activation', approved_at=datetime('now'), updated_at=datetime('now');
