import { CommsHubError } from "../errors.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../migrations/manifest.js";

function json(value) {
  return JSON.stringify(value);
}

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

export class CommsHubRepository {
  constructor(d1) {
    this.d1 = d1;
  }

  async persistJotformIntake(intake) {
    const sourceMetadata = json({
      provider: "jotform",
      formId: intake.formId,
      submissionId: intake.submissionId,
      route: intake.route.key,
    });
    const statements = [
      {
        sql: `INSERT INTO comms_hub_contacts
          (id, primary_email, display_name, phone, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            primary_email = COALESCE(NULLIF(excluded.primary_email, ''), comms_hub_contacts.primary_email),
            display_name = COALESCE(NULLIF(excluded.display_name, ''), comms_hub_contacts.display_name),
            phone = COALESCE(NULLIF(excluded.phone, ''), comms_hub_contacts.phone),
            updated_at = excluded.updated_at`,
        params: [
          intake.contactId,
          intake.contact.email,
          intake.contact.name,
          intake.contact.phone,
          intake.processedAt,
          intake.processedAt,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO comms_hub_conversations
          (id, channel, provider, workflow, status, contact_id, subject, source_reference,
           created_at, updated_at, last_message_at, metadata_json)
          VALUES (?, 'form', 'jotform', ?, 'open', ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          intake.conversationId,
          intake.route.workflow,
          intake.contactId,
          intake.message.subject,
          intake.sourceReference,
          intake.processedAt,
          intake.processedAt,
          intake.receivedAt,
          sourceMetadata,
        ],
      },
      {
        sql: `INSERT OR IGNORE INTO comms_hub_messages
          (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
           provider_message_id, received_at, created_at, metadata_json)
          VALUES (?, ?, 'inbound', ?, '[]', ?, ?, NULL, ?, ?, ?, ?)`,
        params: [
          intake.messageId,
          intake.conversationId,
          intake.contact.email,
          intake.message.subject,
          intake.message.bodyText,
          intake.sourceReference,
          intake.receivedAt,
          intake.processedAt,
          sourceMetadata,
        ],
      },
      ...intake.attachments.map((attachment) => ({
        sql: `INSERT OR IGNORE INTO comms_hub_attachments
          (id, message_id, provider, provider_url, filename, status, created_at, metadata_json)
          VALUES (?, ?, 'jotform', ?, ?, 'reference_only', ?, ?)`,
        params: [
          attachment.id,
          intake.messageId,
          attachment.providerUrl,
          attachment.filename,
          intake.processedAt,
          json({ questionId: attachment.questionId, label: attachment.label }),
        ],
      })),
      {
        sql: `INSERT OR IGNORE INTO comms_hub_intake_events
          (event_id, conversation_id, provider, form_id, submission_id, correlation_id,
           received_at, processed_at, payload_sha256, payload_json, archive_status,
           archive_key, archive_attempts, archive_next_attempt_at)
          VALUES (?, ?, 'jotform', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 0, ?)
          RETURNING event_id`,
        params: [
          intake.eventId,
          intake.conversationId,
          intake.formId,
          intake.submissionId,
          intake.correlationId,
          intake.receivedAt,
          intake.processedAt,
          intake.payloadSha256,
          intake.payloadJson,
          intake.archiveKey,
          intake.processedAt,
        ],
      },
    ];

    const results = await this.d1.batch(statements);
    const inserted = rows(results.at(-1)).some((row) => row?.event_id === intake.eventId);
    return { duplicate: !inserted };
  }

  async getConversation(conversationId) {
    const conversationResult = await this.d1.query(
      `SELECT id, channel, provider, workflow, status, contact_id, subject, source_reference,
              created_at, updated_at, last_message_at, metadata_json
         FROM comms_hub_conversations
        WHERE id = ?`,
      [conversationId]
    );
    const conversation = rows(conversationResult)[0] || null;
    if (!conversation) return null;

    const [contactResult, messagesResult, attachmentsResult] = await Promise.all([
      this.d1.query(
        `SELECT id, primary_email, display_name, phone, created_at, updated_at
           FROM comms_hub_contacts WHERE id = ?`,
        [conversation.contact_id]
      ),
      this.d1.query(
        `SELECT id, direction, sender, recipients_json, subject, body_text, body_html,
                provider_message_id, received_at, created_at, metadata_json
           FROM comms_hub_messages
          WHERE conversation_id = ?
          ORDER BY received_at ASC`,
        [conversationId]
      ),
      this.d1.query(
        `SELECT a.id, a.message_id, a.provider, a.provider_url, a.filename, a.status, a.created_at, a.metadata_json
           FROM comms_hub_attachments a
           JOIN comms_hub_messages m ON m.id = a.message_id
          WHERE m.conversation_id = ?
          ORDER BY a.created_at ASC`,
        [conversationId]
      ),
    ]);

    return {
      ...conversation,
      contact: rows(contactResult)[0] || null,
      messages: rows(messagesResult),
      attachments: rows(attachmentsResult),
    };
  }

  async getArchiveCounts() {
    const result = await this.d1.query(
      `SELECT archive_status AS status, COUNT(*) AS count
         FROM comms_hub_intake_events
        GROUP BY archive_status
        ORDER BY archive_status`
    );
    return Object.fromEntries(rows(result).map((row) => [row.status, Number(row.count) || 0]));
  }

  async claimArchiveJob({ workerId, now, leaseExpiresAt, maxAttempts }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_intake_events
          SET archive_status = 'leased',
              archive_attempts = archive_attempts + 1,
              archive_lease_owner = ?,
              archive_lease_expires_at = ?,
              archive_failure_class = NULL,
              archive_error = NULL
        WHERE event_id = (
          SELECT event_id
            FROM comms_hub_intake_events
           WHERE archive_attempts < ?
             AND archive_next_attempt_at <= ?
             AND (
               archive_status IN ('pending', 'failed')
               OR (archive_status = 'leased' AND (archive_lease_expires_at IS NULL OR archive_lease_expires_at <= ?))
             )
           ORDER BY processed_at ASC
           LIMIT 1
        )
        RETURNING event_id, conversation_id, provider, form_id, submission_id, received_at, processed_at,
                  payload_sha256, archive_key, archive_attempts`,
      [workerId, leaseExpiresAt, maxAttempts, now, now]
    );
    return rows(result)[0] || null;
  }

  async completeArchiveJob({ eventId, workerId, completedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_intake_events
          SET archive_status = 'complete',
              archive_completed_at = COALESCE(archive_completed_at, ?),
              archive_lease_owner = NULL,
              archive_lease_expires_at = NULL,
              archive_failure_class = NULL,
              archive_error = NULL
        WHERE event_id = ?
          AND (
            (archive_status = 'leased' AND archive_lease_owner = ?)
            OR archive_status = 'complete'
          )
        RETURNING event_id`,
      [completedAt, eventId, workerId]
    );
    if (!rows(result).length) {
      throw new CommsHubError(409, "archive_lease_lost", "Archive job lease was lost before completion.", {
        failureClass: "recoverable",
        publicMessage: "Archive job lease was lost.",
      });
    }
  }

  async failArchiveJob({ eventId, workerId, status, failureClass, errorMessage, nextAttemptAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_intake_events
          SET archive_status = ?,
              archive_next_attempt_at = ?,
              archive_lease_owner = NULL,
              archive_lease_expires_at = NULL,
              archive_failure_class = ?,
              archive_error = ?
        WHERE event_id = ? AND archive_status = 'leased' AND archive_lease_owner = ?
        RETURNING event_id`,
      [status, nextAttemptAt, failureClass, errorMessage, eventId, workerId]
    );
    return Boolean(rows(result).length);
  }

  async schemaStatus() {
    try {
      const result = await this.d1.query(
        `SELECT version, checksum, applied_at
           FROM comms_hub_schema_migrations
          ORDER BY version ASC`
      );
      const migrations = rows(result);
      const applied = new Set(migrations.map((migration) => String(migration.version || "")));
      const missing = COMMS_HUB_REQUIRED_MIGRATIONS.filter((version) => !applied.has(version));
      return { available: missing.length === 0, migrations, missing };
    } catch (error) {
      if (/no such table/i.test(String(error?.message || ""))) {
        return { available: false, migrations: [], missing: [...COMMS_HUB_REQUIRED_MIGRATIONS] };
      }
      throw error;
    }
  }
}

export default CommsHubRepository;
