import { safeErrorLog } from "./domain/redaction.js";
import { log } from "../../logger.js";

const pending = new Set();

function enabled(context) {
  return Boolean(
    context?.config?.aiEnabled
    && context?.config?.autonomousRepliesEnabled
    && context?.aiWorkflowService
    && context?.governanceService
  );
}

export async function runInboundConversationAutomation({ context, conversationId, actor = "inbound-automation", scheduleFollowUp = true } = {}) {
  if (!conversationId || !enabled(context)) return { skipped: true, reason: "automation_disabled" };
  const operations = context.operationsRepository?.getConversationOperations
    ? await context.operationsRepository.getConversationOperations(conversationId).catch(() => null)
    : null;
  if (operations?.owner_type === "person") return { skipped: true, reason: "human_assigned" };
  const analysis = await context.aiWorkflowService.analyseConversation(conversationId, { operation: "analyse", scheduleFollowUp });
  if (!analysis?.draft?.id) return { skipped: true, reason: "no_draft", analysis };
  if (analysis.draft.requiresApproval) return { skipped: true, reason: "approval_required", analysis };
  try {
    const delivery = await context.governanceService.attemptAutonomousReply(
      { conversationId, draftId: analysis.draft.id },
      { actor, role: "admin" },
    );
    return { skipped: false, sent: true, analysis, delivery };
  } catch (error) {
    const expected = new Set([
      "autonomous_policy_not_found",
      "autonomous_reply_policy_rejected",
      "autonomous_reply_response_intelligence_blocked",
      "autonomous_reply_security_blocked",
      "autonomous_reply_requires_approval",
      "autonomous_reply_rate_limited",
      "autonomous_replies_disabled",
      "autonomous_reply_human_assigned",
    ]);
    if (!expected.has(error?.code)) throw error;
    return { skipped: true, reason: error.code, analysis };
  }
}

export function kickInboundConversationAutomation({ context, conversationId, actor = "inbound-automation", scheduleFollowUp = true, blockedReason = "" } = {}) {
  if (blockedReason) return false;
  if (!conversationId || !enabled(context) || pending.has(conversationId)) return false;
  pending.add(conversationId);
  queueMicrotask(() => {
    void runInboundConversationAutomation({ context, conversationId, actor, scheduleFollowUp })
      .then((result) => log.info("commsHub.inboundAutomation.complete", {
        conversationId,
        actor,
        sent: Boolean(result?.sent),
        skipped: Boolean(result?.skipped),
        reason: result?.reason || null,
      }))
      .catch((error) => log.warn("commsHub.inboundAutomation.failed", { conversationId, actor, error: safeErrorLog(error) }))
      .finally(() => pending.delete(conversationId));
  });
  return true;
}

export default kickInboundConversationAutomation;
