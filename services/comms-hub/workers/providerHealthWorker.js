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
    this.timer = setInterval(() => void this.runOnce().catch(() => {}), this.context.config.providerHealthPollMs);
    this.timer.unref?.(); void this.runOnce().catch(() => {}); return true;
  }
  async stop() { this.stopping = true; if (this.timer) clearInterval(this.timer); this.timer = null; while (this.running) await new Promise((resolve) => setTimeout(resolve, 25)); }
}
export default CommsHubProviderHealthWorker;
