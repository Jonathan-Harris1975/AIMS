import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { isSocialChannel, isSocialCommentChannel, isSocialDmChannel } from "../services/comms-hub/domain/channels.js";
import { conversationReplyState } from "../services/comms-hub/domain/replySafety.js";
import { calculatePriority, policyForWorkflow, selectWorkflow } from "../services/comms-hub/domain/ai.js";
import { buildSmartConversationContext } from "../services/comms-hub/smartContextService.js";
import { buildFormRequestRecord, decideConversationJotform } from "../services/comms-hub/formOrchestrationService.js";
import { CommsHubEmailService } from "../services/comms-hub/emailService.js";
import { CommsHubAttachmentService } from "../services/comms-hub/attachmentService.js";
import { CommsOperationsRepository } from "../services/comms-hub/repositories/commsOperationsRepository.js";
import { sendReplyDraft } from "../services/comms-hub/replyDraftService.js";
import { executeSocialAction } from "../services/comms-hub/socialActionsService.js";
import { CommsHubReplyDeliveryService } from "../services/comms-hub/replyDeliveryService.js";
import { CommsHubDelayedActionWorker } from "../services/comms-hub/workers/delayedActionWorker.js";
import { ingestSocialAttachments } from "../services/comms-hub/socialService.js";

class SqliteD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
    for (const name of [
      "0001_comms_hub.sql",
      "0002_zernio_social.sql",
      "0003_ai_workflows.sql",
      "0004_hardening.sql",
      "0005_operations_and_channels.sql",
      "0006_smart_response_forms.sql",
      "0007_business_hours_and_handoff.sql",
    ]) this.db.exec(readFileSync(new URL(`../services/comms-hub/migrations/${name}`, import.meta.url), "utf8"));
  }
  async query(sql, params = []) { return { success: true, results: this.db.prepare(sql).all(...params) }; }
  async batch(statements) { return statements.map(({ sql, params = [] }) => ({ success: true, results: this.db.prepare(sql).all(...params) })); }
}

function message(id, body) {
  return { id, direction: "inbound", subject: "", body_text: body, received_at: "2026-08-16T16:00:00.000Z" };
}

const formConfig = {
  formOrchestrationEnabled: true,
  jotformForms: {
    contact: { formId: "contact-1", url: "https://form.jotform.com/contact-1", label: "Contact form", workflow: "contact_intake" },
    case_study: { formId: "case-1", url: "https://form.jotform.com/case-1", label: "Case Study form", workflow: "case_study_intake" },
    podcast_enquiry: { formId: "podcast-1", url: "https://form.jotform.com/podcast-1", label: "Podcast Enquiry form", workflow: "podcast_enquiry_intake" },
  },
};

test("runtime channel taxonomy covers persisted social DM/comment values", () => {
  assert.equal(isSocialChannel("social_dm"), true);
  assert.equal(isSocialChannel("social_comment"), true);
  assert.equal(isSocialDmChannel("social_dm"), true);
  assert.equal(isSocialCommentChannel("social_comment"), true);

  const dm = selectWorkflow({ intent: "commercial_enquiry", channel: "social_dm", currentWorkflow: "social_inbox" });
  const comment = selectWorkflow({ intent: "complaint", channel: "social_comment", currentWorkflow: "social_comment_moderation" });
  assert.deepEqual({ selected: dm.selectedWorkflow, mismatch: dm.mismatch }, { selected: "social_inbox", mismatch: false });
  assert.deepEqual({ selected: comment.selectedWorkflow, mismatch: comment.mismatch }, { selected: "social_comment_moderation", mismatch: false });

  const publicPriority = calculatePriority({ intent: "complaint", urgency: 0, customerImpact: 0, reputationalRisk: 0.8, commercialValue: 0 }, { workflow: "social_comment_moderation", channel: "social_comment" });
  assert.ok(publicPriority.overrideReasons.includes("public_reputation"));
});

test("chat and email preserve their operational workflows and have reply policies", () => {
  const chat = selectWorkflow({ intent: "podcast_contribution", channel: "chat", currentWorkflow: "website_chat" });
  const email = selectWorkflow({ intent: "unknown", channel: "email", currentWorkflow: "email_inbox" });
  assert.equal(chat.selectedWorkflow, "website_chat");
  assert.equal(chat.mismatch, false);
  assert.equal(email.selectedWorkflow, "email_inbox");
  assert.equal(email.mismatch, false);
  assert.equal(policyForWorkflow("website_chat").modelRoute, "commsHubDraftContact");
  assert.equal(policyForWorkflow("email_inbox").modelRoute, "commsHubDraftContact");
});

test("smart context recognises persisted social comment and DM channels", () => {
  const comment = buildSmartConversationContext({
    id: "c1", channel: "social_comment", workflow: "social_comment_moderation", messages: [message("m1", "What do you mean by this post?")],
    socialThread: { platform: "instagram", thread_type: "comment" },
  }, { now: new Date("2026-08-16T16:00:00Z"), maximumBooks: 1 });
  const dm = buildSmartConversationContext({
    id: "c2", channel: "social_dm", workflow: "social_inbox", messages: [message("m2", "Can you help me?")],
    socialThread: { platform: "facebook", thread_type: "dm" },
  }, { now: new Date("2026-08-16T16:00:00Z"), maximumBooks: 1 });
  assert.equal(comment.engagementMode, "public_content_discussion");
  assert.equal(dm.engagementMode, "social_conversation");
});

test("AI draft delivery sends persisted social_dm via social action adapter", async () => {
  let providerMessage = "";
  let markedSent = false;
  const context = {
    config: { socialMonitorOnly: false, badLanguageBlockEnabled: true, aiEnabled: false, approvalsEnforced: true },
    aiRepository: {
      async getDraft() { return { id: "draft-1", conversation_id: "cnv-1", status: "ready", body_text: "Thanks for getting in touch.", body_html: null, subject: "", evidence_ids_json: "[]", metadata_json: "{}", requires_approval: 0 }; },
      async markDraftSent({ id }) { markedSent = id === "draft-1"; return { id, status: "sent" }; },
    },
    repository: {
      async getConversation() { return { id: "cnv-1", channel: "social_dm", workflow: "social_inbox" }; },
      async getSocialThreadByConversation() { return { conversation_id: "cnv-1", credential_family: "meta", platform: "facebook", thread_type: "dm", account_id: "acct", provider_thread_id: "thread-1", provider_post_id: null, root_comment_id: null }; },
      async claimOutboundAction() { return { acquired: true, duplicate: false }; },
      async completeOutboundAction() {},
      async failOutboundAction() {},
    },
    operationsRepository: { async getConversationOperations() { return { operational_status: "open" }; } },
    zernio: { meta: { async sendMessage(input) { providerMessage = input.message; return { id: "provider-1" }; } } },
  };
  const result = await sendReplyDraft({ draftId: "draft-1", context });
  assert.equal(result.duplicate, false);
  assert.equal(providerMessage, "Thanks for getting in touch.");
  assert.equal(markedSent, true);
});

test("manual email replies block bad language and arbitrary recipients by default", async () => {
  let sendCalled = false;
  const context = {
    config: { emailEnabled: true, badLanguageBlockEnabled: true, emailExternalRecipientsEnabled: false, emailMaxReplyChars: 20_000 },
    repository: { async getConversation() { return { id: "email-1", channel: "email", subject: "Hello", contact: { primary_email: "person@example.com" } }; } },
    operationsRepository: { async getConversationWorkspace() { return { operations: { operational_status: "open" }, emailThread: null }; } },
    oneComMail: { async sendMessage() { sendCalled = true; return { messageId: "x" }; } },
  };
  const service = new CommsHubEmailService({ context });
  await assert.rejects(() => service.send({ conversationId: "email-1", bodyText: "You are a fucking idiot", idempotencyKey: "email-test-1" }), (error) => error?.code === "email_reply_language_policy_rejected");
  await assert.rejects(() => service.send({ conversationId: "email-1", bodyText: "Normal reply", recipients: ["other@example.com"], idempotencyKey: "email-test-2" }), (error) => error?.code === "email_external_recipient_blocked");
  assert.equal(sendCalled, false);
});

test("manual social replies block bad language before provider send", async () => {
  let sendCalled = false;
  const context = {
    config: { socialMonitorOnly: false, badLanguageBlockEnabled: true, aiEnabled: false, approvalsEnforced: true },
    repository: {
      async getConversation() { return { id: "cnv-1", channel: "social_dm", status: "open" }; },
      async getSocialThreadByConversation() { return { conversation_id: "cnv-1", credential_family: "meta", platform: "facebook", thread_type: "dm", account_id: "acct", provider_thread_id: "thread-1", provider_post_id: null, root_comment_id: null }; },
      async claimOutboundAction() { return { acquired: true, duplicate: false }; },
      async failOutboundAction() {},
    },
    operationsRepository: { async getConversationOperations() { return { operational_status: "open" }; } },
    zernio: { meta: { async sendMessage() { sendCalled = true; return { id: "provider-1" }; } } },
  };
  await assert.rejects(() => executeSocialAction({ conversationId: "cnv-1", action: "reply", body: { message: "fuck off" }, idempotencyKey: "social-test-1", context }), (error) => error?.code === "social_reply_language_policy_rejected");
  assert.equal(sendCalled, false);
});

test("form request cycles are idempotent per draft but allow a later genuine cycle", () => {
  const conversation = { id: "cnv-form-source", contact_id: "contact-1", channel: "chat", workflow: "website_chat" };
  const decision = { selected: true, formKey: "podcast_enquiry", formId: "podcast-1", formUrl: "https://form.jotform.com/podcast-1", reason: "podcast", required: true };
  const first = buildFormRequestRecord({ conversation, draftId: "draft-1", decision, sentAt: "2026-08-16T16:00:00Z" });
  const retry = buildFormRequestRecord({ conversation, draftId: "draft-1", decision, sentAt: "2026-08-16T16:01:00Z" });
  const later = buildFormRequestRecord({ conversation, draftId: "draft-2", decision, sentAt: "2026-09-16T16:00:00Z" });
  assert.equal(first.id, retry.id);
  assert.notEqual(first.id, later.id);
});

test("old completed form intent does not resurrect unless the latest conversation asks again", () => {
  const base = {
    id: "cnv-old-form", channel: "chat", workflow: "website_chat",
    messages: [message("m1", "I want to be a guest on the podcast."), message("m2", "Thanks, that's all sorted. What books cover AI in railways?")],
  };
  const formRequests = [{ form_key: "podcast_enquiry", status: "replied", replied_at: "2026-08-15T12:00:00Z" }];
  const stale = decideConversationJotform({ conversation: base, intent: { intent: "podcast_contribution" }, summary: {}, formRequests, config: formConfig });
  assert.equal(stale.selected, false);

  const again = decideConversationJotform({ conversation: { ...base, messages: [...base.messages, message("m3", "I'd like to apply to be on the podcast again.")] }, intent: { intent: "podcast_contribution" }, summary: {}, formRequests, config: formConfig });
  assert.equal(again.selected, true);
  assert.equal(again.formKey, "podcast_enquiry");
});

test("returned Jotform matches only a source contact with a verified email alias", async () => {
  const d1 = new SqliteD1();
  const repo = new CommsOperationsRepository(d1);
  const now = "2026-08-16T16:00:00.000Z";
  d1.db.prepare(`INSERT INTO comms_hub_contacts (id, primary_email, display_name, phone, created_at, updated_at) VALUES ('contact-1','person@example.com','Person','',?,?)`).run(now, now);
  d1.db.prepare(`INSERT INTO comms_hub_conversations (id, channel, provider, workflow, status, contact_id, subject, source_reference, created_at, updated_at, last_message_at, metadata_json) VALUES ('source-1','chat','coginpal','website_chat','open','contact-1','Chat','s1',?,?,?,'{}')`).run(now, now, now);
  await repo.upsertFormRequestSent({ id: "fr-1", sourceConversationId: "source-1", sourceContactId: "contact-1", formKey: "contact", formId: "form-1", formUrl: "https://form.jotform.com/form-1", reason: "test", sentViaChannel: "chat", sentDraftId: "draft-1", sentAt: now, expiresAt: "2026-08-20T16:00:00.000Z", metadata: {} });

  const noAlias = await repo.matchPendingFormRequestForSubmission({ formId: "form-1", email: "person@example.com", submissionConversationId: "submission-1", submissionId: "sub-1", submittedAt: "2026-08-16T17:00:00.000Z" });
  assert.equal(noAlias, null);

  await repo.addContactAlias({ id: "alias-1", contactId: "contact-1", type: "email", value: "person@example.com", provider: "one.com", confidence: 1, verified: true, createdAt: now, metadata: {} });
  const matched = await repo.matchPendingFormRequestForSubmission({ formId: "form-1", email: "person@example.com", submissionConversationId: "submission-1", submissionId: "sub-1", submittedAt: "2026-08-16T17:00:00.000Z" });
  assert.equal(matched?.id, "fr-1");
  assert.equal(matched?.match_method, "verified_email_and_form");
});

test("attachment downloader rejects local/private targets and validates redirects", async () => {
  let fetchCalls = 0;
  const context = { config: { attachmentDownloadTimeoutMs: 5_000, attachmentMaxBytes: 1_000_000 } };
  const service = new CommsHubAttachmentService({
    context,
    lookupImpl: async (hostname) => hostname === "cdn.example.com" ? [{ address: "93.184.216.34", family: 4 }] : [{ address: "127.0.0.1", family: 4 }],
    fetchImpl: async (url) => {
      fetchCalls += 1;
      if (String(url).includes("redirect")) return new Response(null, { status: 302, headers: { location: "https://127.0.0.1/private" } });
      return new Response("safe", { status: 200, headers: { "content-type": "text/plain", "content-length": "4" } });
    },
  });
  await assert.rejects(() => service.download("https://127.0.0.1/secret"), (error) => error?.code === "attachment_url_private_target");
  await assert.rejects(() => service.download("https://cdn.example.com/redirect"), (error) => error?.code === "attachment_url_private_target");
  const safe = await service.download("https://cdn.example.com/file.txt");
  assert.equal(safe.buffer.toString(), "safe");
  assert.equal(fetchCalls, 2);
});


test("generic reply delivery supports persisted social channels for delayed/replay paths", async () => {
  let message = "";
  const context = {
    config: { socialMonitorOnly: false, badLanguageBlockEnabled: true, aiEnabled: false, approvalsEnforced: true },
    repository: {
      async getConversation() { return { id: "cnv-2", channel: "social_dm", status: "open" }; },
      async getSocialThreadByConversation() { return { conversation_id: "cnv-2", credential_family: "meta", platform: "instagram", thread_type: "dm", account_id: "acct", provider_thread_id: "thread-2", provider_post_id: null, root_comment_id: null }; },
      async claimOutboundAction() { return { acquired: true, duplicate: false }; },
      async completeOutboundAction() {},
      async failOutboundAction() {},
    },
    operationsRepository: { async getConversationOperations() { return { operational_status: "open" }; } },
    zernio: { meta: { async sendMessage(input) { message = input.message; return { id: "provider-2" }; } } },
  };
  const delivery = new CommsHubReplyDeliveryService({ context });
  await delivery.send({ conversation: { id: "cnv-2", channel: "social_dm" }, draft: { body_text: "Delayed hello" }, idempotencyKey: "delay-social-1" });
  assert.equal(message, "Delayed hello");
});

test("reply state blocks resolved, snoozed, archived, blocked and quarantined conversations", () => {
  for (const status of ["resolved", "snoozed", "archived", "blocked", "quarantined"]) {
    const state = conversationReplyState({ conversation: { status: "open" }, operations: { operational_status: status } });
    assert.equal(state.allowed, false, status);
  }
  assert.equal(conversationReplyState({ conversation: { status: "closed" }, operations: { operational_status: "open" } }).allowed, false);
  assert.equal(conversationReplyState({ conversation: { status: "open" }, operations: { operational_status: "escalated" } }).allowed, true);
  assert.equal(conversationReplyState({ conversation: { status: "open" }, operations: { operational_status: "pending" } }).allowed, true);
});

test("manual email reply refuses a resolved conversation before SMTP", async () => {
  let sent = false;
  const context = {
    config: { emailEnabled: true, badLanguageBlockEnabled: true, emailExternalRecipientsEnabled: false, emailMaxReplyChars: 20_000 },
    repository: { async getConversation() { return { id: "email-resolved", channel: "email", status: "open", subject: "Hello", contact: { primary_email: "person@example.com" } }; } },
    operationsRepository: { async getConversationWorkspace() { return { operations: { operational_status: "resolved" }, emailThread: null }; } },
    oneComMail: { async sendMessage() { sent = true; return { messageId: "never" }; } },
  };
  const service = new CommsHubEmailService({ context });
  await assert.rejects(() => service.send({ conversationId: "email-resolved", bodyText: "A normal reply", idempotencyKey: "email-resolved-1" }), (error) => error?.code === "conversation_reply_blocked");
  assert.equal(sent, false);
});

test("manual social reply refuses an archived conversation before provider claim", async () => {
  let claimed = false;
  let providerCalled = false;
  const context = {
    config: { socialMonitorOnly: false, badLanguageBlockEnabled: true },
    repository: {
      async getConversation() { return { id: "social-archived", channel: "social_dm", status: "open" }; },
      async getSocialThreadByConversation() { return { conversation_id: "social-archived", credential_family: "meta", platform: "facebook", thread_type: "dm", account_id: "acct", provider_thread_id: "thread", provider_post_id: null, root_comment_id: null }; },
      async claimOutboundAction() { claimed = true; return { acquired: true, duplicate: false }; },
    },
    operationsRepository: { async getConversationOperations() { return { operational_status: "archived" }; } },
    zernio: { meta: { async sendMessage() { providerCalled = true; return { id: "never" }; } } },
  };
  await assert.rejects(() => executeSocialAction({ conversationId: "social-archived", action: "reply", body: { message: "Hello" }, idempotencyKey: "social-archived-1", context }), (error) => error?.code === "conversation_reply_blocked");
  assert.equal(claimed, false);
  assert.equal(providerCalled, false);
});

test("social attachments ingest in background path without requiring the delayed-action worker", async () => {
  let ingested = null;
  const event = {
    family: "meta", platform: "facebook", threadType: "dm", conversationId: "social-1", contactId: "contact-1", messageId: "message-1",
    attachments: [{ id: "a1", url: "https://cdn.example.com/file.pdf", name: "file.pdf" }],
  };
  const context = {
    operationsRepository: { async getAttachmentObject() { return null; } },
    repository: { async markAttachmentStatus() {} },
    attachmentService: { async ingestReference(input) { ingested = input; return { scan_status: "clean" }; } },
  };
  await ingestSocialAttachments(event, context);
  assert.equal(ingested.attachmentId, "message-1:a1");
  assert.equal(ingested.metadata.channel, "social_dm");
  assert.equal(ingested.metadata.platform, "facebook");
});

test("delayed attachment recovery skips an attachment already promoted clean", async () => {
  let ingestCalled = false;
  const worker = new CommsHubDelayedActionWorker({ context: {
    config: {},
    operationsRepository: { async getAttachmentObject() { return { scan_status: "clean", deleted_at: null }; } },
    attachmentService: { async ingestReference() { ingestCalled = true; } },
  } });
  const result = await worker.execute({ action_type: "attachment_ingest", payload_json: JSON.stringify({ attachmentId: "att-1", providerUrl: "https://cdn.example.com/a" }) });
  assert.equal(result.duplicate, true);
  assert.equal(ingestCalled, false);
});


test("generic social saved replies and policies cover persisted DM/comment channels", async () => {
  const d1 = new SqliteD1();
  const repo = new CommsOperationsRepository(d1);
  const now = "2026-08-16T16:00:00.000Z";
  await repo.upsertSavedReply({ id: "srp-1", key: "hello-social", label: "Hello", channel: "social", bodyTemplate: "Hello {{name}}", variables: ["name"], actor: "admin", at: now });
  assert.equal((await repo.listSavedReplies({ channel: "social_dm" })).length, 1);
  assert.equal((await repo.listSavedReplies({ channel: "social_comment" })).length, 1);

  await repo.upsertAutonomousPolicy({ id: "arp-1", key: "social-safe", channel: "social", intent: "general_enquiry", maximumRisk: 0.1, minimumConfidence: 0.99, requireEvidence: true, allowedHours: {}, maximumPerHour: 1, status: "active", actor: "admin", approvedBy: "admin", createdAt: now });
  assert.equal((await repo.findAutonomousPolicy({ channel: "social_dm", intent: "general_enquiry" }))?.policy_key, "social-safe");

  const sla = await d1.query(`INSERT INTO comms_hub_sla_policies (id,policy_key,channel,priority_label,first_response_minutes,resolution_minutes,business_hours_json,active,created_by,created_at,updated_at) VALUES ('sla-1','social-standard','social','normal',60,1440,'{}',1,'admin',?,?) RETURNING *`, [now, now]);
  assert.equal(sla.results.length, 1);
  assert.equal((await repo.findSlaPolicy({ channel: "social_comment", priorityLabel: "normal" }))?.policy_key, "social-standard");
});
