import { CommsHubError } from "../errors.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../migrations/manifest.js";
import { stableId } from "../domain/ids.js";

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
      workflow: intake.route.workflow,
      acknowledgementProvider: "jotform",
      aimsAutoresponse: false,
      answerCount: intake.storageSummary.answerCount,
      attachmentCount: intake.storageSummary.attachmentCount,
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
      })),      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
          VALUES (?, 'contact', ?, NULL, ?, 'form', ?, '{}', ?)`,
        params: [stableId("srch", "contact", intake.contactId), intake.contactId, intake.contactId,
          `${intake.contact.name} ${intake.contact.email} ${intake.contact.phone}`, intake.processedAt],
      },
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
          VALUES (?, 'conversation', ?, ?, ?, 'form', ?, '{}', ?)`,
        params: [stableId("srch", "conversation", intake.conversationId), intake.conversationId,
          intake.conversationId, intake.contactId, `${intake.message.subject} ${intake.message.bodyText}`, intake.processedAt],
      },
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
          VALUES (?, 'message', ?, ?, ?, 'form', ?, '{}', ?)`,
        params: [stableId("srch", "message", intake.messageId), intake.messageId,
          intake.conversationId, intake.contactId, `${intake.message.subject} ${intake.message.bodyText}`, intake.processedAt],
      },
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

    const [contactResult, messagesResult, attachmentsResult, socialThreadResult] = await Promise.all([
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
      this.d1.query(
        `SELECT id, credential_family, platform, thread_type, account_id, provider_thread_id,
                provider_post_id, root_comment_id, participant_id, provider_status, metadata_json
           FROM comms_hub_social_threads WHERE conversation_id = ?`,
        [conversationId]
      ),
    ]);

    return {
      ...conversation,
      contact: rows(contactResult)[0] || null,
      messages: rows(messagesResult),
      attachments: rows(attachmentsResult),
      socialThread: rows(socialThreadResult)[0] || null,
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
                  payload_sha256, payload_json, archive_key, archive_attempts`,
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


  async persistZernioEvent(event) {
    const eventPayload = json({
      kind: event.kind,
      eventType: event.eventType,
      platform: event.platform,
      accountId: event.accountId || null,
      providerThreadId: event.providerThreadId || null,
      providerPostId: event.providerPostId || null,
      rootCommentId: event.rootCommentId || null,
      metadata: event.metadata || {},
    });

    if (event.kind === "account") {
      const result = await this.d1.query(
        `INSERT OR IGNORE INTO comms_hub_social_events
          (id, provider, credential_family, platform, provider_event_id, event_type,
           conversation_id, message_id, correlation_id, source, received_at, processed_at,
           payload_sha256, payload_json)
         VALUES (?, 'zernio', ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [event.eventId, event.family, event.platform, event.providerEventId, event.eventType,
          event.correlationId, event.source, event.receivedAt, event.processedAt,
          event.payloadSha256, eventPayload]
      );
      return { duplicate: !rows(result).length };
    }

    const identityMetadata = json({
      providerContactId: event.identity?.providerContactId || null,
      isOwner: Boolean(event.identity?.isOwner),
    });
    const threadMetadata = json(event.metadata || {});
    const conversationMetadata = json({
      provider: "zernio",
      credentialFamily: event.family,
      platform: event.platform,
      accountId: event.accountId,
      threadType: event.threadType,
    });
    const statements = [
      {
        sql: `INSERT INTO comms_hub_contacts
          (id, primary_email, display_name, phone, created_at, updated_at)
          VALUES (?, NULL, ?, NULL, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            display_name = COALESCE(NULLIF(excluded.display_name, ''), comms_hub_contacts.display_name),
            updated_at = excluded.updated_at`,
        params: [event.contactId, event.identity?.displayName || event.identity?.username || null, event.processedAt, event.processedAt],
      },
      {
        sql: `INSERT INTO comms_hub_channel_identities
          (id, contact_id, provider, credential_family, platform, account_id, participant_id,
           provider_contact_id, username, display_name, avatar_url, created_at, updated_at, metadata_json)
          VALUES (?, ?, 'zernio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider, credential_family, platform, account_id, participant_id) DO UPDATE SET
            provider_contact_id = COALESCE(excluded.provider_contact_id, comms_hub_channel_identities.provider_contact_id),
            username = COALESCE(excluded.username, comms_hub_channel_identities.username),
            display_name = COALESCE(excluded.display_name, comms_hub_channel_identities.display_name),
            avatar_url = COALESCE(excluded.avatar_url, comms_hub_channel_identities.avatar_url),
            updated_at = excluded.updated_at,
            metadata_json = excluded.metadata_json`,
        params: [event.identityId, event.contactId, event.family, event.platform, event.accountId,
          event.identity?.participantId, event.identity?.providerContactId || null,
          event.identity?.username || null, event.identity?.displayName || null,
          event.identity?.avatarUrl || null, event.processedAt, event.processedAt, identityMetadata],
      },
      {
        sql: `INSERT INTO comms_hub_conversations
          (id, channel, provider, workflow, status, contact_id, subject, source_reference,
           created_at, updated_at, last_message_at, metadata_json)
          VALUES (?, ?, 'zernio', ?, 'open', ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            contact_id = excluded.contact_id,
            subject = excluded.subject,
            updated_at = excluded.updated_at,
            last_message_at = CASE
              WHEN excluded.last_message_at > comms_hub_conversations.last_message_at THEN excluded.last_message_at
              ELSE comms_hub_conversations.last_message_at
            END,
            metadata_json = excluded.metadata_json`,
        params: [event.conversationId, event.threadType === "dm" ? "social_dm" : "social_comment",
          event.workflow, event.contactId, event.subject,
          `zernio:${event.family}:${event.platform}:${event.threadType}:${event.accountId}:${event.providerThreadId}`,
          event.occurredAt, event.processedAt, event.occurredAt, conversationMetadata],
      },
      {
        sql: `INSERT INTO comms_hub_social_threads
          (id, conversation_id, provider, credential_family, platform, thread_type, account_id,
           provider_thread_id, provider_post_id, root_comment_id, participant_id, provider_status,
           created_at, updated_at, metadata_json)
          VALUES (?, ?, 'zernio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(provider, credential_family, platform, thread_type, account_id, provider_thread_id) DO UPDATE SET
            participant_id = COALESCE(excluded.participant_id, comms_hub_social_threads.participant_id),
            provider_status = COALESCE(excluded.provider_status, comms_hub_social_threads.provider_status),
            updated_at = excluded.updated_at,
            metadata_json = excluded.metadata_json`,
        params: [event.threadId, event.conversationId, event.family, event.platform, event.threadType,
          event.accountId, event.providerThreadId, event.providerPostId || null,
          event.rootCommentId || null, event.identity?.participantId || null,
          event.providerStatus || null, event.occurredAt, event.processedAt, threadMetadata],
      },
    ];

    if (["message", "comment", "message_mutation"].includes(event.kind)) {
      statements.push({
        sql: `INSERT INTO comms_hub_messages
          (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
           provider_message_id, received_at, created_at, metadata_json)
          VALUES (?, ?, ?, ?, '[]', ?, ?, NULL, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            direction = excluded.direction,
            sender = COALESCE(NULLIF(excluded.sender, ''), comms_hub_messages.sender),
            subject = excluded.subject,
            body_text = CASE WHEN excluded.body_text <> '' THEN excluded.body_text ELSE comms_hub_messages.body_text END,
            metadata_json = excluded.metadata_json`,
        params: [event.messageId, event.conversationId, event.direction,
          event.identity?.displayName || event.identity?.username || event.identity?.participantId || null,
          event.subject, event.bodyText, event.providerMessageId, event.occurredAt,
          event.processedAt, json(event.metadata || {})],
      });
      for (const attachment of event.attachments || []) {
        statements.push({
          sql: `INSERT OR IGNORE INTO comms_hub_attachments
            (id, message_id, provider, provider_url, filename, status, created_at, metadata_json)
            VALUES (?, ?, 'zernio', ?, ?, 'reference_only', ?, ?)`,
          params: [
            `${event.messageId}:${attachment.id}`,
            event.messageId,
            attachment.url,
            attachment.name || attachment.type || "attachment",
            event.processedAt,
            json({ type: attachment.type || "file", credentialFamily: event.family, platform: event.platform }),
          ],
        });
      }
    } else if (event.kind === "message_status") {
      statements.push({
        sql: `UPDATE comms_hub_messages
                 SET metadata_json = json_set(
                       metadata_json,
                       '$.deliveryStatus', ?,
                       '$.statusUpdatedAt', ?
                     )
               WHERE provider_message_id = ?`,
        params: [event.metadata?.deliveryStatus || event.eventType, event.processedAt, event.providerMessageId],
      });
    }

    statements.push(
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
         VALUES (?, 'contact', ?, NULL, ?, ?, ?, '{}', ?)`,
        params: [stableId("srch", "contact", event.contactId), event.contactId, event.contactId,
          event.threadType === "dm" ? "social_dm" : "social_comment",
          `${event.identity?.displayName || ""} ${event.identity?.username || ""}`, event.processedAt],
      },
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
         VALUES (?, 'conversation', ?, ?, ?, ?, ?, '{}', ?)`,
        params: [stableId("srch", "conversation", event.conversationId), event.conversationId,
          event.conversationId, event.contactId, event.threadType === "dm" ? "social_dm" : "social_comment",
          `${event.subject || ""} ${event.bodyText || ""}`, event.processedAt],
      }
    );
    if (["message", "comment", "message_mutation"].includes(event.kind)) statements.push({
      sql: `INSERT OR REPLACE INTO comms_hub_search_documents
        (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
       VALUES (?, 'message', ?, ?, ?, ?, ?, '{}', ?)`,
      params: [stableId("srch", "message", event.messageId), event.messageId, event.conversationId,
        event.contactId, event.threadType === "dm" ? "social_dm" : "social_comment",
        `${event.subject || ""} ${event.bodyText || ""}`, event.processedAt],
    });

    statements.push({
      sql: `INSERT OR IGNORE INTO comms_hub_social_events
        (id, provider, credential_family, platform, provider_event_id, event_type,
         conversation_id, message_id, correlation_id, source, received_at, processed_at,
         payload_sha256, payload_json)
       VALUES (?, 'zernio', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      params: [event.eventId, event.family, event.platform, event.providerEventId, event.eventType,
        event.conversationId || null, ["message", "comment", "message_mutation"].includes(event.kind) ? event.messageId || null : null,
        event.correlationId, event.source,
        event.receivedAt, event.processedAt, event.payloadSha256, eventPayload],
    });

    const results = await this.d1.batch(statements);
    return { duplicate: !rows(results.at(-1)).length };
  }

  async getSocialThreadByConversation(conversationId) {
    const result = await this.d1.query(
      `SELECT id, conversation_id, provider, credential_family, platform, thread_type, account_id,
              provider_thread_id, provider_post_id, root_comment_id, participant_id, provider_status,
              created_at, updated_at, metadata_json
         FROM comms_hub_social_threads
        WHERE conversation_id = ?`,
      [conversationId]
    );
    return rows(result)[0] || null;
  }

  async listSocialConversations({ platform = "", status = "", limit = 50, before = "" } = {}) {
    const clauses = ["c.provider = 'zernio'"];
    const params = [];
    if (platform) { clauses.push("t.platform = ?"); params.push(platform); }
    if (status) { clauses.push("c.status = ?"); params.push(status); }
    if (before) { clauses.push("c.updated_at < ?"); params.push(before); }
    params.push(Math.max(1, Math.min(100, Number(limit) || 50)));
    const result = await this.d1.query(
      `SELECT c.id, c.channel, c.workflow, c.status, c.subject, c.contact_id, c.updated_at,
              c.last_message_at, t.credential_family, t.platform, t.thread_type, t.account_id,
              t.provider_status, i.username, i.display_name, i.avatar_url
         FROM comms_hub_conversations c
         JOIN comms_hub_social_threads t ON t.conversation_id = c.id
         LEFT JOIN comms_hub_channel_identities i
           ON i.contact_id = c.contact_id AND i.account_id = t.account_id AND i.platform = t.platform
        WHERE ${clauses.join(" AND ")}
        ORDER BY c.updated_at DESC
        LIMIT ?`,
      params
    );
    return rows(result);
  }

  async setConversationStatus({ conversationId, status, providerStatus, updatedAt }) {
    await this.d1.batch([
      {
        sql: `UPDATE comms_hub_conversations SET status = ?, updated_at = ? WHERE id = ?`,
        params: [status, updatedAt, conversationId],
      },
      {
        sql: `UPDATE comms_hub_social_threads SET provider_status = ?, updated_at = ? WHERE conversation_id = ?`,
        params: [providerStatus, updatedAt, conversationId],
      },
    ]);
  }

  async claimOutboundAction({ id, idempotencyKey, conversationId, family, platform, actionType, requestSha256, now }) {
    const inserted = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_social_outbound_actions
        (id, idempotency_key, conversation_id, credential_family, platform, action_type,
         request_sha256, status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'processing', 1, ?, ?)
       RETURNING id`,
      [id, idempotencyKey, conversationId, family, platform, actionType, requestSha256, now, now]
    );
    if (rows(inserted).length) return { acquired: true, duplicate: false, existing: null };

    const existingResult = await this.d1.query(
      `SELECT id, conversation_id, credential_family, platform, action_type, request_sha256,
              status, provider_response_json, attempts, failure_class, error, updated_at
         FROM comms_hub_social_outbound_actions WHERE idempotency_key = ?`,
      [idempotencyKey]
    );
    const existing = rows(existingResult)[0];
    if (!existing || existing.request_sha256 !== requestSha256 || existing.conversation_id !== conversationId || existing.action_type !== actionType) {
      throw new CommsHubError(409, "social_idempotency_conflict", "Idempotency key was already used for a different social action.", {
        failureClass: "permanent",
        publicMessage: "Idempotency key conflicts with an earlier request.",
      });
    }
    if (existing.status === "complete") return { acquired: false, duplicate: true, existing };
    if (existing.status === "processing") {
      throw new CommsHubError(409, "social_action_in_progress", "An action with this idempotency key is already in progress.", {
        retryable: true,
        failureClass: "temporary",
        publicMessage: "This action is already being processed.",
      });
    }
    if (existing.status === "reconciliation_required") {
      throw new CommsHubError(409, "social_action_reconciliation_required", "The provider result is uncertain and must be checked before another action is sent.", {
        failureClass: "recoverable",
        publicMessage: "Check the provider before retrying this action.",
      });
    }
    throw new CommsHubError(409, "social_action_failed_previous", "This idempotency key belongs to a failed action and cannot be reused.", {
      failureClass: "permanent",
      publicMessage: "Use a new idempotency key after correcting the request.",
    });
  }

  async completeOutboundAction({ idempotencyKey, response, completedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_social_outbound_actions
          SET status = 'complete', provider_response_json = ?, failure_class = NULL, error = NULL, updated_at = ?
        WHERE idempotency_key = ? AND status = 'processing'
        RETURNING id`,
      [json(response || {}), completedAt, idempotencyKey]
    );
    if (!rows(result).length) throw new CommsHubError(409, "social_action_state_lost", "Social action state changed before completion.");
  }

  async failOutboundAction({ idempotencyKey, failureClass, errorMessage, failedAt, reconciliationRequired = false }) {
    await this.d1.query(
      `UPDATE comms_hub_social_outbound_actions
          SET status = ?, failure_class = ?, error = ?, updated_at = ?
        WHERE idempotency_key = ? AND status = 'processing'`,
      [reconciliationRequired ? "reconciliation_required" : "failed", failureClass || "recoverable", errorMessage || "operation failed", failedAt, idempotencyKey]
    );
  }

  async claimSocialPollJob({ workerId, now, leaseExpiresAt, families }) {
    if (!Array.isArray(families) || !families.length) return null;
    const placeholders = families.map(() => "?").join(", ");
    const result = await this.d1.query(
      `UPDATE comms_hub_social_poll_jobs
          SET lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1,
              failure_class = NULL, error = NULL, updated_at = ?
        WHERE id = (
          SELECT id FROM comms_hub_social_poll_jobs
           WHERE credential_family IN (${placeholders})
             AND next_attempt_at <= ?
             AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
           ORDER BY next_attempt_at ASC, updated_at ASC
           LIMIT 1
        )
        RETURNING id, credential_family, platform, resource, cursor, cycle_started_at,
                  last_success_at, attempts`,
      [workerId, leaseExpiresAt, now, ...families, now, now]
    );
    return rows(result)[0] || null;
  }

  async completeSocialPollJob({ id, workerId, cursor, cycleStartedAt, lastSuccessAt, nextAttemptAt, completedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_social_poll_jobs
          SET cursor = ?, cycle_started_at = ?, last_success_at = COALESCE(?, last_success_at),
              next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
              attempts = 0, failure_class = NULL, error = NULL, updated_at = ?
        WHERE id = ? AND lease_owner = ?
        RETURNING id`,
      [cursor || null, cycleStartedAt || null, lastSuccessAt || null, nextAttemptAt, completedAt, id, workerId]
    );
    if (!rows(result).length) throw new CommsHubError(409, "social_poll_lease_lost", "Social polling lease was lost.");
  }

  async failSocialPollJob({ id, workerId, failureClass, errorMessage, nextAttemptAt, failedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_social_poll_jobs
          SET next_attempt_at = ?, lease_owner = NULL, lease_expires_at = NULL,
              failure_class = ?, error = ?, updated_at = ?
        WHERE id = ? AND lease_owner = ?
        RETURNING id`,
      [nextAttemptAt, failureClass || "recoverable", errorMessage || "poll failed", failedAt, id, workerId]
    );
    return Boolean(rows(result).length);
  }

  async getSocialStatus() {
    const [eventsResult, pollResult, outboundResult] = await Promise.all([
      this.d1.query(`SELECT credential_family, platform, event_type, COUNT(*) AS count,
                            MAX(processed_at) AS last_processed_at
                       FROM comms_hub_social_events
                      GROUP BY credential_family, platform, event_type
                      ORDER BY credential_family, platform, event_type`),
      this.d1.query(`SELECT id, credential_family, platform, resource, cursor, last_success_at,
                            next_attempt_at, attempts, lease_owner, lease_expires_at,
                            failure_class, error, updated_at
                       FROM comms_hub_social_poll_jobs
                      ORDER BY credential_family, platform, resource`),
      this.d1.query(`SELECT credential_family, platform, status, COUNT(*) AS count,
                            MAX(updated_at) AS last_updated_at
                       FROM comms_hub_social_outbound_actions
                      GROUP BY credential_family, platform, status
                      ORDER BY credential_family, platform, status`),
    ]);
    return { events: rows(eventsResult), polling: rows(pollResult), outbound: rows(outboundResult) };
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
