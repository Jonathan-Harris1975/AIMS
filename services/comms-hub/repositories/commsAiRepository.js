import { CommsHubError } from "../errors.js";

function json(value) { return JSON.stringify(value ?? {}); }
function rows(result) { return Array.isArray(result?.results) ? result.results : []; }
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

export class CommsAiRepository {
  constructor(d1) { this.d1 = d1; }

  async beginAiRun(run) {
    await this.d1.query(
      `INSERT INTO comms_hub_ai_runs
        (id, conversation_id, operation, status, started_at, metadata_json)
       VALUES (?, ?, ?, 'processing', ?, ?)`,
      [run.id, run.conversationId, run.operation, run.startedAt, json(run.metadata || {})]
    );
  }

  async persistAnalysisBundle(bundle) {
    const statements = [];
    for (const evidence of bundle.evidence || []) {
      statements.push({
        sql: `INSERT OR IGNORE INTO comms_hub_ai_evidence
          (id, ai_run_id, conversation_id, index_id, source_reference, title, excerpt,
           relevance_score, content_sha256, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [evidence.id, bundle.run.id, bundle.run.conversationId, evidence.indexId, evidence.sourceReference,
          evidence.title || null, evidence.excerpt, evidence.score, evidence.contentSha256, json(evidence.metadata || {}), bundle.completedAt],
      });
    }
    statements.push({
      sql: `INSERT INTO comms_hub_conversation_state
        (conversation_id, intent, intent_confidence, selected_workflow, workflow_mismatch,
         priority_score, priority_label, priority_factors_json, priority_override_reasons_json,
         queue_key, escalation_required, sentiment,
         abuse_label, risk_level, summary_text, unresolved_actions_json, source_message_ids_json, source_links_json,
         next_action, last_ai_run_id, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(conversation_id) DO UPDATE SET
         intent = excluded.intent,
         intent_confidence = excluded.intent_confidence,
         selected_workflow = excluded.selected_workflow,
         workflow_mismatch = excluded.workflow_mismatch,
         priority_score = excluded.priority_score,
         priority_label = excluded.priority_label,
         priority_factors_json = excluded.priority_factors_json,
         priority_override_reasons_json = excluded.priority_override_reasons_json,
         priority_overridden = 0,
         priority_override_reason = NULL,
         priority_overridden_by = NULL,
         priority_overridden_at = NULL,
         queue_key = excluded.queue_key,
         escalation_required = excluded.escalation_required,
         sentiment = excluded.sentiment,
         abuse_label = excluded.abuse_label,
         risk_level = excluded.risk_level,
         summary_text = excluded.summary_text,
         unresolved_actions_json = excluded.unresolved_actions_json,
         source_message_ids_json = excluded.source_message_ids_json,
         source_links_json = excluded.source_links_json,
         next_action = excluded.next_action,
         last_ai_run_id = excluded.last_ai_run_id,
         updated_at = excluded.updated_at`,
      params: [bundle.run.conversationId, bundle.intent.intent, bundle.intent.confidence,
        bundle.routing.selectedWorkflow, bundle.routing.mismatch ? 1 : 0,
        bundle.priority.score, bundle.priority.label, json(bundle.priority.factors), json(bundle.priority.overrideReasons),
        bundle.queue.key, bundle.queue.escalationRequired ? 1 : 0,
        bundle.moderation.sentiment, bundle.moderation.abuseLabel, bundle.moderation.riskLevel,
        bundle.summary.summary, json(bundle.summary.unresolvedActions), json(bundle.summary.sourceMessageIds), json(bundle.summary.sourceLinks || []),
        bundle.summary.nextAction || null, bundle.run.id, bundle.completedAt],
    });
    if (bundle.approval) {
      statements.push({
        sql: `INSERT OR IGNORE INTO comms_hub_approvals
          (id, conversation_id, target_type, target_id, action_type, status, risk_level, scope_sha256,
           requested_by, requested_at, expires_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
        params: [bundle.approval.id, bundle.run.conversationId, bundle.approval.targetType, bundle.approval.targetId,
          bundle.approval.actionType, bundle.approval.riskLevel, bundle.approval.scopeSha256,
          bundle.approval.requestedBy, bundle.approval.requestedAt, bundle.approval.expiresAt || null,
          json(bundle.approval.metadata || {})],
      });
    }
    if (bundle.draft) {
      statements.push({
        sql: `INSERT INTO comms_hub_reply_drafts
          (id, conversation_id, ai_run_id, channel, policy_key, body_text, status, risk_level,
           requires_approval, evidence_ids_json, provider, model, approval_id, created_at, updated_at, metadata_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO NOTHING`,
        params: [bundle.draft.id, bundle.run.conversationId, bundle.run.id, bundle.draft.channel,
          bundle.draft.policyKey, bundle.draft.bodyText, bundle.draft.status, bundle.draft.riskLevel,
          bundle.draft.requiresApproval ? 1 : 0, json(bundle.draft.evidenceIds), bundle.draft.provider || null,
          bundle.draft.model || null, bundle.approval?.id || null, bundle.completedAt, bundle.completedAt,
          json(bundle.draft.metadata || {})],
      });
    }
    if (bundle.followUp) {
      statements.push({
        sql: `INSERT INTO comms_hub_follow_ups
          (id, conversation_id, ai_run_id, reason, due_at, status, attempts, next_attempt_at,
           idempotency_key, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'scheduled', 0, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO UPDATE SET
           reason = excluded.reason,
           due_at = excluded.due_at,
           next_attempt_at = excluded.next_attempt_at,
           metadata_json = excluded.metadata_json,
           updated_at = excluded.updated_at
         WHERE comms_hub_follow_ups.status IN ('scheduled', 'failed')`,
        params: [bundle.followUp.id, bundle.run.conversationId, bundle.run.id, bundle.followUp.reason,
          bundle.followUp.dueAt, bundle.followUp.dueAt, bundle.followUp.idempotencyKey,
          json(bundle.followUp.metadata || {}), bundle.completedAt, bundle.completedAt],
      });
    }
    if (bundle.queue?.escalationRequired) {
      statements.push({
        sql: `UPDATE comms_hub_conversations SET status = 'pending', updated_at = ?
              WHERE id = ? AND status = 'open'`,
        params: [bundle.completedAt, bundle.run.conversationId],
      });
    }
    statements.push({
      sql: `UPDATE comms_hub_ai_runs SET
          status = 'complete', intent = ?, intent_confidence = ?, selected_workflow = ?, workflow_mismatch = ?,
          urgency = ?, commercial_value = ?, reputational_risk = ?, customer_impact = ?,
          priority_score = ?, priority_label = ?, priority_factors_json = ?, priority_override_reasons_json = ?,
          sentiment = ?, abuse_label = ?, risk_level = ?, provider = ?, model = ?, prompt_sha256 = ?,
          response_sha256 = ?, rationale = ?, completed_at = ?, metadata_json = ?
        WHERE id = ? AND status = 'processing'`,
      params: [bundle.intent.intent, bundle.intent.confidence, bundle.routing.selectedWorkflow, bundle.routing.mismatch ? 1 : 0,
        bundle.intent.urgency, bundle.intent.commercialValue, bundle.intent.reputationalRisk, bundle.intent.customerImpact,
        bundle.priority.score, bundle.priority.label, json(bundle.priority.factors), json(bundle.priority.overrideReasons),
        bundle.moderation.sentiment, bundle.moderation.abuseLabel, bundle.moderation.riskLevel,
        bundle.model.provider || null, bundle.model.model || null, bundle.promptSha256, bundle.responseSha256,
        bundle.intent.rationale || bundle.moderation.rationale || null, bundle.completedAt,
        json(bundle.run.metadata || {}), bundle.run.id],
    });
    await this.d1.batch(statements);
  }

  async failAiRun({ id, status = "failed", error, completedAt }) {
    await this.d1.query(
      `UPDATE comms_hub_ai_runs SET status = ?, error = ?, completed_at = ? WHERE id = ? AND status = 'processing'`,
      [status, String(error || "AI operation failed").slice(0, 1000), completedAt, id]
    );
  }

  async getConversationAiState(conversationId) {
    const [state, runs, evidence, drafts, approvals, followUps, workflows] = await Promise.all([
      this.d1.query(`SELECT * FROM comms_hub_conversation_state WHERE conversation_id = ?`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_ai_runs WHERE conversation_id = ? ORDER BY started_at DESC LIMIT 20`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_ai_evidence WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 50`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_reply_drafts WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_approvals WHERE conversation_id = ? ORDER BY requested_at DESC LIMIT 20`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_follow_ups WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20`, [conversationId]),
      this.d1.query(`SELECT * FROM comms_hub_workflow_runs WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 10`, [conversationId]),
    ]);
    const stateRow = rows(state)[0] || null;
    if (stateRow) {
      stateRow.unresolved_actions = parse(stateRow.unresolved_actions_json, []);
      stateRow.source_message_ids = parse(stateRow.source_message_ids_json, []);
      stateRow.source_links = parse(stateRow.source_links_json, []);
      stateRow.priority_factors = parse(stateRow.priority_factors_json, {});
      stateRow.priority_override_reasons = parse(stateRow.priority_override_reasons_json, []);
    }
    const priorityOverrides = await this.d1.query(
      `SELECT * FROM comms_hub_priority_overrides WHERE conversation_id = ? ORDER BY created_at DESC LIMIT 20`,
      [conversationId]
    );
    const runRows = rows(runs).map((row) => ({ ...row, metadata: parse(row.metadata_json, {}) }));
    const draftRows = rows(drafts).map((row) => ({
      ...row,
      metadata: parse(row.metadata_json, {}),
      evidence_ids: parse(row.evidence_ids_json, []),
    }));
    return { state: stateRow, runs: runRows, evidence: rows(evidence), drafts: draftRows, approvals: rows(approvals), followUps: rows(followUps), workflows: rows(workflows), priorityOverrides: rows(priorityOverrides) };
  }

  async overridePriority({ id, conversationId, score, label, reason, actor, createdAt }) {
    const current = await this.d1.query(
      `SELECT priority_score, priority_label FROM comms_hub_conversation_state WHERE conversation_id = ?`,
      [conversationId]
    );
    const state = rows(current)[0];
    if (!state) throw new CommsHubError(409, "priority_state_missing", "Conversation has no AI priority state to override.");
    const queueKey = score >= 60 ? "priority_review" : "standard";
    const escalationRequired = score >= 60 ? 1 : 0;
    const results = await this.d1.batch([
      {
        sql: `UPDATE comms_hub_priority_overrides SET active = 0 WHERE conversation_id = ? AND active = 1 RETURNING id`,
        params: [conversationId],
      },
      {
        sql: `INSERT INTO comms_hub_priority_overrides
          (id, conversation_id, previous_score, previous_label, override_score, override_label,
           reason, actor, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?) RETURNING *`,
        params: [id, conversationId, state.priority_score, state.priority_label, score, label, reason, actor, createdAt],
      },
      {
        sql: `UPDATE comms_hub_conversation_state SET priority_score = ?, priority_label = ?,
            priority_overridden = 1, priority_override_reason = ?, priority_overridden_by = ?,
            priority_overridden_at = ?, queue_key = ?, escalation_required = ?, updated_at = ?
          WHERE conversation_id = ? RETURNING *`,
        params: [score, label, reason, actor, createdAt, queueKey, escalationRequired, createdAt, conversationId],
      },
      {
        sql: `UPDATE comms_hub_conversations SET status = CASE WHEN ? = 1 THEN 'pending' ELSE status END,
            updated_at = ? WHERE id = ? RETURNING id`,
        params: [escalationRequired, createdAt, conversationId],
      },
    ]);
    return { override: rows(results[1])[0], state: rows(results[2])[0] };
  }

  async listPriorityQueue({ limit = 50 } = {}) {
    const result = await this.d1.query(
      `SELECT c.id, c.channel, c.provider, c.workflow, c.status, c.subject, c.last_message_at,
              s.intent, s.intent_confidence, s.selected_workflow, s.workflow_mismatch,
              s.priority_score, s.priority_label, s.priority_overridden, s.queue_key,
              s.escalation_required, s.sentiment, s.abuse_label, s.risk_level,
              s.summary_text, s.next_action, s.updated_at
         FROM comms_hub_conversation_state s
         JOIN comms_hub_conversations c ON c.id = s.conversation_id
        WHERE c.status IN ('open', 'pending')
        ORDER BY s.escalation_required DESC, s.priority_score DESC, c.last_message_at ASC
        LIMIT ?`,
      [Math.max(1, Math.min(200, Number(limit) || 50))]
    );
    return rows(result);
  }

  async createApproval(approval) {
    const result = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_approvals
        (id, conversation_id, target_type, target_id, action_type, status, risk_level, scope_sha256,
         requested_by, requested_at, expires_at, metadata_json)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [approval.id, approval.conversationId, approval.targetType, approval.targetId, approval.actionType,
        approval.riskLevel, approval.scopeSha256, approval.requestedBy, approval.requestedAt,
        approval.expiresAt || null, json(approval.metadata || {})]
    );
    if (rows(result)[0]) return rows(result)[0];
    const existing = await this.d1.query(
      `SELECT * FROM comms_hub_approvals WHERE target_type = ? AND target_id = ? AND action_type = ? AND scope_sha256 = ?`,
      [approval.targetType, approval.targetId, approval.actionType, approval.scopeSha256]
    );
    return rows(existing)[0] || null;
  }

  async decideApproval({ id, decision, decidedBy, reason, decidedAt }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_approvals SET status = ?, decided_by = ?, decision_reason = ?, decided_at = ?
        WHERE id = ? AND status = 'pending' AND (expires_at IS NULL OR expires_at > ?)
        RETURNING *`,
      [decision, decidedBy, reason || null, decidedAt, id, decidedAt]
    );
    const approval = rows(result)[0];
    if (!approval) throw new CommsHubError(409, "approval_not_pending", "Approval is not pending or has expired.", { publicMessage: "Approval cannot be changed." });
    if (approval.target_type === "reply_draft") {
      await this.d1.query(
        `UPDATE comms_hub_reply_drafts SET status = ?, updated_at = ? WHERE id = ? AND status = 'pending_approval'`,
        [decision === "approved" ? "approved" : "rejected", decidedAt, approval.target_id]
      );
    }
    return approval;
  }

  async requireApproved({ approvalId, conversationId, targetType, targetId, actionType, scopeSha256, now }) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_approvals
        WHERE id = ? AND conversation_id = ? AND target_type = ? AND target_id = ?
          AND action_type = ? AND scope_sha256 = ? AND status = 'approved'
          AND (expires_at IS NULL OR expires_at > ?)`,
      [approvalId, conversationId, targetType, targetId, actionType, scopeSha256, now]
    );
    const approval = rows(result)[0];
    if (!approval) {
      throw new CommsHubError(403, "approval_required", "A matching authorised approval record is required before this action can execute.", {
        failureClass: "permanent",
        publicMessage: "This action requires approval.",
      });
    }
    return approval;
  }

  async upsertModerationAction({ id, conversationId, platform, actionType, idempotencyKey, status, approvalId = null, payloadSha256, now }) {
    const result = await this.d1.query(
      `INSERT INTO comms_hub_moderation_actions
        (id, conversation_id, platform, action_type, idempotency_key, status, approval_id,
         payload_sha256, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(idempotency_key) DO UPDATE SET
         status = CASE
           WHEN comms_hub_moderation_actions.status IN ('executed', 'quarantined') THEN comms_hub_moderation_actions.status
           WHEN comms_hub_moderation_actions.status = 'pending_approval' AND excluded.status = 'requested' THEN comms_hub_moderation_actions.status
           ELSE excluded.status
         END,
         approval_id = COALESCE(excluded.approval_id, comms_hub_moderation_actions.approval_id),
         updated_at = excluded.updated_at
       WHERE comms_hub_moderation_actions.payload_sha256 = excluded.payload_sha256
         AND comms_hub_moderation_actions.conversation_id = excluded.conversation_id
         AND comms_hub_moderation_actions.action_type = excluded.action_type
       RETURNING *`,
      [id, conversationId, platform, actionType, idempotencyKey, status, approvalId, payloadSha256, now, now]
    );
    const action = rows(result)[0];
    if (!action) {
      throw new CommsHubError(409, "moderation_idempotency_conflict", "Moderation idempotency key conflicts with an earlier payload.", {
        failureClass: "permanent",
        publicMessage: "Moderation idempotency key conflicts with an earlier request.",
      });
    }
    return action;
  }

  async completeModerationAction({ idempotencyKey, response, completedAt }) {
    await this.d1.query(
      `UPDATE comms_hub_moderation_actions SET status = 'executed', provider_response_json = ?,
          failure_class = NULL, error = NULL, updated_at = ?
        WHERE idempotency_key = ? AND status != 'quarantined'`,
      [json(response || {}), completedAt, idempotencyKey]
    );
  }

  async failModerationAction({ idempotencyKey, status = "failed", failureClass, error, failedAt }) {
    await this.d1.query(
      `UPDATE comms_hub_moderation_actions SET status = ?, failure_class = ?, error = ?, updated_at = ?
        WHERE idempotency_key = ? AND status NOT IN ('executed', 'quarantined')`,
      [status, failureClass || "recoverable", String(error || "moderation action failed").slice(0, 1000), failedAt, idempotencyKey]
    );
  }

  async getDraft(id) {
    const result = await this.d1.query(`SELECT * FROM comms_hub_reply_drafts WHERE id = ?`, [id]);
    return rows(result)[0] || null;
  }

  async markDraftSent({ id, sentAt, metadata = {} }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_reply_drafts SET status = 'sent', sent_at = ?, updated_at = ?, metadata_json = ?
        WHERE id = ? AND status IN ('approved', 'draft') RETURNING *`,
      [sentAt, sentAt, json(metadata), id]
    );
    if (!rows(result)[0]) throw new CommsHubError(409, "reply_draft_not_sendable", "Reply draft is not in a sendable state.");
    return rows(result)[0];
  }

  async cancelFollowUpsForConversation({ conversationId, cancelledAt, reason = "conversation_resolved" }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_follow_ups SET status = 'cancelled', cancelled_at = ?, updated_at = ?, error = ?
        WHERE conversation_id = ? AND status IN ('scheduled', 'failed') RETURNING id`,
      [cancelledAt, cancelledAt, reason, conversationId]
    );
    return rows(result).length;
  }

  async cancelResolvedFollowUps(cancelledAt) {
    const result = await this.d1.query(
      `UPDATE comms_hub_follow_ups SET status = 'cancelled', cancelled_at = ?, updated_at = ?, error = 'conversation_resolved'
        WHERE status IN ('scheduled', 'failed') AND conversation_id IN (
          SELECT id FROM comms_hub_conversations WHERE status IN ('closed', 'quarantined')
        ) RETURNING id`,
      [cancelledAt, cancelledAt]
    );
    return rows(result).length;
  }

  async claimFollowUp({ workerId, now, leaseExpiresAt, maxAttempts }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_follow_ups SET status = 'leased', lease_owner = ?, lease_expires_at = ?,
          attempts = attempts + 1, updated_at = ?
        WHERE id = (
          SELECT f.id FROM comms_hub_follow_ups f
          JOIN comms_hub_conversations c ON c.id = f.conversation_id
          WHERE f.attempts < ? AND f.next_attempt_at <= ? AND f.due_at <= ?
            AND c.status IN ('open', 'pending')
            AND (f.status IN ('scheduled', 'failed') OR (f.status = 'leased' AND (f.lease_expires_at IS NULL OR f.lease_expires_at <= ?)))
          ORDER BY f.due_at ASC LIMIT 1
        ) RETURNING *`,
      [workerId, leaseExpiresAt, now, maxAttempts, now, now, now]
    );
    return rows(result)[0] || null;
  }

  async completeFollowUp({ id, workerId, completedAt, metadata = {} }) {
    const result = await this.d1.query(
      `UPDATE comms_hub_follow_ups SET status = 'complete', completed_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, updated_at = ?, metadata_json = ?
        WHERE id = ? AND status = 'leased' AND lease_owner = ? RETURNING id`,
      [completedAt, completedAt, json(metadata), id, workerId]
    );
    if (!rows(result).length) throw new CommsHubError(409, "follow_up_lease_lost", "Follow-up lease was lost.");
  }

  async failFollowUp({ id, workerId, status, nextAttemptAt, failureClass, error, failedAt }) {
    await this.d1.query(
      `UPDATE comms_hub_follow_ups SET status = ?, next_attempt_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, failure_class = ?, error = ?, updated_at = ?
        WHERE id = ? AND status = 'leased' AND lease_owner = ?`,
      [status, nextAttemptAt, failureClass, String(error || "failed").slice(0, 500), failedAt, id, workerId]
    );
  }

  async getOrCreateWorkflowRun(run) {
    const inserted = await this.d1.query(
      `INSERT OR IGNORE INTO comms_hub_workflow_runs
        (id, conversation_id, workflow_key, workflow_version, state, status, idempotency_key,
         data_json, next_action_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [run.id, run.conversationId, run.workflowKey, run.workflowVersion, run.state, run.status,
        run.idempotencyKey, json(run.data || {}), run.nextActionAt || null, run.createdAt, run.createdAt]
    );
    if (rows(inserted)[0]) return rows(inserted)[0];
    const existing = await this.d1.query(
      `SELECT * FROM comms_hub_workflow_runs WHERE conversation_id = ? AND workflow_key = ?`,
      [run.conversationId, run.workflowKey]
    );
    return rows(existing)[0] || null;
  }

  async transitionWorkflow({ runId, eventId, fromState, toState, status, actionKey, actor, idempotencyKey, data, details, nextActionAt, now }) {
    const results = await this.d1.batch([
      {
        sql: `INSERT OR IGNORE INTO comms_hub_workflow_events
          (id, workflow_run_id, from_state, to_state, action_key, actor, idempotency_key, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
        params: [eventId, runId, fromState || null, toState, actionKey, actor, idempotencyKey, json(details || {}), now],
      },
      {
        sql: `UPDATE comms_hub_workflow_runs SET state = ?, status = ?, data_json = ?, next_action_at = ?,
            updated_at = ?, completed_at = CASE WHEN ? = 'complete' THEN ? ELSE completed_at END
          WHERE id = ? AND state = ? RETURNING *`,
        params: [toState, status, json(data || {}), nextActionAt || null, now, status, now, runId, fromState],
      },
    ]);
    if (!rows(results[0]).length) {
      const existing = await this.d1.query(`SELECT * FROM comms_hub_workflow_runs WHERE id = ?`, [runId]);
      return { duplicate: true, run: rows(existing)[0] || null };
    }
    if (!rows(results[1])[0]) throw new CommsHubError(409, "workflow_state_conflict", "Workflow state changed before the transition completed.");
    return { duplicate: false, run: rows(results[1])[0] };
  }

  async getWorkflowEventByIdempotency(runId, idempotencyKey) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_workflow_events WHERE workflow_run_id = ? AND idempotency_key = ?`,
      [runId, idempotencyKey]
    );
    return rows(result)[0] || null;
  }

  async getWorkflowRun(id) {
    const result = await this.d1.query(`SELECT * FROM comms_hub_workflow_runs WHERE id = ?`, [id]);
    return rows(result)[0] || null;
  }

  async recordProviderHealth(snapshot) {
    await this.d1.query(
      `INSERT INTO comms_hub_provider_health
        (id, provider, adapter, status, success_count, failure_count, consecutive_failures,
         last_status_code, last_success_at, last_failure_at, observed_at, evidence_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [snapshot.id, snapshot.provider, snapshot.adapter, snapshot.status, snapshot.successCount,
        snapshot.failureCount, snapshot.consecutiveFailures, snapshot.lastStatusCode || null,
        snapshot.lastSuccessAt || null, snapshot.lastFailureAt || null, snapshot.observedAt,
        json(snapshot.evidence || {})]
    );
  }

  async listLatestProviderHealth() {
    const result = await this.d1.query(
      `SELECT h.* FROM comms_hub_provider_health h
       JOIN (SELECT provider, adapter, MAX(observed_at) AS observed_at
               FROM comms_hub_provider_health GROUP BY provider, adapter) latest
         ON latest.provider = h.provider AND latest.adapter = h.adapter AND latest.observed_at = h.observed_at
       ORDER BY h.provider, h.adapter`
    );
    return rows(result);
  }

  async createBackupRun(run) {
    await this.d1.query(
      `INSERT INTO comms_hub_backup_runs
        (id, status, source_database_id, restore_database_id, started_at, metadata_json)
       VALUES (?, 'exporting', ?, ?, ?, ?)`,
      [run.id, run.sourceDatabaseId, run.restoreDatabaseId || null, run.startedAt, json(run.metadata || {})]
    );
  }

  async updateBackupRun(id, patch) {
    const allowed = {
      status: "status", exportBookmark: "export_bookmark", exportSha256: "export_sha256",
      manifestSha256: "manifest_sha256", r2ExportKey: "r2_export_key", r2ManifestKey: "r2_manifest_key",
      linkedObjectCount: "linked_object_count", validationStatus: "validation_status",
      validationDetails: "validation_details_json", completedAt: "completed_at", validatedAt: "validated_at",
      failureClass: "failure_class", error: "error", metadata: "metadata_json",
    };
    const sets = []; const params = [];
    for (const [key, column] of Object.entries(allowed)) {
      if (!(key in patch)) continue;
      sets.push(`${column} = ?`);
      const value = ["validationDetails", "metadata"].includes(key) ? json(patch[key]) : patch[key];
      params.push(value ?? null);
    }
    if (!sets.length) return;
    params.push(id);
    await this.d1.query(`UPDATE comms_hub_backup_runs SET ${sets.join(", ")} WHERE id = ?`, params);
  }

  async recordBackupObjects(objects) {
    if (!objects.length) return;
    await this.d1.batch(objects.map((object) => ({
      sql: `INSERT OR REPLACE INTO comms_hub_backup_objects
        (id, backup_run_id, bucket_name, object_key, archive_object_key, size_bytes, etag, sha256, status, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [object.id, object.backupRunId, object.bucketName, object.objectKey, object.archiveObjectKey,
        object.sizeBytes, object.etag || null, object.sha256 || null, object.status, json(object.metadata || {})],
    })));
  }

  async getBackupObjects(backupRunId) {
    const result = await this.d1.query(
      `SELECT * FROM comms_hub_backup_objects WHERE backup_run_id = ? ORDER BY object_key`,
      [backupRunId]
    );
    return rows(result);
  }

  async updateBackupObjectStatuses(backupRunId, checks) {
    const allowedStatuses = new Set(["verified", "missing", "mismatch"]);
    const statements = (checks || [])
      .filter((check) => allowedStatuses.has(check.status))
      .map((check) => ({
        sql: `UPDATE comms_hub_backup_objects SET status = ?, metadata_json = ?
              WHERE backup_run_id = ? AND object_key = ?`,
        params: [check.status, json({ restoreKey: check.restoreKey || null, observedSha256: check.sha256 || null }), backupRunId, check.key],
      }));
    if (statements.length) await this.d1.batch(statements);
  }

  async getBackupRun(id) {
    const result = await this.d1.query(`SELECT * FROM comms_hub_backup_runs WHERE id = ?`, [id]);
    return rows(result)[0] || null;
  }

  async getLatestBackupStatus() {
    const [runs, objects] = await Promise.all([
      this.d1.query(`SELECT * FROM comms_hub_backup_runs ORDER BY started_at DESC LIMIT 20`),
      this.d1.query(`SELECT backup_run_id, status, COUNT(*) AS count FROM comms_hub_backup_objects GROUP BY backup_run_id, status`),
    ]);
    return { runs: rows(runs), objects: rows(objects) };
  }
}

export default CommsAiRepository;
