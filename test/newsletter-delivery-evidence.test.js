import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { parseRawEmail } from '../services/comms-hub/domain/email.js';
import { deliveryStatusParameters } from '../services/comms-hub/domain/smtp.js';
import { parseDeliveryReport } from '../services/comms-hub/domain/deliveryReport.js';
import { NewsletterDeliveryMonitor } from '../services/newsletter/delivery/deliveryMonitor.js';
import { NewsletterDeliveryWorker } from '../services/comms-hub/workers/newsletterDeliveryWorker.js';
import { CommsHubNotificationService } from '../services/comms-hub/notificationService.js';
import { CommsOperationsRepository } from '../services/comms-hub/repositories/commsOperationsRepository.js';
import { COMMS_HUB_REQUIRED_MIGRATIONS } from '../services/comms-hub/migrations/manifest.js';
import { deliverTodaysIssueToSubscriber, getCampaignStatus, claimNewsletterRecipient } from '../services/newsletter/delivery/aimsDelivery.js';
import { loadCommsHubConfig } from '../services/comms-hub/config.js';
import { CommsHubWorkerHeartbeatService } from '../services/comms-hub/workerHeartbeatService.js';

const now = new Date('2026-11-12T13:00:00Z');
const originalId = 'newsletter-test@jonathan-harris.online';
function dsn({ action = 'failed', status = '5.7.1', id = originalId, recipient = 'monitor@example.com', reportId = 'report@one.com' } = {}) {
  return `From: Mail Delivery System <mailer-daemon@one.com>\r\nMessage-ID: <${reportId}>\r\n`
    + 'Content-Type: multipart/report; report-type=delivery-status; boundary="report"\r\n\r\n'
    + '--report\r\nContent-Type: text/plain\r\n\r\nHuman-readable text deliberately ignored.\r\n'
    + '--report\r\nContent-Type: message/delivery-status\r\n\r\nReporting-MTA: dns; one.com\r\n\r\n'
    + `Final-Recipient: rfc822; ${recipient}\r\nAction: ${action}\r\nStatus: ${status}\r\n`
    + 'Remote-MTA: dns; gmail-smtp-in.l.google.com\r\nDiagnostic-Code: smtp; 550 5.7.1 rejected\r\n'
    + `--report\r\nContent-Type: text/rfc822-headers\r\n\r\nMessage-ID: <${id}>\r\n\r\n--report--\r\n`;
}
function fixture() {
  const db = new DatabaseSync(':memory:');
  for (const name of COMMS_HUB_REQUIRED_MIGRATIONS) {
    db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}.sql`, import.meta.url), 'utf8'));
  }
  const d1 = { async query(sql, params = []) {
    const stmt = db.prepare(sql);
    return { results: stmt.columns().length ? stmt.all(...params) : (stmt.run(...params), []) };
  } };
  db.prepare(`INSERT INTO newsletter_subscribers(id,email,email_hash,status,created_at,updated_at)
    VALUES('reader','monitor@example.com','hash','active',?,?)`).run(now.toISOString(), now.toISOString());
  db.prepare(`INSERT INTO newsletter_delivery_recipients(issue_id,subscriber_id,status,attempted_at,provider_message_id,transport_status)
    VALUES('issue','reader','sent','2026-11-12T10:47:12Z',?,'smtp_accepted')`).run(`<${originalId}>`);
  const context = { d1, config: { newsletterDeliveryMonitorEnabled: true, newsletterDeliveryMonitorPollMs: 300000,
    newsletterDeliveryUnconfirmedMs: 3600000, manualEmailAccounts: { newsletter: { mailbox: 'INBOX' } } },
    manualMailAccounts: {}, operationsRepository: new CommsOperationsRepository(d1) };
  context.notificationService = new CommsHubNotificationService({ context });
  const monitor = new NewsletterDeliveryMonitor({ context, clock: () => now });
  context.newsletterDeliveryMonitor = monitor;
  return { db, d1, context, monitor, close: () => db.close(), row: () => db.prepare('SELECT * FROM newsletter_delivery_recipients').get() };
}

test('parses structured DSNs, folded/encoded parts and multiple recipients; ignores prose and malformed reports', () => {
  const raw = dsn();
  const report = parseRawEmail(raw).deliveryReport;
  assert.equal(report.originalMessageId, originalId);
  assert.equal(report.recipients[0].action, 'failed');
  assert.equal(report.recipients[0].remoteMta, 'dns; gmail-smtp-in.l.google.com');
  const encoded = raw.replace('Content-Type: text/rfc822-headers\r\n\r\nMessage-ID: <' + originalId + '>',
    'Content-Type: text/rfc822-headers\r\nContent-Transfer-Encoding: base64\r\n\r\n' + Buffer.from(`Message-ID: <${originalId}>`).toString('base64'));
  assert.equal(parseDeliveryReport(encoded).originalMessageId, originalId);
  const multi = raw.replace('--report\r\nContent-Type: text/rfc822-headers',
    '\r\nFinal-Recipient: rfc822; other@example.com\r\nAction: delayed\r\nStatus: 4.2.0\r\n--report\r\nContent-Type: text/rfc822-headers');
  assert.equal(parseDeliveryReport(multi).recipients.length, 2);
  assert.equal(parseDeliveryReport(raw.replace('report-type=delivery-status', 'report-type=other')), null);
  assert.equal(parseDeliveryReport(dsn({ status: '2.0.0' })), null);
  assert.equal(parseDeliveryReport('Content-Type: text/plain\r\n\r\n' + raw), null);
  assert.equal(parseDeliveryReport(dsn({ id: '' })), null);
});

test('requires exact Message-ID and recipient, preserves DSN evidence and deduplicates restart processing', async t => {
  const f = fixture(); t.after(f.close);
  assert.equal((await f.monitor.recordReport(parseRawEmail(dsn({ recipient: 'wrong@example.com' })), now)).matched, 0);
  assert.equal((await f.monitor.recordReport(parseRawEmail(dsn({ id: 'unrelated@example.com' })), now)).matched, 0);
  for (let i = 0; i < 2; i++) await f.monitor.recordReport(parseRawEmail(dsn()), now);
  assert.equal(f.row().transport_status, 'failure_reported');
  assert.equal(f.row().status, 'sent'); // Submission receipt remains a resend barrier.
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_delivery_reports').get().n, 1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM comms_hub_notifications').get().n, 1);
  assert.equal((await claimNewsletterRecipient({ d1: f.d1, sessionId: 'issue', subscriberId: 'reader' })).claimed, false);
  await f.monitor.recordReport(parseRawEmail(dsn({ action: 'delayed', status: '4.2.0', reportId: 'delay@one.com' })), now);
  assert.equal(f.row().transport_status, 'failure_reported');
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_suppressions').get().n, 0);
});

test('delivery reports, relay reports and missing reports never claim inbox receipt', async t => {
  const f = fixture(); t.after(f.close);
  for (let i = 0; i < 2; i++) await f.monitor.alertUnconfirmed(now);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM comms_hub_notifications').get().n, 1);
  await f.monitor.recordReport(parseRawEmail(dsn({ action: 'relayed', status: '2.0.0' })), now);
  assert.equal(f.row().transport_status, 'smtp_accepted');
  await f.monitor.recordReport(parseRawEmail(dsn({ action: 'delivered', status: '2.0.0', reportId: 'delivered@one.com' })), now);
  assert.equal(f.row().transport_status, 'delivery_reported');
  assert.equal(await f.monitor.alertUnconfirmed(now), 0);
  const result = await getCampaignStatus('aims-issue', { d1: f.d1 });
  assert.equal(result.inboxConfirmed, false);
  assert.equal(result.transportCounts.delivery_reported, 1);
});

test('dedicated mailbox monitor uses durable leases and cursors, survives failures and does not send replies', async t => {
  const f = fixture(); t.after(f.close);
  const requested = [];
  let fail = true;
  f.context.manualMailAccounts.newsletter = {
    getMailboxCursor: async () => ({ uidValidity: 42, highestUid: 110 }),
    fetchMessages: async args => { requested.push(args); if (fail) throw new Error('IMAP outage');
      return { uidValidity: 42, messages: args.afterUid < 11 ? [{ uid: 11, parsed: parseRawEmail(dsn()) }] : [] }; },
  };
  await assert.rejects(f.monitor.run(), /IMAP outage/);
  assert.equal(f.db.prepare('SELECT last_uid FROM newsletter_delivery_monitor_state').get().last_uid, 0);
  fail = false;
  assert.equal((await f.monitor.run()).matched, 1);
  assert.equal(requested.at(-1).afterUid, 10);
  const restarted = new NewsletterDeliveryMonitor({ context: f.context, clock: () => now });
  await restarted.run();
  assert.equal(requested.at(-1).afterUid, 11);
  f.db.prepare("UPDATE newsletter_delivery_monitor_state SET lease_owner='other',lease_expires_at='2026-11-12T14:00:00Z'").run();
  assert.equal((await restarted.run()).reason, 'mailbox_leased');
  assert.equal(f.row().transport_status, 'failure_reported');
});

test('SMTP acceptance saves the provider response and never resends an accepted issue', async t => {
  const f = fixture(); t.after(f.close);
  f.db.exec('DELETE FROM newsletter_delivery_recipients');
  let sends = 0;
  const deps = { d1: f.d1, mail: { sendMessage: async args => {
    sends++; assert.equal(args.requestDeliveryStatus, true);
    return { messageId: args.messageId, response: '250 2.0.0 queued as queue-123', dsnRequested: true };
  } }, findSession: async () => 'issue', loadIssue: async () => ({ metadata: {}, newsletter: { subject: 'AI Edge' }, emailHtml: '<p>Issue</p>' }) };
  assert.equal((await deliverTodaysIssueToSubscriber({ subscriberId: 'reader', email: 'monitor@example.com' }, deps)).status, 'sent');
  assert.equal(f.row().smtp_response, '250 2.0.0 queued as queue-123');
  assert.equal(f.row().transport_status, 'smtp_accepted');
  assert.equal(f.row().smtp_dsn_requested, 1);
  assert.ok(f.row().smtp_accepted_at);
  await deliverTodaysIssueToSubscriber({ subscriberId: 'reader', email: 'monitor@example.com' }, deps);
  assert.equal(sends, 1);
});

test('monitor worker failures raise a durable incident and propagate to health monitoring', async t => {
  const f = fixture(); t.after(f.close);
  const worker = new NewsletterDeliveryWorker({ context: f.context });
  await assert.rejects(worker.runOnce(), /not configured/);
  const notification = f.db.prepare('SELECT * FROM comms_hub_notifications').get();
  assert.equal(JSON.parse(notification.metadata_json).event, 'newsletter_monitor_unavailable');
  assert.equal(notification.email_requested, 0);
  const heartbeat = new CommsHubWorkerHeartbeatService({ context: f.context });
  assert.ok(heartbeat.criticalDescriptors().some(d => d.category === 'newsletter_delivery' && d.enabled));
  const config = loadCommsHubConfig({ ONECOM_NEWSLETTER_PASSWORD: 'test' });
  assert.equal(config.newsletterDeliveryMonitorEnabled, true);
  assert.deepEqual(Object.keys(config.emailAccounts), ['info']);
});

test('requests delivery reports only when DSN is advertised and explicitly requested', () => {
  const ehlo = { lines: ['250-host', '250-DSN', '250 AUTH PLAIN'] };
  assert.equal(deliveryStatusParameters(ehlo).requested, false);
  assert.deepEqual(deliveryStatusParameters(ehlo, true), {
    requested: true, mailFrom: ' RET=HDRS', rcptTo: ' NOTIFY=SUCCESS,FAILURE,DELAY',
  });
  for (const lines of [['250 DSNFAKE'], ['250-host', '250 AUTH PLAIN']]) {
    assert.deepEqual(deliveryStatusParameters({ lines }, true), { requested: false, mailFrom: '', rcptTo: '' });
  }
});

test('Gmail 550 5.7.26 rejection creates an explicit sender-authentication incident', async t => {
  const f = fixture(); t.after(f.close);
  const raw = dsn({ status: '5.7.26' }).replace('550 5.7.1 rejected',
    '550 5.7.26 Your email has been blocked because the sender is unauthenticated. DKIM = did not pass. SPF = did not pass.');
  await f.monitor.recordReport(parseRawEmail(raw), now);
  const notification = f.db.prepare('SELECT * FROM comms_hub_notifications').get();
  assert.equal(JSON.parse(notification.metadata_json).event, 'newsletter_authentication_failed');
  assert.match(notification.body_text, /SPF and one.com DKIM/);
  assert.equal(notification.severity, 'critical');
  assert.equal(f.row().transport_status, 'failure_reported');
});
