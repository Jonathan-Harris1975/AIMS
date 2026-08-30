import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { loadCommsHubConfig } from "../services/comms-hub/config.js";
import { ensureSocialPostContext } from "../services/comms-hub/socialPostContextService.js";
import { normaliseZernioEvent } from "../services/comms-hub/domain/zernioWebhook.js";
import { buildLiveContentContext } from "../services/comms-hub/liveContentAwarenessService.js";
import { classifyBrandGrounding } from "../services/comms-hub/brandGroundingService.js";
import { decideConversationJotform } from "../services/comms-hub/formOrchestrationService.js";
import { buildSmartResponseIntelligence } from "../services/comms-hub/smartResponseIntelligenceService.js";
import { deterministicFormHandoffDraft } from "../services/comms-hub/aiWorkflowService.js";
import { runInboundConversationAutomation } from "../services/comms-hub/inboundAutomationService.js";
import { CommsHubDelayedActionWorker } from "../services/comms-hub/workers/delayedActionWorker.js";
import { COMMS_HUB_REQUIRED_MIGRATIONS } from "../services/comms-hub/migrations/manifest.js";

function formsConfig() {
  return {
    smartResponseEnabled: true,
    smartResponseMinimumConfidence: 0.86,
    formOrchestrationEnabled: true,
    jotformForms: {
      contact: { formId: "260281179574362", key: "contact", label: "Contact form", workflow: "contact_intake", url: "https://form.jotform.com/260281179574362" },
      case_study: { formId: "262063136008044", key: "case_study", label: "Case study contribution form", workflow: "case_study_intake", url: "https://form.jotform.com/262063136008044" },
      podcast_enquiry: { formId: "262097861889073", key: "podcast_enquiry", label: "Podcast enquiry form", workflow: "podcast_enquiry_intake", url: "https://form.jotform.com/262097861889073" },
    },
  };
}

function message(body, metadata = {}) {
  return { id: "m1", direction: "inbound", subject: "Enquiry", body_text: body, received_at: "2026-08-29T20:00:00.000Z", metadata_json: JSON.stringify(metadata) };
}

test("AI-enabled channels default to active customer-facing automation", () => {
  const cfg = loadCommsHubConfig({
    COMMS_HUB_ENABLED: "false",
    COMMS_HUB_AI_ENABLED: "true",
    COMMS_HUB_EMAIL_ENABLED: "true",
  });
  assert.equal(cfg.autonomousRepliesEnabled, true);
  assert.equal(cfg.emailPollWorkerEnabled, true);
  assert.equal(cfg.emailWorkflowEvaluationEnabled, true);
  assert.equal(cfg.emailAccounts.info.workflowEvaluationEnabled, true);
  assert.equal(cfg.chatAiWorkflowEnabled, true);
  assert.equal(cfg.formAutoSendEnabled, true);
  assert.equal(cfg.socialMonitorOnly, false);
});

test("fresh social comments enrich missing source-post text before automation", async () => {
  let persisted = null;
  const conversation = {
    id: "cnv-comment",
    provider: "zernio",
    messages: [message("What do you mean by this?")],
    socialThread: {
      credential_family: "meta",
      platform: "instagram",
      thread_type: "comment",
      account_id: "acct-1",
      provider_post_id: "post-9",
      metadata_json: "{}",
    },
  };
  const result = await ensureSocialPostContext({
    conversation,
    context: {
      zernio: { meta: { async listCommentedPosts() { return { data: [{ id: "post-9", accountId: "acct-1", title: "Practical AI", content: "Start with one measurable workflow.", permalink: "https://instagram.com/p/9" }], pagination: { hasMore: false } }; } } },
      repository: { async mergeSocialPostContext(input) { persisted = input; } },
    },
  });
  assert.equal(result.required, true);
  assert.equal(result.available, true);
  assert.equal(result.enriched, true);
  assert.match(result.context.text, /measurable workflow/i);
  assert.equal(persisted.conversationId, "cnv-comment");
});

test("a social comment cannot be auto-answered blind when source-post context cannot be resolved", async () => {
  const result = await ensureSocialPostContext({
    conversation: {
      id: "cnv-comment-missing",
      provider: "zernio",
      messages: [message("What about this?")],
      socialThread: { credential_family: "video", platform: "youtube", thread_type: "comment", account_id: "acct-y", provider_post_id: "video-1", metadata_json: "{}" },
    },
    context: { zernio: { video: { async listCommentedPosts() { return { data: [], pagination: { hasMore: false } }; } } }, repository: {} },
  });
  assert.equal(result.required, true);
  assert.equal(result.available, false);
});

test("missing source-post context schedules a durable retry instead of silently abandoning the comment", async () => {
  let scheduled = null;
  let analysed = false;
  const conversation = {
    id: "cnv-comment-retry", provider: "zernio", channel: "social_comment", messages: [message("Can you explain this?")],
    socialThread: { credential_family: "video", platform: "youtube", thread_type: "comment", account_id: "acct-y", provider_post_id: "video-2", metadata_json: "{}" },
  };
  const result = await runInboundConversationAutomation({
    context: {
      config: { aiEnabled: true, autonomousRepliesEnabled: true },
      repository: { async getConversation() { return conversation; } },
      zernio: { video: { async listCommentedPosts() { return { data: [], pagination: { hasMore: false } }; } } },
      operationsRepository: {
        async getConversationOperations() { return {}; },
        async scheduleDelayedAction(action) { scheduled = action; return { id: action.id, ...action }; },
      },
      aiWorkflowService: { async analyseConversation() { analysed = true; return {}; } },
      governanceService: { async attemptAutonomousReply() { throw new Error("should not send"); } },
    },
    conversationId: conversation.id,
  });
  assert.equal(result.reason, "social_post_context_unavailable");
  assert.equal(result.retryScheduled, true);
  assert.equal(scheduled.actionType, "social_context_retry");
  assert.match(scheduled.idempotencyKey, /^social-context-retry:cnv-comment-retry:/);
  assert.equal(analysed, false);
});

test("the delayed social-context lane remains retryable until exact post context exists", async () => {
  const conversation = {
    id: "cnv-context-worker", provider: "zernio", channel: "social_comment", messages: [message("What does this mean?")],
    socialThread: { credential_family: "video", platform: "youtube", thread_type: "comment", account_id: "acct-y", provider_post_id: "video-3", metadata_json: "{}" },
  };
  const worker = new CommsHubDelayedActionWorker({ context: {
    config: { aiEnabled: true, autonomousRepliesEnabled: true },
    repository: { async getConversation() { return conversation; } },
    zernio: { video: { async listCommentedPosts() { return { data: [], pagination: { hasMore: false } }; } } },
    operationsRepository: { async getConversationOperations() { return {}; } },
    aiWorkflowService: { async analyseConversation() { throw new Error("should not analyse without source context"); } },
    governanceService: {},
  } });
  await assert.rejects(
    () => worker.execute({ action_type: "social_context_retry", conversation_id: conversation.id, payload_json: "{}" }),
    (error) => error?.code === "social_post_context_unavailable" && error?.failureClass === "temporary",
  );
});

test("post/story-originated DMs preserve exact source context for replies", async () => {
  const event = normaliseZernioEvent({
    family: "meta", eventId: "evt-dm", eventType: "message.received", platform: "instagram",
    receivedAt: "2026-08-29T20:00:00.000Z", payloadSha256: "abc",
    payload: {
      account: { accountId: "acct-1" },
      conversation: { id: "dm-1", platformConversationId: "dm-1", participantId: "u1" },
      message: {
        id: "msg-1", text: "Can you explain this?", sender: { id: "u1", name: "Reader" },
        metadata: { storyReply: true, postContext: { id: "story-8", title: "AI adoption", text: "Adopt AI by proving one useful workflow first.", permalink: "https://instagram.com/stories/8" } },
      },
    },
  }, { correlationId: "corr-dm", source: "webhook" });
  assert.match(event.metadata.postContext.text, /one useful workflow/i);

  const live = await buildLiveContentContext({
    id: event.conversationId,
    channel: "social_dm",
    provider: "zernio",
    messages: [message(event.bodyText, event.metadata)],
    socialThread: { platform: "instagram", thread_type: "dm", provider_post_id: null, metadata_json: "{}" },
  }, { editorialLedger: { events: [] }, zernioState: { quiz: { scheduled: [] } }, now: new Date("2026-08-29T20:00:00Z") });
  assert.equal(live.mode, "exact_social_post");
  assert.equal(live.exactPost.kind, "exact_social_story");
  assert.match(live.exactPost.text, /proving one useful workflow/i);
});

test("customer-facing email grounds website and podcast topics in the official site", () => {
  const grounding = classifyBrandGrounding({
    channel: "email",
    messages: [message("What is the podcast about and where is it on the website?")],
  }, { conversationalIntelligence: { enabled: true, family: "podcast_media", personalBrandLikely: false, resolvedQuery: "podcast website" } });
  assert.equal(grounding.required, true);
  assert.equal(grounding.sourceOfTruth, "official_website");
});

test("email/chat form routing distinguishes podcast participation from sponsorship and website support", () => {
  const config = formsConfig();
  const base = (body) => ({ id: "c1", channel: "email", messages: [message(body)] });
  const guest = decideConversationJotform({ conversation: base("I would like to appear as a guest on the podcast."), intent: { intent: "podcast_contribution", confidence: .96 }, summary: {}, config });
  const sponsor = decideConversationJotform({ conversation: base("We would like to discuss podcast sponsorship."), intent: { intent: "commercial_enquiry", confidence: .92 }, summary: {}, config });
  const website = decideConversationJotform({ conversation: base("I need to report a website issue."), intent: { intent: "support_request", confidence: .91 }, summary: {}, config });
  assert.equal(guest.formKey, "podcast_enquiry");
  assert.equal(sponsor.formKey, "contact");
  assert.equal(website.formKey, "contact");
});

test("approved form handoffs use the exact allow-listed URL without needing model generation", () => {
  const decision = decideConversationJotform({
    conversation: { id: "c-form-draft", channel: "email", messages: [message("I would like to appear as a guest on the podcast.")] },
    intent: { intent: "podcast_contribution", confidence: 0.7 },
    summary: {},
    config: formsConfig(),
  });
  const draft = deterministicFormHandoffDraft(decision);
  assert.ok(draft);
  assert.match(draft.bodyText, /podcast enquiry form/i);
  assert.match(draft.bodyText, /https:\/\/form\.jotform\.com\/262097861889073/);
  assert.deepEqual([...draft.evidenceSourceReferences], []);
  assert.equal(deterministicFormHandoffDraft({ ...decision, withholdUrl: true }), null);
});

test("an allow-listed form handoff is a deterministic autonomous delivery path", () => {
  const intelligence = buildSmartResponseIntelligence({
    conversation: { id: "c-form", channel: "email", messages: [message("We would like to sponsor the podcast.")] },
    intent: { intent: "commercial_enquiry", confidence: 0.61 },
    moderation: { severity: 0 },
    summary: { nextAction: "Collect sponsorship details", unresolvedActions: [] },
    evidence: [], smartContext: { memory: {} }, strategy: {}, conduct: {}, security: {},
    policy: { requiresEvidence: true }, config: formsConfig(),
  });
  assert.equal(intelligence.formDecision.formKey, "contact");
  assert.equal(intelligence.safeFormDeliveryEligible, true);
  assert.equal(intelligence.autonomousEligible, true);
});

test("migration 0020 is delivered and keeps all three customer-facing autonomous policies active", () => {
  assert.ok(COMMS_HUB_REQUIRED_MIGRATIONS.includes("0018_default_channel_automation"));
  assert.ok(COMMS_HUB_REQUIRED_MIGRATIONS.includes("0019_social_context_retry"));
  assert.equal(COMMS_HUB_REQUIRED_MIGRATIONS.at(-1), "0020_professional_autonomous_comms");
  const db = new DatabaseSync(":memory:");
  for (const key of COMMS_HUB_REQUIRED_MIGRATIONS) db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${key}.sql`, import.meta.url), "utf8"));
  const rows = db.prepare("SELECT policy_key, status FROM comms_hub_autonomous_reply_policies WHERE policy_key IN ('full-chat-low-risk','full-email-low-risk','full-social-low-risk') ORDER BY policy_key").all();
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.status === "active"));
  const delayedTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='comms_hub_delayed_actions'").get()?.sql || "";
  assert.match(delayedTableSql, /social_context_retry/);
});
