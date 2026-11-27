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
  const repository = { admitHandoff: async () => true, claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
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
  const repository = { admitHandoff: async () => true, claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
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
  const rawBody = JSON.stringify({ providerEventId: "event-1", text: "Can you explain the proposal? Interested?" });
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  assert.equal(verifyInboundSignature(rawBody, { signature, timestamp, secret,
    now: new Date("2026-11-27T08:04:59.000Z") }), true);
  assert.equal(verifyInboundSignature(rawBody, { signature, timestamp, secret,
    now: new Date("2026-11-27T08:05:01.000Z") }), false);
  assert.equal(classifyBookFeatureInbound("Interested, but do not contact me again"), "opt_out");
  assert.equal(classifyBookFeatureInbound("Interested, could you explain?"), "uncertain");
  const calls = [];
  const repository = { findOpportunityByProviderMessage: async () => ({ opportunity_id: "opp", contact_id: "contact" }),
    processInboundEvent: async (event) => { calls.push(event); return { duplicate: false, action: "operator_review" }; } };
  const result = await handleBookFeatureInbound({ rawBody, signature, timestamp, secret, providerEventId: "event-1",
    providerMessageId: "provider-1", text: "Can you explain the proposal? Interested?" }, { repository,
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

test("explicit opt-outs take precedence over apparent engagement", async () => {
  const secret = "test-secret";
  const timestamp = "2026-11-27T08:00:00.000Z";
  const text = "Interested, but do not contact me again";
  const rawBody = JSON.stringify({ providerEventId: "event-opt-out", text });
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  const calls = [];
  const repository = { findOpportunityByProviderMessage: async () => ({ opportunity_id: "opp", contact_id: "contact" }),
    processInboundEvent: async (event) => { calls.push(event); return { duplicate: false, action: "suppressed_and_cancelled" }; } };
  const result = await handleBookFeatureInbound({ rawBody, signature, timestamp, secret, providerEventId: "event-opt-out",
    providerMessageId: "provider-1", text }, { repository,
    now: () => new Date("2026-11-27T08:01:00.000Z"), persist: async () => {} });
  assert.equal(result.action, "suppressed_and_cancelled");
  assert.equal(calls[0].category, "opt_out");
});

test("late suppression of intended contact blocks controlled-test handoff", async () => {
  const outcomes = [];
  let sends = 0;
  let checks = 0;
  const repository = { admitHandoff: async () => true, claimOutbox: async () => lease(),
    outboxDispatchContext: async () => ({ ...dispatchContext(), intended_email: "editor@example.com" }),
    mode: async () => ({ effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }),
    finishOutboxLease: async (_lease, outcome) => outcomes.push(outcome) };
  const worker = new BookFeatureDispatchWorker({ repository,
    context: { d1: {}, emailService: { send: async () => { sends++; } } },
    readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async (email) => email === "editor@example.com" && ++checks > 1,
    createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  assert.equal((await worker.runOnce()).status, "cancelled");
  assert.equal(sends, 0);
  assert.equal(outcomes[0].errorCode, "final_handoff_gate_failed");
});

test("unclassified provider exceptions after handoff are reconciliation pending, never retryable", async () => {
  const outcomes = [];
  const repository = { admitHandoff: async () => true, claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
    mode: async () => ({ effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }),
    finishOutboxLease: async (_lease, outcome) => outcomes.push(outcome) };
  const worker = new BookFeatureDispatchWorker({ repository, context: { d1: {}, emailService: {
    send: async () => { throw Object.assign(new Error("provider timeout"), { retryable: true }); },
  } }, readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async () => null, createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  assert.equal((await worker.runOnce()).status, "unknown");
  assert.equal(outcomes[0].status, "unknown");
  assert.equal(outcomes[0].nextAttemptAt, undefined);
});

test("a failed delivery event write after persisted acceptance does not re-finish or retry the lease", async () => {
  const outcomes = [];
  const repository = { admitHandoff: async () => true, claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
    mode: async () => ({ effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }),
    finishOutboxLease: async (_lease, outcome) => outcomes.push(outcome),
    recordDeliveryEvent: async () => { throw new Error("event store unavailable"); } };
  const worker = new BookFeatureDispatchWorker({ repository, context: { d1: {}, emailService: {
    send: async () => ({ providerMessageId: "provider-1" }),
  } }, readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async () => null, createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  const result = await worker.runOnce();
  assert.equal(result.status, "accepted");
  assert.equal(result.reconciliationRequired, true);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, "accepted");
});

test("atomic dispatch admission denial prevents provider handoff", async () => {
  const outcomes = [];
  let sends = 0;
  const repository = { claimOutbox: async () => lease(), outboxDispatchContext: async () => dispatchContext(),
    mode: async () => ({ effective: "controlled_test", killSwitch: false, testRecipients: ["test@example.com"] }),
    admitHandoff: async () => false, finishOutboxLease: async (_lease, outcome) => outcomes.push(outcome) };
  const worker = new BookFeatureDispatchWorker({ repository, context: { d1: {}, emailService: {
    send: async () => { sends++; },
  } }, readPrivate: async () => JSON.stringify({ pitch: { subject: "A useful feature", body: "A complete safe body." } }),
    now: () => new Date("2026-11-27T08:00:00.000Z") });
  worker.shared = { isSuppressed: async () => null, createOutboundConversation: async () => ({ conversationId: "conversation" }) };
  assert.equal((await worker.runOnce()).status, "cancelled");
  assert.equal(sends, 0);
  assert.equal(outcomes[0].errorCode, "atomic_admission_denied");
});

test("signed inbound content cannot be substituted", async () => {
  const secret = "test-secret";
  const timestamp = "2026-11-27T08:00:00.000Z";
  const rawBody = JSON.stringify({ providerEventId: "event-1", text: "No thanks" });
  const signature = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex")}`;
  await assert.rejects(handleBookFeatureInbound({ rawBody, signature, timestamp, secret,
    providerEventId: "event-1", text: "Interested" }, { repository: {},
    now: () => new Date("2026-11-27T08:01:00.000Z") }), /does not match/);
});
