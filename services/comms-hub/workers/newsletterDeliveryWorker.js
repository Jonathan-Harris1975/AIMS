import { log } from '../../../logger.js';
import { safeErrorLog } from '../domain/redaction.js';

export class NewsletterDeliveryWorker {
  constructor({ context }) { this.context = context; this.running = false; this.stopping = false; this.timer = null; }
  async runOnce() {
    if (this.running || this.stopping) return { skipped: true, reason: this.stopping ? 'stopping' : 'already_running' };
    this.running = true;
    try { return await this.context.newsletterDeliveryMonitor.run(); }
    catch (error) {
      await this.context.newsletterDeliveryMonitor.notify('monitor_unavailable', new Date().toISOString().slice(0, 10),
        'Newsletter delivery monitoring is unavailable. Check worker health and Newsletter mailbox connectivity. Receipt cannot be verified.').catch(() => null);
      throw error;
    } finally { this.running = false; }
  }
  start() {
    if (!this.context.config.newsletterDeliveryMonitorEnabled || this.timer || this.stopping) return false;
    const run = () => void this.runOnce().catch(error => log.error('newsletter.deliveryMonitor.failed', { error: safeErrorLog(error) }));
    run();
    this.timer = setInterval(run, this.context.config.newsletterDeliveryMonitorPollMs);
    this.timer.unref?.();
    return true;
  }
  async stop() {
    this.stopping = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    while (this.running) await new Promise(resolve => setTimeout(resolve, 25));
  }
}
