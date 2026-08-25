import { randomUUID } from "node:crypto";
import { safeErrorLog, redactDiagnosticText } from "../domain/redaction.js";
import { log } from "../../../logger.js";

function failureClass(error) {
  if (error?.failureClass) return error.failureClass;
  if (error?.retryable) return "temporary";
  return "recoverable";
}

export class CommsHubFollowUpWorker {
  constructor({ context, workerId = `aims-follow-up-${randomUUID()}` }) {
    this.context = context;
    this.workerId = workerId;
    this.timer = null;
    this.running = false;
    this.stopping = false;
  }

  async runOnce({ limit = this.context.config.followUpBatchSize } = {}) {
    if (this.running || this.stopping) return { skipped: true, processed: 0 };
    this.running = true;
    let processed = 0; let completed = 0; let failed = 0;
    try {
      const now = new Date().toISOString();
      const cancelled = await this.context.aiRepository.cancelResolvedFollowUps(now);
      for (let index = 0; index < limit; index += 1) {
        const claimedAt = new Date();
        const job = await this.context.aiRepository.claimFollowUp({
          workerId: this.workerId,
          now: claimedAt.toISOString(),
          leaseExpiresAt: new Date(claimedAt.valueOf() + this.context.config.followUpLeaseMs).toISOString(),
          maxAttempts: this.context.config.followUpMaxAttempts,
        });
        if (!job) break;
        processed += 1;
        try {
          const result = await this.context.aiWorkflowService.analyseConversation(job.conversation_id, {
            operation: "follow_up",
            scheduleFollowUp: false,
          });
          await this.context.aiRepository.completeFollowUp({
            id: job.id,
            workerId: this.workerId,
            completedAt: new Date().toISOString(),
            metadata: { aiRunId: result.runId, draftId: result.draft?.id || null },
          });
          completed += 1;
        } catch (error) {
          const exhausted = Number(job.attempts) >= this.context.config.followUpMaxAttempts;
          await this.context.aiRepository.failFollowUp({
            id: job.id,
            workerId: this.workerId,
            status: exhausted ? "quarantined" : "failed",
            nextAttemptAt: exhausted ? new Date().toISOString() : new Date(Date.now() + Math.min(21_600_000, 30_000 * (2 ** Math.max(0, Number(job.attempts) - 1)))).toISOString(),
            failureClass: failureClass(error),
            error: redactDiagnosticText(error?.message || error),
            failedAt: new Date().toISOString(),
          });
          failed += 1;
          log.warn("commsHub.followUp.failed", { followUpId: job.id, conversationId: job.conversation_id, error: safeErrorLog(error) });
        }
      }
      return { skipped: false, processed, completed, failed, cancelled };
    } finally { this.running = false; }
  }

  start() {
    if (!this.context.config.followUpWorkerEnabled || this.timer || this.stopping) return false;
    this.timer = setInterval(
      () => void this.runOnce().catch((error) => log.error("commsHub.followUp.tickFailed", { workerId: this.workerId, error: safeErrorLog(error) })),
      this.context.config.followUpPollMs
    );
    this.timer.unref?.();
    void this.runOnce().catch((error) => log.error("commsHub.followUp.initialRunFailed", { workerId: this.workerId, error: safeErrorLog(error) }));
    return true;
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export default CommsHubFollowUpWorker;
