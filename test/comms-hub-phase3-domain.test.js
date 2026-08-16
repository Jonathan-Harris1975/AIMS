import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { loadCommsHubConfig, getCommsHubReadiness } from "../services/comms-hub/config.js";
import { CommsAiRepository } from "../services/comms-hub/repositories/commsAiRepository.js";
import { CommsHubAiWorkflowService } from "../services/comms-hub/aiWorkflowService.js";
import { AiSearchClient } from "../services/comms-hub/clients/aiSearchClient.js";
import { PodcastContributionWorkflowService } from "../services/comms-hub/podcastWorkflowService.js";
import { buildApprovalRequest, decideApproval, requireApproval } from "../services/comms-hub/approvalService.js";
import { executeSocialAction, requestSocialActionApproval } from "../services/comms-hub/socialActionsService.js";
import {
  calculatePriority,
  normaliseIntentResult,
  normalisePriorityOverride,
  parseStrictJson,
  policyForWorkflow,
  requiresHumanApproval,
} from "../services/comms-hub/domain/ai.js";

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const name of ["0001_comms_hub.sql", "0002_zernio_social.sql", "0003_ai_workflows.sql", "0004_hardening.sql"]) {
      this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}`, import.meta.url), "utf8"));
    }
  }
  async query(sql, params = []) { return { success: true, results: this.db.prepare(sql).all(...params) }; }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const results = statements.map(({ sql, params = [] }) => ({ success: true, results: this.db.prepare(sql).all(...params) }));
      this.db.exec("COMMIT");
      return results;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
}

function baseEnv() {
  return {
    COMMS_HUB_ENABLED: "true",
    D1_UUID: "11111111-1111-1111-1111-111111111111",
    D1_API_KEY: "d1-token",
    JOTFORM_API_KEY: "jotform-token",
    R2_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
    R2_ACCESS_KEY_ID: "r2-key",
    R2_SECRET_ACCESS_KEY: "r2-secret",
    R2_BUCKET_COMMS_HUB: "comms-hub",
    R2_PUBLIC_BASE_URL_COMMS_HUB: "https://receipts.example.com",
  };
}

function seedConversation(d1, { workflow = "podcast_enquiry_intake", channel = "form" } = {}) {
  const conversationId = "cnv_0123456789abcdefghjkmnpqrs";
  const contactId = "con_0123456789abcdefghjkmnpqrs";
  const messageId = "msg_0123456789abcdefghjkmnpqrs";
  const now = "2026-08-04T01:00:00.000Z";
  d1.db.prepare(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(contactId, "person@example.com", "Person", "", now, now);
  d1.db.prepare(`INSERT INTO comms_hub_conversations
    (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, metadata_json)
    VALUES (?, ?, 'jotform', ?, 'open', ?, 'Podcast contribution', 'jotform:262097861889073:sub-1', ?, ?, ?, '{}')`)
    .run(conversationId, channel, workflow, contactId, now, now, now);
  d1.db.prepare(`INSERT INTO comms_hub_messages
    (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html, provider_message_id, received_at, created_at, metadata_json)
    VALUES (?, ?, 'inbound', 'person@example.com', '[]', 'Podcast contribution', 'Here is my case study: https://example.com/source', NULL, 'jotform:message:1', ?, ?, '{}')`)
    .run(messageId, conversationId, now, now);
  return { conversationId, contactId, messageId, now };
}

function rowConversation(d1, conversationId, { channel = "form", workflow = "podcast_enquiry_intake", status = "open" } = {}) {
  return {
    id: conversationId,
    channel,
    provider: channel === "social" ? "zernio" : "jotform",
    workflow,
    status,
    subject: "Podcast contribution",
    messages: d1.db.prepare(`SELECT * FROM comms_hub_messages WHERE conversation_id = ?`).all(conversationId),
    attachments: [],
    socialThread: null,
  };
}

test("Phase 3 AI readiness is opt-in and requires approved AI Search configuration", () => {
  const normal = getCommsHubReadiness(baseEnv());
  assert.equal(normal.ready, true);
  const enabled = getCommsHubReadiness({ ...baseEnv(), COMMS_HUB_AI_ENABLED: "true" });
  assert.equal(enabled.ready, false);
  assert.deepEqual(enabled.missing.sort(), ["CLOUDFLARE_AI_SEARCH_API_TOKEN", "COMMS_HUB_AI_SEARCH_INSTANCES"].sort());
  const config = loadCommsHubConfig({
    ...baseEnv(),
    COMMS_HUB_AI_ENABLED: "true",
    CLOUDFLARE_AI_SEARCH_API_TOKEN: "search-token",
    COMMS_HUB_AI_SEARCH_INSTANCES: "hive, brand-assets, hive",
    COMMS_HUB_APPROVALS_ENFORCED: "false",
  }, { requireEnabled: true });
  assert.equal(config.aiEnabled, true);
  assert.equal(config.approvalsEnforced, true);
  assert.deepEqual(config.aiSearchApprovedInstances, ["hive", "brand-assets"]);
  assert.equal(config.followUpWorkerEnabled, false);
});

test("Follow-up worker configuration fails closed unless Phase 3 AI is enabled", () => {
  const readiness = getCommsHubReadiness({
    ...baseEnv(),
    COMMS_HUB_FOLLOW_UP_WORKER_ENABLED: "true",
  });
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.missing, ["COMMS_HUB_AI_ENABLED"]);
});

test("AI Search client accepts the current Cloudflare chunks and item metadata response shape", async () => {
  const requests = [];
  const client = new AiSearchClient({
    aiSearchApprovedInstances: ["hive"],
    cloudflareApiBaseUrl: "https://api.cloudflare.com/client/v4",
    cloudflareAccountId: "account-1",
    aiSearchApiToken: "token-1",
    aiSearchTimeoutMs: 20_000,
  }, {
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            success: true,
            result: {
              chunks: [{
                id: "chunk-1",
                score: 0.91,
                text: "Approved evidence",
                item: { key: "docs/source.md", metadata: { title: "Source title", owner: "HIVE" } },
              }],
            },
          };
        },
      };
    },
  });
  const result = await client.searchInstance("hive", "ground this", { maxResults: 4 });
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/ai-search\/instances\/hive\/search$/);
  assert.deepEqual(JSON.parse(requests[0].options.body).messages, [{ role: "user", content: "ground this" }]);
  assert.equal(result[0].sourceReference, "docs/source.md");
  assert.equal(result[0].title, "Source title");
  assert.equal(result[0].metadata.owner, "HIVE");
});

test("Intent scoring is deterministic and strict JSON rejects prose wrappers", () => {
  const result = normaliseIntentResult({
    intent: "complaint", confidence: 0.9, urgency: 0.8, customerImpact: 0.7,
    reputationalRisk: 0.6, commercialValue: 0.1, rationale: "Customer impact",
  });
  const priority = calculatePriority(result, { channel: "social" });
  assert.equal(priority.score, 77);
  assert.equal(priority.baseScore, 62);
  assert.equal(priority.label, "high");
  assert.deepEqual(priority.overrideReasons, ["complaint"]);
  assert.equal(priority.factors.urgency.contribution, 28);
  assert.deepEqual(parseStrictJson("```json\n{\"intent\":\"unknown\"}\n```"), { intent: "unknown" });
  assert.throws(() => parseStrictJson("The answer is unknown."), /valid JSON object/);
});

test("Each intake workflow selects its dedicated drafting route", () => {
  assert.equal(policyForWorkflow("contact_intake").modelRoute, "commsHubDraftContact");
  assert.equal(policyForWorkflow("case_study_intake").modelRoute, "commsHubDraftContribute");
  assert.equal(policyForWorkflow("podcast_enquiry_intake").modelRoute, "commsHubDraftPodcast");
  assert.equal(policyForWorkflow("social_inbox").modelRoute, "commsHubDraftSocial");
});

test("AI analysis bounds long conversation transcripts while preserving the newest messages", async () => {
  const d1 = new SqliteD1();
  const { conversationId } = seedConversation(d1);
  const now = "2026-08-04T01:00:00.000Z";
  const statement = d1.db.prepare(`INSERT INTO comms_hub_messages
    (id, conversation_id, direction, sender, recipients_json, subject, body_text, body_html, provider_message_id, received_at, created_at, metadata_json)
    VALUES (?, ?, 'inbound', 'person@example.com', '[]', 'Long thread', ?, NULL, ?, ?, ?, '{}')`);
  for (let index = 0; index < 120; index += 1) {
    const id = `msg_long_${String(index).padStart(3, "0")}`;
    statement.run(id, conversationId, `${index}:`.padEnd(12_000, "x"), `provider:${index}`, now, now);
  }
  const aiRepository = new CommsAiRepository(d1);
  let capturedTranscript = null;
  const responses = {
    commsHubTriage: { intent: "podcast_contribution", confidence: 0.9, urgency: 0.1, commercialValue: 0.1, reputationalRisk: 0.1, customerImpact: 0.1, rationale: "Contribution" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: 0.9, severity: 0, rationale: "Safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "A long contribution thread.", unresolvedActions: [], sourceMessageIds: [], nextAction: "Review", followUpNeeded: false },
    commsHubFollowUp: { bodyText: "Following up on the outstanding review step. The supplied material remains in the automated process.", evidenceSourceReferences: ["docs/podcast-process.md"] },
  };
  const context = {
    config: { aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: 0.2, aiApprovalPriorityScore: 60 },
    repository: { async getConversation() { return rowConversation(d1, conversationId); } },
    aiRepository,
    aiSearch: { async searchApproved() { return [{ indexId: "hive", sourceReference: "docs/podcast-process.md", excerpt: "Automated review process.", title: "Podcast process", score: 1, contentSha256: "ok", metadata: {} }]; } },
  };
  const service = new CommsHubAiWorkflowService({
    context,
    aiRequest: async (routeName, options) => {
      if (routeName === "commsHubTriage") {
        const content = options.messages[1].content;
        const match = content.match(/UNTRUSTED_DATA_JSON_START\n([\s\S]*?)\nUNTRUSTED_DATA_JSON_END/);
        capturedTranscript = JSON.parse(match ? match[1] : content).transcript;
      }
      return { content: JSON.stringify(responses[routeName]), providerId: "fake", model: "fake", routeKey: routeName };
    },
  });
  const result = await service.analyseConversation(conversationId, { operation: "follow_up", scheduleFollowUp: false });
  assert.ok(capturedTranscript.length <= 100);
  assert.ok(capturedTranscript.reduce((total, message) => total + message.body.length, 0) <= 80_000);
  assert.equal(capturedTranscript.at(-1).id, "msg_long_119");
  assert.equal(capturedTranscript.some((message) => message.id === "msg_0123456789abcdefghjkmnpqrs"), false);
  assert.equal(result.followUp, null);
});

test("Spam intent always requires human approval even when other risk signals are low", () => {
  const policy = requiresHumanApproval({
    intent: "spam",
    moderation: { severity: 0, riskLevel: "low" },
    priority: { score: 1 },
    policy: policyForWorkflow("social_inbox"),
    hasEvidence: true,
  });
  assert.equal(policy.required, true);
  assert.deepEqual(policy.reasons, ["spam_intent"]);
});

test("Approval middleware fails closed until a matching authorised decision exists", async () => {
  const d1 = new SqliteD1();
  const { conversationId } = seedConversation(d1);
  const repository = new CommsAiRepository(d1);
  const approval = buildApprovalRequest({
    conversationId,
    targetType: "reply_draft",
    targetId: "drf_0123456789abcdefghjkmnpqrs",
    actionType: "send_reply",
    payload: { bodyText: "Grounded reply", evidenceIds: ["evi_1"] },
    riskLevel: "high",
  });
  await repository.createApproval(approval);
  await assert.rejects(() => requireApproval({
    repository,
    approvalId: approval.id,
    conversationId,
    targetType: "reply_draft",
    targetId: approval.targetId,
    actionType: "send_reply",
    payload: { bodyText: "Grounded reply", evidenceIds: ["evi_1"] },
  }), (error) => error?.code === "approval_required");
  await decideApproval({ repository, approvalId: approval.id, decision: "approved", decidedBy: "reviewer@example.com", reason: "Checked sources" });
  const authorised = await requireApproval({
    repository,
    approvalId: approval.id,
    conversationId,
    targetType: "reply_draft",
    targetId: approval.targetId,
    actionType: "send_reply",
    payload: { bodyText: "Grounded reply", evidenceIds: ["evi_1"] },
  });
  assert.equal(authorised.status, "approved");
  await assert.rejects(() => requireApproval({
    repository,
    approvalId: approval.id,
    conversationId,
    targetType: "reply_draft",
    targetId: approval.targetId,
    actionType: "send_reply",
    payload: { bodyText: "Changed after approval", evidenceIds: ["evi_1"] },
  }), (error) => error?.code === "approval_required");
});

test("AI analysis persists intent, priority, evidence, summary, draft, approval and one follow-up", async () => {
  const d1 = new SqliteD1();
  const { conversationId, messageId } = seedConversation(d1);
  const aiRepository = new CommsAiRepository(d1);
  const repository = { async getConversation(id) { return id === conversationId ? rowConversation(d1, id) : null; } };
  const responses = {
    commsHubTriage: { intent: "podcast_contribution", confidence: 0.96, urgency: 0.8, commercialValue: 0.5, reputationalRisk: 0.7, customerImpact: 0.8, rationale: "Time-sensitive contribution" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: 0.99, severity: 0.1, rationale: "No abuse", recommendedAction: "reply" },
    commsHubSummary: { summary: "A podcast contribution includes a supporting URL.", unresolvedActions: ["Review the source"], sourceMessageIds: [messageId], nextAction: "Review evidence", followUpNeeded: true, followUpReason: "Review still pending", followUpHours: 72 },
    commsHubDraftPodcast: { bodyText: "Thank you for the contribution. We will review the supplied source through the automated podcast contribution process.", evidenceSourceReferences: ["https://docs.example.com/podcast-process"] },
    commsHubDraftComplex: { bodyText: "Thank you for the contribution. We will review the supplied source through the automated podcast contribution process.", evidenceSourceReferences: ["https://docs.example.com/podcast-process"] },
  };
  const requestedRoutes = [];
  const aiRequest = async (routeName) => {
    requestedRoutes.push(routeName);
    return ({
    content: JSON.stringify(responses[routeName]),
    providerId: `fake-${routeName}`,
    model: `model-${routeName}`,
    durationMs: 10,
    usage: null,
    routeKey: routeName,
  });
  };
  const context = {
    config: { aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: 0.2, aiApprovalPriorityScore: 60 },
    repository,
    aiRepository,
    aiSearch: {
      async searchApproved() {
        return [{
          indexId: "hive",
          sourceReference: "https://docs.example.com/podcast-process",
          title: "Podcast contribution process",
          excerpt: "Contributions are reviewed automatically before publication.",
          score: 0.94,
          contentSha256: "abc123",
          metadata: { approved: true },
        }];
      },
    },
  };
  const service = new CommsHubAiWorkflowService({ context, aiRequest });
  const result = await service.analyseConversation(conversationId);
  assert.equal(result.intent.intent, "podcast_contribution");
  assert.equal(result.priority.label, "high");
  assert.equal(result.draft.status, "pending_approval");
  assert.equal(result.approval.status, "pending");
  assert.ok(result.followUp?.dueAt);
  assert.equal(result.routing.selectedWorkflow, "podcast_enquiry_intake");
  assert.equal(result.routing.mismatch, false);
  assert.equal(result.queue.key, "priority_review");
  assert.equal(requestedRoutes.at(-1), "commsHubDraftComplex");
  assert.equal(result.complexity.complex, true);
  assert.ok(result.complexity.reasons.includes("high_priority"));

  const state = await aiRepository.getConversationAiState(conversationId);
  assert.equal(state.state.intent, "podcast_contribution");
  assert.equal(state.evidence.length, 1);
  assert.equal(state.drafts.length, 1);
  assert.equal(state.approvals.length, 1);
  assert.equal(state.followUps.length, 1);
  assert.equal(state.followUps[0].status, "scheduled");
  assert.deepEqual(state.state.source_links, ["https://example.com/source"]);

  const low = normalisePriorityOverride({ score: 20, reason: "Operator verified this is not urgent." });
  await aiRepository.overridePriority({
    id: "pro_0123456789abcdefghjkmnpqrs",
    conversationId,
    ...low,
    actor: "operator@example.com",
    createdAt: "2026-08-04T01:10:00.000Z",
  });
  let overridden = await aiRepository.getConversationAiState(conversationId);
  assert.equal(overridden.state.priority_score, 20);
  assert.equal(overridden.state.queue_key, "standard");
  assert.equal(overridden.state.escalation_required, 0);
  assert.equal(overridden.priorityOverrides.length, 1);

  const critical = normalisePriorityOverride({ score: 95, reason: "New reputational escalation confirmed." });
  await aiRepository.overridePriority({
    id: "pro_1123456789abcdefghjkmnpqrs",
    conversationId,
    ...critical,
    actor: "operator@example.com",
    createdAt: "2026-08-04T01:11:00.000Z",
  });
  overridden = await aiRepository.getConversationAiState(conversationId);
  assert.equal(overridden.state.queue_key, "priority_review");
  assert.equal(overridden.state.escalation_required, 1);
  assert.equal(overridden.priorityOverrides.length, 2);
  const queue = await aiRepository.listPriorityQueue();
  assert.equal(queue[0].id, conversationId);
  assert.equal(queue[0].priority_score, 95);
});

test("Intent routing uses the selected workflow policy and escalates a workflow mismatch", async () => {
  const d1 = new SqliteD1();
  const { conversationId, messageId } = seedConversation(d1, { workflow: "contact_intake" });
  const aiRepository = new CommsAiRepository(d1);
  const requestedRoutes = [];
  const responses = {
    commsHubTriage: { intent: "podcast_contribution", confidence: 0.98, urgency: 0.2, commercialValue: 0.2, reputationalRisk: 0.1, customerImpact: 0.2, rationale: "Podcast contribution" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: 0.99, severity: 0, rationale: "Safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "A podcast contribution was submitted.", unresolvedActions: ["Review source"], sourceMessageIds: [messageId], nextAction: "Review source", followUpNeeded: false },
    commsHubDraftComplex: { bodyText: "Thank you. We will review the supplied source through the automated podcast contribution process.", evidenceSourceReferences: ["https://docs.example.com/podcast-process"] },
  };
  const context = {
    config: { aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: 0.2, aiApprovalPriorityScore: 60 },
    repository: { async getConversation() { return rowConversation(d1, conversationId, { workflow: "contact_intake" }); } },
    aiRepository,
    aiSearch: { async searchApproved() { return [{ indexId: "hive", sourceReference: "https://docs.example.com/podcast-process", excerpt: "Automated review only.", title: "Podcast process", score: 1, contentSha256: "ok", metadata: {} }]; } },
  };
  const service = new CommsHubAiWorkflowService({
    context,
    aiRequest: async (routeName) => {
      requestedRoutes.push(routeName);
      return { content: JSON.stringify(responses[routeName]), providerId: "fake", model: "fake", routeKey: routeName };
    },
  });
  const result = await service.analyseConversation(conversationId);
  assert.equal(result.routing.selectedWorkflow, "podcast_enquiry_intake");
  assert.equal(result.routing.mismatch, true);
  assert.equal(result.queue.escalationRequired, true);
  assert.equal(result.approval.status, "pending");
  assert.equal(requestedRoutes.at(-1), "commsHubDraftComplex");
  assert.ok(result.complexity.reasons.includes("workflow_mismatch"));
  const state = await aiRepository.getConversationAiState(conversationId);
  assert.equal(state.state.selected_workflow, "podcast_enquiry_intake");
  assert.equal(state.state.workflow_mismatch, 1);
});

test("AI drafting rejects evidence references that were not returned by approved indexes", async () => {
  const d1 = new SqliteD1();
  const { conversationId, messageId } = seedConversation(d1);
  const aiRepository = new CommsAiRepository(d1);
  const responses = {
    commsHubTriage: { intent: "podcast_contribution", confidence: 0.9, urgency: 0.2, commercialValue: 0.2, reputationalRisk: 0.1, customerImpact: 0.2, rationale: "Contribution" },
    commsHubModeration: { sentiment: "neutral", abuseLabel: "none", confidence: 0.9, severity: 0.1, rationale: "Safe", recommendedAction: "reply" },
    commsHubSummary: { summary: "Contribution received.", unresolvedActions: [], sourceMessageIds: [messageId], nextAction: "Review", followUpNeeded: false },
    commsHubDraftPodcast: { bodyText: "This uses an invented source.", evidenceSourceReferences: ["https://invented.example.com"] },
  };
  const context = {
    config: { aiEnabled: true, approvalsEnforced: true, aiMaximumEvidence: 8, aiAutoApprovalRiskThreshold: 0.2, aiApprovalPriorityScore: 60 },
    repository: { async getConversation() { return rowConversation(d1, conversationId); } },
    aiRepository,
    aiSearch: { async searchApproved() { return [{ indexId: "hive", sourceReference: "https://approved.example.com", excerpt: "Approved", title: "Approved", score: 1, contentSha256: "ok", metadata: {} }]; } },
  };
  const service = new CommsHubAiWorkflowService({
    context,
    aiRequest: async (routeName) => ({ content: JSON.stringify(responses[routeName]), providerId: "fake", model: "fake", routeKey: routeName }),
  });
  await assert.rejects(() => service.analyseConversation(conversationId), (error) => error?.code === "reply_evidence_reference_invalid");
  const runs = d1.db.prepare(`SELECT status FROM comms_hub_ai_runs WHERE conversation_id = ?`).all(conversationId);
  assert.equal(runs[0].status, "failed");
});

test("High-risk social moderation requires a scope-matched approval before provider execution", async () => {
  const d1 = new SqliteD1();
  const { conversationId } = seedConversation(d1, { workflow: "social_comment_moderation", channel: "social" });
  const aiRepository = new CommsAiRepository(d1);
  let providerCalls = 0;
  const repository = {
    async getSocialThreadByConversation() { return { credential_family: "video", platform: "youtube", thread_type: "comment", account_id: "channel-1", provider_post_id: "video-1", root_comment_id: "comment-1" }; },
    async claimOutboundAction() { return { acquired: true, duplicate: false }; },
    async completeOutboundAction() {}, async failOutboundAction() {}, async setConversationStatus() {},
  };
  const context = {
    config: { aiEnabled: true, approvalsEnforced: true },
    repository,
    aiRepository,
    zernio: { video: { async moderateYouTubeComment() { providerCalls += 1; return { success: true }; } } },
  };
  const idempotencyKey = "moderate:youtube:approved:1";
  await assert.rejects(() => executeSocialAction({
    conversationId, action: "moderate", body: { moderationStatus: "rejected" }, idempotencyKey, context,
  }), (error) => error?.code === "approval_required");
  assert.equal(providerCalls, 0);

  const approval = await requestSocialActionApproval({
    conversationId,
    action: "moderate",
    body: { moderationStatus: "rejected" },
    idempotencyKey,
    requestedBy: "operator@example.com",
    context,
  });
  await decideApproval({ repository: aiRepository, approvalId: approval.id, decision: "approved", decidedBy: "reviewer@example.com" });
  const result = await executeSocialAction({
    conversationId,
    action: "moderate",
    body: { moderationStatus: "rejected", approvalId: approval.id },
    idempotencyKey,
    context,
  });
  assert.equal(result.duplicate, false);
  assert.equal(providerCalls, 1);
});

test("Unsupported moderation actions are quarantined and never reach the provider", async () => {
  const d1 = new SqliteD1();
  const { conversationId } = seedConversation(d1, { workflow: "social_comment_moderation", channel: "social" });
  const aiRepository = new CommsAiRepository(d1);
  let providerCalls = 0;
  const context = {
    config: { approvalsEnforced: true },
    aiRepository,
    repository: {
      async getSocialThreadByConversation() { return { credential_family: "meta", platform: "facebook", thread_type: "comment", account_id: "page-1", provider_post_id: "post-1", root_comment_id: "comment-1" }; },
      async claimOutboundAction() { return { acquired: true, duplicate: false }; },
      async completeOutboundAction() {},
      async failOutboundAction() {},
      async setConversationStatus() {},
    },
    zernio: { meta: { async deleteComment() { providerCalls += 1; } } },
  };
  await assert.rejects(() => executeSocialAction({
    conversationId, action: "block", body: {}, idempotencyKey: "block:facebook:unsupported:1", context,
  }), (error) => error?.code === "moderation_capability_unsupported");
  assert.equal(providerCalls, 0);
  const audit = d1.db.prepare("SELECT * FROM comms_hub_moderation_actions WHERE idempotency_key = ?").get("block:facebook:unsupported:1");
  assert.equal(audit.status, "quarantined");
  assert.equal(audit.failure_class, "permanent");
});

test("Podcast contribution workflow is resumable and never offers a guest booking path", async () => {
  const d1 = new SqliteD1();
  const { conversationId } = seedConversation(d1);
  const context = {
    repository: { async getConversation() { return rowConversation(d1, conversationId); } },
    aiRepository: new CommsAiRepository(d1),
  };
  const service = new PodcastContributionWorkflowService({ context });
  const started = await service.start(conversationId);
  assert.equal(started.state, "received");
  const precheck = await service.advance({ conversationId, action: "precheck", idempotencyKey: "podcast:precheck:1", data: {} });
  assert.equal(precheck.run.state, "precheck_complete");
  const review = await service.advance({ conversationId, action: "submit_for_review", idempotencyKey: "podcast:review:1", data: {} });
  assert.equal(review.run.state, "awaiting_review");
  const data = JSON.parse(review.run.data_json);
  assert.equal(data.guestBookingOffered, false);
  await assert.rejects(() => service.advance({ conversationId, action: "book_guest", idempotencyKey: "podcast:guest:1", data: {} }), /not valid/);
  const duplicate = await service.advance({ conversationId, action: "submit_for_review", idempotencyKey: "podcast:review:1", data: {} });
  assert.equal(duplicate.duplicate, true);
});
