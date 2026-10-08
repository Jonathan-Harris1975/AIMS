#!/usr/bin/env node
// Run inside the verified AIMS deployment. Never print provider payloads,
// URLs, recipient details, credentials or confirmation tokens.
import '../config/loadEnv.js';
import { loadCommsHubConfig } from '../services/comms-hub/config.js';
import { D1Client } from '../services/comms-hub/clients/d1Client.js';
import { JotformClient } from '../services/comms-hub/clients/jotformClient.js';
import { OneComMailClient } from '../services/comms-hub/clients/oneComMailClient.js';
import { normaliseJotformAnswers, extractJotformContact } from '../services/comms-hub/domain/submission.js';
import { processNewsletterJotformSignup, NEWSLETTER_JOTFORM_FORM_ID } from '../services/newsletter/jotformIntake.js';
import { reconcileNewsletterWebhook, replayNewsletterTest, newsletterRepairScope } from '../services/newsletter/jotformReconcile.js';

try {
  const { replayOnly, email, date } = newsletterRepairScope(process.argv.slice(2));
  const config = loadCommsHubConfig(process.env, { requireEnabled: true });
  const formId = NEWSLETTER_JOTFORM_FORM_ID;
  const report = {};
  if (!replayOnly) report.registration = await reconcileNewsletterWebhook({ baseUrl: config.publicBaseUrl, formId,
    apiBaseUrl: config.jotformApiBaseUrl, apiKey: config.jotformApiKey });
  if (email && date) {
    const query = new URLSearchParams({ limit: '100', filter: JSON.stringify({ 'created_at:gt': `${date} 00:00:00`, 'created_at:lt': `${date} 23:59:59` }) });
    const response = await fetch(`${config.jotformApiBaseUrl}/form/${formId}/submissions?${query}`, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json', APIKEY: config.jotformApiKey },
    });
    const payload = await response.json();
    if (!response.ok || Number(payload.responseCode) !== 200 || !Array.isArray(payload.content)) throw Object.assign(new Error(), { code: 'newsletter_test_lookup_failed' });
    const submissions = payload.content.slice(0, 100).map(row => ({ id: row.id, created_at: row.created_at,
      email: extractJotformContact(normaliseJotformAnswers(row)).email }));
    const account = config.manualEmailAccounts.newsletter;
    if (!account?.enabled) throw Object.assign(new Error(), { code: 'newsletter_sender_not_configured' });
    const mail = new OneComMailClient({ ...config, oneComEmailAccountKey: account.key, oneComEmailAddress: account.address,
      oneComEmailUsername: account.username, oneComEmailPassword: account.password, oneComMailbox: account.mailbox });
    report.testRecovery = await replayNewsletterTest({ email, date, submissions, formId,
      context: { d1: new D1Client(config), jotform: new JotformClient(config), manualMailAccounts: { newsletter: mail } },
      processSignup: processNewsletterJotformSignup });
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} catch (error) {
  const code = /^[a-zA-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'newsletter_intake_repair_failed';
  const diagnostic = error?.diagnostic || {};
  process.stdout.write(`${JSON.stringify({ ok: false, code,
    ...(['GET', 'POST'].includes(diagnostic.operation) ? { operation: diagnostic.operation,
      httpStatus: Number.isInteger(diagnostic.httpStatus) ? diagnostic.httpStatus : null,
      providerStatus: Number.isInteger(diagnostic.providerStatus) ? diagnostic.providerStatus : null } : {}) })}\n`);
  process.exitCode = 1;
}
