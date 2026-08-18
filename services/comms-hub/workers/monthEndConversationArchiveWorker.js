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
      const archivedAt = at.toISOString();
      const cutoff = currentMonthArchiveCutoff(at, this.context.config.businessTimeZone || 'Europe/London');
      const batchSize = Math.min(Math.max(Number(limit) || this.context.config.monthEndArchiveBatchSize, 1), 500);
      const candidates = await this.context.operationsRepository.listClosedBeforeArchiveCutoff(cutoff, batchSize);
      let archived = 0;
      const failed = [];
      for (const candidate of candidates) {
        try {
          const [conversation, workspace] = await Promise.all([
            this.context.repository.getConversation(candidate.conversation_id),
            this.context.operationsRepository.getConversationWorkspace(candidate.conversation_id),
          ]);
          if (!conversation) continue;
          await this.context.operationsRepository.storeConversationArchive({
            conversation,
            snapshot: { conversation, ...workspace },
            closedAt: candidate.closed_at || conversation.updated_at,
            archivedAt,
          });
          const currentOperations = candidate.version == null
            ? await this.context.operationsRepository.ensureConversationOperations(candidate.conversation_id, 'month-end-archive', archivedAt)
            : null;
          const updated = await this.context.operationsRepository.updateConversationStatus({
            conversationId: candidate.conversation_id,
            status: 'archived',
            actor: 'month-end-archive',
            expectedVersion: candidate.version ?? currentOperations?.version ?? null,
            reason: 'automatic_month_end_archive',
            at: archivedAt,
          });
          await this.context.aiRepository?.cancelFollowUpsForConversation?.({
            conversationId: candidate.conversation_id,
            cancelledAt: archivedAt,
            reason: 'conversation_archived',
          }).catch(() => null);
          await this.context.auditService?.record?.({
            actor: 'month-end-archive',
            role: 'admin',
            action: 'conversation_archived_monthly',
            objectType: 'conversation',
            objectId: candidate.conversation_id,
            conversationId: candidate.conversation_id,
            after: updated,
            details: { cutoff, archivedAt, archiveStore: 'comms_hub_conversation_archives' },
          }).catch(() => null);
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
