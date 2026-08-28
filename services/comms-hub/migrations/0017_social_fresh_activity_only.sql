PRAGMA foreign_keys = ON;

-- Social polling is intentionally forward-only. The first poll after this
-- migration establishes a per-resource freshness floor rather than replaying
-- provider history. The floor is retained so the normal overlap window can
-- never cross back into pre-activation content.
ALTER TABLE comms_hub_social_poll_jobs ADD COLUMN fresh_since_at TEXT;

-- Hide conversations created solely by the previous historical poll behaviour.
-- A six-hour ingestion gap is deliberately much larger than the normal two-minute
-- poll cadence and distinguishes historical catch-up from ordinary poll latency.
-- Webhook-backed conversations are never archived by this repair.
INSERT OR IGNORE INTO comms_hub_conversation_operations
  (conversation_id, operational_status, version, updated_by, updated_at)
SELECT c.id, 'archived', 1, 'migration:0017', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM comms_hub_conversations c
 WHERE c.provider = 'zernio'
   AND EXISTS (
     SELECT 1
       FROM comms_hub_social_events se
      WHERE se.conversation_id = c.id
        AND se.source = 'poll'
   )
   AND NOT EXISTS (
     SELECT 1
       FROM comms_hub_social_events se
      WHERE se.conversation_id = c.id
        AND (
          se.source = 'webhook'
          OR (julianday(se.processed_at) - julianday(se.received_at)) <= 0.25
        )
   );

UPDATE comms_hub_conversation_operations
   SET operational_status = 'archived',
       snoozed_until = NULL,
       resolved_at = NULL,
       updated_by = 'migration:0017',
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
       version = version + 1
 WHERE conversation_id IN (
   SELECT c.id
     FROM comms_hub_conversations c
    WHERE c.provider = 'zernio'
      AND EXISTS (
        SELECT 1
          FROM comms_hub_social_events se
         WHERE se.conversation_id = c.id
           AND se.source = 'poll'
      )
      AND NOT EXISTS (
        SELECT 1
          FROM comms_hub_social_events se
         WHERE se.conversation_id = c.id
           AND (
             se.source = 'webhook'
             OR (julianday(se.processed_at) - julianday(se.received_at)) <= 0.25
           )
      )
 );

-- Re-baseline every social resource on the upgraded worker. No provider history
-- is fetched during that baseline cycle. Facebook/Instagram DMs and comments,
-- plus YouTube comments, start ingesting only activity at or after the new floor.
UPDATE comms_hub_social_poll_jobs
   SET cursor = NULL,
       cycle_started_at = NULL,
       fresh_since_at = NULL,
       last_success_at = NULL,
       next_attempt_at = '1970-01-01T00:00:00.000Z',
       attempts = 0,
       lease_owner = NULL,
       lease_expires_at = NULL,
       failure_class = NULL,
       error = NULL,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');
