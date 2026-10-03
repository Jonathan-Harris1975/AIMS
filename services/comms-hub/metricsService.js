import { CommsHubError } from './errors.js';
import { newsletterRequestSignals } from '../newsletter/telemetry.js';

export class CommsHubMetricsService {
  constructor({ context }) { this.context = context; }
  async get({ from, to }) {
    const fromMs = Date.parse(from);
    const toMs = Date.parse(to);
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs || toMs - fromMs > 366 * 86400000) {
      throw new CommsHubError(400, 'metrics_range_invalid', 'Metrics range is invalid.');
    }
    const metrics = await this.context.operationsRepository.metrics({ from: new Date(fromMs).toISOString(), to: new Date(toMs).toISOString() });
    return { ...metrics, newsletterRequestSignals: newsletterRequestSignals() };
  }
}
export default CommsHubMetricsService;
