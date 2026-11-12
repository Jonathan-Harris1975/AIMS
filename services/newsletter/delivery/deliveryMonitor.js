import { randomUUID } from 'node:crypto';
import { normaliseMessageId } from '../../comms-hub/domain/deliveryReport.js';

const REPORT_STATES = { failed: 'failure_reported', delayed: 'delay_reported', delivered: 'delivery_reported' };

export class NewsletterDeliveryMonitor {
  constructor({ context, clock = () => new Date() }) { this.context = context; this.clock = clock; }

  async notify(type, issueId, bodyText, severity = 'warning') {
    return this.context.notificationService.create({
      actor: 'admin', type: severity === 'critical' ? 'failure' : 'system', title: 'AI Edge delivery evidence', bodyText, severity,
      // Keep incidents visible in Comms Hub even when the email transport is faulty.
      emailRequested: false, metadata: { issueId, event: `newsletter_${type}`, inboxConfirmed: false }, idempotencySeed: `${issueId}:${type}`,
    });
  }

  async recordReport(message, now) {
    const report = message.deliveryReport;
    if (!report) return { matched: 0, unmatched: message.deliveryReportCandidate ? 1 : 0 };
    const { d1 } = this.context;
    await d1.query(`INSERT INTO newsletter_delivery_report_inbox(report_id,report_json,observed_at,last_attempt_at)
      VALUES(?,?,?,?) ON CONFLICT(report_id) DO NOTHING`,
    [message.messageId, JSON.stringify(report), now.toISOString(), now.toISOString()]);
    let matched = 0;
    let unmatched = 0;
    for (const recipient of report.recipients.slice(0, 100)) {
      const messageId = normaliseMessageId(report.originalMessageId);
      // Both identifiers must match. A subject, sender name or quoted prose cannot match a receipt.
      const found = await d1.query(`SELECT d.issue_id,d.subscriber_id FROM newsletter_delivery_recipients d
        JOIN newsletter_subscribers s ON s.id=d.subscriber_id
        WHERE d.provider_message_id IN (?,?) AND s.email=? COLLATE NOCASE AND d.status='sent'`,
      [messageId, `<${messageId}>`, recipient.recipient]);
      if (found.results?.length !== 1) { unmatched += 1; continue; }
      const row = found.results[0];
      const state = REPORT_STATES[recipient.action];
      await d1.query(`INSERT INTO newsletter_delivery_reports
        (report_id,issue_id,subscriber_id,action,enhanced_status,diagnostic,reporting_mta,remote_mta,observed_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(report_id,issue_id,subscriber_id) DO NOTHING`,
      [message.messageId, row.issue_id, row.subscriber_id, recipient.action, recipient.status,
        recipient.diagnostic, report.reportingMta, recipient.remoteMta, now.toISOString()]);
      if (state) {
        // Never regress terminal reported evidence to a later delay or a relay notice.
        await d1.query(`UPDATE newsletter_delivery_recipients SET transport_status=?,transport_updated_at=?
          WHERE issue_id=? AND subscriber_id=? AND (transport_status IN ('unknown','smtp_accepted','delay_reported')
            OR (?='failure_reported' AND transport_status='delivery_reported'))`,
        [state, now.toISOString(), row.issue_id, row.subscriber_id, state]);
      }
      if (recipient.action === 'failed' || recipient.action === 'delayed') {
        const authenticationFailure = recipient.action === 'failed'
          && /\b5\.7\.26\b|sender is unauthenticated/i.test(`${recipient.status} ${recipient.diagnostic}`);
        const type = authenticationFailure ? 'authentication_failed' : `${recipient.action}_${recipient.status}`;
        const description = authenticationFailure
          ? 'A matched report identifies sender authentication failure (5.7.26). Check the sending domain SPF and one.com DKIM records. No automatic resend was made.'
          : `A matched delivery report says ${recipient.action} (${recipient.status}). Check the stored report and one.com trace. No automatic resend was made.`;
        await this.notify(type, row.issue_id, description, recipient.action === 'failed' ? 'critical' : 'warning');
      }
      matched += 1;
    }
    await d1.query(`UPDATE newsletter_delivery_report_inbox SET last_attempt_at=?,matched_at=? WHERE report_id=?`,
      [now.toISOString(), unmatched ? null : now.toISOString(), message.messageId]);
    return { matched, unmatched };
  }

  async reconcilePending(now) {
    const since = new Date(now.getTime() - 7 * 86400000).toISOString();
    const { d1 } = this.context;
    const pending = await d1.query(`SELECT report_id,report_json FROM newsletter_delivery_report_inbox
      WHERE matched_at IS NULL AND observed_at>=? AND last_attempt_at<? ORDER BY last_attempt_at LIMIT 25`, [since, now.toISOString()]);
    let matched = 0;
    for (const row of pending.results || []) {
      const result = await this.recordReport({ messageId: row.report_id, deliveryReport: JSON.parse(row.report_json) }, now);
      matched += result.matched;
    }
    // This is a bounded correlation inbox, not a second mail archive.
    await d1.query("DELETE FROM newsletter_delivery_report_inbox WHERE observed_at<?", [since]);
    return matched;
  }

  async alertUnconfirmed(now) {
    const cutoff = new Date(now.getTime() - this.context.config.newsletterDeliveryUnconfirmedMs).toISOString();
    const since = new Date(now.getTime() - 7 * 86400000).toISOString();
    const rows = await this.context.d1.query(`SELECT issue_id,COUNT(*) AS count FROM newsletter_delivery_recipients
      WHERE status='sent' AND attempted_at>=? AND attempted_at<=? AND transport_status IN ('unknown','smtp_accepted')
      GROUP BY issue_id LIMIT 100`, [since, cutoff]);
    for (const row of rows.results || []) {
      await this.notify('unconfirmed', row.issue_id,
        'This issue has SMTP submissions without a matched delivery report after the monitoring interval. Receipt remains unconfirmed; absence of a report is not proof of failure.');
    }
    return rows.results?.length || 0;
  }

  async run({ now = this.clock() } = {}) {
    const { config, d1, manualMailAccounts } = this.context;
    const mail = manualMailAccounts?.newsletter;
    if (!mail) throw Object.assign(new Error('Newsletter delivery monitor mailbox is not configured.'), { code: 'newsletter_monitor_unconfigured' });
    const mailbox = config.manualEmailAccounts.newsletter.mailbox;
    const owner = randomUUID();
    await d1.query(`INSERT INTO newsletter_delivery_monitor_state(mailbox) VALUES(?) ON CONFLICT(mailbox) DO NOTHING`, [mailbox]);
    const lease = await d1.query(`UPDATE newsletter_delivery_monitor_state SET lease_owner=?,lease_expires_at=?
      WHERE mailbox=? AND (lease_expires_at IS NULL OR lease_expires_at<=?) RETURNING *`,
    [owner, new Date(now.getTime() + 900000).toISOString(), mailbox, now.toISOString()]);
    if (!lease.results?.length) return { skipped: true, reason: 'mailbox_leased' };
    try {
      const prior = lease.results[0];
      const cursor = await mail.getMailboxCursor({ mailbox });
      if (!cursor.uidValidity) throw Object.assign(new Error('Newsletter mailbox UIDVALIDITY is missing.'), { code: 'newsletter_monitor_invalid_cursor' });
      const reset = Number(prior.uid_validity) !== cursor.uidValidity;
      // Inspect the most recent 100 UIDs on first activation or mailbox replacement.
      const afterUid = reset ? Math.max(0, cursor.highestUid - 100) : Number(prior.last_uid);
      const batch = await mail.fetchMessages({ mailbox, afterUid, limit: 25 });
      if (batch.uidValidity !== cursor.uidValidity) throw Object.assign(new Error('Newsletter mailbox changed during polling.'), { code: 'newsletter_monitor_cursor_changed' });
      let matched = 0;
      let unmatched = 0;
      let high = afterUid;
      for (const entry of batch.messages) {
        const result = await this.recordReport(entry.parsed, now);
        matched += result.matched;
        unmatched += result.unmatched;
        high = Math.max(high, entry.uid);
      }
      const reconciled = await this.reconcilePending(now);
      const unconfirmedIssues = await this.alertUnconfirmed(now);
      if (unmatched) await this.notify('unmatched_report', now.toISOString().slice(0, 10),
        'A delivery report could not be matched to exactly one newsletter recipient. Inspect the Newsletter mailbox; no receipt was changed.');
      // Persist only after report handling and notifications succeed. Replays are idempotent.
      const saved = await d1.query(`UPDATE newsletter_delivery_monitor_state
        SET uid_validity=?,last_uid=?,last_success_at=? WHERE mailbox=? AND lease_owner=? AND lease_expires_at>?
        RETURNING mailbox`, [cursor.uidValidity, high, now.toISOString(), mailbox, owner, this.clock().toISOString()]);
      if (!saved.results?.length) throw Object.assign(new Error('Newsletter monitor lease expired.'), { code: 'newsletter_monitor_lease_lost' });
      return { skipped: false, processed: batch.messages.length, matched, unmatched, reconciled, unconfirmedIssues };
    } finally {
      await d1.query(`UPDATE newsletter_delivery_monitor_state SET lease_owner=NULL,lease_expires_at=NULL WHERE mailbox=? AND lease_owner=?`, [mailbox, owner]);
    }
  }
}
