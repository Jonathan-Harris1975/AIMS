import { randomUUID } from "node:crypto";
import { reconcileZernioWebhook } from "../socialService.js";
import { safeErrorLog } from "../domain/redaction.js";

export class CommsHubWebhookReconcileWorker {
  constructor({ context, writeLog = null }) {
    this.context = context;
    this.workerId = `comms-webhooks-${randomUUID()}`;
    this.timer = null;
    this.running = false;
    this.writeLog = writeLog || (async (level, event, data) => {
      const { log } = await import("../../../logger.js");
      log[level](event, data);
    });
  }

  enabledFamilies() {
    return Object.entries(this.context?.config?.zernioFamilies || {})
      .filter(([, family]) => family?.enabled && this.context?.zernio?.[family.family])
      .map(([family]) => family);
  }

  async runOnce() {
    if (this.running) return { skipped: true, reason: "already_running" };
    if (!this.context?.config?.zernioWebhookReconcileEnabled) return { skipped: true, reason: "disabled" };
    const families = this.enabledFamilies();
    if (!families.length) return { skipped: true, reason: "no_enabled_families" };

    this.running = true;
    const results = {};
    const failures = {};
    try {
      for (const family of families) {
        try {
          results[family] = await reconcileZernioWebhook({ family, context: this.context });
        } catch (error) {
          failures[family] = {
            code: error?.code || error?.name || "webhook_reconcile_failed",
            error: safeErrorLog(error),
          };
          await this.writeLog("warn", "commsHub.webhooks.familyReconcileFailed", {
            workerId: this.workerId,
            family,
            code: failures[family].code,
            error: failures[family].error,
          });
        }
      }
      const succeeded = Object.keys(results);
      const failed = Object.keys(failures);
      await this.writeLog(failed.length ? "warn" : "info", "commsHub.webhooks.reconciled", {
        workerId: this.workerId,
        families,
        succeeded,
        failed,
        operations: Object.fromEntries(Object.entries(results).map(([family, item]) => [family, item?.operation || "unknown"])),
      });
      return { skipped: false, enabledFamilies: families, families: results, failures, succeeded, failed };
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.context?.config?.zernioWebhookReconcileEnabled || this.timer || !this.enabledFamilies().length) return false;
    const intervalMs = this.context.config.zernioWebhookReconcileIntervalMs;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {});
    }, intervalMs);
    this.timer.unref?.();
    void this.runOnce().catch(() => {});
    void this.writeLog("info", "commsHub.webhooks.workerStarted", {
      workerId: this.workerId,
      intervalMs,
      families: this.enabledFamilies(),
    });
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export default CommsHubWebhookReconcileWorker;
