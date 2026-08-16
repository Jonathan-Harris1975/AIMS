import { createHmac, timingSafeEqual } from "node:crypto";
import { ZERNIO_CHANNEL_FAMILIES } from "../config.js";
import { CommsHubError } from "../errors.js";
import { sha256Hex, stableId } from "./ids.js";

const META_EVENTS = new Set([
  "webhook.test",
  "message.received",
  "message.sent",
  "conversation.started",
  "message.edited",
  "message.deleted",
  "message.delivered",
  "message.read",
  "message.failed",
  "comment.received",
  "account.connected",
  "account.disconnected",
]);

const VIDEO_EVENTS = new Set([
  "webhook.test",
  "comment.received",
  "account.connected",
  "account.disconnected",
]);

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function first(...values) {
  for (const value of values) {
    const candidate = text(value);
    if (candidate) return candidate;
  }
  return "";
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function iso(value, fallback = new Date().toISOString()) {
  const parsed = new Date(value || fallback);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function safeEqualHex(left, right) {
  const a = Buffer.from(text(left).toLowerCase(), "utf8");
  const b = Buffer.from(text(right).toLowerCase(), "utf8");
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b);
}

function rawBodyFromRequest(req) {
  if (Buffer.isBuffer(req?.aimsRawBody)) return req.aimsRawBody;
  if (Buffer.isBuffer(req?.rawBody)) return req.rawBody;
  return null;
}

function eventSet(family) {
  return family === "meta" ? META_EVENTS : family === "video" ? VIDEO_EVENTS : new Set();
}

export function platformForZernioPayload(payload) {
  const account = object(payload?.account);
  const conversation = object(payload?.conversation);
  const message = object(payload?.message);
  const comment = object(payload?.comment);
  const post = object(payload?.post);
  return first(
    payload?.platform,
    account.platform,
    conversation.platform,
    message.platform,
    comment.platform,
    post.platform,
    payload?.metadata?.platform
  ).toLowerCase();
}

export function verifyZernioSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody)) return false;
  if (!/^[a-f0-9]{64}$/i.test(text(signature)) || !text(secret)) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqualHex(expected, signature);
}

export function readZernioWebhookEnvelope(req, { family, secret, maxBytes }) {
  const definition = ZERNIO_CHANNEL_FAMILIES[family];
  if (!definition) {
    throw new CommsHubError(404, "zernio_family_unknown", "Unknown Zernio credential family.", {
      publicMessage: "Webhook endpoint not found.",
    });
  }

  const rawBody = rawBodyFromRequest(req);
  if (!rawBody) {
    throw new CommsHubError(400, "zernio_raw_body_missing", "Zernio raw request body is unavailable for signature verification.", {
      failureClass: "permanent",
      publicMessage: "Webhook body could not be verified.",
    });
  }
  if (rawBody.length > maxBytes) {
    throw new CommsHubError(413, "zernio_webhook_too_large", "Zernio webhook exceeds the configured size limit.", {
      failureClass: "permanent",
      publicMessage: "Webhook body is too large.",
    });
  }

  const signature = first(req?.get?.("x-zernio-signature"), req?.headers?.["x-zernio-signature"]);
  if (!verifyZernioSignature(rawBody, signature, secret)) {
    throw new CommsHubError(401, "zernio_signature_invalid", "Zernio webhook signature verification failed.", {
      failureClass: "permanent",
      publicMessage: "Webhook signature is invalid.",
    });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (cause) {
    throw new CommsHubError(400, "zernio_webhook_json_invalid", "Zernio webhook body is not valid JSON.", {
      cause,
      failureClass: "permanent",
      publicMessage: "Webhook body is invalid.",
    });
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CommsHubError(400, "zernio_webhook_object_required", "Zernio webhook body must be an object.", {
      failureClass: "permanent",
      publicMessage: "Webhook body is invalid.",
    });
  }

  const eventId = first(payload.id, req?.get?.("x-zernio-event-id"), req?.get?.("x-late-event-id"));
  const headerEventId = first(req?.get?.("x-zernio-event-id"), req?.get?.("x-late-event-id"));
  if (!eventId) {
    throw new CommsHubError(400, "zernio_event_id_missing", "Zernio webhook event ID is missing.", {
      failureClass: "permanent",
      publicMessage: "Webhook event ID is missing.",
    });
  }
  if (headerEventId && payload.id && headerEventId !== text(payload.id)) {
    throw new CommsHubError(403, "zernio_event_id_mismatch", "Zernio webhook event ID header does not match the payload.", {
      failureClass: "permanent",
      publicMessage: "Webhook event verification failed.",
    });
  }

  const eventType = first(payload.event).toLowerCase();
  if (!eventSet(family).has(eventType)) {
    throw new CommsHubError(422, "zernio_event_unsupported", `Zernio event '${eventType || "unknown"}' is not supported by ${family}.`, {
      failureClass: "permanent",
      publicMessage: "Webhook event is not supported.",
    });
  }

  const platform = platformForZernioPayload(payload);
  if (eventType !== "webhook.test" && !definition.platforms.includes(platform)) {
    throw new CommsHubError(403, "zernio_platform_family_mismatch", `Platform '${platform || "unknown"}' does not belong to the ${family} API key.`, {
      failureClass: "permanent",
      publicMessage: "Webhook platform verification failed.",
    });
  }

  return Object.freeze({
    family,
    eventId,
    eventType,
    platform: platform || null,
    receivedAt: iso(payload.timestamp),
    payload,
    rawBody,
    payloadSha256: sha256Hex(rawBody),
  });
}

function normaliseIdentity(candidate, fallback = {}) {
  const source = object(candidate);
  return {
    participantId: first(source.id, source.participantId, source.userId, source.platformUserId, fallback.participantId),
    providerContactId: first(source.contactId, fallback.providerContactId) || null,
    username: first(source.username, source.handle, fallback.username) || null,
    displayName: first(source.name, source.displayName, fallback.displayName) || null,
    avatarUrl: first(source.picture, source.avatar, source.avatarUrl, fallback.avatarUrl) || null,
    isOwner: Boolean(source.isOwner ?? fallback.isOwner),
  };
}

function normaliseAttachments(values) {
  return array(values).map((item, index) => {
    const entry = object(item);
    const url = first(entry.url, entry.imageUrl, entry.mediaUrl);
    if (!url) return null;
    return {
      id: first(entry.id) || `attachment-${index + 1}`,
      type: first(entry.type, entry.mimeType) || "file",
      url,
      name: first(entry.name, entry.filename) || null,
    };
  }).filter(Boolean);
}

function normaliseMessageEvent(envelope, correlationId, source) {
  const payload = envelope.payload;
  const account = object(payload.account);
  const conversation = object(payload.conversation);
  const message = object(payload.message);
  const participantFallback = object(conversation.participant);
  const directionHint = first(message.direction).toLowerCase();
  const outgoing = envelope.eventType === "message.sent" || ["outgoing", "outbound", "sent"].includes(directionHint);
  const identity = normaliseIdentity(outgoing ? participantFallback : message.sender, {
    participantId: first(conversation.participantId, participantFallback.id, message.sender?.id),
    providerContactId: first(conversation.contactId, participantFallback.contactId, message.sender?.contactId),
    username: first(conversation.participantUsername, participantFallback.username, message.sender?.username),
    displayName: first(conversation.participantName, participantFallback.name, message.sender?.name),
    avatarUrl: first(conversation.participantPicture, participantFallback.picture, message.sender?.picture),
  });
  const accountId = first(account.accountId, account.id, conversation.accountId, message.accountId);
  const providerThreadId = first(conversation.platformConversationId, conversation.id, message.conversationId, payload.conversationId);
  const providerMessageId = first(message.platformMessageId, message.id, payload.messageId);
  const eventType = envelope.eventType;
  const direction = outgoing || identity.isOwner ? "outbound" : "inbound";
  const bodyText = first(message.text, message.message, message.body, message.caption);
  const attachments = normaliseAttachments(message.attachments);
  const statusOnly = ["message.delivered", "message.read", "message.failed"].includes(eventType);
  const mutation = ["message.edited", "message.deleted"].includes(eventType);

  if (!accountId || !providerThreadId || !providerMessageId) {
    throw new CommsHubError(422, "zernio_message_identity_incomplete", "Zernio message event is missing account, conversation or message identity.", {
      failureClass: "permanent",
      publicMessage: "Webhook message identity is incomplete.",
    });
  }
  if (!statusOnly && !mutation && !bodyText && attachments.length === 0) {
    throw new CommsHubError(422, "zernio_message_content_missing", "Zernio message event has no message content.", {
      failureClass: "permanent",
      publicMessage: "Webhook message content is missing.",
    });
  }

  const participantId = identity.participantId || first(conversation.participantId) || `unknown:${providerThreadId}`;
  const contactId = stableId("cnt", "zernio", envelope.family, envelope.platform, accountId, participantId);
  const conversationId = stableId("cnv", "zernio", envelope.family, envelope.platform, accountId, providerThreadId);
  const messageId = stableId("msg", "zernio", envelope.family, envelope.platform, accountId, providerMessageId);

  return {
    kind: statusOnly ? "message_status" : mutation ? "message_mutation" : "message",
    source,
    provider: "zernio",
    family: envelope.family,
    platform: envelope.platform,
    eventId: stableId("sev", "zernio", envelope.family, envelope.eventId),
    providerEventId: envelope.eventId,
    eventType,
    correlationId,
    receivedAt: envelope.receivedAt,
    processedAt: new Date().toISOString(),
    payloadSha256: envelope.payloadSha256,
    accountId,
    contactId,
    identityId: stableId("idn", "zernio", envelope.family, envelope.platform, accountId, participantId),
    identity: { ...identity, participantId },
    conversationId,
    threadId: stableId("sth", "zernio", envelope.family, envelope.platform, "dm", accountId, providerThreadId),
    threadType: "dm",
    providerThreadId,
    providerPostId: null,
    rootCommentId: null,
    providerStatus: first(conversation.status) || null,
    workflow: "social_inbox",
    subject: `${envelope.platform} direct message`,
    messageId,
    providerMessageId: `zernio:${envelope.family}:${envelope.platform}:${accountId}:${providerMessageId}`,
    direction,
    bodyText: bodyText || (eventType === "message.deleted" ? "[message deleted]" : ""),
    attachments,
    occurredAt: iso(message.sentAt || message.createdAt || message.timestamp || payload.timestamp, envelope.receivedAt),
    metadata: {
      deliveryStatus: first(message.deliveryStatus, eventType.replace("message.", "")) || null,
      edited: eventType === "message.edited",
      deleted: eventType === "message.deleted",
      storyReply: Boolean(message.metadata?.storyReply),
      storyMention: Boolean(message.metadata?.isStoryMention),
    },
  };
}

function normaliseCommentEvent(envelope, correlationId, source) {
  const payload = envelope.payload;
  const account = object(payload.account);
  const comment = object(payload.comment);
  const post = object(payload.post);
  const identity = normaliseIdentity(comment.from || comment.sender || comment.author);
  const accountId = first(account.accountId, account.id, comment.accountId, post.accountId);
  const providerPostId = first(comment.platformPostId, comment.postId, post.platformPostId, post.id);
  const providerCommentId = first(comment.platformCommentId, comment.commentId, comment.id);
  const parentId = first(comment.parentId, comment.parentCommentId);
  const rootCommentId = parentId || providerCommentId;
  const participantId = identity.participantId || `unknown:${providerCommentId}`;
  const attachment = object(comment.attachment);
  const bodyText = first(comment.message, comment.text, comment.content)
    || (first(attachment.type) ? `[attachment: ${first(attachment.type)}]` : "");

  if (!accountId || !providerPostId || !providerCommentId || !bodyText) {
    throw new CommsHubError(422, "zernio_comment_identity_incomplete", "Zernio comment event is missing account, post, comment or content identity.", {
      failureClass: "permanent",
      publicMessage: "Webhook comment identity is incomplete.",
    });
  }

  const providerThreadId = `${providerPostId}:${rootCommentId}`;
  const contactId = stableId("cnt", "zernio", envelope.family, envelope.platform, accountId, participantId);
  const conversationId = stableId("cnv", "zernio", envelope.family, envelope.platform, accountId, providerThreadId);
  const messageId = stableId("msg", "zernio", envelope.family, envelope.platform, accountId, providerCommentId);

  return {
    kind: "comment",
    source,
    provider: "zernio",
    family: envelope.family,
    platform: envelope.platform,
    eventId: stableId("sev", "zernio", envelope.family, envelope.eventId),
    providerEventId: envelope.eventId,
    eventType: envelope.eventType,
    correlationId,
    receivedAt: envelope.receivedAt,
    processedAt: new Date().toISOString(),
    payloadSha256: envelope.payloadSha256,
    accountId,
    contactId,
    identityId: stableId("idn", "zernio", envelope.family, envelope.platform, accountId, participantId),
    identity: { ...identity, participantId },
    conversationId,
    threadId: stableId("sth", "zernio", envelope.family, envelope.platform, "comment", accountId, providerThreadId),
    threadType: "comment",
    providerThreadId,
    providerPostId,
    rootCommentId,
    providerStatus: null,
    workflow: "social_comment_moderation",
    subject: `${envelope.platform} comment`,
    messageId,
    providerMessageId: `zernio:${envelope.family}:${envelope.platform}:${accountId}:${providerCommentId}`,
    providerCommentId,
    direction: identity.isOwner ? "outbound" : "inbound",
    bodyText,
    attachments: first(attachment.imageUrl, attachment.url) ? [{
      id: first(attachment.id) || "comment-attachment",
      type: first(attachment.type) || "file",
      url: first(attachment.imageUrl, attachment.url),
      name: null,
    }] : [],
    occurredAt: iso(comment.createdTime || comment.createdAt || payload.timestamp, envelope.receivedAt),
    metadata: {
      parentId: parentId || null,
      replyCount: Number(comment.replyCount || 0) || 0,
      likeCount: Number(comment.likeCount || 0) || 0,
      isHidden: Boolean(comment.isHidden),
      canReply: comment.canReply !== false,
      canDelete: Boolean(comment.canDelete),
      canHide: Boolean(comment.canHide),
      permalink: first(comment.url, post.permalink, post.url) || null,
      postContext: {
        title: first(post.title, post.name) || null,
        text: first(post.content, post.message, post.caption, post.description) || null,
        permalink: first(post.permalink, post.url) || null,
        createdTime: first(post.createdTime, post.createdAt) || null,
      },
    },
  };
}

function normaliseConversationEvent(envelope, correlationId, source) {
  const payload = envelope.payload;
  const account = object(payload.account);
  const conversation = object(payload.conversation);
  const identity = normaliseIdentity(conversation.participant, {
    participantId: conversation.participantId,
    providerContactId: conversation.contactId,
    username: conversation.participantUsername,
    displayName: conversation.participantName,
    avatarUrl: conversation.participantPicture,
  });
  const accountId = first(account.accountId, account.id, conversation.accountId);
  const providerThreadId = first(conversation.platformConversationId, conversation.id);
  if (!accountId || !providerThreadId) {
    throw new CommsHubError(422, "zernio_conversation_identity_incomplete", "Zernio conversation event is missing account or thread identity.", {
      failureClass: "permanent",
      publicMessage: "Webhook conversation identity is incomplete.",
    });
  }
  const participantId = identity.participantId || `unknown:${providerThreadId}`;
  return {
    kind: "conversation",
    source,
    provider: "zernio",
    family: envelope.family,
    platform: envelope.platform,
    eventId: stableId("sev", "zernio", envelope.family, envelope.eventId),
    providerEventId: envelope.eventId,
    eventType: envelope.eventType,
    correlationId,
    receivedAt: envelope.receivedAt,
    processedAt: new Date().toISOString(),
    payloadSha256: envelope.payloadSha256,
    accountId,
    contactId: stableId("cnt", "zernio", envelope.family, envelope.platform, accountId, participantId),
    identityId: stableId("idn", "zernio", envelope.family, envelope.platform, accountId, participantId),
    identity: { ...identity, participantId },
    conversationId: stableId("cnv", "zernio", envelope.family, envelope.platform, accountId, providerThreadId),
    threadId: stableId("sth", "zernio", envelope.family, envelope.platform, "dm", accountId, providerThreadId),
    threadType: "dm",
    providerThreadId,
    providerPostId: null,
    rootCommentId: null,
    providerStatus: first(conversation.status) || "active",
    workflow: "social_inbox",
    subject: `${envelope.platform} direct message`,
    messageId: null,
    providerMessageId: null,
    direction: null,
    bodyText: "",
    attachments: [],
    occurredAt: iso(payload.startedAt || payload.timestamp, envelope.receivedAt),
    metadata: {},
  };
}

export function normaliseZernioEvent(envelope, { correlationId, source = "webhook" }) {
  if (envelope.eventType === "webhook.test") {
    return {
      kind: "test",
      source,
      provider: "zernio",
      family: envelope.family,
      platform: envelope.platform,
      providerEventId: envelope.eventId,
      correlationId,
      receivedAt: envelope.receivedAt,
      payloadSha256: envelope.payloadSha256,
    };
  }
  if (envelope.eventType === "comment.received") return normaliseCommentEvent(envelope, correlationId, source);
  if (envelope.eventType === "conversation.started") return normaliseConversationEvent(envelope, correlationId, source);
  if (envelope.eventType.startsWith("message.")) return normaliseMessageEvent(envelope, correlationId, source);
  return {
    kind: "account",
    source,
    provider: "zernio",
    family: envelope.family,
    platform: envelope.platform,
    eventId: stableId("sev", "zernio", envelope.family, envelope.eventId),
    providerEventId: envelope.eventId,
    eventType: envelope.eventType,
    correlationId,
    receivedAt: envelope.receivedAt,
    processedAt: new Date().toISOString(),
    payloadSha256: envelope.payloadSha256,
    accountId: first(envelope.payload?.account?.accountId, envelope.payload?.account?.id),
    metadata: {
      accountUsername: first(envelope.payload?.account?.username, envelope.payload?.account?.name) || null,
    },
  };
}

export function zernioWebhookEventsForFamily(family) {
  return [...eventSet(family)];
}
