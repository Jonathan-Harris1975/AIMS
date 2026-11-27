import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BookFeatureDispatchWorker } from "../services/outreach/bookFeature/dispatchWorker.js";
import { classifyBookFeatureInbound, handleBookFeatureInbound, verifyInboundSignature } from "../services/outreach/bookFeature/inboundLifecycle.js";

function lease() { return { id: "outbox-1", lease_owner: "worker", lease_expires_at: "2026-11-27T08:02:00.000Z", attempt_count: 1, max_attempts: 3 }; }
function dispatchContext() { return { id: "outbox-1", opportunity_id: "opp", email: "test@example.com",
  official_domain: "example.com", canonical_name: "Example", validation_result: "valid",
  validation_expires_at: "2026-12-01T00:00:00.000Z", eligibility_status: "eligible",
  body_key: "private/pitch.json", subject: "A useful feature", idempotency_key: "key-1" }; }

test("dispatch rechecks effective mode and allowlist immediately before provider handoff", async () => {
  const outcomes = [];
  let modeCalls = 0;
  let sends = 0;
  const repository = { claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
    mode: async () => (++modeCalls === 1
      ? { effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }
      : { effective: "suspended", killSwitch: true, testRecipients: ["test@example.com"] }),
    finishOutboxLease: async (_lease, outcome) => outcomes.push(outcome), recordDeliveryEvent: async () => {} };
  const context = { d1: {}, emailService: { send: async () => { sends++; } } };
  const worker = new BookFeatureDispatchWorker({ repository, context,
    readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async () => null, createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  const result = await worker.runOnce();
  assert.equal(result.status, "cancelled");
  assert.equal(sends, 0);
  assert.equal(outcomes[0].errorCode, "final_handoff_gate_failed");
});

test("provider acceptance remains accepted pending delivery reconciliation and uncertain outcomes are never blindly retried", async () => {
  const accepted = [];
  const repository = { claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
    mode: async () => ({ effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }),
    finishOutboxLease: async (_lease, outcome) => accepted.push(outcome), recordDeliveryEvent: async () => {} };
  const context = { d1: {}, emailService: { send: async () => ({ providerMessageId: "provider-1" }) } };
  const worker = new BookFeatureDispatchWorker({ repository, context,
    readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async () => null, createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  assert.equal((await worker.runOnce()).status, "accepted");
  assert.equal(accepted[0].status, "accepted");
  assert.equal(accepted[0].deliveredAt, undefined);

  accepted.length = 0;
  context.emailService.send = async () => { throw Object.assign(new Error("timeout after DATA"), { deliveryUncertain: true, code: "smtp_timeout" }); };
  assert.equal((await worker.runOnce()).status, "unknown");
  assert.equal(accepted[0].status, "unknown");
  assert.equal(accepted[0].nextAttemptAt, undefined);
});

test("inbound signatures reject replay windows and ambiguous content does not auto-reply", async () => {
  const secret = "test-secret";
  const timestamp = "2026-11-27T08:00:00.000Z";
  const rawBody = JSON.stringify({ providerEventId: "event-1", text: "Can you explain the proposal?" });
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  assert.equal(verifyInboundSignature(rawBody, { signature, timestamp, secret,
    now: new Date("2026-11-27T08:04:59.000Z") }), true);
  assert.equal(verifyInboundSignature(rawBody, { signature, timestamp, secret,
    now: new Date("2026-11-27T08:05:01.000Z") }), false);
  assert.equal(classifyBookFeatureInbound("Interested, but do not contact me again"), "uncertain");
  const calls = [];
  const repository = { findOpportunityByProviderMessage: async () => ({ opportunity_id: "opp", contact_id: "contact" }),
    processInboundEvent: async (event) => { calls.push(event); return { duplicate: false, action: "operator_review" }; } };
  const result = await handleBookFeatureInbound({ rawBody, signature, timestamp, secret, providerEventId: "event-1",
    providerMessageId: "provider-1", text: "Interested, but do not contact me again" }, { repository,
    now: () => new Date("2026-11-27T08:01:00.000Z"), persist: async () => {} });
  assert.equal(result.action, "operator_review");
  assert.equal(calls[0].category, "uncertain");
  assert.equal(calls[0].authenticated, true);
});

test("expired dispatch lease prevents provider handoff", async () => {
  const outcomes = [];
  let sends = 0;
  const repository = {
    claimOutbox: async () => ({ ...lease(), lease_expires_at: "2026-11-27T07:59:00.000Z" }),
    outboxDispatchContext: async () => dispatchContext(),
    mode: async () => ({ effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }),
    finishOutboxLease: async (_lease, outcome) => outcomes.push(outcome),
  };
  const worker = new BookFeatureDispatchWorker({ repository,
    context: { d1: {}, emailService: { send: async () => { sends++; } } },
    readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async () => null, createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  assert.equal((await worker.runOnce()).status, "cancelled");
  assert.equal(sends, 0);
  assert.equal(outcomes[0].errorCode, "handoff_expired");
});
