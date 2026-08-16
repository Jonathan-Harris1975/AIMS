import { CommsHubError } from "../errors.js";

const BLOCKED_OPERATIONAL_STATUSES = new Set([
  "snoozed",
  "resolved",
  "blocked",
  "quarantined",
  "archived",
]);

const BLOCKED_CONVERSATION_STATUSES = new Set([
  "closed",
  "quarantined",
]);

function clean(value) {
  return String(value || "").trim().toLowerCase();
}

export function conversationReplyState({ conversation, operations } = {}) {
  const operationalStatus = clean(operations?.operational_status);
  const conversationStatus = clean(conversation?.status);
  const blockedByOperationalStatus = BLOCKED_OPERATIONAL_STATUSES.has(operationalStatus);
  const blockedByConversationStatus = BLOCKED_CONVERSATION_STATUSES.has(conversationStatus);
  return Object.freeze({
    allowed: !(blockedByOperationalStatus || blockedByConversationStatus),
    operationalStatus: operationalStatus || null,
    conversationStatus: conversationStatus || null,
    blockedByOperationalStatus,
    blockedByConversationStatus,
  });
}

export function assertConversationReplyAllowed({ conversation, operations } = {}) {
  const state = conversationReplyState({ conversation, operations });
  if (state.allowed) return state;
  const status = state.blockedByOperationalStatus ? state.operationalStatus : state.conversationStatus;
  throw new CommsHubError(409, "conversation_reply_blocked", `Conversation is not sendable while status is '${status || "closed"}'.`, {
    failureClass: "permanent",
    publicMessage: "Reopen this conversation before sending a reply.",
    details: state,
  });
}

export default assertConversationReplyAllowed;
