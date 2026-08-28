-- Production social DM/comment delivery policy.
-- Social replies remain gated by Smart Response Intelligence, moderation,
-- conduct, prompt-injection checks, approval state and hourly rate limits.
-- Evidence is not universally required because ordinary conversational DMs and
-- comments can be answered without making factual claims. Personal-brand facts
-- are independently constrained to official-website evidence by the brand
-- grounding layer.

INSERT INTO comms_hub_autonomous_reply_policies
  (id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
   allowed_hours_json, maximum_per_hour, status, created_by, approved_by, created_at, approved_at, updated_at)
VALUES
  ('arp-full-social-low-risk', 'full-social-low-risk', 'social', 'any', 0.15, 0.88, 0, '{}', 30, 'active',
   'deployment:social-conversation-delivery', 'owner-activation', datetime('now'), datetime('now'), datetime('now'))
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
