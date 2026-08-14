import { randomUUID } from "node:crypto";
import { safeErrorLog, redactDiagnosticText } from "../domain/redaction.js";
import { sha256Hex } from "../domain/ids.js";

function classifyFailure(error) {
  if (error?.failureClass) return error.failureClass;
  const status = Number(error?.statusCode || error?.status || error?.$metadata?.httpStatusCode || 0);
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return "temporary";
  const text = `${error?.name || ""} ${error?.code || ""} ${error?.message || error || ""}`.toLowerCase();
  if (/timeout|abort|temporar|throttl|rate|busy|unavailable|network|socket|reset/.test(text)) return "temporary";
  if (/credential|unauthor|forbidden|access denied|invalidaccesskey|signature/.test(text)) return "permanent";
  return "recoverable";
}

function nextAttemptAt(attempt, now = Date.now()) {
  const base = Math.min(6 * 60 * 60 * 1000, 30_000 * (2 ** Math.max(0, attempt - 1)));
  return new Date(now + base + Math.floor(Math.random() * 5_000)).toISOString();
}

function safePayloadSummary(payloadJson) {
  try {
    const payload = JSON.parse(String(payloadJson || "{}"));
    const answers = Array.isArray(payload?.answers) ? payload.answers : [];
    const attachments = Array.isArray(payload?.attachments) ? payload.attachments : [];
    return {
      formKey: String(payload?.route?.key || "").slice(0, 100) || null,
      workflow: String(payload?.route?.workflow || "").slice(0, 100) || null,
      answerCount: answers.length,
      attachmentCount: attachments.length,
      acknowledgementProvider: "jotform",
    };
  } catch {
    return {
      formKey: null,
      workflow: null,
      answerCount: null,
      attachmentCount: null,
      acknowledgementProvider: "jotform",
    };
  }
}

function receiptFor(job) {
  const summary = safePayloadSummary(job.payload_json);
  return JSON.stringify({
    schemaVersion: 2,
    eventId: job.event_id,
    conversationId: job.conversation_id,
    provider: job.provider,
    sourceReferenceSha256: sha256Hex(`jotform:${job.form_id}:${job.submission_id}`),
    formKey: summary.formKey,
    workflow: summary.workflow,
    receivedAt: job.received_at,
    processedAt: job.processed_at,
    payloadSha256: job.payload_sha256,
    answerCount: summary.answerCount,
    attachmentCount: summary.attachmentCount,
    acknowledgementProvider: summary.acknowledgementProvider,
  }, null, 2);
}

export class CommsHubArchiveWorker {
  constructor({ repository, uploadText, config, workerId = `aims-${randomUUID()}`, logger = null }) {
    this.repository = repository;
    this.uploadText = uploadText;
    this.config = config;
    this.workerId = workerId;
    this.logger = logger;
    this.timer = null;
    this.running = false;
    this.stopping = false;
  }

  async writeLog(level, event, data) {
    try {
      if (this.logger?.[level]) {
        this.logger[level](event, data);
        return;
      }
      const { log } = await import("../../../logger.js");
      log[level](event, data);
    } catch {
      // Logging must never change queue state or retry behaviour.
    }
  }

  async processJob(job) {
    try {
      await this.uploadText(
        this.config.r2BucketAlias,
        job.archive_key,
        receiptFor(job),
        "application/json; charset=utf-8",
        { cacheControl: "no-store, max-age=0" }
      );
      await this.repository.completeArchiveJob({
        eventId: job.event_id,
        workerId: this.workerId,
        completedAt: new Date().toISOString(),
      });
      void this.writeLog("info", "commsHub.archive.complete", {
        eventId: job.event_id,
        conversationId: job.conversation_id,
        attempt: job.archive_attempts,
      });
      return { ok: true };
    } catch (error) {
      const failureClass = classifyFailure(error);
      const exhausted = Number(job.archive_attempts) >= this.config.archiveMaxAttempts;
      const permanent = failureClass === "permanent";
      const status = exhausted || permanent ? "quarantined" : "failed";
      const retryAt = status === "quarantined" ? new Date().toISOString() : nextAttemptAt(job.archive_attempts);
      await this.repository.failArchiveJob({
        eventId: job.event_id,
        workerId: this.workerId,
        status,
        failureClass,
        errorMessage: redactDiagnosticText(error?.message || error).slice(0, 500),
        nextAttemptAt: retryAt,
      });
      void this.writeLog(status === "quarantined" ? "error" : "warn", "commsHub.archive.failed", {
        eventId: job.event_id,
        conversationId: job.conversation_id,
        attempt: job.archive_attempts,
        status,
        error: safeErrorLog(error),
      });
      return { ok: false, status, failureClass };
    }
  }

  async runOnce({ limit = this.config.archiveBatchSize } = {}) {
    if (this.running || this.stopping) return { skipped: true, processed: 0 };
    this.running = true;
    let processed = 0;
    let completed = 0;
    let failed = 0;
    try {
      for (let index = 0; index < limit; index += 1) {
        const now = new Date();
        const job = await this.repository.claimArchiveJob({
          workerId: this.workerId,
          now: now.toISOString(),
          leaseExpiresAt: new Date(now.valueOf() + this.config.archiveLeaseMs).toISOString(),
          maxAttempts: this.config.archiveMaxAttempts,
        });
        if (!job) break;
        processed += 1;
        const result = await this.processJob(job);
        if (result.ok) completed += 1;
        else failed += 1;
      }
      return { skipped: false, processed, completed, failed };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.config.archiveWorkerEnabled || this.timer || this.stopping) return false;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => this.writeLog("error", "commsHub.archive.tickFailed", { error: safeErrorLog(error) }));
    }, this.config.archivePollMs);
    this.timer.unref?.();
    void this.runOnce().catch((error) => this.writeLog("error", "commsHub.archive.initialRunFailed", { error: safeErrorLog(error) }));
    void this.writeLog("info", "commsHub.archive.started", { workerId: this.workerId, pollMs: this.config.archivePollMs });
    return true;
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    void this.writeLog("info", "commsHub.archive.stopped", { workerId: this.workerId });
  }
}

export default CommsHubArchiveWorker;
