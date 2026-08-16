import { sha256Hex, stableId } from './domain/ids.js';
import { businessHoursPolicy, isWithinBusinessHours, nextBusinessOpening } from './domain/businessHours.js';

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/i;
const HUMAN_RE = /\b(?:talk|speak|chat|connect)\s+(?:to|with)\s+(?:jonathan|a\s+human|a\s+person)|\bhuman\s+(?:help|support|assistance)|\bcontact\s+jonathan\b/i;
const CALLBACK_RE = /\b(?:email\s+(?:me|is)|reach\s+me|contact\s+me|get\s+back\s+to\s+me|my\s+email|you\s+can\s+email)\b/i;

export function extractCallbackEmail(value) {
  const match = String(value || '').match(EMAIL_RE);
  return match ? match[0].toLowerCase() : '';
}

export function humanContactRequested(value) {
  return HUMAN_RE.test(String(value || ''));
}

export function callbackEmailConsent(value, { allowBareEmail = false } = {}) {
  const input = String(value || '');
  return Boolean(extractCallbackEmail(input) && (allowBareEmail || CALLBACK_RE.test(input) || humanContactRequested(input)));
}

export function humanHandoffStatus(config = {}, at = new Date()) {
  const policy = businessHoursPolicy(config);
  const available = isWithinBusinessHours(at, policy);
  return Object.freeze({
    available,
    timeZone: policy.timeZone,
    startHour: policy.startHour,
    endHour: policy.endHour,
    nextAvailableAt: available ? at.toISOString() : nextBusinessOpening(at, policy).toISOString(),
  });
}

export function humanContactOffer({ available }) {
  return available
    ? 'Jonathan is available for hand-off now. I can flag this conversation for him. If you would rather he gets back to you later, you can leave an email address here.'
    : "Jonathan isn't available for live hand-off right now. If you'd like him to get back to you in due course, you can leave an email address here and I'll attach it to this conversation.";
}

export async function recordCallbackEmail({ context, conversationId, contactId, channel, provider, bodyText, allowBareEmail = false, at = new Date().toISOString() }) {
  if (context?.config?.callbackEmailCaptureEnabled === false) return null;
  if (!callbackEmailConsent(bodyText, { allowBareEmail })) return null;
  const email = extractCallbackEmail(bodyText);
  if (!email || !contactId) return null;
  const alias = await context.operationsRepository.addContactAlias({
    id: stableId('als', 'callback', conversationId, email),
    contactId,
    type: 'callback_email',
    value: email,
    provider: `${provider || channel || 'comms'}:${conversationId}`, 
    confidence: 0.9,
    verified: false,
    createdAt: at,
    metadata: {
      consentPurpose: 'human_callback',
      consentSource: channel,
      sourceConversationId: conversationId,
      ownershipVerified: false,
    },
  });
  const fingerprint = sha256Hex(email).slice(0, 16);
  await context.auditService?.record?.({
    actor: 'system', role: 'operator', action: 'callback_email_captured', objectType: 'contact', objectId: contactId,
    conversationId, details: { channel, provider: provider || null, emailFingerprint: fingerprint, ownershipVerified: false },
  }).catch(() => null);
  await context.notificationService?.create?.({
    actor: 'admin', conversationId, type: 'human_callback', title: 'Callback email supplied',
    bodyText: 'A visitor supplied an email address and explicitly asked for Jonathan to get back to them. Review the contact aliases on this conversation.',
    severity: 'info', idempotencySeed: `callback-email:${conversationId}:${fingerprint}`,
    metadata: { contactId, emailFingerprint: fingerprint, ownershipVerified: false },
  }).catch(() => null);
  return alias;
}
