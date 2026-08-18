export const AUTOMATION_EXCLUDED_EMAIL_ACCOUNT_KEYS = Object.freeze(["admin", "newsletter"]);

const EXCLUDED_EMAIL_KEYS = new Set(AUTOMATION_EXCLUDED_EMAIL_ACCOUNT_KEYS);

function normalise(value) {
  return String(value ?? "").trim().toLowerCase();
}

function parseObject(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function isAutomationExcludedEmailAccountKey(accountKey) {
  return EXCLUDED_EMAIL_KEYS.has(normalise(accountKey));
}

export function conversationEmailAccountKey(conversation, workspace = null) {
  if (normalise(conversation?.channel) !== "email") return "";
  const conversationMetadata = parseObject(conversation?.metadata || conversation?.metadata_json);
  const workspaceThread = workspace?.emailThread || workspace?.email_thread || null;
  return normalise(
    workspaceThread?.account_key
    || workspaceThread?.accountKey
    || conversationMetadata.accountKey
    || conversationMetadata.account_key
  );
}

export function conversationAutomationExclusion(conversation, workspace = null) {
  const accountKey = conversationEmailAccountKey(conversation, workspace);
  if (!accountKey || !isAutomationExcludedEmailAccountKey(accountKey)) return null;
  return Object.freeze({
    excluded: true,
    reason: "email_account_outside_comms_hub_automation",
    accountKey,
  });
}

export async function resolveConversationAutomationExclusion(context, conversation) {
  if (normalise(conversation?.channel) !== "email") return null;
  let exclusion = conversationAutomationExclusion(conversation);
  if (exclusion) return exclusion;
  if (!context?.operationsRepository?.getConversationWorkspace) return null;
  const workspace = await context.operationsRepository.getConversationWorkspace(conversation.id);
  exclusion = conversationAutomationExclusion(conversation, workspace);
  return exclusion;
}
