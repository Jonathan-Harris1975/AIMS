import { log } from "../../../logger.js";
import { safeErrorLog } from "../domain/redaction.js";

export class CommsHubHousekeepingWorker {
  constructor({ context }) {
    this.context = context;
    this.timer = null;
    this.running = false;
    this.stopping = false;
  }

  async runOnce({ now = new Date() } = {}) {
    if (this.running || this.stopping) {
      return { skipped: true, reason: this.stopping ? "stopping" : "already_running" };
    }
    this.running = true;
    try {
      return this.context.housekeepingService.run({ runType: "daily", actor: "aims:housekeeping-worker", now });
    } finally {
      this.running = false;
    }
  }

  start() {
    if (!this.context.config.housekeepingEnabled || !this.context.config.housekeepingWorkerEnabled || this.timer || this.stopping) return false;
    const run = () => void this.runOnce().catch((error) => {
      log.error("commsHub.housekeeping.failed", { error: safeErrorLog(error) });
    });
    run();
    this.timer = setInterval(run, this.context.config.housekeepingPollMs);
    this.timer.unref?.();
    return true;
  }

  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export default CommsHubHousekeepingWorker;
