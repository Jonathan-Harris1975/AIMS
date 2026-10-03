import { createHash } from 'node:crypto';
import { beginSubscription } from './audience/d1Audience.js';
import { CommsHubError } from '../comms-hub/errors.js';
import { recordNewsletterOutcome } from './telemetry.js';

export function trustedNewsletterBase(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new CommsHubError(503, 'newsletter_public_base_url_missing', 'A trusted newsletter base URL is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new CommsHubError(503, 'newsletter_public_base_url_invalid', 'Newsletter base URL must be an HTTPS origin.');
  }
  return url.origin;
}

export async function sendSubscriptionConfirmation(options) {
  try {
    const result = await deliverConfirmation(options);
    recordNewsletterOutcome(!result.ok ? 'suppressed' : result.duplicate || result.status === 'already_subscribed' ? 'duplicate' : 'accepted_pending');
    return result;
  } catch (error) {
    const code = String(error.code || '');
    recordNewsletterOutcome(code.includes('email_invalid') || code.includes('publication_invalid') ? 'validation_rejected'
      : code.includes('base_url') || code.includes('sender_not_configured') ? 'configuration_failure'
        : code.includes('reconciliation_required') || error.deliveryUncertain ? 'provider_unknown' : 'provider_failure');
    throw error;
  }
}

async function deliverConfirmation({ input, d1, mail, baseUrl, compose, now = () => new Date() }) {
  const base = trustedNewsletterBase(baseUrl);
  if (!mail?.sendMessage) throw new CommsHubError(503, 'newsletter_sender_not_configured', 'Newsletter sender is not configured.', { retryable: true, failureClass: 'temporary' });
  const email = String(input.email || '').trim().toLowerCase();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CommsHubError(400, 'newsletter_email_invalid', 'A valid email address is required.');
  if ((input.publicationId || 'ai-edge') !== 'ai-edge') throw new CommsHubError(400, 'newsletter_publication_invalid', 'Unknown newsletter publication.');
  const subscriber = (await d1.query(`SELECT ns.status, ns.verified_at, s.status AS subscription_status, sup.email_hash AS suppressed
    FROM newsletter_subscribers ns LEFT JOIN newsletter_subscriptions s ON s.subscriber_id=ns.id AND s.publication_id='ai-edge'
    LEFT JOIN newsletter_suppressions sup ON sup.email_hash=ns.email_hash WHERE ns.email=?`, [email])).results?.[0];
  if (subscriber?.suppressed || subscriber?.status === 'erased') return { ok: false, status: 'suppressed' };
  if (subscriber?.status === 'active' && subscriber?.subscription_status === 'active' && subscriber?.verified_at) {
    return { ok: true, duplicate: true, status: 'already_subscribed' };
  }
  // Stable per email/publication: concurrent browser and webhook retries cannot
  // both send. Only hashes are retained here; no token or address is logged.
  const requestKey = createHash('sha256').update(`ai-edge:${email}`).digest('hex');
  const at = now().toISOString();
  const claimed = await d1.query(`INSERT INTO newsletter_confirmation_deliveries
    (request_key,status,attempts,created_at,updated_at) VALUES(?,'sending',1,?,?)
    ON CONFLICT(request_key) DO UPDATE SET status='sending', attempts=attempts+1, retryable=0, error_code=NULL, updated_at=excluded.updated_at
    WHERE (status='failed' AND retryable=1 AND attempts<6) OR (status='sent' AND expires_at<=excluded.updated_at)
    RETURNING request_key`, [requestKey, at, at]);
  if (!claimed.results?.length) {
    const prior = (await d1.query('SELECT status,expires_at FROM newsletter_confirmation_deliveries WHERE request_key=?', [requestKey])).results?.[0];
    if (prior?.status === 'sent') return { ok: true, duplicate: true, status: 'confirmation_already_sent', expiresAt: prior.expires_at };
    throw new CommsHubError(409, 'newsletter_confirmation_reconciliation_required', 'Confirmation delivery is pending or requires reconciliation.', { retryable: false });
  }
  let sending = false;
  let accepted = false;
  try {
    const result = await beginSubscription({ ...input, email }, { d1 });
    if (!result.ok) {
      await d1.query("UPDATE newsletter_confirmation_deliveries SET status='failed',retryable=0,error_code=?,updated_at=? WHERE request_key=?", [result.status, at, requestKey]);
      return result;
    }
    if (result.status === 'already_subscribed') {
      await d1.query("UPDATE newsletter_confirmation_deliveries SET status='sent',expires_at=NULL,updated_at=? WHERE request_key=?", [at, requestKey]);
      return result;
    }
    const confirmationUrl = `${base}/newsletter/confirm/${encodeURIComponent(result.token)}`;
    sending = true;
    const receipt = await mail.sendMessage({ to: [email], ...compose({ confirmationUrl }),
      messageId: `<newsletter-confirm-${requestKey}@${new URL(base).hostname}>` });
    accepted = true;
    await d1.query("UPDATE newsletter_confirmation_deliveries SET status='sent',expires_at=?,provider_message_id=?,updated_at=? WHERE request_key=?",
      [result.expiresAt, receipt?.messageId || null, now().toISOString(), requestKey]);
    return { ok: true, duplicate: false, status: 'confirmation_sent', expiresAt: result.expiresAt };
  } catch (error) {
    const uncertain = accepted || (sending && (error.deliveryUncertain === true || error.deliveryUncertain === undefined));
    await d1.query("UPDATE newsletter_confirmation_deliveries SET status=?,retryable=?,error_code=?,updated_at=? WHERE request_key=?",
      [uncertain ? 'reconciliation_required' : 'failed', !uncertain && (!sending || error.retryable === true) ? 1 : 0,
      uncertain ? 'provider_outcome_unknown' : 'confirmation_failed', now().toISOString(), requestKey]).catch(() => null);
    if (uncertain) error.deliveryUncertain = true;
    throw error;
  }
}
