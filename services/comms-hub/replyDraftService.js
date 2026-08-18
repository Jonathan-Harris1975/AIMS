import { CommsHubError } from "./errors.js";
import { requireApproval } from "./approvalService.js";
import { executeSocialAction } from "./socialActionsService.js";
import { buildFormRequestRecord } from "./formOrchestrationService.js";
import { isSocialChannel } from "./domain/channels.js";
import { assertConversationReplyAllowed } from "./domain/replySafety.js";
import { businessHoursPolicy, conversationFirstInboundAt, delayedBusinessReplyAt, ensureFutureBusinessTime, hasOutboundMessages } from "./domain/businessHours.js";
import { resolveConversationAutomationExclusion } from "./domain/automationScope.js";

function parseArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseObject(value) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }

export async function sendReplyDraft({ draftId, context, scheduledDelivery = false }) {
  const draft = await context.aiRepository.getDraft(draftId);
  if (!draft) throw new CommsHubError(404, "reply_draft_not_found", "Reply draft was not found.");
  if (draft.status === "sent") return { duplicate: true, draft };
  if (["rejected", "quarantined", "pending_approval"].includes(draft.status)) {
    throw new CommsHubError(409, "reply_draft_not_sendable", `Reply draft is ${draft.status}.`, {
      publicMessage: "Reply draft is not ready to send.",
    });
  }
  const evidenceIds = parseArray(draft.evidence_ids_json);
  const draftMetadata = draft.metadata || parseObject(draft.metadata_json);
  if (draftMetadata?.security?.promptInjectionDetected && Number(draft.requires_approval) !== 1) {
    throw new CommsHubError(409, "reply_draft_security_approval_required", "A security-flagged AI draft cannot be sent without a scope-matched human approval.", {
      publicMessage: "This reply requires security review before it can be sent.",
    });
  }
  if (Number(draft.requires_approval) === 1) {
    await requireApproval({
      repository: context.aiRepository,
      approvalId: draft.approval_id,
      conversationId: draft.conversation_id,
      targetType: "reply_draft",
      targetId: draft.id,
      actionType: "send_reply",
      payload: { bodyText: draft.body_text, evidenceIds },
    });
  }
  const conversation = await context.repository.getConversation(draft.conversation_id);
  if (!conversation) throw new CommsHubError(404, "conversation_not_found", "Conversation was not found.");
  const automationExclusion = await resolveConversationAutomationExclusion(context, conversation);
  if (automationExclusion) {
    throw new CommsHubError(409, "conversation_automation_excluded", `Email account ${automationExclusion.accountKey} is outside Comms Hub automation.`, {
      failureClass: "permanent",
      publicMessage: "This conversation belongs to a mailbox that is intentionally outside AIMS automation.",
    });
  }
  const operations = await context.operationsRepository.getConversationOperations(conversation.id);
  assertConversationReplyAllowed({ conversation, operations });

  const shouldDelayInitialEmail = !scheduledDelivery && conversation.channel === 'email' && context.config?.emailInitialReplyDelayEnabled && !hasOutboundMessages(conversation);
  const shouldDelayFormReply = !scheduledDelivery && conversation.channel === 'form' && context.config?.formReplyDelayEnabled && !hasOutboundMessages(conversation);
  if (shouldDelayInitialEmail || shouldDelayFormReply) {
    const policy = businessHoursPolicy(context.config);
    const targetDueAt = delayedBusinessReplyAt({
      receivedAt: conversationFirstInboundAt(conversation),
      seed: `${conversation.id}:${conversation.channel === 'form' ? 'jotform-processed-reply' : 'initial-email-reply'}`,
      ...policy,
      minimumDays: context.config.replyDelayMinDays,
      maximumDays: context.config.replyDelayMaxDays,
    });
    const dueAt = ensureFutureBusinessTime(targetDueAt, policy).toISOString();
    const delayed = await context.workflowEngineService.schedule({
      conversationId: conversation.id,
      actionType: 'reply_draft',
      dueAt,
      payload: { draftId: draft.id },
      idempotencyKey: `business-reply-draft:${draft.id}`,
      maxAttempts: 8,
    }, { actor: 'business-reply-scheduler', role: 'admin' });
    return { duplicate: false, scheduled: true, dueAt: delayed?.due_at || dueAt, delayedActionId: delayed?.id || null, draft };
  }

  let delivery;
  if (isSocialChannel(conversation.channel)) {
    delivery = await executeSocialAction({
      conversationId: conversation.id,
      action: "reply",
      body: { message: draft.body_text },
      idempotencyKey: `ai-draft:${draft.id}`,
      context,
    });
  } else if (context.replyDelivery?.send) {
    delivery = await context.replyDelivery.send({ conversation, draft, idempotencyKey: `ai-draft:${draft.id}`, scheduledDelivery });
  } else {
    throw new CommsHubError(501, "reply_delivery_adapter_unavailable", "No delivery adapter is configured for this conversation channel.", {
      failureClass: "permanent",
      publicMessage: "This reply is drafted but its channel delivery adapter is not configured.",
    });
  }

  const sentAt = new Date().toISOString();
  const sent = await context.aiRepository.markDraftSent({
    id: draft.id,
    sentAt,
    metadata: { ...draftMetadata, delivery: delivery?.response || delivery || {}, evidenceIds },
  });
  const formDecision = draftMetadata?.smartLayers?.formDecision || null;
  let formRequest = null;
  if (formDecision?.selected && !formDecision?.withholdUrl && conversation.channel !== "form" && context.operationsRepository?.upsertFormRequestSent) {
    const request = buildFormRequestRecord({
      conversation,
      draftId: draft.id,
      decision: formDecision,
      sentAt,
      expiryHours: context.config?.formRequestExpiryHours || 336,
    });
    if (request) formRequest = await context.operationsRepository.upsertFormRequestSent(request);
  }
  if (conversation.channel === "form" && context.operationsRepository?.updateFormProcessing) {
    await context.operationsRepository.updateFormProcessing({ conversationId: conversation.id, status: "replied", replyDraftId: draft.id, replySentAt: sentAt }).catch(() => null);
  }
  return { duplicate: false, draft: sent, delivery: delivery?.response || delivery, formRequest };
}

export default sendReplyDraft;
