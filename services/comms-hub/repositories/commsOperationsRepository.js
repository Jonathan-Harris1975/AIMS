import { CommsHubError } from "../errors.js";
import { sha256Hex, stableId } from "../domain/ids.js";
import { channelFamily } from "../domain/channels.js";

function rows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value || "");
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function text(value, maximum = 10_000) {
  return String(value ?? "").trim().slice(0, maximum);
}

function nowIso() {
  return new Date().toISOString();
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(",");
}

const OPERATIONAL_STATUSES = new Set([
  "open", "pending", "snoozed", "resolved", "blocked", "quarantined", "archived", "escalated",
]);

export class CommsOperationsRepository {
  constructor(d1) {
    this.d1 = d1;
  }

  async ensureConversationOperations(conversationId, actor = "system", at = nowIso()) {
    await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_conversation_operations
        (conversation_id, operational_status, version, updated_by, updated_at)
       VALUES (?, 'open', 1, ?, ?)`,
      [conversationId, actor, at]
    );
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_conversation_operations WHERE conversation_id = ?`,
      [conversationId]
    );
    return rows(result)[0] || null;
  }

  async getConversationOperations(conversationId) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_conversation_operations WHERE conversation_id = ?`,
      [conversationId]
    );
    return rows(result)[0] || null;
  }

  async listUnifiedQueue({
    status = "", channel = "", interactionType = "", owner = "", priority = "", aiStatus = "",
    tag = "", overdue = false, before = "", limit = 50,
  } = {}) {
    const boundedLimit = Number.isInteger(Number(limit)) ? Math.min(Math.max(Number(limit), 1), 200) : 50;
    const clauses = [];
    const params = [];
    if (status) {
      clauses.push("COALESCE(o.operational_status, c.status) = ?");
      params.push(status);
    }
    if (channel) {
      clauses.push("c.channel = ?");
      params.push(channel);
    }
    if (interactionType) {
      if (!["dm", "comment"].includes(interactionType)) {
        throw new CommsHubError(400, "interaction_type_invalid", "Interaction type must be dm or comment.");
      }
      clauses.push("st.thread_type = ?");
      params.push(interactionType);
    }
    if (owner) {
      clauses.push("o.owner_id = ?");
      params.push(owner);
    }
    if (priority) {
      clauses.push("s.priority_label = ?");
      params.push(priority);
    }
    if (aiStatus) {
      clauses.push(`EXISTS (
        SELECT 1 FROM comms_hub_ai_runs ar
         WHERE ar.conversation_id = c.id AND ar.status = ?
      )`);
      params.push(aiStatus);
    }
    if (tag) {
      clauses.push(`EXISTS (
        SELECT 1 FROM comms_hub_conversation_tags ct
        JOIN comms_hub_tags t ON t.id = ct.tag_id
        WHERE ct.conversation_id = c.id AND t.tag_key = ? AND t.active = 1
      )`);
      params.push(tag);
    }
    if (overdue) clauses.push("o.response_due_at IS NOT NULL AND o.response_due_at <= ?");
    if (overdue) params.push(nowIso());
    if (before) {
      clauses.push("c.updated_at < ?");
      params.push(before);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.d1.query(
      `SELECT c.id, c.channel, c.provider, c.workflow, c.subject, c.contact_id,
              c.created_at, c.updated_at, c.last_message_at,
              COALESCE(o.operational_status, c.status) AS operational_status,
              o.owner_type, o.owner_id, o.team_id, o.snoozed_until,
              o.response_due_at, o.resolution_due_at, o.first_response_at, o.resolved_at,
              o.escalation_level, o.escalation_reason, o.version,
              s.intent, s.intent_confidence, s.priority_score, s.priority_label,
              s.queue_key, s.escalation_required, s.sentiment, s.abuse_label,
              s.risk_level, s.summary_text, s.next_action,
              ct.primary_email, ct.display_name, ct.phone,
              st.thread_type AS interaction_type, st.platform AS social_platform,
              st.credential_family AS social_family, st.account_id AS social_account_id,
              st.provider_thread_id AS social_provider_thread_id, st.provider_post_id AS social_provider_post_id,
              st.root_comment_id AS social_root_comment_id, st.provider_status AS social_provider_status,
              CAST((julianday('now') - julianday(c.last_message_at)) * 86400 AS INTEGER) AS age_seconds,
              CASE WHEN o.response_due_at IS NOT NULL AND o.response_due_at <= ? THEN 1 ELSE 0 END AS response_overdue
         FROM comms_hub_conversations c
         JOIN comms_hub_contacts ct ON ct.id = c.contact_id
         LEFT JOIN comms_hub_conversation_operations o ON o.conversation_id = c.id
         LEFT JOIN comms_hub_conversation_state s ON s.conversation_id = c.id
         LEFT JOIN comms_hub_social_threads st ON st.conversation_id = c.id
         ${where}
        ORDER BY response_overdue DESC,
                 COALESCE(s.priority_score, 0) DESC,
                 c.last_message_at ASC
        LIMIT ?`,
      [nowIso(), ...params, boundedLimit]
    );
    return rows(result).map((row) => ({
      ...row,
      response_overdue: Boolean(row.response_overdue),
      escalation_required: Boolean(row.escalation_required),
    }));
  }

  async updateConversationStatus({ conversationId, status, actor, expectedVersion = null, snoozedUntil = null, reason = "", at = nowIso() }) {
    if (!OPERATIONAL_STATUSES.has(status)) {
      throw new CommsHubError(400, "conversation_status_invalid", `Unsupported conversation status: ${status}.`);
    }
    await this.ensureConversationOperations(conversationId, actor, at);
    const versionClause = expectedVersion === null || expectedVersion === undefined ? "" : " AND version = ?";
    const params = [
      status,
      status === "snoozed" ? snoozedUntil : null,
      status === "resolved" ? at : null,
      status === "escalated" ? "high" : null,
      status === "escalated" ? text(reason, 1000) : null,
      actor,
      at,
      conversationId,
    ];
    if (versionClause) params.push(Number(expectedVersion));
    const result = await this.d1.query(
      `UPDATE comms_hub_conversation_operations
          SET operational_status = ?, snoozed_until = ?,
              resolved_at = CASE WHEN ? IS NOT NULL THEN ? ELSE resolved_at END,
              escalation_level = COALESCE(?, escalation_level),
              escalation_reason = COALESCE(?, escalation_reason),
              updated_by = ?, updated_at = ?, version = version + 1
        WHERE conversation_id = ?${versionClause}
        RETURNING *`,
      [
        status,
        status === "snoozed" ? snoozedUntil : null,
        status === "resolved" ? at : null,
        status === "resolved" ? at : null,
        status === "escalated" ? "high" : null,
        status === "escalated" ? text(reason, 1000) : null,
        actor,
        at,
        conversationId,
        ...(versionClause ? [Number(expectedVersion)] : []),
      ]
    );
    const updated = rows(result)[0] || null;
    if (!updated) {
      throw new CommsHubError(409, "conversation_version_conflict", "Conversation changed before this update could be applied.", {
        publicMessage: "Conversation was updated by another operation.",
      });
    }
    return updated;
  }

  async assignConversation({ conversationId, ownerType, ownerId, teamId = null, actor, expectedVersion = null, at = nowIso() }) {
    if (!new Set(["person", "team", "automation"]).has(ownerType)) {
      throw new CommsHubError(400, "assignment_owner_type_invalid", "Assignment owner type is invalid.");
    }
    if (!text(ownerId, 200)) throw new CommsHubError(400, "assignment_owner_missing", "Assignment owner is required.");
    await this.ensureConversationOperations(conversationId, actor, at);
    const versionClause = expectedVersion === null || expectedVersion === undefined ? "" : " AND version = ?";
    const result = await this.d1.query(
      `UPDATE comms_hub_conversation_operations
          SET owner_type = ?, owner_id = ?, team_id = ?, updated_by = ?, updated_at = ?, version = version + 1
        WHERE conversation_id = ?${versionClause}
        RETURNING *`,
      [ownerType, text(ownerId, 200), text(teamId, 200) || null, actor, at, conversationId,
        ...(versionClause ? [Number(expectedVersion)] : [])]
    );
    const updated = rows(result)[0] || null;
    if (!updated) throw new CommsHubError(409, "conversation_version_conflict", "Conversation assignment conflicted with another update.");
    return updated;
  }

  async createTag({ id, key, label, category = "general", actor, at = nowIso() }) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_tags (id, tag_key, label, category, created_by, created_at, active)
       VALUES (?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(tag_key) DO UPDATE SET label = excluded.label, category = excluded.category, active = 1
       RETURNING *`,
      [id, key, label, category, actor, at]
    );
    return rows(result)[0] || null;
  }

  async applyTags({ conversationIds, tagIds, actor, at = nowIso() }) {
    const statements = [];
    for (const conversationId of conversationIds) {
      for (const tagId of tagIds) {
        statements.push({
          sql: `INSERT OR IGNORE INTO comms_hub_conversation_tags
            (conversation_id, tag_id, applied_by, applied_at) VALUES (?, ?, ?, ?)`,
          params: [conversationId, tagId, actor, at],
        });
      }
    }
    if (!statements.length) return 0;
    await this.d1.batch(statements);
    return statements.length;
  }

  async removeTags({ conversationIds, tagIds }) {
    if (!conversationIds.length || !tagIds.length) return 0;
    const result = await this.d1.query(
      `DELETE FROM comms_hub_conversation_tags
        WHERE conversation_id IN (${placeholders(conversationIds.length)})
          AND tag_id IN (${placeholders(tagIds.length)})
        RETURNING conversation_id`,
      [...conversationIds, ...tagIds]
    );
    return rows(result).length;
  }

  async listConversationTags(conversationId) {
    const result = await this.d1.query(
      `SELECT t.id, t.tag_key, t.label, t.category, ct.applied_by, ct.applied_at
         FROM comms_hub_conversation_tags ct
         JOIN comms_hub_tags t ON t.id = ct.tag_id
        WHERE ct.conversation_id = ? AND t.active = 1
        ORDER BY t.category, t.label`,
      [conversationId]
    );
    return rows(result);
  }

  async addInternalNote({ id, conversationId, bodyText, actor, mentions = [], at = nowIso(), metadata = {} }) {
    const statements = [{
      sql: `INSERT INTO comms_hub_internal_notes
        (id, conversation_id, body_text, author, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      params: [id, conversationId, bodyText, actor, at, at, json(metadata)],
    }];
    for (const mentionedActor of mentions) {
      statements.push({
        sql: `INSERT INTO comms_hub_mentions
          (id, conversation_id, note_id, mentioned_actor, mentioned_by, status, created_at)
         VALUES (?, ?, ?, ?, ?, 'unread', ?)`,
        params: [stableId("mnt", id, mentionedActor), conversationId, id, mentionedActor, actor, at],
      });
    }
    await this.d1.batch(statements);
    return { id, conversation_id: conversationId, body_text: bodyText, author: actor, created_at: at, mentions };
  }

  async listInternalNotes(conversationId) {
    const result = await this.d1.query(
      `SELECT n.*, GROUP_CONCAT(m.mentioned_actor) AS mentioned_actors
         FROM comms_hub_internal_notes n
         LEFT JOIN comms_hub_mentions m ON m.note_id = n.id
        WHERE n.conversation_id = ? AND n.deleted_at IS NULL
        GROUP BY n.id
        ORDER BY n.created_at ASC`,
      [conversationId]
    );
    return rows(result).map((row) => ({
      ...row,
      mentions: String(row.mentioned_actors || "").split(",").filter(Boolean),
      metadata: parseJson(row.metadata_json, {}),
    }));
  }

  async listMentions({ actor, status = "unread", limit = 100 }) {
    const result = await this.d1.query(
      `SELECT m.*, n.body_text AS note_text
         FROM comms_hub_mentions m
         LEFT JOIN comms_hub_internal_notes n ON n.id = m.note_id
        WHERE m.mentioned_actor = ? AND (? = '' OR m.status = ?)
        ORDER BY m.created_at DESC LIMIT ?`,
      [actor, status, status, Math.min(Math.max(Number(limit) || 50, 1), 200)]
    );
    return rows(result);
  }

  async markMention({ id, actor, status, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_mentions
          SET status = ?, read_at = CASE WHEN ? = 'read' THEN ? ELSE read_at END
        WHERE id = ? AND mentioned_actor = ?
        RETURNING *`,
      [status, status, at, id, actor]
    );
    return rows(result)[0] || null;
  }

  async upsertSavedReply({ id, key, label, channel, bodyTemplate, variables, actor, at = nowIso() }) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_saved_replies
        (id, reply_key, label, channel, body_template, variables_json, created_by, created_at, updated_at, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
       ON CONFLICT(reply_key) DO UPDATE SET
         label = excluded.label, channel = excluded.channel, body_template = excluded.body_template,
         variables_json = excluded.variables_json, updated_at = excluded.updated_at, active = 1
       RETURNING *`,
      [id, key, label, channel, bodyTemplate, json(variables), actor, at, at]
    );
    return rows(result)[0] || null;
  }

  async getSavedReply(key) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_saved_replies WHERE reply_key = ? AND active = 1`,
      [key]
    );
    return rows(result)[0] || null;
  }

  async listSavedReplies({ channel = "" } = {}) {
    const family = channelFamily(channel);
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_saved_replies
        WHERE active = 1 AND (? = '' OR channel IN ('any', ?, ?))
        ORDER BY label`,
      [channel, channel, family]
    );
    return rows(result).map((row) => ({ ...row, variables: parseJson(row.variables_json, []) }));
  }

  async ensureAttachmentReference({ id, messageId, provider, providerUrl = "", filename, status = "pending", createdAt = nowIso(), metadata = {} }) {
    await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_attachments
        (id, message_id, provider, provider_url, filename, status, created_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, messageId, provider, providerUrl, filename, status, createdAt, json(metadata)]
    );
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_attachments WHERE id = ? AND message_id = ?`,
      [id, messageId]
    );
    const attachment = rows(result)[0] || null;
    if (!attachment) throw new CommsHubError(409, "attachment_parent_mismatch", "Attachment does not belong to the supplied message.");
    return attachment;
  }

  async recordAttachmentObject(record) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_attachment_objects
        (id, attachment_id, bucket_name, object_key, sha256, size_bytes, content_type,
         scan_status, scan_provider, scan_reference, scanned_at, stored_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(attachment_id) DO UPDATE SET
         bucket_name = excluded.bucket_name, object_key = excluded.object_key,
         sha256 = excluded.sha256, size_bytes = excluded.size_bytes, content_type = excluded.content_type,
         scan_status = excluded.scan_status, scan_provider = excluded.scan_provider,
         scan_reference = excluded.scan_reference, scanned_at = excluded.scanned_at,
         metadata_json = excluded.metadata_json
       RETURNING *`,
      [record.id, record.attachmentId, record.bucketName, record.objectKey, record.sha256,
        record.sizeBytes, record.contentType, record.scanStatus, record.scanProvider || null,
        record.scanReference || null, record.scannedAt || null, record.storedAt, json(record.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async getAttachmentObject(attachmentId) {
    const result = await this.d1.query(
      `SELECT ao.*, a.filename, a.provider, a.status AS attachment_status
         FROM comms_hub_attachment_objects ao
         JOIN comms_hub_attachments a ON a.id = ao.attachment_id
        WHERE ao.attachment_id = ? AND ao.deleted_at IS NULL`,
      [attachmentId]
    );
    return rows(result)[0] || null;
  }

  async consumeWebhookNonce({ source, nonce, payloadSha256, receivedAt, expiresAt }) {
    const result = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_webhook_nonces
        (source, nonce, payload_sha256, received_at, expires_at)
       VALUES (?, ?, ?, ?, ?) RETURNING nonce`,
      [source, nonce, payloadSha256, receivedAt, expiresAt]
    );
    return Boolean(rows(result).length);
  }

  async deleteExpiredWebhookNonces(at = nowIso()) {
    const result = await this.d1.query(
      `DELETE FROM comms_hub_webhook_nonces WHERE expires_at <= ? RETURNING nonce`,
      [at]
    );
    return rows(result).length;
  }

  async recordAuditEvent(event) {
    const lastResult = await this.d1.query(
      `SELECT chain_sha256 FROM comms_hub_audit_events ORDER BY occurred_at DESC, id DESC LIMIT 1`
    );
    const previous = rows(lastResult)[0]?.chain_sha256 || null;
    const canonical = JSON.stringify({
      id: event.id,
      occurredAt: event.occurredAt,
      actor: event.actor,
      actorRole: event.actorRole,
      action: event.action,
      objectType: event.objectType,
      objectId: event.objectId || null,
      conversationId: event.conversationId || null,
      requestId: event.requestId || null,
      outcome: event.outcome,
      beforeSha256: event.beforeSha256 || null,
      afterSha256: event.afterSha256 || null,
      details: event.details || {},
      previous,
    });
    const chainSha256 = sha256Hex(canonical);
    await this.d1.query(
      `INSERT INTO comms_hub_audit_events
        (id, occurred_at, actor, actor_role, action, object_type, object_id, conversation_id,
         request_id, outcome, before_sha256, after_sha256, details_json,
         chain_previous_sha256, chain_sha256)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [event.id, event.occurredAt, event.actor, event.actorRole, event.action, event.objectType,
        event.objectId || null, event.conversationId || null, event.requestId || null,
        event.outcome, event.beforeSha256 || null, event.afterSha256 || null,
        json(event.details || {}), previous, chainSha256]
    );
    return { ...event, chainPreviousSha256: previous, chainSha256 };
  }

  async listAuditEvents({ conversationId = "", objectType = "", objectId = "", limit = 200 } = {}) {
    const clauses = [];
    const params = [];
    if (conversationId) { clauses.push("conversation_id = ?"); params.push(conversationId); }
    if (objectType) { clauses.push("object_type = ?"); params.push(objectType); }
    if (objectId) { clauses.push("object_id = ?"); params.push(objectId); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_audit_events ${where}
       ORDER BY occurred_at DESC, id DESC LIMIT ?`,
      [...params, Math.min(Math.max(Number(limit) || 100, 1), 500)]
    );
    return rows(result).map((row) => ({ ...row, details: parseJson(row.details_json, {}) }));
  }

  async upsertWorkflowDefinition(definition) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_workflow_definitions
        (id, workflow_key, version, name, status, definition_json, definition_sha256,
         created_by, created_at, activated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [definition.id, definition.key, definition.version, definition.name, definition.status,
        json(definition.definition), definition.sha256, definition.actor, definition.createdAt,
        definition.status === "active" ? definition.createdAt : null]
    );
    return rows(result)[0] || null;
  }

  async activateWorkflowDefinition({ key, version, actor, at = nowIso() }) {
    const results = await this.d1.batch([
      {
        sql: `UPDATE comms_hub_workflow_definitions
                SET status = 'retired', retired_at = ?
              WHERE workflow_key = ? AND status = 'active' AND version <> ?`,
        params: [at, key, version],
      },
      {
        sql: `UPDATE comms_hub_workflow_definitions
                SET status = 'active', activated_at = ?, retired_at = NULL
              WHERE workflow_key = ? AND version = ?
              RETURNING *`,
        params: [at, key, version],
      },
    ]);
    const activated = rows(results[1])[0] || null;
    if (!activated) throw new CommsHubError(404, "workflow_definition_not_found", "Workflow definition was not found.");
    return { ...activated, activated_by: actor };
  }

  async listWorkflowDefinitions({ key = "", status = "" } = {}) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_workflow_definitions
        WHERE (? = '' OR workflow_key = ?) AND (? = '' OR status = ?)
        ORDER BY workflow_key, version DESC`,
      [key, key, status, status]
    );
    return rows(result).map((row) => ({ ...row, definition: parseJson(row.definition_json, {}) }));
  }

  async getWorkflowDefinition({ key, version = null, activeOnly = false }) {
    const clauses = ["workflow_key = ?"];
    const params = [key];
    if (version !== null && version !== undefined) {
      clauses.push("version = ?");
      params.push(Number(version));
    }
    if (activeOnly) clauses.push("status = 'active'");
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_workflow_definitions
        WHERE ${clauses.join(" AND ")}
        ORDER BY version DESC LIMIT 1`,
      params
    );
    const row = rows(result)[0] || null;
    return row ? { ...row, definition: parseJson(row.definition_json, {}) } : null;
  }

  async upsertRoutingRule(rule) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_routing_rules
        (id, rule_key, priority, status, conditions_json, actions_json, stop_processing,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(rule_key) DO UPDATE SET
         priority = excluded.priority, status = excluded.status,
         conditions_json = excluded.conditions_json, actions_json = excluded.actions_json,
         stop_processing = excluded.stop_processing, updated_at = excluded.updated_at
       RETURNING *`,
      [rule.id, rule.key, rule.priority, rule.status, json(rule.conditions), json(rule.actions),
        rule.stopProcessing ? 1 : 0, rule.actor, rule.createdAt, rule.createdAt]
    );
    return rows(result)[0] || null;
  }

  async listActiveRoutingRules() {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_routing_rules WHERE status = 'active' ORDER BY priority ASC, rule_key ASC`
    );
    return rows(result).map((row) => ({
      ...row,
      conditions: parseJson(row.conditions_json, {}),
      actions: parseJson(row.actions_json, []),
      stop_processing: Boolean(row.stop_processing),
    }));
  }

  async scheduleDelayedAction(action) {
    const result = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_delayed_actions
        (id, conversation_id, action_type, payload_json, due_at, status, attempts, max_attempts,
         idempotency_key, next_attempt_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'scheduled', 0, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [action.id, action.conversationId, action.actionType, json(action.payload || {}), action.dueAt,
        action.maxAttempts || 8, action.idempotencyKey, action.dueAt, action.actor, action.createdAt, action.createdAt]
    );
    if (rows(result)[0]) return rows(result)[0];
    const existing = await this.d1.query(`SELECT * FROM comms_hub_delayed_actions WHERE idempotency_key = ?`, [action.idempotencyKey]);
    return rows(existing)[0] || null;
  }

  async claimDelayedAction({ workerId, now, leaseExpiresAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_delayed_actions
          SET status = 'leased', lease_owner = ?, lease_expires_at = ?,
              attempts = attempts + 1, updated_at = ?
        WHERE id = (
          SELECT id FROM comms_hub_delayed_actions
           WHERE attempts < max_attempts AND due_at <= ? AND next_attempt_at <= ?
             AND (status IN ('scheduled','failed') OR
                  (status = 'leased' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)))
           ORDER BY due_at ASC LIMIT 1
        ) RETURNING *`,
      [workerId, leaseExpiresAt, now, now, now, now]
    );
    return rows(result)[0] || null;
  }

  async claimDelayedActionById({ id, workerId, now, leaseExpiresAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_delayed_actions
          SET status = 'leased', lease_owner = ?, lease_expires_at = ?,
              attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND attempts < max_attempts AND due_at <= ? AND next_attempt_at <= ?
          AND status IN ('scheduled','failed')
        RETURNING *`,
      [workerId, leaseExpiresAt, now, id, now, now]
    );
    return rows(result)[0] || null;
  }

  async resetDelayedActionForReplay(id, at = nowIso()) {
    const result = await this.d1.query(
      `UPDATE comms_hub_delayed_actions
          SET status = 'scheduled', attempts = 0, next_attempt_at = ?, due_at = ?,
              lease_owner = NULL, lease_expires_at = NULL,
              failure_class = NULL, error = NULL, updated_at = ?
        WHERE id = ? AND status IN ('failed','quarantined') RETURNING *`,
      [at, at, at, id]
    );
    return rows(result)[0] || null;
  }

  async completeDelayedAction({ id, workerId, completedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_delayed_actions
          SET status = 'complete', completed_at = ?, lease_owner = NULL,
              lease_expires_at = NULL, updated_at = ?, failure_class = NULL, error = NULL
        WHERE id = ? AND status = 'leased' AND lease_owner = ? RETURNING *`,
      [completedAt, completedAt, id, workerId]
    );
    if (!rows(result).length) throw new CommsHubError(409, "delayed_action_lease_lost", "Delayed action lease was lost.");
    return rows(result)[0];
  }

  async failDelayedAction({ id, workerId, status, failureClass, error, nextAttemptAt, failedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_delayed_actions
          SET status = ?, failure_class = ?, error = ?, next_attempt_at = ?,
              lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE id = ? AND status = 'leased' AND lease_owner = ? RETURNING *`,
      [status, failureClass, text(error, 1000), nextAttemptAt, failedAt, id, workerId]
    );
    return rows(result)[0] || null;
  }

  async createEscalation(escalation) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_escalations
        (id, conversation_id, category, severity, reason, status, assigned_to,
         source, created_by, created_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)
       RETURNING *`,
      [escalation.id, escalation.conversationId, escalation.category, escalation.severity,
        escalation.reason, escalation.assignedTo || null, escalation.source, escalation.actor,
        escalation.createdAt, json(escalation.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async listEscalations({ status = "open", severity = "", limit = 100 } = {}) {
    const result = await this.d1.query(
      `SELECT e.*, c.channel, c.subject, c.last_message_at
         FROM comms_hub_escalations e
         JOIN comms_hub_conversations c ON c.id = e.conversation_id
        WHERE (? = '' OR e.status = ?) AND (? = '' OR e.severity = ?)
        ORDER BY CASE e.severity WHEN 'critical' THEN 0 ELSE 1 END, e.created_at ASC
        LIMIT ?`,
      [status, status, severity, severity, Math.min(Math.max(Number(limit) || 100, 1), 200)]
    );
    return rows(result);
  }

  async upsertSlaPolicy(policy) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_sla_policies
        (id, policy_key, channel, priority_label, first_response_minutes, resolution_minutes,
         business_hours_json, active, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(policy_key) DO UPDATE SET
         channel = excluded.channel, priority_label = excluded.priority_label,
         first_response_minutes = excluded.first_response_minutes,
         resolution_minutes = excluded.resolution_minutes,
         business_hours_json = excluded.business_hours_json,
         active = excluded.active, updated_at = excluded.updated_at
       RETURNING *`,
      [policy.id, policy.key, policy.channel, policy.priorityLabel, policy.firstResponseMinutes,
        policy.resolutionMinutes, json(policy.businessHours || {}), policy.active ? 1 : 0,
        policy.actor, policy.createdAt, policy.createdAt]
    );
    return rows(result)[0] || null;
  }

  async findSlaPolicy({ channel, priorityLabel }) {
    const family = channelFamily(channel);
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_sla_policies
        WHERE active = 1 AND channel IN (?, ?, 'any') AND priority_label IN (?, 'any')
        ORDER BY CASE WHEN channel = ? THEN 0 WHEN channel = ? THEN 1 ELSE 2 END,
                 CASE WHEN priority_label = ? THEN 0 ELSE 1 END
        LIMIT 1`,
      [channel, family, priorityLabel, channel, family, priorityLabel]
    );
    return rows(result)[0] || null;
  }

  async setConversationSla({ conversationId, responseDueAt, resolutionDueAt, actor, at = nowIso() }) {
    await this.ensureConversationOperations(conversationId, actor, at);
    const result = await this.d1.query(
      `UPDATE comms_hub_conversation_operations
          SET response_due_at = ?, resolution_due_at = ?, updated_by = ?, updated_at = ?, version = version + 1
        WHERE conversation_id = ? RETURNING *`,
      [responseDueAt, resolutionDueAt, actor, at, conversationId]
    );
    return rows(result)[0] || null;
  }

  async upsertAutonomousPolicy(policy) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_autonomous_reply_policies
        (id, policy_key, channel, intent, maximum_risk, minimum_confidence, require_evidence,
         allowed_hours_json, maximum_per_hour, status, created_by, approved_by,
         created_at, approved_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(policy_key) DO UPDATE SET
         channel = excluded.channel, intent = excluded.intent,
         maximum_risk = excluded.maximum_risk, minimum_confidence = excluded.minimum_confidence,
         require_evidence = excluded.require_evidence, allowed_hours_json = excluded.allowed_hours_json,
         maximum_per_hour = excluded.maximum_per_hour, status = excluded.status,
         approved_by = excluded.approved_by, approved_at = excluded.approved_at,
         updated_at = excluded.updated_at
       RETURNING *`,
      [policy.id, policy.key, policy.channel, policy.intent, policy.maximumRisk, policy.minimumConfidence,
        policy.requireEvidence ? 1 : 0, json(policy.allowedHours || {}), policy.maximumPerHour,
        policy.status, policy.actor, policy.approvedBy || null, policy.createdAt,
        policy.status === "active" ? policy.createdAt : null, policy.createdAt]
    );
    return rows(result)[0] || null;
  }

  async findAutonomousPolicy({ channel, intent }) {
    const family = channelFamily(channel);
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_autonomous_reply_policies
        WHERE status = 'active' AND channel IN (?, ?, 'any') AND intent IN (?, 'any')
        ORDER BY CASE WHEN channel = ? THEN 0 WHEN channel = ? THEN 1 ELSE 2 END,
                 CASE WHEN intent = ? THEN 0 ELSE 1 END
        LIMIT 1`,
      [channel, family, intent, channel, family, intent]
    );
    return rows(result)[0] || null;
  }

  async countAutonomousSendsSince(policyKey, since) {
    const result = await this.d1.query(
      `SELECT COUNT(*) AS count FROM comms_hub_audit_events
        WHERE action = 'autonomous_reply_sent'
          AND occurred_at >= ?
          AND json_extract(details_json, '$.policyKey') = ?`,
      [since, policyKey]
    );
    return Number(rows(result)[0]?.count || 0);
  }

  async upsertRetentionPolicy(policy) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_retention_policies
        (id, policy_key, channel, retain_days, action, legal_hold_tag, active,
         created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(policy_key) DO UPDATE SET
         channel = excluded.channel, retain_days = excluded.retain_days,
         action = excluded.action, legal_hold_tag = excluded.legal_hold_tag,
         active = excluded.active, updated_at = excluded.updated_at
       RETURNING *`,
      [policy.id, policy.key, policy.channel, policy.retainDays, policy.action,
        policy.legalHoldTag || null, policy.active ? 1 : 0, policy.actor,
        policy.createdAt, policy.createdAt]
    );
    return rows(result)[0] || null;
  }

  async listDueRetentionCandidates(at = nowIso(), limit = 100) {
    const result = await this.d1.query(
      `SELECT c.id AS conversation_id, c.contact_id, c.channel, c.updated_at,
              p.id AS policy_id, p.policy_key, p.retain_days, p.action, p.legal_hold_tag
         FROM comms_hub_conversations c
         JOIN comms_hub_retention_policies p ON p.active = 1 AND (p.channel IN (c.channel, 'any') OR (c.channel IN ('social_dm','social_comment') AND p.channel = 'social'))
        WHERE c.updated_at <= datetime(?, '-' || p.retain_days || ' days')
          AND NOT EXISTS (
            SELECT 1 FROM comms_hub_retention_jobs j
             WHERE j.conversation_id = c.id AND j.status IN ('pending','processing','complete')
          )
          AND (p.legal_hold_tag IS NULL OR NOT EXISTS (
            SELECT 1 FROM comms_hub_conversation_tags ct
            JOIN comms_hub_tags t ON t.id = ct.tag_id
            WHERE ct.conversation_id = c.id AND t.tag_key = p.legal_hold_tag
          ))
        ORDER BY c.updated_at ASC LIMIT ?`,
      [at, Math.min(Math.max(Number(limit) || 100, 1), 500)]
    );
    return rows(result);
  }

  async createRetentionJob(job) {
    const result = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_retention_jobs
        (id, policy_id, contact_id, conversation_id, action, status,
         requested_by, requested_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)
       RETURNING *`,
      [job.id, job.policyId || null, job.contactId || null, job.conversationId || null,
        job.action, job.actor, job.requestedAt, json(job.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async getRetentionJobForReplay(id) {
    const result = await this.d1.query(
      `SELECT j.*, COALESCE(p.policy_key, 'manual') AS policy_key
         FROM comms_hub_retention_jobs j
         LEFT JOIN comms_hub_retention_policies p ON p.id = j.policy_id
        WHERE j.id = ?`,
      [id]
    );
    return rows(result)[0] || null;
  }

  async updateRetentionJob({ id, status, exportObjectKey = null, error = null, completedAt = null }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_retention_jobs
          SET status = ?, export_object_key = COALESCE(?, export_object_key),
              error = ?, completed_at = ?
        WHERE id = ? RETURNING *`,
      [status, exportObjectKey, error, completedAt, id]
    );
    return rows(result)[0] || null;
  }

  async anonymiseConversation({ conversationId, contactId, at = nowIso() }) {
    const pseudonym = `deleted-${sha256Hex(contactId).slice(0, 12)}`;
    const otherResult = await this.d1.query(
      `SELECT COUNT(*) AS count FROM comms_hub_conversations WHERE contact_id = ? AND id <> ?`,
      [contactId, conversationId]
    );
    const redactContact = Number(rows(otherResult)[0]?.count || 0) === 0;
    const statements = [
      {
        sql: `UPDATE comms_hub_messages SET sender = NULL, recipients_json = '[]', body_text = '[deleted]', body_html = NULL,
                metadata_json = '{"retention":"anonymised"}' WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_conversation_operations SET operational_status = 'archived', updated_by = 'retention', updated_at = ?, version = version + 1 WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
    ];
    if (redactContact) {
      statements.push(
        {
          sql: `UPDATE comms_hub_contacts SET primary_email = NULL, display_name = ?, phone = NULL, updated_at = ? WHERE id = ?`,
          params: [pseudonym, at, contactId],
        },
        {
          sql: `DELETE FROM comms_hub_contact_aliases WHERE contact_id = ?`,
          params: [contactId],
        }
      );
    }
    await this.d1.batch(statements);
    return { conversationId, contactId, pseudonym: redactContact ? pseudonym : null, contactRedacted: redactContact, at };
  }

  async listAttachmentObjectsForConversation(conversationId) {
    const result = await this.d1.query(
      `SELECT ao.*, a.filename
         FROM comms_hub_attachment_objects ao
         JOIN comms_hub_attachments a ON a.id = ao.attachment_id
         JOIN comms_hub_messages m ON m.id = a.message_id
        WHERE m.conversation_id = ? AND ao.deleted_at IS NULL AND ao.scan_status = 'clean'`,
      [conversationId]
    );
    return rows(result);
  }

  async deleteConversationContent({ conversationId, contactId, at = nowIso() }) {
    const otherResult = await this.d1.query(
      `SELECT COUNT(*) AS count
         FROM comms_hub_conversations
        WHERE contact_id = ? AND id <> ?
          AND COALESCE(json_extract(metadata_json, '$.retention'), '') <> 'deleted'`,
      [contactId, conversationId]
    );
    const redactContact = Number(rows(otherResult)[0]?.count || 0) === 0;
    const pseudonym = `deleted-${sha256Hex(contactId).slice(0, 12)}`;
    const deletedHash = sha256Hex("{}");
    const statements = [
      {
        sql: `UPDATE comms_hub_attachment_objects
                SET deleted_at = ?, metadata_json = '{"retention":"deleted"}'
              WHERE attachment_id IN (
                SELECT a.id FROM comms_hub_attachments a
                JOIN comms_hub_messages m ON m.id = a.message_id
                WHERE m.conversation_id = ?
              )`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_attachments
                SET provider_url = '', filename = '[deleted]', status = 'deleted',
                    metadata_json = '{"retention":"deleted"}'
              WHERE message_id IN (SELECT id FROM comms_hub_messages WHERE conversation_id = ?)`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_messages
                SET sender = NULL, recipients_json = '[]', subject = '[deleted]',
                    body_text = '[deleted]', body_html = NULL,
                    metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_internal_notes
                SET body_text = '[deleted]', deleted_at = ?, updated_at = ?,
                    metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [at, at, conversationId],
      },
      { sql: `DELETE FROM comms_hub_mentions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_search_documents WHERE conversation_id = ?`, params: [conversationId] },
      {
        sql: `UPDATE comms_hub_reply_drafts
                SET body_text = '[deleted]', evidence_ids_json = '[]',
                    metadata_json = '{"retention":"deleted"}', updated_at = ?
              WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_ai_evidence
                SET title = NULL, excerpt = '[deleted]', metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_ai_runs
                SET rationale = NULL, error = NULL, metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_intake_events
                SET payload_json = '{}', payload_sha256 = ?
              WHERE conversation_id = ?`,
        params: [deletedHash, conversationId],
      },
      {
        sql: `UPDATE comms_hub_social_events
                SET payload_json = '{}', payload_sha256 = ?
              WHERE conversation_id = ?`,
        params: [deletedHash, conversationId],
      },
      {
        sql: `UPDATE comms_hub_social_threads
                SET participant_id = NULL, metadata_json = '{"retention":"deleted"}', updated_at = ?
              WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_email_threads
                SET internet_message_id = NULL, references_json = '[]',
                    metadata_json = '{"retention":"deleted"}', updated_at = ?
              WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_chat_sessions
                SET visitor_id = ?, metadata_json = '{"retention":"deleted"}',
                    mode = 'closed', assigned_actor = NULL, takeover_ended_at = ?, updated_at = ?
              WHERE conversation_id = ?`,
        params: [pseudonym, at, at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_channel_outbound_actions
                SET provider_response_json = NULL, error = NULL
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_social_outbound_actions
                SET provider_response_json = NULL, error = NULL
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_moderation_actions
                SET provider_response_json = NULL, error = NULL
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_approvals
                SET decision_reason = NULL, metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_follow_ups
                SET reason = '[deleted]', error = NULL, metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_workflow_runs
                SET data_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_workflow_events
                SET details_json = '{"retention":"deleted"}'
              WHERE workflow_run_id IN (SELECT id FROM comms_hub_workflow_runs WHERE conversation_id = ?)`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_delayed_actions
                SET payload_json = '{"retention":"deleted"}', error = NULL,
                    status = CASE WHEN status IN ('scheduled','leased','failed') THEN 'cancelled' ELSE status END,
                    updated_at = ?
              WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_escalations
                SET reason = '[deleted]', metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_notifications
                SET title = 'Deleted conversation', body_text = '[deleted]',
                    metadata_json = '{"retention":"deleted"}'
              WHERE conversation_id = ?`,
        params: [conversationId],
      },
      {
        sql: `UPDATE comms_hub_quarantine_items
                SET payload_reference = NULL, error_message = NULL,
                    metadata_json = '{"retention":"deleted"}', updated_at = ?
              WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_conversations
                SET subject = '[deleted]', status = 'closed',
                    metadata_json = '{"retention":"deleted"}', updated_at = ?
              WHERE id = ?`,
        params: [at, conversationId],
      },
      {
        sql: `UPDATE comms_hub_conversation_operations
                SET operational_status = 'archived', owner_type = NULL, owner_id = NULL,
                    team_id = NULL, snoozed_until = NULL, escalation_reason = NULL,
                    updated_by = 'retention', updated_at = ?, version = version + 1
              WHERE conversation_id = ?`,
        params: [at, conversationId],
      },
    ];
    if (redactContact) {
      statements.push(
        {
          sql: `UPDATE comms_hub_contacts
                  SET primary_email = NULL, display_name = ?, phone = NULL, updated_at = ?
                WHERE id = ?`,
          params: [pseudonym, at, contactId],
        },
        { sql: `DELETE FROM comms_hub_contact_aliases WHERE contact_id = ?`, params: [contactId] },
        {
          sql: `UPDATE comms_hub_channel_identities
                  SET provider_contact_id = NULL, username = NULL, display_name = ?, avatar_url = NULL,
                      metadata_json = '{"retention":"deleted"}', updated_at = ?
                WHERE contact_id = ?`,
          params: [pseudonym, at, contactId],
        }
      );
    }
    await this.d1.batch(statements);
    return { conversationId, contactId, pseudonym: redactContact ? pseudonym : null, contactRedacted: redactContact, at };
  }

  async upsertQuarantineItem(item) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_quarantine_items
        (id, source_type, source_id, conversation_id, failure_class, status,
         payload_reference, error_code, error_message, attempts, idempotency_key,
         created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'quarantined', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(source_type, source_id) DO UPDATE SET
         failure_class = excluded.failure_class, status = 'quarantined',
         payload_reference = excluded.payload_reference, error_code = excluded.error_code,
         error_message = excluded.error_message, attempts = excluded.attempts,
         updated_at = excluded.updated_at, metadata_json = excluded.metadata_json
       RETURNING *`,
      [item.id, item.sourceType, item.sourceId, item.conversationId || null,
        item.failureClass, item.payloadReference || null, item.errorCode || null,
        text(item.errorMessage, 1000) || null, item.attempts || 0, item.idempotencyKey,
        item.createdAt, item.createdAt, json(item.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async listQuarantine({ status = "quarantined", failureClass = "", limit = 100 } = {}) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_quarantine_items
        WHERE (? = '' OR status = ?) AND (? = '' OR failure_class = ?)
        ORDER BY created_at ASC LIMIT ?`,
      [status, status, failureClass, failureClass, Math.min(Math.max(Number(limit) || 100, 1), 500)]
    );
    return rows(result).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
  }

  async getQuarantineItem(id) {
    const result = await this.d1.query(`SELECT * FROM comms_hub_quarantine_items WHERE id = ?`, [id]);
    return rows(result)[0] || null;
  }

  async beginQuarantineReplay({ id, actor, at = nowIso() }) {
    const itemResult = await this.d1.query(
      `UPDATE comms_hub_quarantine_items
          SET status = 'replay_pending', attempts = attempts + 1, updated_at = ?
        WHERE id = ? AND status IN ('quarantined','replay_pending') RETURNING *`,
      [at, id]
    );
    const item = rows(itemResult)[0] || null;
    if (!item) throw new CommsHubError(409, "quarantine_not_replayable", "Quarantine item is not replayable.");
    const attemptId = stableId("qat", id, String(item.attempts));
    await this.d1.query(
      `INSERT INTO comms_hub_quarantine_attempts
        (id, quarantine_id, attempt_number, actor, action, outcome, created_at)
       VALUES (?, ?, ?, ?, 'replay', 'started', ?)`,
      [attemptId, id, item.attempts, actor, at]
    );
    return { item, attemptId };
  }

  async finishQuarantineReplay({ id, attemptId, outcome, detail = "", at = nowIso() }) {
    const status = outcome === "success" ? "replayed" : "quarantined";
    await this.d1.batch([
      {
        sql: `UPDATE comms_hub_quarantine_items SET status = ?, updated_at = ?, resolved_at = CASE WHEN ? = 'success' THEN ? ELSE resolved_at END WHERE id = ?`,
        params: [status, at, outcome, at, id],
      },
      {
        sql: `UPDATE comms_hub_quarantine_attempts SET outcome = ?, detail = ? WHERE id = ?`,
        params: [outcome, text(detail, 1000) || null, attemptId],
      },
    ]);
  }

  async createNotification(notification) {
    const result = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_notifications
        (id, actor, conversation_id, type, title, body_text, severity, status,
         email_requested, created_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unread', ?, ?, ?)
       RETURNING *`,
      [notification.id, notification.actor, notification.conversationId || null,
        notification.type, notification.title, notification.bodyText, notification.severity,
        notification.emailRequested ? 1 : 0, notification.createdAt, json(notification.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async listNotifications({ actor, status = "unread", limit = 100 }) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_notifications
        WHERE actor = ? AND (? = '' OR status = ?)
        ORDER BY created_at DESC LIMIT ?`,
      [actor, status, status, Math.min(Math.max(Number(limit) || 100, 1), 200)]
    );
    return rows(result).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
  }

  async markNotification({ id, actor, status, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_notifications
          SET status = ?, read_at = CASE WHEN ? = 'read' THEN ? ELSE read_at END
        WHERE id = ? AND actor = ? RETURNING *`,
      [status, status, at, id, actor]
    );
    return rows(result)[0] || null;
  }

  async upsertEmailThread(thread) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_email_threads
        (id, conversation_id, account_key, mailbox, provider_thread_key,
         internet_message_id, references_json, last_uid, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_key, mailbox, provider_thread_key) DO UPDATE SET
         internet_message_id = COALESCE(excluded.internet_message_id, comms_hub_email_threads.internet_message_id),
         references_json = excluded.references_json,
         last_uid = COALESCE(excluded.last_uid, comms_hub_email_threads.last_uid),
         updated_at = excluded.updated_at, metadata_json = excluded.metadata_json
       RETURNING *`,
      [thread.id, thread.conversationId, thread.accountKey, thread.mailbox,
        thread.providerThreadKey, thread.internetMessageId || null, json(thread.references || []),
        thread.lastUid || null, thread.createdAt, thread.updatedAt || thread.createdAt,
        json(thread.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async findEmailThread({ accountKey, mailbox, providerThreadKey, internetMessageId = "" }) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_email_threads
        WHERE account_key = ? AND mailbox = ?
          AND (provider_thread_key = ? OR (? <> '' AND internet_message_id = ?))
        LIMIT 1`,
      [accountKey, mailbox, providerThreadKey, internetMessageId, internetMessageId]
    );
    return rows(result)[0] || null;
  }

  async upsertChatSession(session) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_chat_sessions
        (id, conversation_id, provider, provider_session_id, website_id, visitor_id,
         mode, assigned_actor, created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, website_id, provider_session_id) DO UPDATE SET
         visitor_id = excluded.visitor_id, updated_at = excluded.updated_at,
         metadata_json = excluded.metadata_json
       RETURNING *`,
      [session.id, session.conversationId, session.provider, session.providerSessionId,
        session.websiteId, session.visitorId, session.mode || "automation",
        session.assignedActor || null, session.createdAt, session.updatedAt || session.createdAt,
        json(session.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async getChatSessionByConversation(conversationId) {
    const result = await this.d1.query(`SELECT * FROM comms_hub_chat_sessions WHERE conversation_id = ?`, [conversationId]);
    return rows(result)[0] || null;
  }

  async getChatSession({ provider = "coginpal", websiteId, providerSessionId }) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_chat_sessions
        WHERE provider = ? AND website_id = ? AND provider_session_id = ?
        LIMIT 1`,
      [provider, websiteId, providerSessionId]
    );
    return rows(result)[0] || null;
  }

  async countRecentChatInbound({ conversationId, since }) {
    const result = await this.d1.query(
      `SELECT COUNT(*) AS count FROM comms_hub_messages
        WHERE conversation_id = ? AND direction = 'inbound' AND received_at >= ?`,
      [conversationId, since]
    );
    return Number(rows(result)[0]?.count || 0);
  }

  async listChatMessages({ conversationId, after = "", limit = 100 }) {
    const safeLimit = Math.min(Math.max(Number(limit) || 100, 1), 250);
    const result = await this.d1.query(
      `SELECT id, direction, sender, body_text, provider_message_id, received_at, created_at, metadata_json
         FROM comms_hub_messages
        WHERE conversation_id = ? AND (? = '' OR received_at > ?)
        ORDER BY received_at ASC
        LIMIT ?`,
      [conversationId, after, after, safeLimit]
    );
    return rows(result).map((row) => ({
      id: row.id,
      direction: row.direction,
      sender: row.sender || null,
      bodyText: row.body_text || "",
      providerMessageId: row.provider_message_id || null,
      receivedAt: row.received_at,
      createdAt: row.created_at,
      metadata: parseJson(row.metadata_json, {}),
    }));
  }

  async updateChatTakeover({ conversationId, mode, actor = null, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_chat_sessions
          SET mode = ?, assigned_actor = ?,
              takeover_requested_at = CASE WHEN ? = 'takeover_requested' THEN ? ELSE takeover_requested_at END,
              takeover_started_at = CASE WHEN ? = 'human' THEN ? ELSE takeover_started_at END,
              takeover_ended_at = CASE WHEN ? IN ('automation','closed') THEN ? ELSE takeover_ended_at END,
              updated_at = ?
        WHERE conversation_id = ? RETURNING *`,
      [mode, actor, mode, at, mode, at, mode, at, at, conversationId]
    );
    return rows(result)[0] || null;
  }

  async indexSearchDocument(document) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_search_documents
        (id, object_type, object_id, conversation_id, contact_id, channel,
         searchable_text, metadata_json, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(object_type, object_id) DO UPDATE SET
         conversation_id = excluded.conversation_id, contact_id = excluded.contact_id,
         channel = excluded.channel, searchable_text = excluded.searchable_text,
         metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
       RETURNING *`,
      [document.id, document.objectType, document.objectId, document.conversationId || null,
        document.contactId || null, document.channel || null, document.searchableText,
        json(document.metadata || {}), document.updatedAt]
    );
    return rows(result)[0] || null;
  }

  async search({ query, objectType = "", channel = "", contactId = "", conversationId = "", limit = 100 }) {
    const tokens = text(query, 500).toLowerCase().split(/\s+/).filter((token) => token.length >= 2).slice(0, 10);
    if (!tokens.length) return [];
    const clauses = tokens.map(() => "LOWER(searchable_text) LIKE ? ESCAPE '\\'");
    const params = tokens.map((token) => `%${token.replace(/[%_]/g, "\\$&")}%`);
    if (objectType) { clauses.push("object_type = ?"); params.push(objectType); }
    if (channel) { clauses.push("channel = ?"); params.push(channel); }
    if (contactId) { clauses.push("contact_id = ?"); params.push(contactId); }
    if (conversationId) { clauses.push("conversation_id = ?"); params.push(conversationId); }
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_search_documents
        WHERE ${clauses.join(" AND ")}
        ORDER BY updated_at DESC LIMIT ?`,
      [...params, Math.min(Math.max(Number(limit) || 50, 1), 200)]
    );
    return rows(result).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
  }

  async metrics({ from, to }) {
    const [volume, response, resolution, automation, failures, channel] = await Promise.all([
      this.d1.query(
        `SELECT COUNT(*) AS conversations,
                SUM((SELECT COUNT(*) FROM comms_hub_messages m WHERE m.conversation_id = c.id)) AS messages
           FROM comms_hub_conversations c WHERE c.created_at >= ? AND c.created_at < ?`, [from, to]
      ),
      this.d1.query(
        `SELECT AVG((julianday(o.first_response_at) - julianday(c.created_at)) * 86400) AS average_seconds,
                COUNT(o.first_response_at) AS measured
           FROM comms_hub_conversation_operations o
           JOIN comms_hub_conversations c ON c.id = o.conversation_id
          WHERE c.created_at >= ? AND c.created_at < ? AND o.first_response_at IS NOT NULL`, [from, to]
      ),
      this.d1.query(
        `SELECT AVG((julianday(o.resolved_at) - julianday(c.created_at)) * 86400) AS average_seconds,
                COUNT(o.resolved_at) AS resolved
           FROM comms_hub_conversation_operations o
           JOIN comms_hub_conversations c ON c.id = o.conversation_id
          WHERE c.created_at >= ? AND c.created_at < ? AND o.resolved_at IS NOT NULL`, [from, to]
      ),
      this.d1.query(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN json_extract(details_json, '$.automated') = 1 THEN 1 ELSE 0 END) AS automated
           FROM comms_hub_audit_events
          WHERE action IN ('reply_sent','autonomous_reply_sent') AND occurred_at >= ? AND occurred_at < ?`, [from, to]
      ),
      this.d1.query(
        `SELECT failure_class, COUNT(*) AS count FROM comms_hub_quarantine_items
          WHERE created_at >= ? AND created_at < ? GROUP BY failure_class`, [from, to]
      ),
      this.d1.query(
        `SELECT channel, COUNT(*) AS conversations,
                SUM((SELECT COUNT(*) FROM comms_hub_messages m WHERE m.conversation_id = c.id)) AS messages
           FROM comms_hub_conversations c
          WHERE c.created_at >= ? AND c.created_at < ? GROUP BY channel ORDER BY channel`, [from, to]
      ),
    ]);
    const automationRow = rows(automation)[0] || {};
    const total = Number(automationRow.total || 0);
    return {
      period: { from, to },
      volume: rows(volume)[0] || { conversations: 0, messages: 0 },
      responseTime: rows(response)[0] || { average_seconds: null, measured: 0 },
      resolutionTime: rows(resolution)[0] || { average_seconds: null, resolved: 0 },
      automation: {
        total,
        automated: Number(automationRow.automated || 0),
        rate: total ? Number(automationRow.automated || 0) / total : 0,
      },
      failures: rows(failures),
      channels: rows(channel),
    };
  }

  async persistChannelMessage({ contact, conversation, message, attachments = [], at = nowIso() }) {
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
        params: [contact.id, contact.email || contact.primaryEmail || null, contact.displayName || null, contact.phone || null, at, at],
      },
      {
        sql: `INSERT INTO comms_hub_conversations
          (id, channel, provider, workflow, status, contact_id, subject, source_reference,
           created_at, updated_at, last_message_at, metadata_json)
         VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           subject = CASE WHEN comms_hub_conversations.subject = '' THEN excluded.subject ELSE comms_hub_conversations.subject END,
           updated_at = excluded.updated_at,
           last_message_at = CASE WHEN excluded.last_message_at > comms_hub_conversations.last_message_at THEN excluded.last_message_at ELSE comms_hub_conversations.last_message_at END,
           metadata_json = excluded.metadata_json`,
        params: [conversation.id, conversation.channel, conversation.provider, conversation.workflow,
          contact.id, conversation.subject, conversation.sourceReference, conversation.createdAt || at,
          at, message.receivedAt, json(conversation.metadata || {})],
      },
      {
        sql: `INSERT OR IGNORE INTO comms_hub_messages
          (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
           provider_message_id, received_at, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [message.id, conversation.id, message.direction, message.sender || null,
          json(message.recipients || []), message.subject || conversation.subject || '',
          message.bodyText || '', message.bodyHtml || null, message.providerMessageId,
          message.receivedAt, at, json(message.metadata || {})],
      },
      {
        sql: `INSERT OR IGNORE INTO comms_hub_conversation_operations
          (conversation_id, operational_status, version, updated_by, updated_at)
         VALUES (?, 'open', 1, 'channel-intake', ?)`,
        params: [conversation.id, at],
      },
    ];
    statements.push(
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
         VALUES (?, 'contact', ?, NULL, ?, ?, ?, '{}', ?)`,
        params: [stableId("srch", "contact", contact.id), contact.id, contact.id, conversation.channel,
          `${contact.displayName || ""} ${contact.email || contact.primaryEmail || ""} ${contact.phone || ""}`, at],
      },
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
         VALUES (?, 'conversation', ?, ?, ?, ?, ?, '{}', ?)`,
        params: [stableId("srch", "conversation", conversation.id), conversation.id, conversation.id,
          contact.id, conversation.channel, `${conversation.subject || ""} ${message.bodyText || ""}`, at],
      },
      {
        sql: `INSERT OR REPLACE INTO comms_hub_search_documents
          (id, object_type, object_id, conversation_id, contact_id, channel, searchable_text, metadata_json, updated_at)
         VALUES (?, 'message', ?, ?, ?, ?, ?, '{}', ?)`,
        params: [stableId("srch", "message", message.id), message.id, conversation.id, contact.id,
          conversation.channel, `${message.subject || ""} ${message.bodyText || ""} ${message.sender || ""}`, at],
      }
    );
    for (const attachment of attachments) {
      statements.push({
        sql: `INSERT OR IGNORE INTO comms_hub_attachments
          (id, message_id, provider, provider_url, filename, status, created_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [attachment.id, message.id, conversation.provider, attachment.providerUrl || '',
          attachment.filename, attachment.status || 'reference_only', at, json(attachment.metadata || {})],
      });
    }
    const results = await this.d1.batch(statements);
    const messageInserted = Number(results[2]?.meta?.changes || 0) > 0 || rows(results[2]).length > 0;
    return { duplicate: !messageInserted, conversationId: conversation.id, messageId: message.id };
  }

  async recordOutboundMessage({ id, conversationId, sender, recipients, subject, bodyText, bodyHtml = null, providerMessageId, receivedAt, metadata = {} }) {
    const result = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_messages
        (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html,
         provider_message_id, received_at, created_at, metadata_json)
       VALUES (?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [id, conversationId, sender || null, json(recipients || []), subject || '', bodyText || '', bodyHtml,
        providerMessageId, receivedAt, receivedAt, json(metadata)]
    );
    await this.d1.query(
      `UPDATE comms_hub_conversations SET updated_at = ?, last_message_at = ? WHERE id = ?`,
      [receivedAt, receivedAt, conversationId]
    );
    await this.d1.query(
      `UPDATE comms_hub_conversation_operations
          SET first_response_at = COALESCE(first_response_at, ?), updated_at = ?, version = version + 1
        WHERE conversation_id = ?`,
      [receivedAt, receivedAt, conversationId]
    );
    return rows(result)[0] || null;
  }

  async claimChannelOutboundAction({ id, idempotencyKey, conversationId, channel, actionType, requestSha256, at = nowIso() }) {
    const inserted = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_channel_outbound_actions
        (id, idempotency_key, conversation_id, channel, action_type, request_sha256,
         status, attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'processing', 1, ?, ?)
       RETURNING *`,
      [id, idempotencyKey, conversationId, channel, actionType, requestSha256, at, at]
    );
    if (rows(inserted)[0]) return { acquired: true, duplicate: false, action: rows(inserted)[0] };
    const existingResult = await this.d1.query(
      `SELECT * FROM comms_hub_channel_outbound_actions WHERE idempotency_key = ?`,
      [idempotencyKey]
    );
    const existing = rows(existingResult)[0] || null;
    if (!existing) return { acquired: false, duplicate: false, existing: null };
    if (existing.request_sha256 !== requestSha256 || existing.conversation_id !== conversationId || existing.channel !== channel) {
      throw new CommsHubError(409, 'channel_idempotency_conflict', 'Idempotency key was already used for a different channel action.');
    }
    return { acquired: false, duplicate: existing.status === 'complete', existing };
  }

  async completeChannelOutboundAction({ idempotencyKey, providerMessageId, response, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_channel_outbound_actions
          SET status = 'complete', provider_message_id = ?, provider_response_json = ?,
              updated_at = ?, failure_class = NULL, error = NULL
        WHERE idempotency_key = ? RETURNING *`,
      [providerMessageId || null, json(response || {}), at, idempotencyKey]
    );
    return rows(result)[0] || null;
  }

  async failChannelOutboundAction({ idempotencyKey, failureClass, error, reconciliationRequired = false, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_channel_outbound_actions
          SET status = ?, failure_class = ?, error = ?, attempts = attempts + 1, updated_at = ?
        WHERE idempotency_key = ? RETURNING *`,
      [reconciliationRequired ? 'reconciliation_required' : 'failed', failureClass, text(error, 1000), at, idempotencyKey]
    );
    return rows(result)[0] || null;
  }

  async ensureEmailPollState({ accountKey, mailbox, at = nowIso() }) {
    await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_email_poll_state
        (account_key, mailbox, last_uid, next_attempt_at, attempts, created_at, updated_at)
       VALUES (?, ?, 0, ?, 0, ?, ?)`,
      [accountKey, mailbox, at, at, at]
    );
  }

  async getEmailPollState({ accountKey, mailbox }) {
    const result = await this.d1.query(
      `SELECT account_key, mailbox, last_uid, uid_validity, last_success_at, next_attempt_at,
              attempts, lease_owner, lease_expires_at, failure_class, created_at, updated_at
         FROM comms_hub_email_poll_state
        WHERE account_key = ? AND mailbox = ?
        LIMIT 1`,
      [accountKey, mailbox]
    );
    return rows(result)[0] || null;
  }

  async claimEmailPollState({ accountKey, mailbox, workerId, now, leaseExpiresAt }) {
    await this.ensureEmailPollState({ accountKey, mailbox, at: now });
    const result = await this.d1.query(
      `UPDATE comms_hub_email_poll_state
          SET lease_owner = ?, lease_expires_at = ?, attempts = attempts + 1, updated_at = ?
        WHERE account_key = ? AND mailbox = ? AND next_attempt_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        RETURNING *`,
      [workerId, leaseExpiresAt, now, accountKey, mailbox, now, now]
    );
    return rows(result)[0] || null;
  }

  async completeEmailPollState({ accountKey, mailbox, workerId, lastUid, uidValidity, nextAttemptAt, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_email_poll_state
          SET last_uid = ?, uid_validity = COALESCE(?, uid_validity), last_success_at = ?,
              next_attempt_at = ?, attempts = 0, lease_owner = NULL, lease_expires_at = NULL,
              failure_class = NULL, error = NULL, updated_at = ?
        WHERE account_key = ? AND mailbox = ? AND lease_owner = ? RETURNING *`,
      [lastUid, uidValidity, at, nextAttemptAt, at, accountKey, mailbox, workerId]
    );
    return rows(result)[0] || null;
  }

  async failEmailPollState({ accountKey, mailbox, workerId, failureClass, error, nextAttemptAt, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_email_poll_state
          SET failure_class = ?, error = ?, next_attempt_at = ?,
              lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
        WHERE account_key = ? AND mailbox = ? AND lease_owner = ? RETURNING *`,
      [failureClass, text(error, 1000), nextAttemptAt, at, accountKey, mailbox, workerId]
    );
    return rows(result)[0] || null;
  }

  async resetEmailPollStateForReplay({ accountKey, mailbox, at = nowIso() }) {
    await this.ensureEmailPollState({ accountKey, mailbox, at });
    const result = await this.d1.query(
      `UPDATE comms_hub_email_poll_state
          SET next_attempt_at = ?, attempts = 0, lease_owner = NULL, lease_expires_at = NULL,
              failure_class = NULL, error = NULL, updated_at = ?
        WHERE account_key = ? AND mailbox = ? RETURNING *`,
      [at, at, accountKey, mailbox]
    );
    return rows(result)[0] || null;
  }

  async getContactProfile(contactId) {
    const [contactResult, aliasesResult, identitiesResult, conversationsResult, linksResult] = await Promise.all([
      this.d1.query(`SELECT * FROM comms_hub_contacts WHERE id = ?`, [contactId]),
      this.d1.query(`SELECT * FROM comms_hub_contact_aliases WHERE contact_id = ? AND active = 1 ORDER BY verified DESC, confidence DESC`, [contactId]),
      this.d1.query(`SELECT * FROM comms_hub_channel_identities WHERE contact_id = ? ORDER BY updated_at DESC`, [contactId]),
      this.d1.query(`SELECT id, channel, provider, workflow, subject, created_at, updated_at, last_message_at FROM comms_hub_conversations WHERE contact_id = ? ORDER BY updated_at DESC`, [contactId]),
      this.d1.query(`SELECT * FROM comms_hub_identity_links WHERE source_contact_id = ? OR target_contact_id = ? ORDER BY created_at DESC`, [contactId, contactId]),
    ]);
    const contact = rows(contactResult)[0] || null;
    if (!contact) return null;
    return { contact, aliases: rows(aliasesResult), channelIdentities: rows(identitiesResult), conversations: rows(conversationsResult), identityLinks: rows(linksResult) };
  }

  async addContactAlias(alias) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_contact_aliases
        (id, contact_id, alias_type, alias_value, provider, confidence, verified, active,
         created_at, updated_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
       ON CONFLICT(alias_type, alias_value, provider) DO UPDATE SET
         contact_id = excluded.contact_id, confidence = excluded.confidence,
         verified = excluded.verified, active = 1, updated_at = excluded.updated_at,
         metadata_json = excluded.metadata_json
       RETURNING *`,
      [alias.id, alias.contactId, alias.type, alias.value, alias.provider || '', alias.confidence,
        alias.verified ? 1 : 0, alias.createdAt, alias.createdAt, json(alias.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async proposeIdentityLink(link) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_identity_links
        (id, source_contact_id, target_contact_id, confidence, status, reason,
         proposed_by, created_at, metadata_json)
       VALUES (?, ?, ?, ?, 'proposed', ?, ?, ?, ?) RETURNING *`,
      [link.id, link.sourceContactId, link.targetContactId, link.confidence, link.reason,
        link.actor, link.createdAt, json(link.metadata || {})]
    );
    return rows(result)[0] || null;
  }

  async reviewIdentityLink({ id, decision, actor, reason = '', at = nowIso() }) {
    const status = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : decision === 'reverse' ? 'reversed' : '';
    if (!status) throw new CommsHubError(400, 'identity_link_decision_invalid', 'Identity link decision is invalid.');
    const result = await this.d1.query(
      `UPDATE comms_hub_identity_links
          SET status = ?, reviewed_by = ?, reviewed_at = ?,
              reversed_at = CASE WHEN ? = 'reversed' THEN ? ELSE reversed_at END,
              reason = CASE WHEN ? <> '' THEN ? ELSE reason END
        WHERE id = ? AND status IN ('proposed','approved') RETURNING *`,
      [status, actor, at, status, at, reason, reason, id]
    );
    return rows(result)[0] || null;
  }

  async upsertFormRequestSent(request) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_form_requests
        (id, source_conversation_id, source_contact_id, form_key, form_id, form_url, status, reason,
         sent_via_channel, sent_draft_id, sent_at, expires_at, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = CASE WHEN comms_hub_form_requests.status IN ('submitted','processed','replied') THEN comms_hub_form_requests.status ELSE 'sent' END,
         form_url = excluded.form_url, reason = excluded.reason, sent_via_channel = excluded.sent_via_channel,
         sent_draft_id = COALESCE(excluded.sent_draft_id, comms_hub_form_requests.sent_draft_id),
         sent_at = CASE WHEN comms_hub_form_requests.status IN ('submitted','processed','replied') THEN comms_hub_form_requests.sent_at ELSE excluded.sent_at END,
         expires_at = CASE WHEN comms_hub_form_requests.status IN ('submitted','processed','replied') THEN comms_hub_form_requests.expires_at ELSE excluded.expires_at END,
         metadata_json = excluded.metadata_json, updated_at = excluded.updated_at
       RETURNING *`,
      [request.id, request.sourceConversationId, request.sourceContactId || null, request.formKey, request.formId,
        request.formUrl, request.reason || null, request.sentViaChannel, request.sentDraftId || null, request.sentAt,
        request.expiresAt, json(request.metadata || {}), request.sentAt, request.sentAt]
    );
    return rows(result)[0] || null;
  }

  async listFormRequestsForConversation(conversationId) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_form_requests
        WHERE source_conversation_id = ?
        ORDER BY created_at DESC`,
      [conversationId]
    );
    return rows(result).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) }));
  }

  async matchPendingFormRequestForSubmission({ formId, email, submissionConversationId, submissionId, submittedAt = nowIso() }) {
    const normalisedEmail = text(email, 320).toLowerCase();
    if (!normalisedEmail) return null;
    const candidates = await this.d1.query(
      `SELECT fr.*
         FROM comms_hub_form_requests fr
         JOIN comms_hub_conversations c ON c.id = fr.source_conversation_id
        WHERE fr.form_id = ? AND fr.status = 'sent' AND fr.expires_at > ?
          AND EXISTS (
            SELECT 1 FROM comms_hub_contact_aliases ca
             WHERE ca.contact_id = c.contact_id
               AND ca.alias_type = 'email'
               AND ca.verified = 1
               AND ca.active = 1
               AND LOWER(ca.alias_value) = ?
          )
        ORDER BY fr.sent_at DESC
        LIMIT 2`,
      [formId, submittedAt, normalisedEmail]
    );
    const matches = rows(candidates);
    if (matches.length !== 1) return null;
    const request = matches[0];
    const updated = await this.d1.query(
      `UPDATE comms_hub_form_requests
          SET status = 'submitted', submission_conversation_id = ?, submission_id = ?, submitted_at = ?,
              match_method = 'verified_email_and_form', updated_at = ?
        WHERE id = ? AND status = 'sent' RETURNING *`,
      [submissionConversationId, submissionId, submittedAt, submittedAt, request.id]
    );
    return rows(updated)[0] || null;
  }

  async upsertFormProcessing({ conversationId, formId, submissionId, formKey, status, matchedFormRequestId = null, digest, createdAt = nowIso() }) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_form_processing
        (conversation_id, form_id, submission_id, form_key, status, matched_form_request_id, digest_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         status = excluded.status, matched_form_request_id = COALESCE(excluded.matched_form_request_id, comms_hub_form_processing.matched_form_request_id),
         digest_json = excluded.digest_json, updated_at = excluded.updated_at
       RETURNING *`,
      [conversationId, formId, submissionId, formKey, status, matchedFormRequestId, json(digest || {}), createdAt, createdAt]
    );
    const row = rows(result)[0] || null;
    if (row) row.digest = parseJson(row.digest_json, {});
    return row;
  }

  async getFormProcessing(conversationId) {
    const result = await this.d1.query(`SELECT * FROM comms_hub_form_processing WHERE conversation_id = ?`, [conversationId]);
    const row = rows(result)[0] || null;
    if (row) row.digest = parseJson(row.digest_json, {});
    return row;
  }

  async updateFormProcessing({ conversationId, status, aiRunId = null, replyDraftId = null, replySentAt = null, failureClass = null, error = null, at = nowIso() }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_form_processing SET status = ?,
          ai_run_id = COALESCE(?, ai_run_id), reply_draft_id = COALESCE(?, reply_draft_id),
          reply_sent_at = COALESCE(?, reply_sent_at), failure_class = ?, error = ?, updated_at = ?
        WHERE conversation_id = ? RETURNING *`,
      [status, aiRunId, replyDraftId, replySentAt, failureClass, error ? text(error, 1000) : null, at, conversationId]
    );
    const row = rows(result)[0] || null;
    if (row) row.digest = parseJson(row.digest_json, {});
    if (row?.matched_form_request_id && ['draft_ready','pending_approval','review_required'].includes(status)) {
      await this.d1.query(`UPDATE comms_hub_form_requests SET status = 'processed', processed_at = COALESCE(processed_at, ?), updated_at = ? WHERE id = ? AND status = 'submitted'`, [at, at, row.matched_form_request_id]);
    }
    if (row?.matched_form_request_id && status === 'replied') {
      await this.d1.query(`UPDATE comms_hub_form_requests SET status = 'replied', processed_at = COALESCE(processed_at, ?), replied_at = ?, updated_at = ? WHERE id = ?`, [at, replySentAt || at, at, row.matched_form_request_id]);
    }
    return row;
  }

  async getConversationWorkspace(conversationId) {
    const [ops, tags, notes, audit, escalations, notifications, emailThread, chatSession, formProcessing, formRequests] = await Promise.all([
      this.getConversationOperations(conversationId),
      this.listConversationTags(conversationId),
      this.listInternalNotes(conversationId),
      this.listAuditEvents({ conversationId, limit: 200 }),
      this.d1.query(`SELECT * FROM comms_hub_escalations WHERE conversation_id = ? ORDER BY created_at DESC`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_notifications WHERE conversation_id = ? ORDER BY created_at DESC`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_email_threads WHERE conversation_id = ?`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_chat_sessions WHERE conversation_id = ?`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_form_processing WHERE conversation_id = ?`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_form_requests WHERE source_conversation_id = ? OR submission_conversation_id = ? ORDER BY created_at DESC`, [conversationId, conversationId]),
    ]);
    return {
      operations: ops,
      tags,
      notes,
      audit,
      escalations: rows(escalations),
      notifications: rows(notifications),
      emailThread: rows(emailThread)[0] || null,
      chatSession: rows(chatSession)[0] || null,
      formProcessing: (() => { const row = rows(formProcessing)[0] || null; if (row) row.digest = parseJson(row.digest_json, {}); return row; })(),
      formRequests: rows(formRequests).map((row) => ({ ...row, metadata: parseJson(row.metadata_json, {}) })),
    };
  }
}

export default CommsOperationsRepository;
