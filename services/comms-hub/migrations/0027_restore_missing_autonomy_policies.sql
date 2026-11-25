-- Restore the existing owner-authorised defaults only when the entire policy
-- table is empty and there is no recorded operator policy change. Preserve any
-- existing policy, including explicitly disabled or customised policies.
INSERT INTO comms_hub_autonomous_reply_policies
  (id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
   allowed_hours_json, maximum_per_hour, status, created_by, approved_by, created_at, approved_at, updated_at)
SELECT id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
       '{}', maximum_per_hour, 'active', 'migration:0027-policy-recovery', 'owner-activation',
       datetime('now'), datetime('now'), datetime('now')
FROM (
  SELECT 'arp-full-chat-low-risk' AS id, 'full-chat-low-risk' AS policy_key, 'chat' AS channel,
         'any' AS intent, 0.20 AS maximum_risk, 0.86 AS minimum_confidence, 0 AS require_evidence, 30 AS maximum_per_hour
  UNION ALL SELECT 'arp-full-email-low-risk', 'full-email-low-risk', 'email', 'any', 0.05, 0.86, 1, 10
  UNION ALL SELECT 'arp-full-social-low-risk', 'full-social-low-risk', 'social', 'any', 0.15, 0.86, 0, 30
  UNION ALL SELECT 'arp-social-engagement-safe', 'social-engagement-safe', 'social', 'social_engagement', 0.05, 0.90, 0, 30
)
WHERE NOT EXISTS (SELECT 1 FROM comms_hub_autonomous_reply_policies)
  AND NOT EXISTS (SELECT 1 FROM comms_hub_audit_events WHERE action = 'autonomous_policy_upserted');
