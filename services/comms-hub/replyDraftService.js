import { CommsHubError } from "./errors.js";
import { requireApproval } from "./approvalService.js";
import { executeSocialAction } from "./socialActionsService.js";
import { buildFormRequestRecord } from "./formOrchestrationService.js";
import { isSocialChannel } from "./domain/channels.js";
import { assertConversationReplyAllowed } from "./domain/replySafety.js";

function parseArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseObject(value) { try { const parsed = JSON.parse(value || "{}"); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }

export async function sendReplyDraft({ draftId, context }) {
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
  const operations = await context.operationsRepository.getConversationOperations(conversation.id);
  assertConversationReplyAllowed({ conversation, operations });

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
    delivery = await context.replyDelivery.send({ conversation, draft, idempotencyKey: `ai-draft:${draft.id}` });
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
