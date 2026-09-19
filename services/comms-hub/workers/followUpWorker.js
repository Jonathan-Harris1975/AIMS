import { randomUUID } from "node:crypto";
import { safeErrorLog, redactDiagnosticText } from "../domain/redaction.js";
import { log } from "../../../logger.js";

function failureClass(error) {
  if (error?.failureClass) return error.failureClass;
  if (error?.retryable) return "temporary";
  return "recoverable";
}

const EXPECTED_AUTOMATION_SKIP_CODES = new Set([
  "autonomous_policy_not_found",
  "autonomous_reply_policy_rejected",
  "autonomous_reply_response_intelligence_blocked",
  "autonomous_reply_security_blocked",
  "autonomous_reply_requires_approval",
  "autonomous_reply_rate_limited",
  "autonomous_replies_disabled",
  "autonomous_reply_human_assigned",
]);

async function notifyFollowUpReview(context, job, draftId) {
  return context.notificationService?.create?.({
    actor: "admin",
    conversationId: job.conversation_id,
    type: "system",
    title: "Follow-up draft requires review",
    bodyText: "A scheduled follow-up draft is ready but requires human review before it can be sent.",
    severity: "warning",
    emailRequested: false,
    idempotencySeed: `follow-up-review:${job.id}:${draftId || "draft"}`,
  }).catch(() => null);
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
          let delivery = null;
          let deliveryStatus = result?.draft?.id ? "draft_created" : "no_draft";
          if (result?.draft?.id && result.draft.requiresApproval) {
            deliveryStatus = "approval_required";
            await notifyFollowUpReview(this.context, job, result.draft.id);
          } else if (result?.draft?.id && this.context.config.autonomousRepliesEnabled) {
            try {
              delivery = await this.context.governanceService.attemptAutonomousReply(
                { conversationId: job.conversation_id, draftId: result.draft.id },
                { actor: "follow-up-worker", role: "admin" },
              );
              deliveryStatus = "sent";
            } catch (error) {
              if (!EXPECTED_AUTOMATION_SKIP_CODES.has(error?.code)) throw error;
              deliveryStatus = error.code;
              if (error.code === "autonomous_reply_requires_approval") {
                await notifyFollowUpReview(this.context, job, result.draft.id);
              }
            }
          }
          await this.context.aiRepository.completeFollowUp({
            id: job.id,
            workerId: this.workerId,
            completedAt: new Date().toISOString(),
            metadata: {
              aiRunId: result.runId,
              draftId: result.draft?.id || null,
              deliveryStatus,
              providerMessageId: delivery?.providerMessageId || delivery?.messageId || null,
            },
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
          if (exhausted) {
            await this.context.notificationService?.create?.({
              actor: "admin",
              conversationId: job.conversation_id,
              type: "system",
              title: "Scheduled follow-up needs attention",
              bodyText: "A scheduled follow-up exhausted its retry budget. The conversation and draft history are preserved for manual follow-up.",
              severity: "critical",
              emailRequested: false,
              idempotencySeed: `follow-up-exhausted:${job.id}`,
            }).catch(() => null);
          }
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
