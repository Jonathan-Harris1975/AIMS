import { CommsHubError } from "./errors.js";
import { newCorrelationId, sha256Hex } from "./domain/ids.js";
import { normaliseZernioEvent, zernioWebhookEventsForFamily } from "./domain/zernioWebhook.js";

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function iso(value, fallback = new Date().toISOString()) {
  const parsed = new Date(value || fallback);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback;
}

function stablePayloadHash(payload) {
  return sha256Hex(JSON.stringify(payload));
}

function syntheticEnvelope({ family, platform, eventType, eventId, timestamp, payload }) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return Object.freeze({
    family,
    platform,
    eventType,
    eventId,
    receivedAt: iso(timestamp),
    payload,
    rawBody,
    payloadSha256: sha256Hex(rawBody),
  });
}

export async function withZernioAcceptanceDeadline(operation, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new CommsHubError(
        503,
        "zernio_ack_deadline_exceeded",
        `Zernio webhook acceptance exceeded ${timeoutMs}ms.`,
        {
          retryable: true,
          failureClass: "temporary",
          publicMessage: "Webhook acceptance timed out; retry delivery.",
        }
      ));
    }, timeoutMs);
  });
  try {
    return await Promise.race([Promise.resolve(operation), timeout]);
  } finally {
    clearTimeout(timer);
  }
}


async function scheduleAttachmentIngestion(event, context) {
  if (!context.workflowEngineService || !Array.isArray(event.attachments) || !event.attachments.length || !event.conversationId || !event.messageId) return;
  const dueAt = new Date(Date.now() + 1_000).toISOString();
  for (const attachment of event.attachments) {
    if (!attachment?.url) continue;
    const attachmentId = `${event.messageId}:${attachment.id}`;
    await context.workflowEngineService.schedule({
      conversationId: event.conversationId,
      actionType: "attachment_ingest",
      dueAt,
      payload: {
        attachmentId,
        providerUrl: attachment.url,
        filename: attachment.name || attachment.type || "attachment",
        provider: "zernio",
        metadata: { conversationId: event.conversationId, channel: event.threadType === "dm" ? "social_dm" : "social_comment" },
      },
      idempotencyKey: `attachment-ingest:${attachmentId}`,
    }, { actor: "zernio-intake", role: "admin" });
  }
}

export async function processZernioWebhook({ envelope, correlationId, context }) {
  const event = normaliseZernioEvent(envelope, { correlationId, source: "webhook" });
  if (event.kind === "test") return { test: true, duplicate: false, event };
  const persistence = await context.repository.persistZernioEvent(event);
  if (!persistence.duplicate) await scheduleAttachmentIngestion(event, context);
  return { test: false, ...persistence, event };
}

export async function persistPolledConversation({ family, platform, conversation, messages, context }) {
  const accountId = text(conversation?.accountId);
  const conversationId = text(conversation?.id);
  if (!accountId || !conversationId) return { processed: 0, duplicates: 0 };

  let processed = 0;
  let duplicates = 0;
  for (const message of messages || []) {
    const providerMessageId = text(message?.id);
    if (!providerMessageId) continue;
    const direction = text(message?.direction).toLowerCase();
    const eventType = message?.isDeleted
      ? "message.deleted"
      : message?.isEdited
        ? "message.edited"
        : ["outgoing", "outbound", "sent"].includes(direction) ? "message.sent" : "message.received";
    const fingerprint = stablePayloadHash({
      message: message?.message || "",
      attachments: message?.attachments || [],
      isEdited: Boolean(message?.isEdited),
      isDeleted: Boolean(message?.isDeleted),
      deliveryStatus: message?.deliveryStatus || null,
      editedAt: message?.editedAt || null,
      deletedAt: message?.deletedAt || null,
      readAt: message?.readAt || null,
    }).slice(0, 16);
    const payload = {
      id: `poll:${family}:${platform}:message:${accountId}:${providerMessageId}:${fingerprint}`,
      event: eventType,
      timestamp: message?.createdAt || message?.sentAt || conversation?.updatedTime || new Date().toISOString(),
      account: { accountId, platform, username: conversation?.accountUsername || null },
      conversation: {
        id: conversationId,
        platformConversationId: conversationId,
        platform,
        accountId,
        status: conversation?.status || "active",
        participantId: conversation?.participantId || message?.senderId || null,
        participantName: conversation?.participantName || message?.senderName || null,
        participantPicture: conversation?.participantPicture || null,
      },
      message: {
        id: providerMessageId,
        platformMessageId: providerMessageId,
        conversationId,
        accountId,
        platform,
        text: message?.message || "",
        direction,
        sender: {
          id: message?.senderId || conversation?.participantId || null,
          name: message?.senderName || conversation?.participantName || null,
          isOwner: ["outgoing", "outbound", "sent"].includes(direction),
        },
        attachments: message?.attachments || [],
        createdAt: message?.createdAt || message?.sentAt || null,
        deliveryStatus: message?.deliveryStatus || null,
        metadata: {
          storyReply: Boolean(message?.storyReply),
          isStoryMention: Boolean(message?.isStoryMention),
        },
      },
    };
    const envelope = syntheticEnvelope({
      family,
      platform,
      eventType,
      eventId: payload.id,
      timestamp: payload.timestamp,
      payload,
    });
    const event = normaliseZernioEvent(envelope, { correlationId: newCorrelationId(), source: "poll" });
    const result = await context.repository.persistZernioEvent(event);
    if (!result.duplicate) await scheduleAttachmentIngestion(event, context);
    processed += result.duplicate ? 0 : 1;
    duplicates += result.duplicate ? 1 : 0;
  }
  return { processed, duplicates };
}

function flattenComments(comments) {
  const output = [];
  const visit = (comment) => {
    if (!comment || typeof comment !== "object") return;
    output.push(comment);
    for (const reply of Array.isArray(comment.replies) ? comment.replies : []) visit(reply);
  };
  for (const comment of comments || []) visit(comment);
  return output;
}

export async function persistPolledComments({ family, platform, post, comments, context }) {
  const accountId = text(post?.accountId);
  const postId = text(post?.id);
  if (!accountId || !postId) return { processed: 0, duplicates: 0 };

  let processed = 0;
  let duplicates = 0;
  for (const comment of flattenComments(comments)) {
    const commentId = text(comment?.id);
    if (!commentId) continue;
    const fingerprint = stablePayloadHash({
      message: comment?.message || "",
      from: comment?.from || {},
      parentId: comment?.parentId || null,
      isHidden: Boolean(comment?.isHidden),
      likeCount: Number(comment?.likeCount || 0),
    }).slice(0, 16);
    const timestamp = comment?.createdTime || post?.createdTime || new Date().toISOString();
    const payload = {
      id: `poll:${family}:${platform}:comment:${accountId}:${postId}:${commentId}:${fingerprint}`,
      event: "comment.received",
      timestamp,
      account: { accountId, platform, username: post?.accountUsername || null },
      post: {
        id: postId,
        platformPostId: postId,
        platform,
        permalink: post?.permalink || post?.url || null,
        title: post?.title || post?.name || null,
        content: post?.content || post?.message || post?.caption || post?.description || null,
        createdTime: post?.createdTime || post?.createdAt || null,
      },
      comment: {
        ...comment,
        id: commentId,
        platformCommentId: commentId,
        postId,
        platformPostId: postId,
        accountId,
        platform,
      },
    };
    const envelope = syntheticEnvelope({
      family,
      platform,
      eventType: "comment.received",
      eventId: payload.id,
      timestamp,
      payload,
    });
    const event = normaliseZernioEvent(envelope, { correlationId: newCorrelationId(), source: "poll" });
    const result = await context.repository.persistZernioEvent(event);
    if (!result.duplicate) await scheduleAttachmentIngestion(event, context);
    processed += result.duplicate ? 0 : 1;
    duplicates += result.duplicate ? 1 : 0;
  }
  return { processed, duplicates };
}

export async function reconcileZernioWebhook({ family, context }) {
  const client = context.zernio?.[family];
  const familyConfig = context.config.zernioFamilies?.[family];
  if (!client || !familyConfig?.enabled) {
    throw new CommsHubError(503, "zernio_family_disabled", `Zernio ${family} channel is disabled.`, {
      publicMessage: "Social channel is not enabled.",
    });
  }
  if (!context.config.publicBaseUrl) {
    throw new CommsHubError(503, "comms_hub_public_url_missing", "COMMS_HUB_PUBLIC_BASE_URL is required for webhook registration.", {
      publicMessage: "Comms Hub public URL is not configured.",
    });
  }

  const url = `${context.config.publicBaseUrl}/comms-hub/intake/zernio/${family}`;
  const events = zernioWebhookEventsForFamily(family).filter((event) => event !== "webhook.test");
  const listing = await client.listWebhooks();
  const webhooks = Array.isArray(listing?.webhooks) ? listing.webhooks : [];
  const existing = webhooks.find((entry) => text(entry?.name) === familyConfig.webhookName)
    || webhooks.find((entry) => text(entry?.url) === url);

  const desired = {
    name: familyConfig.webhookName,
    url,
    secret: familyConfig.webhookSecret,
    events,
    isActive: true,
  };
  if (!existing) {
    const created = await client.createWebhook(desired);
    return { family, operation: "created", webhook: created?.webhook || null, desired: { name: desired.name, url, events } };
  }

  // Zernio's list response does not expose the configured secret. Always update
  // an existing webhook so secret rotation is applied even when the visible
  // name, URL, event list and active state are unchanged.
  const updated = await client.updateWebhook({ _id: existing._id || existing.id, ...desired });
  return { family, operation: "updated", webhook: updated?.webhook || null, desired: { name: desired.name, url, events } };
}


export async function reconcileEnabledZernioWebhooks({ context }) {
  const enabledFamilies = Object.entries(context?.config?.zernioFamilies || {})
    .filter(([, family]) => family?.enabled)
    .map(([family]) => family);
  if (!enabledFamilies.length) {
    throw new CommsHubError(503, "zernio_no_enabled_families", "No Zernio social channel families are enabled.", {
      publicMessage: "No social channels are enabled.",
    });
  }
  const families = {};
  for (const family of enabledFamilies) {
    families[family] = await reconcileZernioWebhook({ family, context });
  }
  return { enabledFamilies, families };
}
