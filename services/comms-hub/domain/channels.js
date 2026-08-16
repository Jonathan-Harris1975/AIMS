export function normaliseConversationChannel(value) {
  return String(value ?? "").trim().toLowerCase();
}

export function isSocialChannel(value) {
  return ["social", "social_dm", "social_comment"].includes(normaliseConversationChannel(value));
}

export function isSocialDmChannel(value) {
  return normaliseConversationChannel(value) === "social_dm";
}

export function isSocialCommentChannel(value) {
  return normaliseConversationChannel(value) === "social_comment";
}

export function isChatChannel(value) {
  return normaliseConversationChannel(value) === "chat";
}

export function isEmailChannel(value) {
  return normaliseConversationChannel(value) === "email";
}

export function isFormChannel(value) {
  return normaliseConversationChannel(value) === "form";
}

export function channelFamily(value) {
  const channel = normaliseConversationChannel(value);
  return isSocialChannel(channel) ? "social" : channel;
}

export function channelPolicyCandidates(value) {
  const channel = normaliseConversationChannel(value);
  return Object.freeze([...new Set([channel, channelFamily(channel), "any"].filter(Boolean))]);
}

export default Object.freeze({
  normaliseConversationChannel,
  isSocialChannel,
  isSocialDmChannel,
  isSocialCommentChannel,
  isChatChannel,
  isEmailChannel,
  isFormChannel,
  channelFamily,
  channelPolicyCandidates,
});
