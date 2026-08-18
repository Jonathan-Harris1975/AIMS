PRAGMA foreign_keys = ON;

-- Admin and Newsletter email remain intentionally outside AIMS Comms Hub automation.
-- Preserve their historical records, but cancel queued automation created by older releases.
UPDATE comms_hub_delayed_actions
   SET status = 'cancelled',
       lease_owner = NULL,
       lease_expires_at = NULL,
       failure_class = 'permanent',
       error = 'email_account_outside_comms_hub_automation',
       updated_at = datetime('now')
 WHERE status IN ('scheduled', 'failed', 'leased')
   AND conversation_id IN (
     SELECT c.id
       FROM comms_hub_conversations c
       JOIN comms_hub_email_threads et ON et.conversation_id = c.id
      WHERE c.channel = 'email'
        AND et.account_key IN ('admin', 'newsletter')
   );

UPDATE comms_hub_follow_ups
   SET status = 'cancelled',
       cancelled_at = datetime('now'),
       lease_owner = NULL,
       lease_expires_at = NULL,
       failure_class = 'permanent',
       error = 'email_account_outside_comms_hub_automation',
       updated_at = datetime('now')
 WHERE status IN ('scheduled', 'failed', 'leased')
   AND conversation_id IN (
     SELECT c.id
       FROM comms_hub_conversations c
       JOIN comms_hub_email_threads et ON et.conversation_id = c.id
      WHERE c.channel = 'email'
        AND et.account_key IN ('admin', 'newsletter')
   );
