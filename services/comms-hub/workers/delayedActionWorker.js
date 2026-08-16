import { randomUUID } from 'node:crypto';
import { log } from '../../../logger.js';
import { safeErrorLog } from '../domain/redaction.js';
import { CommsHubError } from '../errors.js';

function parse(value) {
  try { return JSON.parse(value || '{}'); } catch { return {}; }
}

export class CommsHubDelayedActionWorker {
  constructor({ context }) {
    this.context = context;
    this.workerId = `delay-${randomUUID()}`;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.context.config.delayedActionWorkerEnabled || this.timer) return false;
    this.timer = setInterval(
      () => void this.runOnce().catch((error) => log.error('commsHub.delayed.failed', { error: safeErrorLog(error) })),
      this.context.config.delayedActionPollMs
    );
    this.timer.unref?.();
    void this.runOnce();
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async execute(item) {
    const payload = parse(item.payload_json);
    if (item.action_type === 'notification' || item.action_type === 'reminder') {
      return this.context.notificationService.create({
        actor: payload.actor || 'admin',
        conversationId: item.conversation_id,
        type: payload.type || 'system',
        title: payload.title || 'Comms Hub reminder',
        bodyText: payload.bodyText || 'A scheduled Comms Hub action is due.',
        severity: payload.severity || 'info',
        emailRequested: Boolean(payload.emailRequested),
        idempotencySeed: item.id,
      });
    }
    if (item.action_type === 'sla_warning' || item.action_type === 'sla_breach') {
      return this.context.notificationService.create({
        actor: payload.actor || 'admin',
        conversationId: item.conversation_id,
        type: item.action_type,
        title: item.action_type === 'sla_breach' ? 'SLA breached' : 'SLA warning',
        bodyText: `Conversation ${item.conversation_id} ${item.action_type === 'sla_breach' ? 'is overdue' : 'is approaching its response deadline'}.`,
        severity: item.action_type === 'sla_breach' ? 'critical' : 'warning',
        emailRequested: item.action_type === 'sla_breach',
        idempotencySeed: item.id,
      });
    }
    if (item.action_type === 'recheck') {
      return this.context.workflowEngineService.evaluate({
        conversationId: item.conversation_id,
        trigger: 'delayed_recheck',
        event: payload,
      });
    }
    if (item.action_type === 'reply') {
      return this.context.replyDelivery.send({
        conversation: await this.context.repository.getConversation(item.conversation_id),
        draft: payload.draft,
        idempotencyKey: item.idempotency_key,
      });
    }
    if (item.action_type === 'retention') {
      return this.context.retentionWorker.runOnce({
        conversationId: item.conversation_id,
        action: payload.action || 'anonymise',
      });
    }
    if (item.action_type === 'attachment_ingest') {
      const existing = await this.context.operationsRepository.getAttachmentObject?.(payload.attachmentId);
      if (existing?.scan_status === 'clean' && !existing?.deleted_at) return { duplicate: true, attachmentId: payload.attachmentId, status: 'clean' };
      return this.context.attachmentService.ingestReference(payload);
    }
    throw new CommsHubError(400, 'delayed_action_type_unsupported', `Unsupported delayed action ${item.action_type}.`);
  }

  async process(item) {
    try {
      const result = await this.execute(item);
      await this.context.operationsRepository.completeDelayedAction({
        id: item.id,
        workerId: this.workerId,
        completedAt: new Date().toISOString(),
      });
      return { id: item.id, status: 'complete', result };
    } catch (error) {
      const attempts = Number(item.attempts || 1);
      const final = attempts >= Number(item.max_attempts || 8);
      await this.context.operationsRepository.failDelayedAction({
        id: item.id,
        workerId: this.workerId,
        status: final ? 'quarantined' : 'scheduled',
        failureClass: error.failureClass || (final ? 'recoverable' : 'temporary'),
        error: error.message,
        nextAttemptAt: new Date(Date.now() + Math.min(3_600_000, 30_000 * 2 ** attempts)).toISOString(),
        failedAt: new Date().toISOString(),
      });
      if (final) {
        await this.context.quarantineService.quarantine({
          sourceType: 'delayed_action',
          sourceId: item.id,
          conversationId: item.conversation_id,
          failureClass: error.failureClass || 'recoverable',
          errorCode: error.code || 'delayed_action_failed',
          errorMessage: error.message,
          attempts,
          metadata: { actionType: item.action_type },
        });
      }
      return { id: item.id, status: final ? 'quarantined' : 'retry', error: error.message };
    }
  }

  async replay(id) {
    const reset = await this.context.operationsRepository.resetDelayedActionForReplay(id);
    if (!reset) throw new CommsHubError(409, 'delayed_action_not_replayable', 'Delayed action is not in a replayable state.');
    const now = new Date();
    const item = await this.context.operationsRepository.claimDelayedActionById({
      id,
      workerId: this.workerId,
      now: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + this.context.config.delayedActionLeaseMs).toISOString(),
    });
    if (!item) throw new CommsHubError(409, 'delayed_action_replay_claim_failed', 'Delayed action could not be claimed for replay.');
    const result = await this.process(item);
    if (result.status !== 'complete') throw new CommsHubError(502, 'delayed_action_replay_failed', result.error || 'Delayed action replay failed.');
    return result;
  }

  async runOnce({ limit } = {}) {
    if (this.running) return { skipped: true };
    this.running = true;
    const output = [];
    try {
      for (let i = 0; i < (limit || this.context.config.delayedActionBatchSize); i += 1) {
        const now = new Date();
        const item = await this.context.operationsRepository.claimDelayedAction({
          workerId: this.workerId,
          now: now.toISOString(),
          leaseExpiresAt: new Date(now.getTime() + this.context.config.delayedActionLeaseMs).toISOString(),
        });
        if (!item) break;
        output.push(await this.process(item));
      }
      return { processed: output.length, results: output };
    } finally {
      this.running = false;
    }
  }
}

export default CommsHubDelayedActionWorker;
