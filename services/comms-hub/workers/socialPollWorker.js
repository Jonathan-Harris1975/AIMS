import { randomUUID } from "node:crypto";
import { safeErrorLog, redactDiagnosticText } from "../domain/redaction.js";
import { persistPolledComments, persistPolledConversation } from "../socialService.js";

function isoAfter(ms) {
  return new Date(Date.now() + Math.max(0, Number(ms) || 0)).toISOString();
}

function isoBefore(value, ms) {
  const date = new Date(value || 0);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - Math.max(0, Number(ms) || 0)).toISOString();
}

function failureClass(error) {
  if (error?.failureClass) return error.failureClass;
  if (error?.retryable) return "temporary";
  const status = Number(error?.statusCode || error?.status || 0);
  if (status === 429 || status >= 500) return "temporary";
  return "recoverable";
}

export class CommsHubSocialPollWorker {
  constructor({ repository, zernio, config, writeLog = null }) {
    this.repository = repository;
    this.zernio = zernio;
    this.config = config;
    this.workerId = `comms-social-${randomUUID()}`;
    this.timer = null;
    this.running = false;
    this.writeLog = writeLog || (async (level, event, data) => {
      const { log } = await import("../../../logger.js");
      log[level](event, data);
    });
  }

  enabledFamilies() {
    return Object.entries(this.config.zernioFamilies || {})
      .filter(([, family]) => family.enabled && this.zernio?.[family.family])
      .map(([name]) => name);
  }

  async pollConversationJob(job, client, cycleStartedAt) {
    const listing = await client.listConversations({
      platform: job.platform,
      cursor: job.cursor || "",
      limit: this.config.socialPollBatchSize,
      status: "active",
    });
    let processed = 0;
    let duplicates = 0;
    for (const conversation of Array.isArray(listing?.data) ? listing.data : []) {
      let cursor = "";
      for (let page = 1; page <= this.config.socialPollMaxMessagePages; page += 1) {
        const response = await client.listMessages({
          platform: job.platform,
          conversationId: conversation.id,
          accountId: conversation.accountId,
          cursor,
          limit: 100,
          sortOrder: "desc",
        });
        const result = await persistPolledConversation({
          family: job.credential_family,
          platform: job.platform,
          conversation,
          messages: Array.isArray(response?.messages) ? response.messages : [],
          context: { repository: this.repository },
        });
        processed += result.processed;
        duplicates += result.duplicates;
        if (!response?.pagination?.hasMore || !response?.pagination?.nextCursor) break;
        cursor = response.pagination.nextCursor;
      }
    }
    return {
      processed,
      duplicates,
      nextCursor: listing?.pagination?.hasMore ? listing?.pagination?.nextCursor || "" : "",
      cycleStartedAt,
      cycleComplete: !listing?.pagination?.hasMore,
    };
  }

  async pollCommentJob(job, client, cycleStartedAt) {
    const since = isoBefore(job.last_success_at, this.config.socialPollOverlapMs);
    const listing = await client.listCommentedPosts({
      platform: job.platform,
      cursor: job.cursor || "",
      limit: this.config.socialPollBatchSize,
      since,
    });
    let processed = 0;
    let duplicates = 0;
    for (const post of Array.isArray(listing?.data) ? listing.data : []) {
      let cursor = "";
      for (let page = 1; page <= this.config.socialPollMaxCommentPages; page += 1) {
        const response = await client.listPostComments({
          platform: job.platform,
          postId: post.id,
          accountId: post.accountId,
          cursor,
          limit: 100,
        });
        const result = await persistPolledComments({
          family: job.credential_family,
          platform: job.platform,
          post,
          comments: Array.isArray(response?.comments) ? response.comments : [],
          context: { repository: this.repository },
        });
        processed += result.processed;
        duplicates += result.duplicates;
        const next = response?.pagination?.nextCursor || response?.pagination?.cursor || "";
        if (!response?.pagination?.hasMore || !next) break;
        cursor = next;
      }
    }
    return {
      processed,
      duplicates,
      nextCursor: listing?.pagination?.hasMore ? listing?.pagination?.nextCursor || "" : "",
      cycleStartedAt,
      cycleComplete: !listing?.pagination?.hasMore,
    };
  }

  async processJob(job) {
    const client = this.zernio?.[job.credential_family];
    if (!client) throw new Error(`Zernio ${job.credential_family} client is unavailable.`);
    const cycleStartedAt = job.cycle_started_at || new Date().toISOString();
    if (job.resource === "conversations") return this.pollConversationJob(job, client, cycleStartedAt);
    if (job.resource === "comments") return this.pollCommentJob(job, client, cycleStartedAt);
    throw new Error(`Unsupported social polling resource: ${job.resource}`);
  }

  async runOnce({ limit = 5 } = {}) {
    if (this.running) return { skipped: true, reason: "already_running", processedJobs: 0 };
    const families = this.enabledFamilies();
    if (!families.length) return { skipped: true, reason: "no_enabled_families", processedJobs: 0 };
    this.running = true;
    let processedJobs = 0;
    let ingested = 0;
    let duplicates = 0;
    try {
      const maximum = Math.max(1, Math.min(20, Number(limit) || 5));
      for (let index = 0; index < maximum; index += 1) {
        const now = new Date().toISOString();
        const job = await this.repository.claimSocialPollJob({
          workerId: this.workerId,
          now,
          leaseExpiresAt: isoAfter(this.config.socialPollLeaseMs),
          families,
        });
        if (!job) break;
        try {
          const result = await this.processJob(job);
          const completedAt = new Date().toISOString();
          const cycleComplete = result.cycleComplete;
          await this.repository.completeSocialPollJob({
            id: job.id,
            workerId: this.workerId,
            cursor: cycleComplete ? null : result.nextCursor,
            cycleStartedAt: cycleComplete ? null : result.cycleStartedAt,
            lastSuccessAt: cycleComplete ? completedAt : null,
            nextAttemptAt: cycleComplete ? isoAfter(this.config.socialPollMs) : isoAfter(1_000),
            completedAt,
          });
          processedJobs += 1;
          ingested += result.processed;
          duplicates += result.duplicates;
          await this.writeLog("info", "commsHub.socialPoll.complete", {
            workerId: this.workerId,
            jobId: job.id,
            family: job.credential_family,
            platform: job.platform,
            resource: job.resource,
            ingested: result.processed,
            duplicates: result.duplicates,
            cycleComplete,
          });
        } catch (error) {
          const classification = failureClass(error);
          const delay = classification === "temporary"
            ? Math.min(3_600_000, 30_000 * (2 ** Math.min(6, Math.max(0, Number(job.attempts || 1) - 1))))
            : 3_600_000;
          await this.repository.failSocialPollJob({
            id: job.id,
            workerId: this.workerId,
            failureClass: classification,
            errorMessage: redactDiagnosticText(error?.message || error),
            nextAttemptAt: isoAfter(delay),
            failedAt: new Date().toISOString(),
          });
          await this.writeLog(classification === "temporary" ? "warn" : "error", "commsHub.socialPoll.failed", {
            workerId: this.workerId,
            jobId: job.id,
            family: job.credential_family,
            platform: job.platform,
            resource: job.resource,
            error: safeErrorLog(error),
          });
        }
      }
      return { skipped: false, processedJobs, ingested, duplicates };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.config.socialPollWorkerEnabled || !this.enabledFamilies().length || this.timer) return false;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => this.writeLog("error", "commsHub.socialPoll.tickFailed", { error: safeErrorLog(error) }));
    }, this.config.socialPollMs);
    this.timer.unref?.();
    void this.runOnce().catch((error) => this.writeLog("error", "commsHub.socialPoll.initialRunFailed", { error: safeErrorLog(error) }));
    void this.writeLog("info", "commsHub.socialPoll.started", { workerId: this.workerId, pollMs: this.config.socialPollMs });
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
    void this.writeLog("info", "commsHub.socialPoll.stopped", { workerId: this.workerId });
  }
}

export default CommsHubSocialPollWorker;
