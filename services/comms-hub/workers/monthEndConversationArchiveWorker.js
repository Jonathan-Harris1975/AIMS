import { log } from '../../../logger.js';
import { safeErrorLog } from '../domain/redaction.js';

function partsAt(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, Number(part.value)]));
}

function zonedLocalToUtc({ year, month, day, hour = 0, minute = 0, second = 0 }, timeZone) {
  const target = Date.UTC(year, month - 1, day, hour, minute, second);
  let guess = target;
  for (let index = 0; index < 3; index += 1) {
    const seen = partsAt(new Date(guess), timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute, seen.second);
    const next = target - (seenAsUtc - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

export function currentMonthArchiveCutoff(now = new Date(), timeZone = 'Europe/London') {
  const local = partsAt(now, timeZone);
  return zonedLocalToUtc({ year: local.year, month: local.month, day: 1 }, timeZone).toISOString();
}

export class CommsHubMonthEndConversationArchiveWorker {
  constructor({ context }) {
    this.context = context;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (!this.context.config.monthEndArchiveEnabled || this.timer) return false;
    this.timer = setInterval(
      () => void this.runOnce().catch((error) => log.error('commsHub.monthEndArchive.failed', { error: safeErrorLog(error) })),
      this.context.config.monthEndArchivePollMs,
    );
    this.timer.unref?.();
    void this.runOnce().catch((error) => log.error('commsHub.monthEndArchive.initialFailed', { error: safeErrorLog(error) }));
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runOnce({ limit = null, now = null } = {}) {
    if (!this.context.config.monthEndArchiveEnabled) return { skipped: true, reason: 'disabled', archived: 0 };
    if (this.running) return { skipped: true, reason: 'already_running', archived: 0 };
    this.running = true;
    try {
      const at = now ? new Date(now) : (this.context.now ? new Date(this.context.now()) : new Date());
      const cutoff = currentMonthArchiveCutoff(at, this.context.config.businessTimeZone || 'Europe/London');
      const batchSize = Math.min(Math.max(Number(limit) || this.context.config.monthEndArchiveBatchSize, 1), 500);
      const candidates = await this.context.operationsRepository.listResolvedBeforeArchiveCutoff(cutoff, batchSize);
      let archived = 0;
      const failed = [];
      for (const candidate of candidates) {
        try {
          await this.context.operationsService.updateStatus({
            conversationId: candidate.conversation_id,
            status: 'archived',
            expectedVersion: candidate.version ?? null,
            reason: 'automatic_month_end_archive',
          }, { id: null, commsIdentity: { actor: 'month-end-archive', role: 'admin' } });
          archived += 1;
        } catch (error) {
          failed.push({ conversationId: candidate.conversation_id, code: error?.code || 'archive_failed' });
          log.warn('commsHub.monthEndArchive.conversationFailed', { conversationId: candidate.conversation_id, error: safeErrorLog(error) });
        }
      }
      return { skipped: false, cutoff, candidates: candidates.length, archived, failed };
    } finally {
      this.running = false;
    }
  }
}

export default CommsHubMonthEndConversationArchiveWorker;
