import { CommsHubError } from "../errors.js";
import { stableId } from "../domain/ids.js";
import { json, parseJson, placeholders, rows, text } from "./commsOperationsRepositorySupport.js";

function count(result) {
  return Number(rows(result)[0]?.count || 0);
}

function changed(result) {
  return rows(result).length;
}

export class CommsHousekeepingRepository {
  constructor(d1) {
    this.d1 = d1;
  }

  async activeRetentionPolicyCount() {
    const result = await this.d1.query(
      "SELECT COUNT(*) AS count FROM comms_hub_retention_policies WHERE active = 1"
    );
    return count(result);
  }

  async beginRun({ id, windowKey, runType, dryRun, actor, startedAt }) {
    const inserted = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_housekeeping_runs
        (id, window_key, run_type, status, dry_run, actor, started_at, stages_json)
       VALUES (?, ?, ?, 'running', ?, ?, ?, '[]')
       RETURNING *`,
      [id, windowKey, runType, dryRun ? 1 : 0, text(actor, 200), startedAt]
    );
    const created = rows(inserted)[0] || null;
    if (created) return { created: true, run: created };
    const existing = await this.d1.query(
      "SELECT * FROM comms_hub_housekeeping_runs WHERE window_key = ?",
      [windowKey]
    );
    return { created: false, run: rows(existing)[0] || null };
  }

  async finishRun({ id, status, stages, completedAt, error = null }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_housekeeping_runs
          SET status = ?, stages_json = ?, completed_at = ?, error = ?
        WHERE id = ? RETURNING *`,
      [status, json(stages || []), completedAt, text(error, 1000) || null, id]
    );
    const run = rows(result)[0] || null;
    return run ? { ...run, stages: parseJson(run.stages_json, []) } : null;
  }

  async latestRuns(limit = 20) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_housekeeping_runs
        ORDER BY started_at DESC LIMIT ?`,
      [Math.min(Math.max(Number(limit) || 20, 1), 100)]
    );
    return rows(result).map((row) => ({ ...row, dry_run: Boolean(row.dry_run), stages: parseJson(row.stages_json, []) }));
  }

  janitorStatements({ at, recordCutoff }) {
    return [
      {
        key: "replyDraftsRejected",
        sql: `UPDATE comms_hub_reply_drafts
                 SET status = 'rejected', updated_at = ?,
                     metadata_json = json_set(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
                       '$.approvalExpiredAt', ?)
               WHERE status = 'pending_approval'
                 AND approval_id IN (
                   SELECT id FROM comms_hub_approvals
                    WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
                 ) RETURNING id`,
        params: [at, at, at],
      },
      {
        key: "approvalsExpired",
        sql: `UPDATE comms_hub_approvals
                 SET status = 'expired', decided_by = 'housekeeping', decided_at = ?,
                     decision_reason = COALESCE(decision_reason, 'Approval expired automatically.')
               WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?
               RETURNING id`,
        params: [at, at],
      },
      {
        key: "formRequestsExpired",
        sql: `UPDATE comms_hub_form_requests
                 SET status = 'expired', updated_at = ?
               WHERE status = 'sent' AND expires_at <= ? RETURNING id`,
        params: [at, at],
      },
      {
        key: "webhookNoncesDeleted",
        sql: "DELETE FROM comms_hub_webhook_nonces WHERE expires_at <= ? RETURNING nonce",
        params: [at],
      },
      {
        key: "delayedActionsDeleted",
        sql: `DELETE FROM comms_hub_delayed_actions
               WHERE status IN ('complete','cancelled') AND updated_at < ?
                 AND (conversation_id IS NULL OR NOT EXISTS (
                   SELECT 1 FROM comms_hub_conversations c
                    WHERE c.id = comms_hub_delayed_actions.conversation_id
                 )) RETURNING id`,
        params: [recordCutoff],
      },
      {
        key: "notificationsDeleted",
        sql: `DELETE FROM comms_hub_notifications
               WHERE status IN ('read','dismissed','sent') AND created_at < ?
                 AND email_delivery_status IN ('not_requested','sent')
               RETURNING id`,
        params: [recordCutoff],
      },
      {
        key: "quarantineAttemptsDeleted",
        sql: `DELETE FROM comms_hub_quarantine_attempts
               WHERE quarantine_id IN (
                 SELECT id FROM comms_hub_quarantine_items
                  WHERE status IN ('replayed','resolved','dismissed') AND updated_at < ?
               ) RETURNING id`,
        params: [recordCutoff],
      },
      {
        key: "quarantineItemsDeleted",
        sql: `DELETE FROM comms_hub_quarantine_items
               WHERE status IN ('replayed','resolved','dismissed') AND updated_at < ?
               RETURNING id`,
        params: [recordCutoff],
      },
      {
        key: "retentionJobsDeleted",
        sql: `DELETE FROM comms_hub_retention_jobs
               WHERE conversation_id IS NULL AND status IN ('complete','failed')
                 AND COALESCE(completed_at, requested_at) < ?
               RETURNING id`,
        params: [recordCutoff],
      },
    ];
  }

  async runDatabaseJanitor({ at, recordCutoff }) {
    const statements = this.janitorStatements({ at, recordCutoff });
    const results = await this.d1.batch(statements.map(({ sql, params }) => ({ sql, params })));
    return Object.fromEntries(statements.map((statement, index) => [statement.key, changed(results[index])]));
  }

  async previewDatabaseJanitor({ at, recordCutoff }) {
    const queries = [
      ["approvalsExpired", "SELECT COUNT(*) AS count FROM comms_hub_approvals WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?", [at]],
      ["formRequestsExpired", "SELECT COUNT(*) AS count FROM comms_hub_form_requests WHERE status = 'sent' AND expires_at <= ?", [at]],
      ["webhookNoncesDeleted", "SELECT COUNT(*) AS count FROM comms_hub_webhook_nonces WHERE expires_at <= ?", [at]],
      ["delayedActionsDeleted", `SELECT COUNT(*) AS count FROM comms_hub_delayed_actions
        WHERE status IN ('complete','cancelled') AND updated_at < ?
          AND (conversation_id IS NULL OR NOT EXISTS (SELECT 1 FROM comms_hub_conversations c WHERE c.id = comms_hub_delayed_actions.conversation_id))`, [recordCutoff]],
      ["notificationsDeleted", `SELECT COUNT(*) AS count FROM comms_hub_notifications
        WHERE status IN ('read','dismissed','sent') AND created_at < ? AND email_delivery_status IN ('not_requested','sent')`, [recordCutoff]],
      ["quarantineItemsDeleted", `SELECT COUNT(*) AS count FROM comms_hub_quarantine_items
        WHERE status IN ('replayed','resolved','dismissed') AND updated_at < ?`, [recordCutoff]],
      ["retentionJobsDeleted", `SELECT COUNT(*) AS count FROM comms_hub_retention_jobs
        WHERE conversation_id IS NULL AND status IN ('complete','failed') AND COALESCE(completed_at, requested_at) < ?`, [recordCutoff]],
    ];
    const results = await this.d1.batch(queries.map(([, sql, params]) => ({ sql, params })));
    const summary = Object.fromEntries(queries.map(([key], index) => [key, count(results[index])]));
    summary.replyDraftsRejected = summary.approvalsExpired;
    summary.quarantineAttemptsDeleted = summary.quarantineItemsDeleted;
    return summary;
  }

  async pruneProviderHealth({ before, dryRun = false }) {
    const predicate = `observed_at < ? AND id NOT IN (
      SELECT latest.id FROM comms_hub_provider_health latest
       WHERE latest.id = (
         SELECT h2.id FROM comms_hub_provider_health h2
          WHERE h2.provider = latest.provider AND h2.adapter = latest.adapter
          ORDER BY h2.observed_at DESC, h2.id DESC LIMIT 1
       )
    )`;
    const result = await this.d1.query(
      dryRun
        ? `SELECT COUNT(*) AS count FROM comms_hub_provider_health WHERE ${predicate}`
        : `DELETE FROM comms_hub_provider_health WHERE ${predicate} RETURNING id`,
      [before]
    );
    return dryRun ? count(result) : changed(result);
  }

  async listAuditEventsForArchive({ before, limit = 500 }) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_audit_events
        WHERE occurred_at < ? ORDER BY occurred_at ASC, id ASC LIMIT ?`,
      [before, Math.min(Math.max(Number(limit) || 500, 1), 1000)]
    );
    return rows(result);
  }

  async commitAuditArchiveSegment(segment, eventIds) {
    if (!eventIds.length) return 0;
    const results = await this.d1.batch([
      {
        sql: `INSERT OR IGNORE INTO comms_hub_audit_archive_segments
          (id, object_key, first_event_id, last_event_id, first_occurred_at, last_occurred_at,
           first_previous_sha256, last_chain_sha256, event_count, payload_sha256, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [segment.id, segment.objectKey, segment.firstEventId, segment.lastEventId,
          segment.firstOccurredAt, segment.lastOccurredAt, segment.firstPreviousSha256 || null,
          segment.lastChainSha256, eventIds.length, segment.payloadSha256, segment.archivedAt],
      },
      {
        sql: `DELETE FROM comms_hub_audit_events
               WHERE id IN (${placeholders(eventIds.length)}) RETURNING id`,
        params: eventIds,
      },
    ]);
    return changed(results[1]);
  }

  async listAttachmentObjects() {
    const result = await this.d1.query(
      `SELECT id, attachment_id, object_key, scan_status, stored_at
         FROM comms_hub_attachment_objects WHERE deleted_at IS NULL`
    );
    return rows(result);
  }

  async listDisposableQuarantinedAttachments({ before, limit = 250 }) {
    const result = await this.d1.query(
      `SELECT ao.id, ao.attachment_id, ao.object_key, ao.scan_status, ao.stored_at
         FROM comms_hub_attachment_objects ao
        WHERE ao.deleted_at IS NULL
          AND ao.object_key LIKE 'quarantine/attachments/%'
          AND ao.scan_status IN ('infected','failed')
          AND ao.stored_at < ?
        ORDER BY ao.stored_at ASC LIMIT ?`,
      [before, Math.min(Math.max(Number(limit) || 250, 1), 1000)]
    );
    return rows(result);
  }

  async markAttachmentObjectDeleted({ objectId, attachmentId, at }) {
    await this.d1.batch([
      {
        sql: `UPDATE comms_hub_attachment_objects
                 SET deleted_at = ?, metadata_json = json_set(
                   CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
                   '$.housekeepingDeletedAt', ?)
               WHERE id = ? AND deleted_at IS NULL`,
        params: [at, at, objectId],
      },
      {
        sql: `UPDATE comms_hub_attachments
                 SET status = 'deleted', metadata_json = json_set(
                   CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
                   '$.housekeepingDeletedAt', ?)
               WHERE id = ?`,
        params: [at, attachmentId],
      },
    ]);
  }

  async listExpiredExports({ before, limit = 250 }) {
    const result = await this.d1.query(
      `SELECT id, export_object_key, completed_at
         FROM comms_hub_retention_jobs
        WHERE action = 'export' AND status = 'complete'
          AND export_object_key IS NOT NULL AND completed_at < ?
        ORDER BY completed_at ASC LIMIT ?`,
      [before, Math.min(Math.max(Number(limit) || 250, 1), 1000)]
    );
    return rows(result);
  }

  async markExportExpired({ id, at }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_retention_jobs
          SET export_object_key = NULL,
              metadata_json = json_set(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
                '$.exportExpiredAt', ?)
        WHERE id = ? RETURNING id`,
      [at, id]
    );
    return Boolean(rows(result).length);
  }

  async quarantineSummary({ olderThan }) {
    const [grouped, oldest, aged] = await this.d1.batch([
      {
        sql: `SELECT status, failure_class, COUNT(*) AS count
                FROM comms_hub_quarantine_items
               GROUP BY status, failure_class ORDER BY status, failure_class`,
      },
      {
        sql: `SELECT id, source_type, failure_class, created_at
                FROM comms_hub_quarantine_items
               WHERE status IN ('quarantined','replay_pending')
               ORDER BY created_at ASC LIMIT 10`,
      },
      {
        sql: `SELECT COUNT(*) AS count FROM comms_hub_quarantine_items
               WHERE status IN ('quarantined','replay_pending') AND created_at < ?`,
        params: [olderThan],
      },
    ]);
    const open = rows(grouped)
      .filter((item) => ["quarantined", "replay_pending"].includes(item.status))
      .reduce((total, item) => total + Number(item.count || 0), 0);
    return { open, olderThanCount: count(aged), byStatus: rows(grouped), oldest: rows(oldest) };
  }

  async resolveQuarantine({ id, disposition, actor, reason, at }) {
    if (!["resolved", "dismissed"].includes(disposition)) {
      throw new CommsHubError(400, "quarantine_disposition_invalid", "Quarantine disposition is invalid.");
    }
    const updated = await this.d1.query(
      `UPDATE comms_hub_quarantine_items
          SET status = ?, attempts = attempts + 1, resolved_at = ?, updated_at = ?,
              metadata_json = json_set(CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
                '$.resolutionReason', ?, '$.resolvedBy', ?)
        WHERE id = ? AND status IN ('quarantined','replay_pending') RETURNING *`,
      [disposition, at, at, text(reason, 1000), text(actor, 200), id]
    );
    const item = rows(updated)[0] || null;
    if (!item) {
      throw new CommsHubError(409, "quarantine_not_resolvable", "Quarantine item is not awaiting resolution.");
    }
    await this.d1.query(
      `INSERT INTO comms_hub_quarantine_attempts
        (id, quarantine_id, attempt_number, actor, action, outcome, detail, created_at)
       VALUES (?, ?, ?, ?, ?, 'success', ?, ?)`,
      [stableId("qat", id, String(item.attempts)), id, item.attempts, text(actor, 200), disposition, text(reason, 1000) || null, at]
    );
    return { ...item, metadata: parseJson(item.metadata_json, {}) };
  }

  async listInfoArchiveCandidates({ mailbox, before, limit = 100 }) {
    const result = await this.d1.query(
      `SELECT CAST(json_extract(m.metadata_json, '$.uid') AS INTEGER) AS uid,
              MIN(m.received_at) AS received_at,
              COUNT(*) AS message_count
         FROM comms_hub_messages m
         JOIN comms_hub_conversations c ON c.id = m.conversation_id
         JOIN comms_hub_email_threads et ON et.conversation_id = c.id
         LEFT JOIN comms_hub_conversation_operations o ON o.conversation_id = c.id
        WHERE m.direction = 'inbound'
          AND et.account_key = 'info' AND et.mailbox = ?
          AND m.received_at < ?
          AND CAST(json_extract(m.metadata_json, '$.uid') AS INTEGER) > 0
          AND json_extract(m.metadata_json, '$.providerArchivedAt') IS NULL
          AND json_extract(m.metadata_json, '$.providerArchiveReconciledAt') IS NULL
          AND (o.operational_status IN ('resolved','archived') OR c.status = 'closed')
        GROUP BY CAST(json_extract(m.metadata_json, '$.uid') AS INTEGER)
        ORDER BY MIN(m.received_at) ASC LIMIT ?`,
      [mailbox, before, Math.min(Math.max(Number(limit) || 100, 1), 250)]
    );
    return rows(result).map((row) => ({ ...row, uid: Number(row.uid), message_count: Number(row.message_count || 0) }));
  }

  async markInfoMessagesArchived({ mailbox, uids, archiveMailbox, at, reconciledOnly = false }) {
    if (!uids.length) return 0;
    const field = reconciledOnly ? "providerArchiveReconciledAt" : "providerArchivedAt";
    const result = await this.d1.query(
      `UPDATE comms_hub_messages
          SET metadata_json = json_set(
            CASE WHEN json_valid(metadata_json) THEN metadata_json ELSE '{}' END,
            '$.${field}', ?, '$.providerArchiveMailbox', ?)
        WHERE id IN (
          SELECT m.id FROM comms_hub_messages m
          JOIN comms_hub_conversations c ON c.id = m.conversation_id
          JOIN comms_hub_email_threads et ON et.conversation_id = c.id
          WHERE et.account_key = 'info' AND et.mailbox = ?
            AND CAST(json_extract(m.metadata_json, '$.uid') AS INTEGER) IN (${placeholders(uids.length)})
        ) RETURNING id`,
      [at, archiveMailbox, mailbox, ...uids]
    );
    return changed(result);
  }
}

export default CommsHousekeepingRepository;
