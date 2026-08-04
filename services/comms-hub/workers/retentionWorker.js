import { log } from '../../../logger.js';
import { safeErrorLog } from '../domain/redaction.js';
import { stableId } from '../domain/ids.js';
import { CommsHubError } from '../errors.js';

export class CommsHubRetentionWorker {
  constructor({ context }) {
    this.context = context;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.context.config.retentionWorkerEnabled || this.timer) return false;
    this.timer = setInterval(
      () => void this.runOnce().catch((error) => log.error('commsHub.retention.failed', { error: safeErrorLog(error) })),
      this.context.config.retentionPollMs
    );
    this.timer.unref?.();
    void this.runOnce();
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async executeCandidate(candidate, actor = 'retention-worker') {
    if (candidate.action === 'archive') {
      return this.context.operationsRepository.updateConversationStatus({
        conversationId: candidate.conversation_id,
        status: 'archived',
        actor,
        reason: `retention:${candidate.policy_key}`,
      });
    }
    if (candidate.action === 'anonymise') {
      return this.context.governanceService.anonymise({ conversationId: candidate.conversation_id, actor });
    }
    if (candidate.action === 'delete') {
      return this.context.governanceService.deleteConversation({ conversationId: candidate.conversation_id, actor });
    }
    throw new CommsHubError(400, 'retention_action_invalid', `Unsupported retention action: ${candidate.action}.`);
  }

  async processCandidate(candidate) {
    const at = new Date().toISOString();
    const job = await this.context.operationsRepository.createRetentionJob({
      id: stableId('rtj', candidate.policy_key, candidate.conversation_id),
      policyId: candidate.policy_id,
      contactId: candidate.contact_id,
      conversationId: candidate.conversation_id,
      action: candidate.action,
      actor: 'retention-worker',
      requestedAt: at,
      metadata: {},
    });
    if (!job) return { skipped: true, conversationId: candidate.conversation_id };
    try {
      const result = await this.executeCandidate(candidate);
      await this.context.operationsRepository.updateRetentionJob({ id: job.id, status: 'complete', completedAt: new Date().toISOString() });
      return { id: job.id, status: 'complete', result };
    } catch (error) {
      await this.context.operationsRepository.updateRetentionJob({ id: job.id, status: 'quarantined', error: error.message });
      await this.context.quarantineService.quarantine({
        sourceType: 'retention_job',
        sourceId: job.id,
        conversationId: candidate.conversation_id,
        failureClass: error.failureClass || 'recoverable',
        errorCode: error.code || 'retention_failed',
        errorMessage: error.message,
        metadata: { policyId: candidate.policy_id, policyKey: candidate.policy_key, action: candidate.action },
      });
      return { id: job.id, status: 'quarantined' };
    }
  }

  async replay(jobId) {
    const candidate = await this.context.operationsRepository.getRetentionJobForReplay(jobId);
    if (!candidate) throw new CommsHubError(404, 'retention_job_not_found', 'Retention job was not found.');
    if (candidate.status !== 'quarantined' && candidate.status !== 'failed') {
      throw new CommsHubError(409, 'retention_job_not_replayable', 'Retention job is not in a replayable state.');
    }
    await this.context.operationsRepository.updateRetentionJob({ id: jobId, status: 'processing', error: null });
    try {
      const result = await this.executeCandidate(candidate, 'retention-replay');
      await this.context.operationsRepository.updateRetentionJob({ id: jobId, status: 'complete', error: null, completedAt: new Date().toISOString() });
      return { id: jobId, status: 'complete', result };
    } catch (error) {
      await this.context.operationsRepository.updateRetentionJob({ id: jobId, status: 'quarantined', error: error.message });
      throw error;
    }
  }

  async runOnce({ limit, conversationId, action = 'anonymise' } = {}) {
    if (this.running) return { skipped: true };
    this.running = true;
    try {
      let candidates;
      if (conversationId) {
        const conversation = await this.context.repository.getConversation(conversationId);
        if (!conversation) throw new CommsHubError(404, 'conversation_not_found', 'Conversation was not found.');
        candidates = [{
          conversation_id: conversationId,
          contact_id: conversation.contact_id,
          action,
          policy_id: null,
          policy_key: `manual_${action}`,
        }];
      } else {
        candidates = await this.context.operationsRepository.listDueRetentionCandidates(
          new Date().toISOString(),
          limit || this.context.config.retentionBatchSize
        );
      }
      const results = [];
      for (const candidate of candidates) results.push(await this.processCandidate(candidate));
      return { processed: results.length, results };
    } finally {
      this.running = false;
    }
  }
}

export default CommsHubRetentionWorker;
