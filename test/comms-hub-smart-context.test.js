import test from "node:test";
import assert from "node:assert/strict";

import { buildSmartConversationContext, getFirstPartyBookCatalogueStatus, smartPromptGuidance } from "../services/comms-hub/smartContextService.js";
import { CommsHubAiWorkflowService } from "../services/comms-hub/aiWorkflowService.js";

function message(id, direction, body, metadata = {}) {
  return {
    id,
    direction,
    sender: direction === "outbound" ? "Jonathan" : "visitor",
    received_at: "2026-08-16T14:00:00.000Z",
    subject: "Website chat",
    body_text: body,
    metadata_json: JSON.stringify(metadata),
  };
}

test("smart context derives per-session tone, interests, page context and verified book candidates", () => {
  const conversation = {
    id: "cnv_smart_1",
    channel: "chat",
    workflow: "website_chat",
    source_reference: "session-1",
    metadata_json: JSON.stringify({ page: { title: "AI in Logistics", url: "https://jonathan-harris.online/ai-logistics" } }),
    messages: [message("m1", "inbound", "My name is Alex. I'm in logistics and new to AI. Can you recommend a beginner book?")],
  };
  const context = buildSmartConversationContext(conversation, { now: new Date("2026-08-16T14:30:00Z") });
  assert.equal(context.enabled, true);
  assert.equal(context.engagementMode, "book_discovery");
  assert.equal(context.memory.explicitName, "Alex");
  assert.ok(context.memory.interests.includes("logistics"));
  assert.equal(context.memory.bookStyle, "beginner_accessible");
  assert.equal(context.page.title, "AI in Logistics");
  assert.ok(context.verifiedBookCandidates.length >= 1);
  assert.match(context.verifiedBookCandidates[0].title, /Logistics/i);
  assert.match(context.verifiedBookCandidates[0].bookUrl, /^https:\/\/jonathan-harris\.online\/ebooks\//);
});

test("smart quiz context recognises A/B/C/D answers but never invents correctness", () => {
  const conversation = {
    id: "cnv_quiz_1", channel: "chat", workflow: "contact_intake", messages: [
      message("q1", "outbound", "What is machine learning? A) Robots B) Algorithms improving with experience C) A database D) Manual typing"),
      message("a1", "inbound", "I think it's B"),
    ],
  };
  const context = buildSmartConversationContext(conversation);
  assert.equal(context.engagementMode, "quiz_interaction");
  assert.equal(context.memory.quiz.selectedAnswer, "B");
  assert.equal(context.memory.quiz.correctnessKnown, false);
  assert.match(smartPromptGuidance(context), /Do not claim an answer is correct unless/i);
});

test("social comment context stays public, concise and does not pretend to know unseen source-post text", () => {
  const context = buildSmartConversationContext({
    id: "cnv_social_1", channel: "social", workflow: "social_comment_moderation", messages: [message("m1", "inbound", "Interesting point. What should businesses do next?")],
    socialThread: { platform: "instagram", thread_type: "comment", provider_post_id: "post-1" },
  });
  assert.equal(context.engagementMode, "public_content_discussion");
  assert.equal(context.platform, "instagram");
  assert.equal(context.interactionType, "comment");
  assert.match(smartPromptGuidance(context), /Do not pretend to know the source post text/i);
});

test("AI workflow treats the first-party book catalogue as authoritative evidence and drafts deterministically", async () => {
  const captured = [];
  const conversation = {
    id: "cnv_dynamic_1", channel: "chat", provider: "coginpal", workflow: "website_chat", status: "open",
    subject: "Website chat", metadata_json: JSON.stringify({ page: { title: "Logistics", url: "https://jonathan-harris.online/logistics" } }),
    messages: [message("m1", "inbound", "I'm new to AI in logistics. Which book should I read first?")],
  };
  const responses = {
    commsHubTriage: { intent: "general_enquiry", confidence: .9, urgency: .1, commercialValue: .1, reputationalRisk: .1, customerImpact: .1, rationale: "book enquiry" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: .9, severity: 0, rationale: "safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "Visitor wants a beginner logistics AI book.", unresolvedActions: [], sourceMessageIds: ["m1"], nextAction: "Recommend a grounded book",
       followUpNeeded: false, followUpReason: "", followUpHours: 0 },
  };
  let persisted = null;
  const service = new CommsHubAiWorkflowService({
    context: {
      config: { aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: .2, aiApprovalPriorityScore: 60, smartContextEnabled: true,
         smartMaximumBookCandidates: 3 },
      repository: { async getConversation() { return conversation; } },
      aiRepository: { async beginAiRun() {}, async persistAnalysisBundle(bundle) { persisted = bundle; }, async failAiRun() {} },
      aiSearch: { lastSearchDiagnostics: { ok: true }, async searchApproved() { return []; } },
    },
    aiRequest: async (routeName, options) => {
      captured.push({ routeName, options });
      return { content: JSON.stringify(responses[routeName]), providerId: "test", model: "test", routeKey: routeName };
    },
  });
  await service.analyseConversation(conversation.id, { scheduleFollowUp: false });
  assert.equal(captured.some((entry) => entry.routeName.startsWith("commsHubDraft")), false);
  assert.equal(persisted.run.metadata.smartContext.engagementMode, "book_discovery");
  assert.ok(persisted.run.metadata.knowledgeSearch.firstPartyCatalogueEvidenceCount >= 1);
  assert.equal(persisted.draft.provider, "aims-first-party-catalogue");
  assert.equal(persisted.draft.model, "verified-book-catalogue-v1");
  assert.match(persisted.draft.bodyText, /Artificial Intelligence in Logistics/i);
  assert.match(persisted.draft.bodyText, /https:\/\/jonathan-harris\.online\/ebooks\//i);
  assert.equal(persisted.evidence.some((item) => item.metadata?.sourceType === "first_party_catalogue"), true);
});

test("broad AI book enquiries return verified Jonathan Harris catalogue candidates instead of third-party books", () => {
  const context = buildSmartConversationContext({
    id: "cnv_books_broad",
    channel: "chat",
    workflow: "website_chat",
    messages: [message("m1", "inbound", "What books are available on artificial intelligence?")],
  });
  assert.equal(context.engagementMode, "book_discovery");
  assert.equal(context.bookCatalogue.authoritative, true);
  assert.equal(context.bookCatalogue.broadDiscovery, true);
  assert.ok(context.verifiedBookCandidates.length >= 2);
  assert.equal(context.verifiedBookCandidates[0].title, "The Artificial Intelligence Revolution: From Algorithms to Consciousness");
  assert.ok(context.verifiedBookCandidates.every((book) => book.sourceType === "first_party_catalogue"));
  assert.ok(context.verifiedBookCandidates.every((book) => /^https:\/\/jonathan-harris\.online\/ebooks\//i.test(book.bookUrl)));
  assert.match(smartPromptGuidance(context), /Do not recommend third-party books/i);
});

test("generic recommendation wording does not incorrectly force book discovery", () => {
  const context = buildSmartConversationContext({
    id: "cnv_podcast_recommendation",
    channel: "chat",
    workflow: "website_chat",
    messages: [message("m1", "inbound", "Can you recommend a podcast episode about AI agents?")],
  });
  assert.equal(context.engagementMode, "website_conversation");
  assert.equal(context.verifiedBookCandidates.length, 0);
});


test("first-party book catalogue readiness reports every bundled book as a valid canonical website record", () => {
  const status = getFirstPartyBookCatalogueStatus();
  assert.equal(status.ready, true);
  assert.equal(status.authoritative, true);
  assert.equal(status.bookCount, 40);
  assert.equal(status.validBookCount, 40);
  assert.equal(status.invalidBookCount, 0);
});

test("exact broad AI book question produces only verified first-party catalogue recommendations", async () => {
  const conversation = {
    id: "cnv_books_exact", channel: "chat", provider: "coginpal", workflow: "website_chat", status: "open",
    subject: "Website chat", messages: [message("m1", "inbound", "What books are available on artificial intelligence?")],
  };
  const responses = {
    commsHubTriage: { intent: "general_enquiry", confidence: .95, urgency: .05, commercialValue: .1, reputationalRisk: .01, customerImpact: .1, rationale: "book enquiry" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: .99, severity: 0, rationale: "safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "Visitor asks which AI books are available.", unresolvedActions: [], sourceMessageIds: ["m1"], nextAction: "Recommend verified catalogue books",
       followUpNeeded: false, followUpReason: "", followUpHours: 0 },
  };
  let persisted = null;
  const service = new CommsHubAiWorkflowService({
    context: {
      config: { aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: .2, aiApprovalPriorityScore: 60, smartContextEnabled: true,
         smartMaximumBookCandidates: 3 },
      repository: { async getConversation() { return conversation; } },
      aiRepository: { async beginAiRun() {}, async persistAnalysisBundle(bundle) { persisted = bundle; }, async failAiRun() {} },
      aiSearch: { lastSearchDiagnostics: { ok: true, evidenceCount: 0 }, async searchApproved() { return []; } },
    },
    aiRequest: async (routeName) => ({ content: JSON.stringify(responses[routeName]), providerId: "test", model: "test", routeKey: routeName }),
  });

  await service.analyseConversation(conversation.id, { scheduleFollowUp: false });
  assert.match(persisted.draft.bodyText, /The Artificial Intelligence Revolution: From Algorithms to Consciousness/);
  assert.match(persisted.draft.bodyText, /AI Literacy for the Modern Workplace/);
  assert.match(persisted.draft.bodyText, /https:\/\/jonathan-harris\.online\/ebooks\//i);
  assert.doesNotMatch(persisted.draft.bodyText, /Russell|Norvig|Goodfellow|Bengio|Bostrom|Sutton|Barto/i);
  assert.equal(persisted.draft.provider, "aims-first-party-catalogue");
});
