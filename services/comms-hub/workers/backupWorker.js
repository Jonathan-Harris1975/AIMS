export class CommsHubBackupWorker {
  constructor({ context }) { this.context = context; this.timer = null; this.running = false; this.stopping = false; }
  async runOnce() {
    if (this.running || this.stopping) return { skipped: true };
    this.running = true;
    try { return { skipped: false, backup: await this.context.backupService.runBackup({ actor: "aims:scheduled-backup" }) }; }
    finally { this.running = false; }
  }
  start() {
    if (!this.context.config.backupEnabled || !this.context.config.backupAutomaticEnabled || this.timer || this.stopping) return false;
    this.timer = setInterval(() => void this.runOnce().catch(() => {}), this.context.config.backupIntervalMs);
    this.timer.unref?.(); return true;
  }
  async stop() { this.stopping = true; if (this.timer) clearInterval(this.timer); this.timer = null; while (this.running) await new Promise((resolve) => setTimeout(resolve, 25)); }
}
export default CommsHubBackupWorker;
