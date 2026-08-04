import { CommsHubError } from "./errors.js";
import { requireApproval } from "./approvalService.js";
import { executeSocialAction } from "./socialActionsService.js";

function parseArray(value) { try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }

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

  let delivery;
  if (conversation.channel === "social") {
    delivery = await executeSocialAction({
      conversationId: conversation.id,
      action: "reply",
      body: { message: draft.body_text },
      idempotencyKey: `ai-draft:${draft.id}`,
      context,
    });
  } else if (context.replyDelivery?.send) {
    delivery = await context.replyDelivery.send({ conversation, draft });
  } else {
    throw new CommsHubError(501, "reply_delivery_adapter_unavailable", "No delivery adapter is configured for this conversation channel.", {
      failureClass: "permanent",
      publicMessage: "This reply is drafted but its channel delivery adapter is not configured.",
    });
  }

  const sent = await context.aiRepository.markDraftSent({
    id: draft.id,
    sentAt: new Date().toISOString(),
    metadata: { delivery: delivery?.response || delivery || {}, evidenceIds },
  });
  return { duplicate: false, draft: sent, delivery: delivery?.response || delivery };
}

export default sendReplyDraft;
