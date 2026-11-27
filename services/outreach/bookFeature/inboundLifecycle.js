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
  providerMessageId = null, contactId = null, text = "", occurredAt = null }, {
  repository, persist = putPrivateJson, now = () => new Date(),
} = {}) {
  if (!repository || !verifyInboundSignature(rawBody, { signature, timestamp, secret, now: now() })) {
    throw Object.assign(new Error("Inbound event authentication failed."), { code: "BOOK_FEATURE_INBOUND_AUTH_FAILED" });
  }
  const match = providerMessageId ? await repository.findOpportunityByProviderMessage(providerMessageId) : null;
  const category = classifyBookFeatureInbound(text);
  const hash = createHash("sha256").update(rawBody).digest("hex");
  const bodyEvidenceKey = `outreach/book-feature/inbound/${hash}.json`;
  await persist("kdp", bodyEvidenceKey, { providerEventId, providerMessageId, text, occurredAt, receivedAt: now().toISOString() });
  return repository.processInboundEvent({ providerEventId, providerMessageId, opportunityId: match?.opportunity_id || null,
    contactId: contactId || match?.contact_id || null, category, authenticated: true, bodyEvidenceKey, occurredAt });
}

export const bookFeatureInboundPolicy = Object.freeze({ maximumEventAgeMs: MAX_EVENT_AGE_MS });
