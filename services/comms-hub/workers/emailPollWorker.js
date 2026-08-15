import { randomUUID } from 'node:crypto';
import { safeErrorLog } from '../domain/redaction.js';
import { log } from '../../../logger.js';
import { CommsHubError } from '../errors.js';

function delay(attempt) {
  return Math.min(3_600_000, 30_000 * (2 ** Math.min(attempt, 7)));
}

export class CommsHubEmailPollWorker {
  constructor({ context }) {
    this.context = context;
    this.timer = null;
    this.running = false;
    this.workerId = `email-${randomUUID()}`;
  }

  start() {
    if (!this.context.config.emailPollWorkerEnabled || this.timer) return false;
    this.timer = setInterval(
      () => void this.runOnce().catch((error) => log.error('commsHub.emailPoll.failed', { error: safeErrorLog(error) })),
      this.context.config.emailPollMs
    );
    this.timer.unref?.();
    void this.runOnce();
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async replay(sourceId) {
    const accountKey = this.context.config.oneComEmailAccountKey;
    const mailbox = this.context.config.oneComMailbox;
    if (sourceId !== `${accountKey}:${mailbox}`) {
      throw new CommsHubError(409, 'email_poll_replay_target_invalid', 'Email poll replay target does not match the configured mailbox.');
    }
    await this.context.operationsRepository.resetEmailPollStateForReplay({ accountKey, mailbox });
    const result = await this.runOnce({ force: true });
    if (result.skipped) throw new CommsHubError(409, 'email_poll_replay_not_run', 'Email poll replay could not be started.');
    return result;
  }

  async runOnce({ limit, force = false } = {}) {
    if (this.running) return { skipped: true, reason: 'already_running' };
    this.running = true;
    const now = new Date();
    const mailbox = this.context.config.oneComMailbox;
    const accountKey = this.context.config.oneComEmailAccountKey;
    let state;
    try {
      if (force) await this.context.operationsRepository.resetEmailPollStateForReplay({ accountKey, mailbox, at: now.toISOString() });
      state = await this.context.operationsRepository.claimEmailPollState({
        accountKey,
        mailbox,
        workerId: this.workerId,
        now: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + this.context.config.emailPollLeaseMs).toISOString(),
      });
      if (!state) return { skipped: true, reason: 'not_due' };

      // Safety boundary: inspect mailbox metadata before fetching any body.
      // First run, UIDVALIDITY changes and mailbox resets establish a fresh
      // watermark rather than risking historical message processing.
      const cursor = await this.context.oneComMail.getMailboxCursor({ mailbox });
      const lastUid = Number(state.last_uid || 0);
      const previousUidValidity = Number(state.uid_validity || 0) || null;
      const uidValidityChanged = Boolean(previousUidValidity && cursor.uidValidity && previousUidValidity !== cursor.uidValidity);
      const mailboxReset = lastUid > Number(cursor.highestUid || 0);

      if ((!lastUid && !this.context.config.emailHistoricalBackfillEnabled) || uidValidityChanged || mailboxReset) {
        await this.context.operationsRepository.completeEmailPollState({
          accountKey,
          mailbox,
          workerId: this.workerId,
          lastUid: cursor.highestUid,
          uidValidity: cursor.uidValidity,
          nextAttemptAt: new Date(Date.now() + this.context.config.emailPollMs).toISOString(),
        });
        const reason = uidValidityChanged ? 'uidvalidity_rebaseline' : mailboxReset ? 'mailbox_reset_rebaseline' : 'historical_baseline_established';
        log.info('commsHub.emailPoll.baseline', { accountKey, mailbox, reason, highestUid: cursor.highestUid, uidValidity: cursor.uidValidity });
        return { skipped: true, reason, highestUid: cursor.highestUid };
      }

      const fetched = await this.context.oneComMail.fetchMessages({
        mailbox,
        afterUid: Number(state.last_uid || 0),
        limit: limit || this.context.config.emailPollBatchSize,
      });
      const results = [];
      for (const message of fetched.messages) {
        results.push(await this.context.emailService.persistFetched({ uid: message.uid, parsed: message.parsed, mailbox }));
      }
      await this.context.operationsRepository.completeEmailPollState({
        accountKey,
        mailbox,
        workerId: this.workerId,
        lastUid: fetched.highestUid,
        uidValidity: fetched.uidValidity,
        nextAttemptAt: new Date(Date.now() + this.context.config.emailPollMs).toISOString(),
      });
      if (results.length) {
        log.info('commsHub.emailPoll.processed', {
          accountKey,
          mailbox,
          managedAddress: this.context.config.oneComEmailAddress,
          processed: results.length,
          attachmentCount: results.reduce((total, item) => total + (item.attachments?.length || 0), 0),
        });
      }
      return { processed: results.length, highestUid: fetched.highestUid, results };
    } catch (error) {
      if (state) {
        await this.context.operationsRepository.failEmailPollState({
          accountKey,
          mailbox,
          workerId: this.workerId,
          failureClass: error.failureClass || 'temporary',
          error: error.message,
          nextAttemptAt: new Date(Date.now() + delay(Number(state.attempts || 1))).toISOString(),
        }).catch(() => null);
      }
      await this.context.quarantineService.quarantine({
        sourceType: 'email_poll',
        sourceId: `${accountKey}:${mailbox}`,
        failureClass: error.failureClass || 'temporary',
        errorCode: error.code || 'email_poll_failed',
        errorMessage: error.message,
        attempts: Number(state?.attempts || 1),
        metadata: { accountKey, mailbox },
      }).catch(() => null);
      throw error;
    } finally {
      this.running = false;
    }
  }
}

export default CommsHubEmailPollWorker;
