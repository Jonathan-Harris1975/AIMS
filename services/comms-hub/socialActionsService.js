import { CommsHubError, toCommsHubError } from "./errors.js";
import { sha256Hex, stableId } from "./domain/ids.js";
import { redactDiagnosticText } from "./domain/redaction.js";

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function requestHash(value) {
  return sha256Hex(JSON.stringify(canonical(value)));
}

function requireIdempotencyKey(value) {
  const key = text(value);
  if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(key)) {
    throw new CommsHubError(400, "social_idempotency_key_invalid", "A valid idempotency key is required.", {
      publicMessage: "A valid Idempotency-Key header is required.",
    });
  }
  return key;
}

function requireMessage(value) {
  const message = text(value);
  if (!message || message.length > 2000) {
    throw new CommsHubError(400, "social_message_invalid", "Message must contain between 1 and 2,000 characters.", {
      publicMessage: "Message is missing or too long.",
    });
  }
  return message;
}

function optionalHttpsUrl(value, name) {
  const candidate = text(value);
  if (!candidate) return "";
  let parsed;
  try { parsed = new URL(candidate); } catch {
    throw new CommsHubError(400, "social_url_invalid", `${name} must be a valid HTTPS URL.`, { publicMessage: `${name} is invalid.` });
  }
  if (parsed.protocol !== "https:") {
    throw new CommsHubError(400, "social_url_invalid", `${name} must use HTTPS.`, { publicMessage: `${name} is invalid.` });
  }
  return parsed.toString();
}

function parsedResponse(existing) {
  try { return JSON.parse(existing?.provider_response_json || "{}"); } catch { return {}; }
}

function validateButtons(value, max, label) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > max) {
    throw new CommsHubError(400, "social_interactions_invalid", `${label} must be an array of at most ${max} items.`, {
      publicMessage: `${label} are invalid.`,
    });
  }
  return value;
}

export async function executeSocialAction({ conversationId, action, body = {}, idempotencyKey, context }) {
  const key = requireIdempotencyKey(idempotencyKey);
  const thread = await context.repository.getSocialThreadByConversation(conversationId);
  if (!thread) {
    throw new CommsHubError(404, "social_thread_not_found", "Social thread was not found.", {
      publicMessage: "Social conversation was not found.",
    });
  }
  const client = context.zernio?.[thread.credential_family];
  if (!client) {
    throw new CommsHubError(503, "zernio_family_disabled", `Zernio ${thread.credential_family} client is unavailable.`, {
      publicMessage: "Social channel is not enabled.",
    });
  }

  const normalisedAction = text(action).toLowerCase();
  const actionRequest = {
    action: normalisedAction,
    conversationId,
    family: thread.credential_family,
    platform: thread.platform,
    accountId: thread.account_id,
    providerThreadId: thread.provider_thread_id,
    providerPostId: thread.provider_post_id,
    rootCommentId: thread.root_comment_id,
    body,
  };
  const hash = requestHash(actionRequest);
  const now = new Date().toISOString();
  const claimed = await context.repository.claimOutboundAction({
    id: stableId("act", "zernio", key),
    idempotencyKey: key,
    conversationId,
    family: thread.credential_family,
    platform: thread.platform,
    actionType: normalisedAction,
    requestSha256: hash,
    now,
  });
  if (claimed.duplicate) {
    return { duplicate: true, response: parsedResponse(claimed.existing) };
  }
  if (!claimed.acquired) {
    throw new CommsHubError(409, "social_action_not_acquired", "Social action could not be acquired.", {
      retryable: true,
      publicMessage: "Social action could not be started.",
    });
  }

  let providerResponseReceived = false;
  try {
    let response;
    if (normalisedAction === "reply") {
      const message = requireMessage(body.message);
      const attachmentUrl = optionalHttpsUrl(body.attachmentUrl, "attachmentUrl");
      const quickReplies = validateButtons(body.quickReplies, 13, "quickReplies");
      const buttons = validateButtons(body.buttons, 3, "buttons");
      if (quickReplies?.length && buttons?.length) {
        throw new CommsHubError(400, "social_interactions_conflict", "quickReplies and buttons are mutually exclusive.", {
          publicMessage: "Choose quickReplies or buttons, not both.",
        });
      }
      if (thread.thread_type === "dm") {
        response = await client.sendMessage({
          platform: thread.platform,
          conversationId: thread.provider_thread_id,
          accountId: thread.account_id,
          message,
          attachmentUrl,
          attachmentType: text(body.attachmentType) || undefined,
          quickReplies,
          buttons,
          messagingType: text(body.messagingType) || undefined,
          messageTag: text(body.messageTag) || undefined,
        });
      } else if (body.private === true) {
        response = await client.privateReplyToComment({
          platform: thread.platform,
          postId: thread.provider_post_id,
          commentId: thread.root_comment_id,
          accountId: thread.account_id,
          message,
          quickReplies,
          buttons,
        });
      } else {
        if (quickReplies?.length || buttons?.length) {
          throw new CommsHubError(400, "social_interactions_unsupported", "Interactive elements are not valid on a public comment reply.", {
            publicMessage: "Interactive elements require a direct or private reply.",
          });
        }
        if (attachmentUrl && thread.platform !== "facebook") {
          throw new CommsHubError(400, "social_comment_attachment_unsupported", "Public comment attachments are available only on Facebook.", {
            publicMessage: "Attachments are not supported for this comment reply.",
          });
        }
        response = await client.replyToComment({
          platform: thread.platform,
          postId: thread.provider_post_id,
          commentId: thread.root_comment_id,
          accountId: thread.account_id,
          message,
          attachmentUrl,
        });
      }
    } else if (normalisedAction === "read") {
      if (thread.thread_type !== "dm") throw new CommsHubError(400, "social_action_unsupported", "Read action requires a DM conversation.");
      response = await client.markConversationRead({
        platform: thread.platform,
        conversationId: thread.provider_thread_id,
        accountId: thread.account_id,
      });
    } else if (normalisedAction === "status") {
      if (thread.thread_type !== "dm") throw new CommsHubError(400, "social_action_unsupported", "Status action requires a DM conversation.");
      const status = text(body.status).toLowerCase();
      if (!["active", "archived"].includes(status)) {
        throw new CommsHubError(400, "social_status_invalid", "Status must be active or archived.", { publicMessage: "Status is invalid." });
      }
      response = await client.updateConversationStatus({
        platform: thread.platform,
        conversationId: thread.provider_thread_id,
        accountId: thread.account_id,
        status,
      });
      await context.repository.setConversationStatus({
        conversationId,
        status: status === "archived" ? "closed" : "open",
        providerStatus: status,
        updatedAt: new Date().toISOString(),
      });
    } else if (["hide", "unhide"].includes(normalisedAction)) {
      if (thread.thread_type !== "comment" || !["facebook", "instagram"].includes(thread.platform)) {
        throw new CommsHubError(400, "social_action_unsupported", "Hide and unhide are available only for Meta comments.");
      }
      response = await client.setCommentHidden({
        platform: thread.platform,
        postId: thread.provider_post_id,
        commentId: thread.root_comment_id,
        accountId: thread.account_id,
        hidden: normalisedAction === "hide",
      });
    } else if (normalisedAction === "delete") {
      if (thread.thread_type !== "comment") throw new CommsHubError(400, "social_action_unsupported", "Delete action requires a comment conversation.");
      response = await client.deleteComment({
        platform: thread.platform,
        postId: thread.provider_post_id,
        commentId: thread.root_comment_id,
        accountId: thread.account_id,
      });
      await context.repository.setConversationStatus({
        conversationId,
        status: "closed",
        providerStatus: "deleted",
        updatedAt: new Date().toISOString(),
      });
    } else if (normalisedAction === "moderate") {
      if (thread.thread_type !== "comment" || thread.platform !== "youtube") {
        throw new CommsHubError(400, "social_action_unsupported", "Moderation status is available only for YouTube comments.");
      }
      const moderationStatus = text(body.moderationStatus);
      if (!["published", "rejected", "heldForReview"].includes(moderationStatus)) {
        throw new CommsHubError(400, "social_moderation_invalid", "YouTube moderationStatus is invalid.", {
          publicMessage: "Moderation status is invalid.",
        });
      }
      if (body.banAuthor === true && moderationStatus !== "rejected") {
        throw new CommsHubError(400, "social_ban_author_invalid", "banAuthor is valid only with rejected moderation status.", {
          publicMessage: "banAuthor requires rejected moderation status.",
        });
      }
      response = await client.moderateYouTubeComment({
        platform: thread.platform,
        postId: thread.provider_post_id,
        commentId: thread.root_comment_id,
        accountId: thread.account_id,
        moderationStatus,
        banAuthor: body.banAuthor === true,
      });
      if (moderationStatus === "rejected") {
        await context.repository.setConversationStatus({
          conversationId,
          status: "closed",
          providerStatus: "rejected",
          updatedAt: new Date().toISOString(),
        });
      }
    } else {
      throw new CommsHubError(400, "social_action_unknown", `Unknown social action '${normalisedAction || "missing"}'.`, {
        publicMessage: "Social action is not supported.",
      });
    }

    providerResponseReceived = true;
    await context.repository.completeOutboundAction({ idempotencyKey: key, response, completedAt: new Date().toISOString() });
    return { duplicate: false, response };
  } catch (error) {
    const normalised = toCommsHubError(error, {
      statusCode: 502,
      code: "social_action_failed",
      failureClass: "recoverable",
      publicMessage: "Social action failed.",
    });
    await context.repository.failOutboundAction({
      idempotencyKey: key,
      failureClass: normalised.failureClass || (normalised.retryable ? "temporary" : "recoverable"),
      errorMessage: redactDiagnosticText(normalised.message),
      failedAt: new Date().toISOString(),
      reconciliationRequired: providerResponseReceived || normalised.retryable || normalised.failureClass === "temporary",
    });
    throw normalised;
  }
}

export default executeSocialAction;
