import { log } from "../../../logger.js";
import { safeErrorLog } from "../domain/redaction.js";

export class CommsHubProviderHealthWorker {
  constructor({ context }) { this.context = context; this.timer = null; this.running = false; this.stopping = false; }
  async runOnce() {
    if (this.running || this.stopping) return { skipped: true, captured: 0 };
    this.running = true;
    try { const captured = await this.context.providerHealthService.capture(); return { skipped: false, captured: captured.length }; }
    finally { this.running = false; }
  }
  start() {
    if (!this.context.config.providerHealthWorkerEnabled || this.timer || this.stopping) return false;
    this.timer = setInterval(
      () => void this.runOnce().catch((error) => log.error("commsHub.providerHealth.tickFailed", { error: safeErrorLog(error) })),
      this.context.config.providerHealthPollMs
    );
    this.timer.unref?.();
    void this.runOnce().catch((error) => log.error("commsHub.providerHealth.initialRunFailed", { error: safeErrorLog(error) }));
    return true;
  }
  async stop() { this.stopping = true; if (this.timer) clearInterval(this.timer); this.timer = null; while (this.running) await new Promise((resolve) => setTimeout(resolve, 25)); }
}
export default CommsHubProviderHealthWorker;
