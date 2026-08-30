PRAGMA foreign_keys = ON;

-- Owner-authorised professional automation profile. Smart Response Intelligence,
-- deterministic business-risk checks, prompt security, conduct, evidence rules,
-- human assignment and rate limits remain fail-closed safety gates.
UPDATE comms_hub_autonomous_reply_policies
SET minimum_confidence = 0.86,
    status = 'active',
    approved_by = 'owner-activation',
    approved_at = COALESCE(approved_at, datetime('now')),
    updated_at = datetime('now')
WHERE policy_key IN ('full-chat-low-risk','full-email-low-risk','full-social-low-risk');
