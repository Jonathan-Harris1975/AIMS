import test from "node:test";
import assert from "node:assert/strict";

import {
  assessConversationConduct,
  conductPromptGuidance,
  redactBadLanguageForAi,
  scanOutboundLanguagePolicy,
} from "../services/comms-hub/conversationConductService.js";
import { buildSmartConversationContext, smartPromptGuidance } from "../services/comms-hub/smartContextService.js";
import { CommsHubAiWorkflowService } from "../services/comms-hub/aiWorkflowService.js";

function message(id, direction, body) {
  return {
    id,
    direction,
    sender: direction === "outbound" ? "Jonathan" : "visitor",
    received_at: "2026-08-16T14:00:00.000Z",
    subject: "Website chat",
    body_text: body,
    metadata_json: "{}",
  };
}

test("conduct layer distinguishes isolated frustration from repeated targeted abuse", () => {
  const mild = assessConversationConduct({ messages: [message("m1", "inbound", "This is damn frustrating, can you explain it again?")] });
  assert.equal(mild.level, "mild");
  assert.equal(mild.requiresHumanReview, false);
  assert.equal(mild.automationBlocked, false);

  const abusive = assessConversationConduct({ messages: [
    message("m1", "inbound", "You are a fucking useless bot."),
    message("m2", "inbound", "Jonathan is a fucking idiot too."),
  ] });
  assert.equal(abusive.level, "abusive");
  assert.equal(abusive.targetedCount, 2);
  assert.equal(abusive.requiresHumanReview, true);
  assert.equal(abusive.automationBlocked, true);
  assert.match(conductPromptGuidance(abusive), /calm boundary/i);
});

test("reported bad language is contained without treating a quoted report like direct abuse", () => {
  const conduct = assessConversationConduct({ messages: [message("m1", "inbound", "Someone wrote 'fuck you' under my post. What should I do?")] });
  assert.equal(conduct.level, "mild");
  assert.equal(conduct.requiresHumanReview, false);
  assert.equal(conduct.automationBlocked, false);
});

test("threatening language always blocks automation and requires human review", () => {
  const conduct = assessConversationConduct({ messages: [message("m1", "inbound", "I will find you and hurt you.")] });
  assert.equal(conduct.level, "severe");
  assert.equal(conduct.threat, true);
  assert.equal(conduct.requiresHumanReview, true);
  assert.equal(conduct.automationBlocked, true);
  assert.equal(conduct.suggestedAbuseLabel, "violence");
});

test("bad language is masked before inference and rejected in outbound copy", () => {
  assert.match(redactBadLanguageForAi("This is fucking ridiculous"), /\[PROFANITY\]/);
  assert.equal(scanOutboundLanguagePolicy("Thanks. I can help with that.").detected, false);
  assert.equal(scanOutboundLanguagePolicy("This is fucking ridiculous.").detected, true);
  assert.equal(scanOutboundLanguagePolicy("f u c k this").detected, true);
  assert.equal(scanOutboundLanguagePolicy("f*ck this").detected, true);
  assert.equal(scanOutboundLanguagePolicy("f@ck this").detected, true);
  assert.match(redactBadLanguageForAi("f*ck this"), /\[PROFANITY\]/);
  assert.equal((redactBadLanguageForAi("fuck this, shit that").match(/\[PROFANITY\]/g) || []).length, 2);
  const punctuatedTarget = assessConversationConduct({ messages: [message("m-target", "inbound", "Fuck you! Explain it.")] });
  assert.equal(punctuatedTarget.latestTargeted, true);
});

test("smart memory remembers explicit conversational preferences without inventing profile data", () => {
  const conversation = {
    id: "cnv-memory",
    channel: "chat",
    workflow: "website_chat",
    messages: [
      message("m1", "inbound", "My name is Sam. Keep it short and don't send me links."),
      message("m2", "outbound", "Understood."),
      message("m3", "inbound", "Also, no book recommendations. I'm interested in AI in education."),
      message("m4", "inbound", "I don't understand that. Can you explain it again?"),
      message("m5", "inbound", "I'm confused. What do you mean?"),
      message("m6", "inbound", "I'm still confused. Can you explain it differently?"),
    ],
  };
  const context = buildSmartConversationContext(conversation);
  assert.equal(context.version, "smart-context-v2");
  assert.equal(context.memory.explicitName, "Sam");
  assert.equal(context.memory.responseLength, "brief");
  assert.equal(context.memory.linkPreference, "no_links");
  assert.equal(context.memory.bookRecommendationPreference, "opted_out");
  assert.ok(context.memory.interests.includes("education"));
  assert.ok(context.memory.interactionSignals.confusionCount >= 3);
  assert.equal(context.escalation.required, true);
  assert.ok(context.escalation.reasons.includes("repeated_confusion"));
  assert.equal(context.verifiedBookCandidates.length, 0);
  const guidance = smartPromptGuidance(context);
  assert.match(guidance, /prefers brief answers/i);
  assert.match(guidance, /asked not to receive links/i);
  assert.match(guidance, /opted out of book recommendations/i);
  assert.match(guidance, /repeated confusion/i);
});

test("AI workflow masks inbound profanity and forces approval after repeated targeted abuse", async () => {
  const captured = [];
  const conversation = {
    id: "cnv-conduct-ai",
    channel: "chat",
    provider: "coginpal",
    workflow: "website_chat",
    status: "open",
    subject: "Website chat",
    metadata_json: "{}",
    messages: [
      message("m1", "inbound", "You are a fucking useless bot."),
      message("m2", "inbound", "You are a fucking waste of time. Explain the pricing."),
    ],
  };
  const responses = {
    commsHubTriage: { intent: "general_enquiry", confidence: .9, urgency: .1, commercialValue: .1, reputationalRisk: .2, customerImpact: .1, rationale: "pricing question with hostility" },
    commsHubModeration: { sentiment: "negative", abuseLabel: "none", confidence: .9, severity: .1, rationale: "hostile tone", recommendedAction: "reply" },
    commsHubSummary: { summary: "Visitor asks for pricing information and has used repeated targeted abusive language.", unresolvedActions: [], sourceMessageIds: ["m1", "m2"], nextAction: "Explain pricing calmly", followUpNeeded: true, followUpReason: "pricing", followUpHours: 24 },
    commsHubDraftContact: { bodyText: "I can help with the pricing question, but I won't engage with personal abuse. What pricing information do you need?", evidenceSourceReferences: ["https://jonathan-harris.online/pricing"] },
    commsHubDraftComplex: { bodyText: "I can help with the pricing question, but I won't engage with personal abuse. What pricing information do you need?", evidenceSourceReferences: ["https://jonathan-harris.online/pricing"] },
  };
  let persisted = null;
  const service = new CommsHubAiWorkflowService({
    context: {
      config: {
        aiEnabled: true,
        approvalsEnforced: true,
        aiMaximumEvidence: 8,
        aiAutoApprovalRiskThreshold: .2,
        aiApprovalPriorityScore: 60,
        smartContextEnabled: true,
        smartMaximumBookCandidates: 3,
        smartConductEnabled: true,
        badLanguageBlockEnabled: true,
        conductReviewStrikeThreshold: 2,
        conductAutomationBlockThreshold: 2,
        aiComplexityModerationSeverity: .55,
      },
      repository: { async getConversation() { return conversation; } },
      aiRepository: { async beginAiRun() {}, async persistAnalysisBundle(bundle) { persisted = bundle; }, async failAiRun() {} },
      aiSearch: { async searchApproved() { return [{ indexId: "site", sourceReference: "https://jonathan-harris.online/pricing", title: "Pricing", excerpt: "Pricing information is available on Jonathan's website.", score: .9, contentSha256: "pricing", metadata: {} }]; } },
    },
    aiRequest: async (routeName, options) => {
      captured.push({ routeName, options });
      const response = responses[routeName] || responses.commsHubDraftComplex;
      return { content: JSON.stringify(response), providerId: "test", model: "test", routeKey: routeName };
    },
  });
  const result = await service.analyseConversation(conversation.id, { scheduleFollowUp: true });
  const triageRequest = captured.find((entry) => entry.routeName === "commsHubTriage");
  assert.ok(triageRequest);
  assert.doesNotMatch(triageRequest.options.messages[1].content, /fucking/i);
  assert.match(triageRequest.options.messages[1].content, /\[PROFANITY\]/);
  assert.equal(result.moderation.abuseLabel, "harassment");
  assert.ok(result.moderation.severity >= .7);
  assert.equal(result.queue.key, "priority_review");
  assert.equal(result.queue.escalationRequired, true);
  assert.equal(result.draft.requiresApproval, true);
  assert.equal(result.followUp, null);
  assert.ok(persisted.run.metadata.conduct.automationBlocked);
  assert.ok(persisted.approval.metadata.reasons.includes("abusive_or_hostile_conversation"));
});

test("AI workflow rejects a generated draft containing blocked language", async () => {
  const conversation = {
    id: "cnv-output-language",
    channel: "chat",
    provider: "coginpal",
    workflow: "website_chat",
    status: "open",
    subject: "Website chat",
    metadata_json: "{}",
    messages: [message("m1", "inbound", "Can you help me understand this?")],
  };
  const normal = {
    commsHubTriage: { intent: "general_enquiry", confidence: .9, urgency: .1, commercialValue: .1, reputationalRisk: .1, customerImpact: .1, rationale: "general" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: .9, severity: 0, rationale: "safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "Visitor wants an explanation.", unresolvedActions: [], sourceMessageIds: ["m1"], nextAction: "Explain", followUpNeeded: false, followUpReason: "", followUpHours: 0 },
  };
  const service = new CommsHubAiWorkflowService({
    context: {
      config: {
        aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: .2, aiApprovalPriorityScore: 60,
        smartContextEnabled: true, smartMaximumBookCandidates: 3, smartConductEnabled: true, badLanguageBlockEnabled: true,
        conductReviewStrikeThreshold: 2, conductAutomationBlockThreshold: 2, aiComplexityModerationSeverity: .55,
      },
      repository: { async getConversation() { return conversation; } },
      aiRepository: { async beginAiRun() {}, async persistAnalysisBundle() {}, async failAiRun() {} },
      aiSearch: { async searchApproved() { return [{ indexId: "site", sourceReference: "https://jonathan-harris.online/about", title: "About", excerpt: "General information about Jonathan's work.", score: .9, contentSha256: "about", metadata: {} }]; } },
    },
    aiRequest: async (routeName) => {
      const value = normal[routeName] || { bodyText: "This is fucking simple.", evidenceSourceReferences: ["https://jonathan-harris.online/about"] };
      return { content: JSON.stringify(value), providerId: "test", model: "test", routeKey: routeName };
    },
  });
  await assert.rejects(() => service.analyseConversation(conversation.id), (error) => error.code === "ai_output_language_policy_rejected");
});


test("latest explicit preference wins so a visitor can reverse an earlier opt-out", () => {
  const context = buildSmartConversationContext({
    id: "cnv-pref-reverse", channel: "chat", workflow: "website_chat", messages: [
      message("m1", "inbound", "No links and no book recommendations please."),
      message("m2", "outbound", "Understood."),
      message("m3", "inbound", "Actually, send me the links and recommend a practical AI book for logistics."),
    ],
  });
  assert.equal(context.memory.linkPreference, "links_welcome");
  assert.equal(context.memory.bookRecommendationPreference, "welcome");
  assert.equal(context.engagementMode, "book_discovery");
  assert.ok(context.verifiedBookCandidates.length >= 1);
});

test("AI workflow fails closed when a generated reply violates an explicit no-links preference", async () => {
  const conversation = {
    id: "cnv-no-links", channel: "social", provider: "zernio", workflow: "social_inbox", status: "open", subject: "DM", metadata_json: "{}",
    socialThread: { platform: "instagram", thread_type: "dm" },
    messages: [message("m1", "inbound", "Please keep it brief and don't send me links. What do you offer?")],
  };
  const responses = {
    commsHubTriage: { intent: "social_engagement", confidence: .9, urgency: .1, commercialValue: .1, reputationalRisk: .1, customerImpact: .1, rationale: "general social question" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: .9, severity: 0, rationale: "safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "Visitor asks what Jonathan offers and does not want links.", unresolvedActions: [], sourceMessageIds: ["m1"], nextAction: "Answer briefly", followUpNeeded: false, followUpReason: "", followUpHours: 0 },
    commsHubDraftSocial: { bodyText: "Jonathan writes and speaks about practical AI. https://jonathan-harris.online", evidenceSourceReferences: [] },
  };
  const service = new CommsHubAiWorkflowService({
    context: {
      config: {
        aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: .2, aiApprovalPriorityScore: 60,
        smartContextEnabled: true, smartMaximumBookCandidates: 3, smartConductEnabled: true, badLanguageBlockEnabled: true,
        conductReviewStrikeThreshold: 2, conductAutomationBlockThreshold: 2, aiComplexityModerationSeverity: .55,
      },
      repository: { async getConversation() { return conversation; } },
      aiRepository: { async beginAiRun() {}, async persistAnalysisBundle() {}, async failAiRun() {} },
      aiSearch: { async searchApproved() { return []; } },
    },
    aiRequest: async (routeName) => ({ content: JSON.stringify(responses[routeName]), providerId: "test", model: "test", routeKey: routeName }),
  });
  await assert.rejects(() => service.analyseConversation(conversation.id), (error) => error.code === "ai_output_preference_violation");
});
