import { createHmac, timingSafeEqual, createHash } from "node:crypto";
import { putPrivateJson } from "../../shared/utils/r2-client.js";

const MAX_EVENT_AGE_MS = 5 * 60_000;
const patterns = [
  ["opt_out", /\b(?:unsubscribe|remove me|do not contact|don't contact|stop emailing|opt out)\b/i],
  ["bounce", /\b(?:delivery failed|undeliverable|mailbox unavailable|recipient rejected)\b/i],
  ["out_of_office", /\b(?:out of office|automatic reply|annual leave|vacation)\b/i],
  ["paid_placement", /\b(?:paid placement|sponsored|publishing fee|placement fee|pay to publish)\b/i],
  ["decline", /\b(?:not interested|no thanks|decline|not a fit|do not accept)\b/i],
  ["publication", /\b(?:published|now live|article is live|feature is live)\b/i],
  ["revision", /\b(?:revision|please change|needs changes|amend|rewrite)\b/i],
  ["positive", /\b(?:interested|sounds good|go ahead|happy to|please send|we would like)\b/i],
  ["question", /\?\s*$/],
];

export function classifyBookFeatureInbound(text) {
  const value = String(text || "").slice(0, 100_000);
  if (!value.trim()) return "malformed";
  const matched = patterns.filter(([, expression]) => expression.test(value)).map(([category]) => category);
  // An explicit opt-out overrides engagement or other ambiguous language.
  if (matched.includes("opt_out")) return "opt_out";
  if (matched.includes("decline")) return "decline";
  if (matched.includes("bounce")) return "bounce";
  if (!matched.length || matched.length > 1) return "uncertain";
  return matched[0];
}

export function verifyInboundSignature(rawBody, { signature, timestamp, secret, now = new Date() }) {
  const observed = Date.parse(timestamp || "");
  if (!secret || !Number.isFinite(observed) || Math.abs(now.getTime() - observed) > MAX_EVENT_AGE_MS) return false;
  const supplied = String(signature || "").replace(/^sha256=/, "");
  if (!/^[a-f0-9]{64}$/i.test(supplied)) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export async function handleBookFeatureInbound({ rawBody, signature, timestamp, secret, providerEventId,
  providerMessageId = null, text = "", occurredAt = null }, {
  repository, persist = putPrivateJson, now = () => new Date(),
} = {}) {
  if (!repository || !verifyInboundSignature(rawBody, { signature, timestamp, secret, now: now() })) {
    throw Object.assign(new Error("Inbound event authentication failed."), { code: "BOOK_FEATURE_INBOUND_AUTH_FAILED" });
  }
  const event = JSON.parse(rawBody);
  if (event.providerEventId !== providerEventId || event.text !== text ||
      (event.providerMessageId || null) !== providerMessageId || (event.occurredAt || null) !== occurredAt) {
    throw Object.assign(new Error("Signed inbound payload does not match supplied event."), { code: "BOOK_FEATURE_INBOUND_AUTH_FAILED" });
  }
  const match = providerMessageId ? await repository.findOpportunityByProviderMessage(providerMessageId) : null;
  const category = classifyBookFeatureInbound(text);
  const hash = createHash("sha256").update(rawBody).digest("hex");
  const bodyEvidenceKey = `outreach/book-feature/inbound/${hash}.json`;
  await persist("kdp", bodyEvidenceKey, { providerEventId, providerMessageId, text, occurredAt, receivedAt: now().toISOString() });
  return repository.processInboundEvent({ providerEventId, providerMessageId, opportunityId: match?.opportunity_id || null,
    contactId: match?.contact_id || null, category, authenticated: true, bodyEvidenceKey, occurredAt });
}

export async function handleBookFeatureMailboxInbound({ providerMessageId, eventId, sender, text, occurredAt }, { repository } = {}) {
  const match = providerMessageId ? await repository.findOpportunityByProviderMessage(providerMessageId) : null;
  if (!match || !eventId || !match.delivery_recipient ||
      String(sender || "").trim().toLowerCase() !== match.delivery_recipient.toLowerCase()) return { matched: false };
  const category = classifyBookFeatureInbound(text);
  if (category !== "malformed" && category !== "bounce" && ["accepted","unknown"].includes(match.status)) {
    await repository.reconcileOutbox({ outboxId: match.id, outcome: "delivered", providerEventId: `mailbox-reply:${eventId}`,
      providerMessageId, actor: "authenticated_mailbox", authenticatedProvider: true, evidence: { matchingReply: true } });
  }
  return repository.processInboundEvent({ providerEventId: eventId, providerMessageId,
    opportunityId: match.opportunity_id, contactId: match.contact_id, category, authenticated: true, occurredAt });
}

export const bookFeatureInboundPolicy = Object.freeze({ maximumEventAgeMs: MAX_EVENT_AGE_MS });
