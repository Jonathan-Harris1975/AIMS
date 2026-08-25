import { randomUUID } from "node:crypto";
import { safeErrorLog, redactDiagnosticText } from "../domain/redaction.js";
import { persistPolledComments, persistPolledConversation } from "../socialService.js";
import { SOCIAL_CHANNEL_CAPABILITIES } from "../config.js";

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

function pageState(pagination = {}) {
  return {
    hasMore: Boolean(pagination?.hasMore),
    nextCursorPresent: Boolean(pagination?.nextCursor || pagination?.cursor),
  };
}

export class CommsHubSocialPollWorker {
  constructor({ context = null, repository = null, zernio = null, config = null, writeLog = null }) {
    this.context = context || { repository, zernio, config };
    this.repository = repository || context?.repository;
    this.zernio = zernio || context?.zernio;
    this.config = config || context?.config;
    this.workerId = `comms-social-${randomUUID()}`;
    this.timer = null;
    this.running = false;
    this.stopping = false;
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

  monitoringSummary() {
    const families = this.enabledFamilies();
    return {
      monitorOnly: this.config.socialMonitorOnly !== false,
      workerId: this.workerId,
      pollMs: this.config.socialPollMs,
      batchSize: this.config.socialPollBatchSize,
      families,
      platforms: Object.fromEntries(
        families.map((familyName) => [familyName, [...(this.config.zernioFamilies?.[familyName]?.platforms || [])]])
      ),
      channels: Object.fromEntries(
        Object.entries(SOCIAL_CHANNEL_CAPABILITIES)
          .filter(([, capabilities]) => families.includes(capabilities.family))
          .map(([platform, capabilities]) => [platform, {
            family: capabilities.family,
            directMessages: capabilities.directMessages,
            comments: capabilities.comments,
            pollingResources: [...capabilities.pollingResources],
          }])
      ),
    };
  }

  async pollConversationJob(job, client, cycleStartedAt) {
    const listing = await client.listConversations({
      platform: job.platform,
      cursor: job.cursor || "",
      limit: this.config.socialPollBatchSize,
      status: "active",
    });
    const conversations = Array.isArray(listing?.data) ? listing.data : [];
    await this.writeLog("info", "commsHub.socialPoll.conversations.listed", {
      workerId: this.workerId,
      jobId: job.id,
      family: job.credential_family,
      platform: job.platform,
      resource: job.resource,
      cursorPresent: Boolean(job.cursor),
      conversations: conversations.length,
      ...pageState(listing?.pagination),
    });

    let processed = 0;
    let duplicates = 0;
    let messagePages = 0;
    let messagesSeen = 0;
    for (const conversation of conversations) {
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
        const messages = Array.isArray(response?.messages) ? response.messages : [];
        messagePages += 1;
        messagesSeen += messages.length;
        await this.writeLog("info", "commsHub.socialPoll.messages.page", {
          workerId: this.workerId,
          jobId: job.id,
          family: job.credential_family,
          platform: job.platform,
          page,
          messages: messages.length,
          ...pageState(response?.pagination),
        });
        const result = await persistPolledConversation({
          family: job.credential_family,
          platform: job.platform,
          conversation,
          messages,
          context: this.context,
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
      conversationsScanned: conversations.length,
      messagePages,
      messagesSeen,
      postsScanned: 0,
      commentPages: 0,
      commentsSeen: 0,
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
    const posts = Array.isArray(listing?.data) ? listing.data : [];
    await this.writeLog("info", "commsHub.socialPoll.commentPosts.listed", {
      workerId: this.workerId,
      jobId: job.id,
      family: job.credential_family,
      platform: job.platform,
      resource: job.resource,
      cursorPresent: Boolean(job.cursor),
      sincePresent: Boolean(since),
      posts: posts.length,
      ...pageState(listing?.pagination),
    });

    let processed = 0;
    let duplicates = 0;
    let commentPages = 0;
    let commentsSeen = 0;
    for (const post of posts) {
      let cursor = "";
      for (let page = 1; page <= this.config.socialPollMaxCommentPages; page += 1) {
        const response = await client.listPostComments({
          platform: job.platform,
          postId: post.id,
          accountId: post.accountId,
          cursor,
          limit: 100,
        });
        const comments = Array.isArray(response?.comments) ? response.comments : [];
        commentPages += 1;
        commentsSeen += comments.length;
        await this.writeLog("info", "commsHub.socialPoll.comments.page", {
          workerId: this.workerId,
          jobId: job.id,
          family: job.credential_family,
          platform: job.platform,
          page,
          comments: comments.length,
          ...pageState(response?.pagination),
        });
        const result = await persistPolledComments({
          family: job.credential_family,
          platform: job.platform,
          post,
          comments,
          context: this.context,
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
      conversationsScanned: 0,
      messagePages: 0,
      messagesSeen: 0,
      postsScanned: posts.length,
      commentPages,
      commentsSeen,
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
    if (this.running || this.stopping) {
      const reason = this.stopping ? "stopping" : "already_running";
      await this.writeLog("info", "commsHub.socialPoll.skipped", { workerId: this.workerId, reason });
      return { skipped: true, reason, processedJobs: 0 };
    }
    const families = this.enabledFamilies();
    if (!families.length) {
      await this.writeLog("info", "commsHub.socialPoll.skipped", { workerId: this.workerId, reason: "no_enabled_families" });
      return { skipped: true, reason: "no_enabled_families", processedJobs: 0 };
    }

    const maximum = Math.max(1, Math.min(20, Number(limit) || 5));
    await this.writeLog("info", "commsHub.socialPoll.attempt", {
      ...this.monitoringSummary(),
      jobLimit: maximum,
    });

    this.running = true;
    let processedJobs = 0;
    let ingested = 0;
    let duplicates = 0;
    let noDueJobs = false;
    try {
      for (let index = 0; index < maximum; index += 1) {
        const now = new Date().toISOString();
        const job = await this.repository.claimSocialPollJob({
          workerId: this.workerId,
          now,
          leaseExpiresAt: isoAfter(this.config.socialPollLeaseMs),
          families,
        });
        if (!job) {
          noDueJobs = true;
          await this.writeLog("info", "commsHub.socialPoll.noDueJobs", {
            workerId: this.workerId,
            families,
            processedJobs,
          });
          break;
        }

        await this.writeLog("info", "commsHub.socialPoll.claimed", {
          workerId: this.workerId,
          jobId: job.id,
          family: job.credential_family,
          platform: job.platform,
          resource: job.resource,
          cursorPresent: Boolean(job.cursor),
          cycleStarted: Boolean(job.cycle_started_at),
          lastSuccessAt: job.last_success_at || null,
          attempts: Number(job.attempts || 0),
        });

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
            conversationsScanned: result.conversationsScanned,
            messagePages: result.messagePages,
            messagesSeen: result.messagesSeen,
            postsScanned: result.postsScanned,
            commentPages: result.commentPages,
            commentsSeen: result.commentsSeen,
            cycleComplete,
            nextCursorPresent: !cycleComplete && Boolean(result.nextCursor),
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
            failureClass: classification,
            retryAfterMs: delay,
            error: safeErrorLog(error),
          });
        }
      }
      const result = { skipped: false, processedJobs, ingested, duplicates, noDueJobs };
      await this.writeLog("info", "commsHub.socialPoll.runComplete", {
        workerId: this.workerId,
        families,
        processedJobs,
        ingested,
        duplicates,
        noDueJobs,
      });
      return result;
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.config.socialPollWorkerEnabled || !this.enabledFamilies().length || this.timer || this.stopping) return false;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => this.writeLog("error", "commsHub.socialPoll.tickFailed", { error: safeErrorLog(error) }));
    }, this.config.socialPollMs);
    this.timer.unref?.();
    void this.runOnce().catch((error) => this.writeLog("error", "commsHub.socialPoll.initialRunFailed", { error: safeErrorLog(error) }));
    void this.writeLog("info", "commsHub.socialPoll.started", this.monitoringSummary());
    return true;
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
    void this.writeLog("info", "commsHub.socialPoll.stopped", { workerId: this.workerId });
  }
}

export default CommsHubSocialPollWorker;
