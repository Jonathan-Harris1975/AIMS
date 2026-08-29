import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { loadCommsHubConfig } from "../services/comms-hub/config.js";
import { decideConversationJotform, buildFormRequestRecord } from "../services/comms-hub/formOrchestrationService.js";
import { buildSmartResponseIntelligence } from "../services/comms-hub/smartResponseIntelligenceService.js";
import { buildJotformInformationDigest, formProcessingForAi, CommsHubFormProcessingService } from "../services/comms-hub/formProcessingService.js";
import { buildJotformIntake } from "../services/comms-hub/domain/submission.js";
import { COMMS_HUB_FORM_ROUTES } from "../services/comms-hub/config.js";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import { CommsHubAiWorkflowService } from "../services/comms-hub/aiWorkflowService.js";
import { CommsHubEmailService } from "../services/comms-hub/emailService.js";
import { sendReplyDraft } from "../services/comms-hub/replyDraftService.js";
import { CommsHubGovernanceService } from "../services/comms-hub/governanceService.js";

function config(overrides = {}) {
  return {
    smartResponseEnabled: true,
    smartResponseMinimumConfidence: 0.86,
    formOrchestrationEnabled: true,
    formSmartProcessingEnabled: true,
    formAutoSendEnabled: false,
    formRequestExpiryHours: 336,
    jotformForms: {
      contact: { formId: "260281179574362", key: "contact", label: "Contact form", workflow: "contact_intake", url: "https://form.jotform.com/260281179574362" },
      case_study: { formId: "262063136008044", key: "case_study", label: "Case study contribution form", workflow: "case_study_intake", url: "https://form.jotform.com/262063136008044" },
      podcast_enquiry: { formId: "262097861889073", key: "podcast_enquiry", label: "Podcast enquiry form", workflow: "podcast_enquiry_intake", url: "https://form.jotform.com/262097861889073" },
    },
    ...overrides,
  };
}

function message(body, direction = "inbound") {
  return { id: `m-${Math.random()}`, direction, subject: "Conversation", body_text: body, received_at: "2026-08-16T16:00:00.000Z" };
}

function conversation(body, overrides = {}) {
  return {
    id: "cnv-smart-form",
    channel: "chat",
    workflow: "website_chat",
    status: "open",
    contact_id: "contact-1",
    contact: { id: "contact-1", primary_email: "reader@example.com" },
    messages: [message(body)],
    ...overrides,
  };
}

test("Smart Response sends the podcast form only for participation intent, not ordinary podcast questions", () => {
  const askAbout = decideConversationJotform({
    conversation: conversation("What is Turing's Torch about?"),
    intent: { intent: "general_enquiry", confidence: 0.95 },
    summary: { nextAction: "Answer the question" },
    config: config(),
  });
  assert.equal(askAbout.selected, false);

  const contribute = decideConversationJotform({
    conversation: conversation("I'd like to appear as a guest on your podcast and discuss AI in rail."),
    intent: { intent: "podcast_contribution", confidence: 0.96 },
    summary: { nextAction: "Collect guest details" },
    config: config(),
  });
  assert.equal(contribute.selected, true);
  assert.equal(contribute.formKey, "podcast_enquiry");
  assert.equal(contribute.formUrl, "https://form.jotform.com/262097861889073");
  assert.equal(contribute.required, true);
});

test("An already-active form request is not sent repeatedly in the same conversation", () => {
  const base = conversation("I would like to guest on the podcast.");
  const decision = decideConversationJotform({
    conversation: base,
    intent: { intent: "podcast_contribution", confidence: .96 },
    summary: {},
    formRequests: [{ form_key: "podcast_enquiry", status: "sent", expires_at: "2099-01-01T00:00:00Z" }],
    config: config(),
  });
  assert.equal(decision.selected, false);
  assert.equal(decision.reason, "form_already_active");
  assert.equal(decision.formKey, "podcast_enquiry");
});

test("Case-study contribution gets the case-study form while simple enquiries remain conversational", () => {
  const caseStudy = decideConversationJotform({
    conversation: conversation("I want to share our AI implementation story as a case study."),
    intent: { intent: "case_study_contribution", confidence: 0.92 },
    summary: { nextAction: "Collect structured contribution" },
    config: config(),
  });
  assert.equal(caseStudy.formKey, "case_study");

  const simple = decideConversationJotform({
    conversation: conversation("Which of Jonathan's books is best for a beginner?"),
    intent: { intent: "general_enquiry", confidence: 0.94 },
    summary: { nextAction: "Recommend a book" },
    config: config(),
  });
  assert.equal(simple.selected, false);
});

test("An explicit no-links preference makes Smart Response ask permission before exposing a required form link", () => {
  const intelligence = buildSmartResponseIntelligence({
    conversation: conversation("I'd like to be on the podcast."),
    intent: { intent: "podcast_contribution", confidence: 0.95 },
    moderation: { severity: 0 },
    summary: { nextAction: "Collect podcast details", unresolvedActions: [] },
    evidence: [],
    smartContext: { memory: { linkPreference: "no_links" } },
    strategy: {}, conduct: {}, security: {}, policy: { requiresEvidence: false }, config: config(),
  });
  assert.equal(intelligence.formDecision.selected, true);
  assert.equal(intelligence.formDecision.withholdUrl, true);
  assert.equal(intelligence.clarificationRequired, true);
  assert.equal(intelligence.nextBestMove, "ask_permission_for_form_link");
  assert.equal(intelligence.autonomousEligible, false);
});

test("Jotform digest excludes identity/upload fields while allowing controlled downstream editorial reuse", () => {
  const submission = {
    id: "sub-1",
    form_id: "262063136008044",
    created_at: "2026-08-16 16:00:00",
    answers: {
      1: { name: "name", text: "Name", type: "control_fullname", answer: { first: "Alex", last: "Reader" } },
      2: { name: "email", text: "Email", type: "control_email", answer: "alex@example.com" },
      3: { name: "story", text: "What happened?", type: "control_textarea", answer: "We reduced manual triage time by testing one workflow first." },
      4: { name: "file", text: "Evidence", type: "control_fileupload", answer: ["https://files.example.com/proof.pdf"] },
    },
  };
  const intake = buildJotformIntake({
    formId: "262063136008044", submissionId: "sub-1", route: COMMS_HUB_FORM_ROUTES["262063136008044"], submission,
    correlationId: "corr-1", now: new Date("2026-08-16T16:01:00.000Z"), sourceTimeZone: "UTC",
  });
  const digest = buildJotformInformationDigest(intake);
  assert.equal(digest.facts.length, 1);
  assert.equal(digest.facts[0].label, "What happened?");
  assert.equal(digest.attachmentCount, 1);
  assert.equal(digest.attachmentReviewRequired, true);
  assert.equal(digest.creativeReuseInScope, true);

  const safe = formProcessingForAi({ status: "digest_ready", digest });
  assert.equal(safe.digest.contact.emailSupplied, true);
  assert.equal("email" in safe.digest.contact, false);
  assert.match(safe.digest.facts[0].value, /reduced manual triage/i);
});

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const migration of [
      "0001_comms_hub.sql", "0002_zernio_social.sql", "0003_ai_workflows.sql",
      "0004_hardening.sql", "0005_operations_and_channels.sql", "0006_smart_response_forms.sql", "0007_business_hours_and_handoff.sql",
    ]) this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${migration}`, import.meta.url), "utf8"));
  }
  query(sql, params = []) { return { success: true, results: this.db.prepare(sql).all(...params) }; }
  batch(statements) {
    this.db.exec("BEGIN");
    try { const out = statements.map(({ sql, params = [] }) => this.query(sql, params)); this.db.exec("COMMIT"); return out; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

test("A sent form request is durably matched to a verified submission only by exact form plus verified email", async () => {
  const d1 = new SqliteD1();
  const ops = new CommsOperationsRepository(d1);
  d1.query(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at) VALUES ('contact-1','reader@example.com','Reader','',?,?)`, ["2026-08-16T16:00:00Z", "2026-08-16T16:00:00Z"]);
  d1.query(`INSERT INTO comms_hub_conversations (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, metadata_json) VALUES ('cnv-1','chat','coginpal','website_chat','open','contact-1','Chat','session-1',?,?,?, '{}')`, ["2026-08-16T16:00:00Z", "2026-08-16T16:00:00Z", "2026-08-16T16:00:00Z"]);
  const decision = decideConversationJotform({ conversation: conversation("I want to guest on the podcast", { id: "cnv-1", contact_id: "contact-1" }), intent: { intent: "podcast_contribution", confidence: .95 }, summary: {}, config: config() });
  const request = buildFormRequestRecord({ conversation: { id: "cnv-1", contact_id: "contact-1", channel: "chat", workflow: "website_chat" }, draftId: "draft-1", decision, sentAt: "2026-08-16T16:05:00Z", expiryHours: 24 });
  await ops.upsertFormRequestSent(request);
  await ops.addContactAlias({ id: "alias-email-1", contactId: "contact-1", type: "email", value: "reader@example.com", provider: "one.com", confidence: 1, verified: true, createdAt: "2026-08-16T16:05:00Z", metadata: {} });
  const wrong = await ops.matchPendingFormRequestForSubmission({ formId: decision.formId, email: "someoneelse@example.com", submissionConversationId: "form-cnv-wrong", submissionId: "sub-wrong", submittedAt: "2026-08-16T16:10:00Z" });
  assert.equal(wrong, null);
  const matched = await ops.matchPendingFormRequestForSubmission({ formId: decision.formId, email: "reader@example.com", submissionConversationId: "form-cnv-1", submissionId: "sub-1", submittedAt: "2026-08-16T16:10:00Z" });
  assert.equal(matched.status, "submitted");
  assert.equal(matched.match_method, "verified_email_and_form");
});

test("AI workflow dynamically injects the exact approved Jotform URL and stores the form decision", async () => {
  const captured = [];
  let persisted;
  const convo = conversation("I'd like to contribute as a guest to Turing's Torch.", { id: "cnv-ai-form", workflow: "website_chat", metadata_json: "{}" });
  const responses = {
    commsHubTriage: { intent: "podcast_contribution", confidence: .96, urgency: .1, commercialValue: .2, reputationalRisk: .05, customerImpact: .1, rationale: "guest request" },
    commsHubModeration: { sentiment: "positive", abuseLabel: "none", confidence: .98, severity: 0, rationale: "safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "Visitor wants to contribute to the podcast.", unresolvedActions: [], sourceMessageIds: [convo.messages[0].id], nextAction: "Collect structured podcast details", followUpNeeded: false, followUpReason: "", followUpHours: 0 },
    commsHubDraftContact: { bodyText: "The podcast enquiry form is the best next step: https://form.jotform.com/262097861889073", evidenceSourceReferences: [] },
  };
  const service = new CommsHubAiWorkflowService({
    context: {
      config: {
        ...config(), aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8,
        aiAutoApprovalRiskThreshold: .2, aiApprovalPriorityScore: 60, smartContextEnabled: true,
        smartMaximumBookCandidates: 3, smartLiveContentEnabled: false, smartStrategyEnabled: true,
        smartConductEnabled: true, badLanguageBlockEnabled: true, conductReviewStrikeThreshold: 2,
        conductAutomationBlockThreshold: 2, aiComplexityModerationSeverity: .55,
      },
      repository: { async getConversation() { return convo; } },
      operationsRepository: { async getFormProcessing() { return null; } },
      aiRepository: { async beginAiRun() {}, async persistAnalysisBundle(bundle) { persisted = bundle; }, async failAiRun() {} },
      aiSearch: { async searchApproved() { return []; } },
    },
    aiRequest: async (routeName, options) => {
      captured.push({ routeName, options });
      return { content: JSON.stringify(responses[routeName]), providerId: "test", model: "test", routeKey: routeName };
    },
  });
  const result = await service.analyseConversation(convo.id, { scheduleFollowUp: false });
  const draftCall = captured.find((item) => item.routeName === "commsHubDraftContact");
  assert.equal(draftCall, undefined, "approved form handoffs should not require a model draft call");
  assert.equal(persisted.draft.provider, "aims-form-orchestration");
  assert.equal(persisted.draft.model, "deterministic-approved-jotform-v1");
  assert.match(persisted.draft.bodyText, /podcast enquiry form/i);
  assert.match(persisted.draft.bodyText, /https:\/\/form\.jotform\.com\/262097861889073/);
  assert.equal(result.responseIntelligence.formDecision.formKey, "podcast_enquiry");
  assert.equal(persisted.draft.metadata.smartLayers.formDecision.formKey, "podcast_enquiry");
});

test("Smart form processing can carry a verified low-risk submission through analysis to an explicit reply send", async () => {
  const transitions = [];
  const draftRecord = {
    id: "draft-form-1", conversation_id: "form-cnv", status: "draft", body_text: "Thanks for the detail. Here is the substantive next step.",
    evidence_ids_json: "[]", requires_approval: 0, metadata: {},
  };
  const context = {
    config: { formSmartProcessingEnabled: true, formAutoSendEnabled: false, aiEnabled: true },
    operationsRepository: {
      async getFormProcessing() { return { conversation_id: "form-cnv", status: "digest_ready", digest: { attachmentReviewRequired: false } }; },
      async getConversationOperations() { return { operational_status: "open" }; },
      async updateFormProcessing(input) { transitions.push(input.status); return { ...input, digest: { attachmentReviewRequired: false } }; },
    },
    aiWorkflowService: {
      async analyseConversation() {
        return { runId: "run-form-1", draft: { id: "draft-form-1", requiresApproval: false }, responseIntelligence: { autonomousEligible: true } };
      },
    },
    aiRepository: {
      async getDraft() { return draftRecord; },
      async markDraftSent() { return { ...draftRecord, status: "sent" }; },
    },
    repository: { async getConversation() { return { id: "form-cnv", channel: "form", workflow: "contact_intake", contact: { primary_email: "reader@example.com" } }; } },
    replyDelivery: { async send() { return { response: { providerMessageId: "processed-reply@example.com" } }; } },
  };
  const service = new CommsHubFormProcessingService({ context });
  const result = await service.processConversation("form-cnv", { autoSend: true });
  assert.equal(result.sent, true);
  assert.equal(result.status, "replied");
  assert.deepEqual(transitions, ["processing", "draft_ready", "replied"]);
});

test("Processed Jotform replies are delivered by email from the form conversation with channel idempotency", async () => {
  const calls = [];
  const context = {
    config: { emailEnabled: true, oneComEmailAddress: "info@jonathan-harris.online" },
    repository: { async getConversation() { return { id: "form-cnv", channel: "form", subject: "Podcast enquiry", contact: { primary_email: "guest@example.com" } }; } },
    operationsRepository: {
      async getConversationOperations() { return { operational_status: "open" }; },
      async claimChannelOutboundAction(input) { calls.push(["claim", input]); return { acquired: true }; },
      async recordOutboundMessage(input) { calls.push(["record", input]); },
      async completeChannelOutboundAction(input) { calls.push(["complete", input]); },
      async failChannelOutboundAction() { throw new Error("unexpected"); },
    },
    oneComMail: { async sendMessage(input) { calls.push(["send", input]); return { messageId: "msg@example.com" }; } },
  };
  const service = new CommsHubEmailService({ context });
  const result = await service.sendFormResponse({ conversationId: "form-cnv", bodyText: "Thanks. I have reviewed the details and need one clarification.", idempotencyKey: "form-reply:12345678" });
  assert.equal(result.providerMessageId, "msg@example.com");
  assert.equal(calls.find(([kind]) => kind === "send")[1].to[0], "guest@example.com");
  assert.equal(calls.find(([kind]) => kind === "claim")[1].channel, "form");
});

test("sendReplyDraft records a Jotform request only after the channel reply succeeds", async () => {
  const recorded = [];
  const decision = { selected: true, formKey: "case_study", formId: "262063136008044", formUrl: "https://form.jotform.com/262063136008044", label: "Case study contribution form", workflow: "case_study_intake", reason: "case_study_contribution_requires_structured_intake", required: true };
  const draft = { id: "draft-1", conversation_id: "cnv-1", status: "draft", body_text: `Please use ${decision.formUrl}`, evidence_ids_json: "[]", requires_approval: 0, metadata: { smartLayers: { formDecision: decision } } };
  const context = {
    config: { formRequestExpiryHours: 336 },
    aiRepository: {
      async getDraft() { return draft; },
      async markDraftSent({ metadata }) { recorded.push(["marked", metadata]); return { ...draft, status: "sent" }; },
    },
    repository: { async getConversation() { return { id: "cnv-1", channel: "chat", workflow: "website_chat", contact_id: "contact-1", contact: { primary_email: "reader@example.com" } }; } },
    replyDelivery: { async send() { recorded.push(["delivery"]); return { response: { ok: true } }; } },
    operationsRepository: {
      async getConversationOperations() { return { operational_status: "open" }; },
      async upsertFormRequestSent(request) { recorded.push(["formRequest", request]); return request; },
    },
  };
  const result = await sendReplyDraft({ draftId: "draft-1", context });
  assert.equal(result.formRequest.formId, "262063136008044");
  assert.deepEqual(recorded.map(([kind]) => kind), ["delivery", "marked", "formRequest"]);
});

test("autonomous replies are blocked when Smart Response Intelligence says the draft is not eligible", async () => {
  const context = {
    config: { autonomousRepliesEnabled: true },
    repository: { async getConversation() { return { id: "cnv-1", channel: "chat" }; } },
    aiRepository: {
      async getConversationAiState() { return { state: { intent: "general_enquiry", risk_score: 0, confidence: 1 }, runs: [{ metadata: { security: {}, responseIntelligence: { version: "smart-response/v1", autonomousEligible: false } } }], evidence: [{}] }; },
      async getDraft() { return { id: "d1", conversation_id: "cnv-1", requires_approval: 0 }; },
    },
  };
  const service = new CommsHubGovernanceService({ context });
  await assert.rejects(() => service.attemptAutonomousReply({ conversationId: "cnv-1", draftId: "d1" }), (error) => error.code === "autonomous_reply_response_intelligence_blocked");
});

test("config exposes the three exact smart-form URLs and keeps automatic form replies off by default", () => {
  const cfg = loadCommsHubConfig({
    COMMS_HUB_ENABLED: "false",
  });
  assert.equal(cfg.jotformForms.podcast_enquiry.url, "https://form.jotform.com/262097861889073");
  assert.equal(cfg.formOrchestrationEnabled, true);
  assert.equal(cfg.formSmartProcessingEnabled, true);
  assert.equal(cfg.formAutoSendEnabled, false);
});
