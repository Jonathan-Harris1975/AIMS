import { randomUUID } from "node:crypto";
import { log } from "../../logger.js";
import { safeErrorLog } from "./domain/redaction.js";
import { buildWorkerHeartbeatHealth, workerRunAdvanced } from "./workerHeartbeatState.js";

const INSTRUMENTED = Symbol("commsHubWorkerHeartbeatInstrumented");

export class CommsHubWorkerHeartbeatService {
  constructor({ context, instanceId = randomUUID() }) {
    this.context = context;
    this.instanceId = String(instanceId).slice(0, 200);
  }

  criticalDescriptors() {
    const config = this.context.config;
    const descriptors = [
      { category: "social_poll", key: "default", enabled: config.socialPollWorkerEnabled === true, pollIntervalMs: config.socialPollMs },
      { category: "follow_up", key: "default", enabled: config.followUpWorkerEnabled === true, pollIntervalMs: config.followUpPollMs },
      { category: "provider_monitor", key: "default", enabled: config.providerHealthWorkerEnabled === true, pollIntervalMs: config.providerHealthPollMs },
      { category: "delayed_actions", key: "default", enabled: config.delayedActionWorkerEnabled === true, pollIntervalMs: config.delayedActionPollMs },
      { category: "archive", key: "default", enabled: config.archiveWorkerEnabled === true, pollIntervalMs: config.archivePollMs },
      {
        category: "webhook_reconcile",
        key: "default",
        enabled: config.zernioWebhookReconcileEnabled === true && Object.values(config.zernioFamilies || {}).some((family) => family.enabled),
        pollIntervalMs: config.zernioWebhookReconcileIntervalMs,
      },
      { category: "backup", key: "default", enabled: config.backupEnabled === true && config.backupAutomaticEnabled === true, pollIntervalMs: config.backupIntervalMs },
      { category: "retention", key: "default", enabled: config.retentionWorkerEnabled === true, pollIntervalMs: config.retentionPollMs },
      { category: "month_end_archive", key: "default", enabled: config.monthEndArchiveEnabled === true, pollIntervalMs: config.monthEndArchivePollMs },
      { category: "housekeeping", key: "default", enabled: config.housekeepingEnabled === true && config.housekeepingWorkerEnabled === true, pollIntervalMs: config.housekeepingPollMs },
    ];
    for (const [accountKey, account] of Object.entries(config.emailAccounts || {})) {
      descriptors.push({
        category: "inbound_email",
        key: accountKey,
        enabled: config.emailPollWorkerEnabled === true && account.enabled === true,
        pollIntervalMs: config.emailPollMs,
      });
    }
    return descriptors;
  }

  async safeRecord(event, descriptor, error = null) {
    try {
      await this.context.operationsRepository.recordWorkerHeartbeat({
        category: descriptor.category,
        key: descriptor.key,
        instanceId: this.instanceId,
        enabled: descriptor.enabled === true,
        pollIntervalMs: descriptor.pollIntervalMs,
        event,
        errorCode: error?.code || error?.name || null,
      });
      return true;
    } catch (recordError) {
      log.warn("commsHub.workerHeartbeat.persistFailed", {
        category: descriptor.category,
        key: descriptor.key,
        event,
        error: safeErrorLog(recordError),
      });
      return false;
    }
  }

  async registerCriticalWorkers() {
    const retentionCutoff = new Date(Date.now() - 30 * 86400000).toISOString();
    try {
      await this.context.operationsRepository.pruneWorkerHeartbeats({ before: retentionCutoff });
    } catch (error) {
      log.warn("commsHub.workerHeartbeat.pruneFailed", { error: safeErrorLog(error) });
    }
    await Promise.all(this.criticalDescriptors().map((descriptor) => this.safeRecord("registered", descriptor)));
  }

  instrument(worker, descriptor) {
    if (!worker || !descriptor || typeof worker.runOnce !== "function" || worker[INSTRUMENTED]) return worker;
    const original = worker.runOnce.bind(worker);
    const service = this;
    Object.defineProperty(worker, INSTRUMENTED, { value: true });
    worker.runOnce = async function instrumentedRunOnce(...args) {
      await service.safeRecord("attempt", descriptor);
      try {
        const result = await original(...args);
        if (workerRunAdvanced(result)) await service.safeRecord("success", descriptor);
        return result;
      } catch (error) {
        await service.safeRecord("failure", descriptor, error);
        throw error;
      }
    };
    return worker;
  }

  instrumentCriticalWorkers() {
    const byIdentity = new Map(this.criticalDescriptors().map((descriptor) => [`${descriptor.category}:${descriptor.key}`, descriptor]));
    const bind = (worker, category, key = "default") => this.instrument(worker, byIdentity.get(`${category}:${key}`));
    bind(this.context.socialPollWorker, "social_poll");
    bind(this.context.followUpWorker, "follow_up");
    bind(this.context.providerHealthWorker, "provider_monitor");
    bind(this.context.delayedActionWorker, "delayed_actions");
    bind(this.context.archiveWorker, "archive");
    bind(this.context.webhookReconcileWorker, "webhook_reconcile");
    bind(this.context.backupWorker, "backup");
    bind(this.context.retentionWorker, "retention");
    bind(this.context.monthEndConversationArchiveWorker, "month_end_archive");
    bind(this.context.housekeepingWorker, "housekeeping");
    for (const [accountKey, worker] of Object.entries(this.context.emailPollWorkers || {})) bind(worker, "inbound_email", accountKey);
  }

  async getHealth({ now = new Date() } = {}) {
    const rows = await this.context.operationsRepository.listWorkerHeartbeats();
    return buildWorkerHeartbeatHealth({ descriptors: this.criticalDescriptors(), rows, now });
  }
}

export default CommsHubWorkerHeartbeatService;
