import { randomUUID } from 'node:crypto';
import { safeErrorLog } from '../domain/redaction.js';
import { log } from '../../../logger.js';
import { CommsHubError } from '../errors.js';

function delay(attempt) {
  return Math.min(3_600_000, 30_000 * (2 ** Math.min(attempt, 7)));
}

function providerStage(error, fallback = null) {
  return error?.providerStage || error?.cause?.providerStage || fallback;
}

function safeCause(error) {
  return error?.cause ? safeErrorLog(error.cause) : null;
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

    const reportUnhandledRunFailure = (event, error) => {
      log.error(event, {
        workerId: this.workerId,
        accountKey: this.context.config.oneComEmailAccountKey,
        mailbox: this.context.config.oneComMailbox,
        providerStage: providerStage(error),
        error: safeErrorLog(error),
        cause: safeCause(error),
      });
    };

    this.timer = setInterval(
      () => void this.runOnce().catch((error) => reportUnhandledRunFailure('commsHub.emailPoll.tickFailed', error)),
      this.context.config.emailPollMs
    );
    this.timer.unref?.();

    log.info('commsHub.emailPoll.started', {
      workerId: this.workerId,
      accountKey: this.context.config.oneComEmailAccountKey,
      mailbox: this.context.config.oneComMailbox,
      managedAddress: this.context.config.oneComEmailAddress,
      pollMs: this.context.config.emailPollMs,
      leaseMs: this.context.config.emailPollLeaseMs,
      batchSize: this.context.config.emailPollBatchSize,
      historicalBackfillEnabled: this.context.config.emailHistoricalBackfillEnabled,
    });

    // Never allow the boot-time IMAP attempt to become an unhandled rejection.
    // runOnce() intentionally rethrows after recording/quarantining a failure.
    void this.runOnce().catch((error) => reportUnhandledRunFailure('commsHub.emailPoll.initialRunFailed', error));
    return true;
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    log.info('commsHub.emailPoll.stopped', { workerId: this.workerId });
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
    if (this.running) {
      log.info('commsHub.emailPoll.skipped', { workerId: this.workerId, reason: 'already_running' });
      return { skipped: true, reason: 'already_running' };
    }

    this.running = true;
    const now = new Date();
    const mailbox = this.context.config.oneComMailbox;
    const accountKey = this.context.config.oneComEmailAccountKey;
    let state;
    let stage = 'claim_state';

    log.info('commsHub.emailPoll.attempt', {
      workerId: this.workerId,
      accountKey,
      mailbox,
      force,
      requestedLimit: limit || null,
    });

    try {
      if (force) {
        stage = 'reset_forced_poll';
        await this.context.operationsRepository.resetEmailPollStateForReplay({ accountKey, mailbox, at: now.toISOString() });
      }

      stage = 'claim_state';
      state = await this.context.operationsRepository.claimEmailPollState({
        accountKey,
        mailbox,
        workerId: this.workerId,
        now: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + this.context.config.emailPollLeaseMs).toISOString(),
      });

      if (!state) {
        const current = typeof this.context.operationsRepository.getEmailPollState === 'function'
          ? await this.context.operationsRepository.getEmailPollState({ accountKey, mailbox }).catch(() => null)
          : null;
        log.info('commsHub.emailPoll.skipped', {
          workerId: this.workerId,
          accountKey,
          mailbox,
          reason: 'not_due',
          nextAttemptAt: current?.next_attempt_at || null,
          leaseExpiresAt: current?.lease_expires_at || null,
          leased: Boolean(current?.lease_owner),
          attempts: Number(current?.attempts || 0),
          lastUid: Number(current?.last_uid || 0),
          uidValidity: Number(current?.uid_validity || 0) || null,
          lastSuccessAt: current?.last_success_at || null,
          failureClass: current?.failure_class || null,
        });
        return { skipped: true, reason: 'not_due' };
      }

      log.info('commsHub.emailPoll.claimed', {
        workerId: this.workerId,
        accountKey,
        mailbox,
        attempts: Number(state.attempts || 0),
        lastUid: Number(state.last_uid || 0),
        uidValidity: Number(state.uid_validity || 0) || null,
        leaseExpiresAt: state.lease_expires_at || null,
      });

      // Safety boundary: inspect mailbox metadata before fetching any body.
      // First run, UIDVALIDITY changes and mailbox resets establish a fresh
      // watermark rather than risking historical message processing.
      stage = 'mailbox_cursor';
      log.info('commsHub.emailPoll.imapCursor.start', { workerId: this.workerId, accountKey, mailbox });
      const cursor = await this.context.oneComMail.getMailboxCursor({ mailbox });
      log.info('commsHub.emailPoll.imapCursor.complete', {
        workerId: this.workerId,
        accountKey,
        mailbox,
        highestUid: Number(cursor.highestUid || 0),
        uidNext: Number(cursor.uidNext || 0) || null,
        cursorSource: cursor.cursorSource || null,
        uidValidity: Number(cursor.uidValidity || 0) || null,
      });

      const lastUid = Number(state.last_uid || 0);
      const previousUidValidity = Number(state.uid_validity || 0) || null;
      const uidValidityChanged = Boolean(previousUidValidity && cursor.uidValidity && previousUidValidity !== cursor.uidValidity);
      const mailboxReset = lastUid > Number(cursor.highestUid || 0);

      if ((!lastUid && !this.context.config.emailHistoricalBackfillEnabled) || uidValidityChanged || mailboxReset) {
        stage = 'complete_baseline';
        await this.context.operationsRepository.completeEmailPollState({
          accountKey,
          mailbox,
          workerId: this.workerId,
          lastUid: cursor.highestUid,
          uidValidity: cursor.uidValidity,
          nextAttemptAt: new Date(Date.now() + this.context.config.emailPollMs).toISOString(),
        });
        const reason = uidValidityChanged ? 'uidvalidity_rebaseline' : mailboxReset ? 'mailbox_reset_rebaseline' : 'historical_baseline_established';
        log.info('commsHub.emailPoll.baseline', {
          workerId: this.workerId,
          accountKey,
          mailbox,
          reason,
          highestUid: cursor.highestUid,
          uidValidity: cursor.uidValidity,
        });
        return { skipped: true, reason, highestUid: cursor.highestUid };
      }

      stage = 'fetch_messages';
      const batchLimit = Math.min(Math.max(Number(limit || this.context.config.emailPollBatchSize) || 1, 1), 100);
      log.info('commsHub.emailPoll.fetch.start', {
        workerId: this.workerId,
        accountKey,
        mailbox,
        afterUid: lastUid,
        limit: batchLimit,
        mode: 'bounded_one_message_at_a_time',
      });

      // Keep IMAP/message memory bounded. A full RFC822 message can contain large
      // base64 attachments; retaining 25 raw messages plus parsed buffers can
      // exhaust a small Koyeb instance and starve the HTTP health endpoint.
      // Fetch and persist exactly one message at a time, then release its raw
      // buffer before moving to the next UID.
      const results = [];
      let workingUid = lastUid;
      let observedUidValidity = cursor.uidValidity;
      for (let index = 0; index < batchLimit; index += 1) {
        stage = 'fetch_message';
        const fetched = await this.context.oneComMail.fetchMessages({
          mailbox,
          afterUid: workingUid,
          limit: 1,
        });
        observedUidValidity = fetched.uidValidity || observedUidValidity;
        if (!fetched.messages.length) break;

        const message = fetched.messages[0];
        log.info('commsHub.emailPoll.messageFetched', {
          workerId: this.workerId,
          accountKey,
          mailbox,
          uid: message.uid,
          index: index + 1,
          limit: batchLimit,
        });

        stage = 'persist_message';
        const persisted = await this.context.emailService.persistFetched({
          uid: message.uid,
          parsed: message.parsed,
          mailbox,
        });
        results.push(persisted);
        workingUid = Number(message.uid || fetched.highestUid || workingUid);

        log.info('commsHub.emailPoll.messagePersisted', {
          workerId: this.workerId,
          accountKey,
          mailbox,
          uid: workingUid,
          processed: results.length,
          attachmentCount: persisted.attachments?.length || 0,
        });
      }

      log.info('commsHub.emailPoll.fetch.complete', {
        workerId: this.workerId,
        accountKey,
        mailbox,
        afterUid: lastUid,
        fetched: results.length,
        highestUid: workingUid,
        uidValidity: Number(observedUidValidity || 0) || null,
      });

      stage = 'complete_state';
      await this.context.operationsRepository.completeEmailPollState({
        accountKey,
        mailbox,
        workerId: this.workerId,
        lastUid: workingUid,
        uidValidity: observedUidValidity,
        // Drain another batch almost immediately when the configured batch was
        // filled; otherwise return to the normal poll cadence.
        nextAttemptAt: new Date(Date.now() + (results.length >= batchLimit ? 1_000 : this.context.config.emailPollMs)).toISOString(),
      });

      const attachmentCount = results.reduce((total, item) => total + (item.attachments?.length || 0), 0);
      log.info('commsHub.emailPoll.complete', {
        workerId: this.workerId,
        accountKey,
        mailbox,
        managedAddress: this.context.config.oneComEmailAddress,
        processed: results.length,
        attachmentCount,
        previousUid: lastUid,
        highestUid: workingUid,
      });
      if (results.length) {
        log.info('commsHub.emailPoll.processed', {
          workerId: this.workerId,
          accountKey,
          mailbox,
          managedAddress: this.context.config.oneComEmailAddress,
          processed: results.length,
          attachmentCount,
        });
      }
      return { processed: results.length, highestUid: workingUid, results };
    } catch (error) {
      const failure = safeErrorLog(error);
      const failedStage = providerStage(error, stage);
      log.error('commsHub.emailPoll.failed', {
        workerId: this.workerId,
        accountKey,
        mailbox,
        stage: failedStage,
        attempts: Number(state?.attempts || 0),
        error: failure,
        cause: safeCause(error),
      });
      if (state) {
        await this.context.operationsRepository.failEmailPollState({
          accountKey,
          mailbox,
          workerId: this.workerId,
          failureClass: error.failureClass || 'temporary',
          error: failure.message,
          nextAttemptAt: new Date(Date.now() + delay(Number(state.attempts || 1))).toISOString(),
        }).catch(() => null);
      }
      await this.context.quarantineService.quarantine({
        sourceType: 'email_poll',
        sourceId: `${accountKey}:${mailbox}`,
        failureClass: error.failureClass || 'temporary',
        errorCode: error.code || 'email_poll_failed',
        errorMessage: failure.message,
        attempts: Number(state?.attempts || 1),
        metadata: { accountKey, mailbox, stage: failedStage },
      }).catch(() => null);
      throw error;
    } finally {
      this.running = false;
    }
  }
}

export default CommsHubEmailPollWorker;
