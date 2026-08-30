import test from "node:test";
import assert from "node:assert/strict";

import { assessConversationBusinessRisk } from "../services/comms-hub/conversationConductService.js";
import { buildSmartResponseIntelligence } from "../services/comms-hub/smartResponseIntelligenceService.js";
import { humanContactOffer, proactiveHumanHandoffDecision } from "../services/comms-hub/humanContactService.js";

function conversation(body, channel = "chat") {
  return { channel, messages: [{ id: "m1", direction: "inbound", body_text: body }] };
}

function baseInput(body = "Can you explain your AI work?", channel = "chat") {
  return {
    conversation: conversation(body, channel),
    intent: { intent: "general_enquiry", confidence: .94 },
    moderation: { severity: 0 },
    summary: { unresolvedActions: [] },
    evidence: [{}],
    policy: { requiresEvidence: false },
    config: { smartResponseEnabled: true, smartResponseMinimumConfidence: .86, autoSendEnabled: true, autoSendChatEnabled: true, autoSendEmailEnabled: true, autoSendSocialEnabled: true, autoSendFormEnabled: true },
  };
}

test("money, legal and privacy-rights language deterministically forces human review", () => {
  for (const body of [
    "I want a refund for a charge I dispute.",
    "My solicitor will send a legal claim for breach of contract.",
    "This is a GDPR subject access request; delete my data.",
  ]) {
    const risk = assessConversationBusinessRisk(conversation(body));
    assert.equal(risk.requiresHumanReview, true);
    const intelligence = buildSmartResponseIntelligence(baseInput(body));
    assert.equal(intelligence.humanReviewRequired, true);
    assert.equal(intelligence.autonomousEligible, false);
    assert.match(intelligence.reasons.join(" "), /business_risk:/);
  }
});

test("safe answerable messages auto-send only when their channel is enabled", () => {
  const yes = buildSmartResponseIntelligence(baseInput());
  assert.equal(yes.autonomousEligible, true);
  const input = baseInput("Can you explain your AI work?", "chat");
  input.config.autoSendChatEnabled = false;
  const no = buildSmartResponseIntelligence(input);
  assert.equal(no.autonomousEligible, false);
  assert.ok(no.reasons.includes("channel_auto_send_disabled"));
});

test("proactive handoff routes in hours and uses Contact Me Jotform out of hours", () => {
  const inHours = proactiveHumanHandoffDecision({ handoff: { available: true }, responseIntelligence: { humanReviewRequired: true } });
  assert.equal(inHours.requestLiveHandoff, true);
  const outHours = proactiveHumanHandoffDecision({ handoff: { available: false }, interactionSignals: { complaintCount: 1 } });
  assert.equal(outHours.offerContactForm, true);
  assert.match(humanContactOffer({ available: false, contactUrl: "https://form.jotform.com/260281179574362" }), /https:\/\/form\.jotform\.com\/260281179574362/);
  assert.doesNotMatch(humanContactOffer({ available: false, contactUrl: "https://form.jotform.com/260281179574362" }), /leave an email/i);
});
