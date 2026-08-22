import { json, nowIso, parseJson, rows, text } from "./commsOperationsRepositorySupport.js";

export class CommsIdentityArchiveRepository {
  constructor(d1) {
    this.d1 = d1;
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

  async updateContact({ contactId, changes, at = nowIso() }) {
    const currentResult = await this.d1.query(`SELECT * FROM comms_hub_contacts WHERE id = ?`, [contactId]);
    const current = rows(currentResult)[0] || null;
    if (!current) return null;

    const sets = [];
    const params = [];
    for (const [column, key] of [["display_name", "displayName"], ["primary_email", "primaryEmail"], ["phone", "phone"]]) {
      if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
      sets.push(`${column} = ?`);
      params.push(changes[key]);
    }
    if (!sets.length) return current;
    sets.push("updated_at = ?");
    params.push(at, contactId);
    const result = await this.d1.query(
      `UPDATE comms_hub_contacts SET ${sets.join(", ")} WHERE id = ? RETURNING *`,
      params
    );
    return rows(result)[0] || null;
  }

  async findContactByEmail(primaryEmail, excludeContactId = "") {
    if (!primaryEmail) return null;
    const result = await this.d1.query(
      `SELECT id, primary_email, display_name, phone, created_at, updated_at
         FROM comms_hub_contacts
        WHERE LOWER(primary_email) = ? AND (? = '' OR id <> ?)
        LIMIT 1`,
      [primaryEmail, excludeContactId, excludeContactId]
    );
    return rows(result)[0] || null;
  }

  async deleteContactPreservingConversations({ contactId, replacementContactId, at = nowIso() }) {
    const replacementName = "Deleted contact";
    const [archiveResult, conversationCountResult] = await Promise.all([
      this.d1.query(
        `SELECT conversation_id, snapshot_json
           FROM comms_hub_conversation_archives
          WHERE contact_id = ?`,
        [contactId]
      ),
      this.d1.query(`SELECT COUNT(*) AS count FROM comms_hub_conversations WHERE contact_id = ?`, [contactId]),
    ]);
    const archiveUpdates = rows(archiveResult).map((archive) => {
      const snapshot = parseJson(archive.snapshot_json, {});
      if (snapshot?.conversation) {
        snapshot.conversation.contact_id = replacementContactId;
        snapshot.conversation.contact = {
          id: replacementContactId,
          primary_email: null,
          display_name: replacementName,
          phone: null,
          deleted: true,
        };
      }
      return {
        sql: `UPDATE comms_hub_conversation_archives SET contact_id = ?, snapshot_json = ? WHERE conversation_id = ?`,
        params: [replacementContactId, json(snapshot), archive.conversation_id],
      };
    });

    await this.d1.batch([
      {
        sql: `INSERT OR IGNORE INTO comms_hub_contacts
          (id, primary_email, display_name, phone, created_at, updated_at)
          VALUES (?, NULL, ?, NULL, ?, ?)`,
        params: [replacementContactId, replacementName, at, at],
      },
      { sql: `DELETE FROM comms_hub_contact_aliases WHERE contact_id = ?`, params: [contactId] },
      { sql: `DELETE FROM comms_hub_channel_identities WHERE contact_id = ?`, params: [contactId] },
      { sql: `DELETE FROM comms_hub_identity_links WHERE source_contact_id = ? OR target_contact_id = ?`, params: [contactId, contactId] },
      { sql: `UPDATE comms_hub_conversations SET contact_id = ?, updated_at = ? WHERE contact_id = ?`, params: [replacementContactId, at, contactId] },
      { sql: `UPDATE comms_hub_form_requests SET source_contact_id = ? WHERE source_contact_id = ?`, params: [replacementContactId, contactId] },
      { sql: `UPDATE comms_hub_retention_jobs SET contact_id = ? WHERE contact_id = ?`, params: [replacementContactId, contactId] },
      { sql: `UPDATE comms_hub_search_documents SET contact_id = ? WHERE contact_id = ? AND object_type <> 'contact'`, params: [replacementContactId, contactId] },
      { sql: `DELETE FROM comms_hub_search_documents WHERE object_type = 'contact' AND object_id = ?`, params: [contactId] },
    ]);
    for (let index = 0; index < archiveUpdates.length; index += 80) {
      await this.d1.batch(archiveUpdates.slice(index, index + 80));
    }
    await this.d1.query(`DELETE FROM comms_hub_contacts WHERE id = ?`, [contactId]);
    return {
      contactId,
      replacementContactId,
      linkedConversationCount: Number(rows(conversationCountResult)[0]?.count || 0),
      archivedConversationCount: archiveUpdates.length,
      deletedAt: at,
    };
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

  async storeConversationArchive({ conversation, snapshot, closedAt, archivedAt = nowIso() }) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_conversation_archives
        (conversation_id, contact_id, channel, provider, workflow, subject, closed_at, archived_at, snapshot_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         contact_id = excluded.contact_id,
         channel = excluded.channel,
         provider = excluded.provider,
         workflow = excluded.workflow,
         subject = excluded.subject,
         closed_at = excluded.closed_at,
         archived_at = excluded.archived_at,
         snapshot_json = excluded.snapshot_json
       RETURNING conversation_id, contact_id, channel, provider, workflow, subject, closed_at, archived_at`,
      [conversation.id, conversation.contact_id, conversation.channel, conversation.provider, conversation.workflow,
        conversation.subject, closedAt, archivedAt, json(snapshot)]
    );
    return rows(result)[0] || null;
  }

  async getConversationArchive(conversationId) {
    const result = await this.d1.query(
      `SELECT conversation_id, contact_id, channel, provider, workflow, subject, closed_at, archived_at, snapshot_json
         FROM comms_hub_conversation_archives
        WHERE conversation_id = ?`,
      [conversationId]
    );
    const archive = rows(result)[0] || null;
    if (!archive) return null;
    return { ...archive, snapshot: parseJson(archive.snapshot_json, {}) };
  }

  async listConversationArchives({ contactId = "", channel = "", before = "", limit = 50 } = {}) {
    const clauses = [];
    const params = [];
    if (contactId) { clauses.push("contact_id = ?"); params.push(contactId); }
    if (channel) { clauses.push("channel = ?"); params.push(channel); }
    if (before) { clauses.push("archived_at < ?"); params.push(before); }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.d1.query(
      `SELECT conversation_id, contact_id, channel, provider, workflow, subject, closed_at, archived_at
         FROM comms_hub_conversation_archives
         ${where}
        ORDER BY archived_at DESC
        LIMIT ?`,
      [...params, Math.min(Math.max(Number(limit) || 50, 1), 200)]
    );
    return rows(result);
  }

  async hardDeleteConversation({ conversationId }) {
    const statements = [
      { sql: `DELETE FROM comms_hub_attachment_objects WHERE attachment_id IN (SELECT a.id FROM comms_hub_attachments a JOIN comms_hub_messages m ON m.id = a.message_id WHERE m.conversation_id = ?)`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_social_events WHERE conversation_id = ? OR message_id IN (SELECT id FROM comms_hub_messages WHERE conversation_id = ?)`, params: [conversationId, conversationId] },
      { sql: `DELETE FROM comms_hub_attachments WHERE message_id IN (SELECT id FROM comms_hub_messages WHERE conversation_id = ?)`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_mentions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_workflow_events WHERE workflow_run_id IN (SELECT id FROM comms_hub_workflow_runs WHERE conversation_id = ?)`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_moderation_actions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_reply_drafts WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_ai_evidence WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_follow_ups WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_conversation_state WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_ai_runs WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_form_processing WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_form_requests WHERE source_conversation_id = ? OR submission_conversation_id = ?`, params: [conversationId, conversationId] },
      { sql: `DELETE FROM comms_hub_outreach_articles WHERE conversation_id = ? OR target_id IN (SELECT id FROM comms_hub_outreach_targets WHERE conversation_id = ?)`, params: [conversationId, conversationId] },
      { sql: `DELETE FROM comms_hub_outreach_targets WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_approvals WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_channel_outbound_actions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_social_outbound_actions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_social_threads WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_email_threads WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_chat_sessions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_delayed_actions WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_escalations WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_priority_overrides WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_intake_events WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_conversation_tags WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_internal_notes WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_notifications WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `UPDATE comms_hub_quarantine_items SET conversation_id = NULL WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `UPDATE comms_hub_retention_jobs SET conversation_id = NULL WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_search_documents WHERE conversation_id = ? OR (object_type = 'conversation' AND object_id = ?)`, params: [conversationId, conversationId] },
      { sql: `DELETE FROM comms_hub_conversation_operations WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_messages WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_workflow_runs WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_conversation_archives WHERE conversation_id = ?`, params: [conversationId] },
      { sql: `DELETE FROM comms_hub_conversations WHERE id = ? RETURNING id`, params: [conversationId] },
    ];
    const results = await this.d1.batch(statements);
    const deleted = rows(results.at(-1))[0]?.id || null;
    return { conversationId, deleted: Boolean(deleted) };
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
