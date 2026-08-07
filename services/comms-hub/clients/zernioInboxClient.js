import { CommsHubError } from "../errors.js";
import { withRetry } from "./retry.js";

async function sharedFetchWithTimeout(url, options) {
  const { fetchWithTimeout } = await import("../../shared/http-client.js");
  return fetchWithTimeout(url, options);
}

async function logRetry(event, data) {
  const { log } = await import("../../../logger.js");
  log.warn(event, data);
}

function text(value) {
  return value === undefined || value === null ? "" : String(value).trim();
}

function queryString(params = {}) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    query.set(key, String(value));
  });
  const value = query.toString();
  return value ? `?${value}` : "";
}

async function parseJson(response, operation) {
  let payload;
  try {
    payload = await response.json();
  } catch (cause) {
    throw new CommsHubError(502, "zernio_response_invalid", `${operation} returned invalid JSON.`, {
      cause,
      retryable: true,
      failureClass: "temporary",
      publicMessage: "Zernio is temporarily unavailable.",
    });
  }
  if (!response.ok) {
    const status = Number(response.status) || 502;
    const detail = text(payload?.error || payload?.message || payload?.code || `status ${status}`).slice(0, 500);
    throw new CommsHubError(status === 401 || status === 403 ? 503 : status, "zernio_api_failed", `${operation} failed: ${detail}.`, {
      retryable: [408, 425, 429, 500, 502, 503, 504].includes(status),
      failureClass: status >= 500 || status === 429 ? "temporary" : "permanent",
      publicMessage: status >= 500 || status === 429 ? "Zernio is temporarily unavailable." : "Zernio rejected the operation.",
    });
  }
  return payload;
}

export class ZernioInboxClient {
  constructor(config, family, { fetchImpl = sharedFetchWithTimeout } = {}) {
    const familyConfig = config?.zernioFamilies?.[family];
    if (!familyConfig) throw new TypeError(`Unknown Zernio credential family: ${family}`);
    if (!familyConfig.enabled || !familyConfig.apiKey) {
      throw new CommsHubError(503, "zernio_family_disabled", `Zernio ${family} channel is disabled or missing its API key.`, {
        failureClass: "permanent",
        publicMessage: "Social channel is not enabled.",
      });
    }
    this.config = config;
    this.family = family;
    this.familyConfig = familyConfig;
    this.fetchImpl = fetchImpl;
  }

  assertPlatform(platform) {
    const normalised = text(platform).toLowerCase();
    if (!this.familyConfig.platforms.includes(normalised)) {
      throw new CommsHubError(400, "zernio_platform_family_mismatch", `Platform '${normalised || "unknown"}' does not belong to the ${this.family} API key.`, {
        failureClass: "permanent",
        publicMessage: "Platform is not available through this channel.",
      });
    }
    return normalised;
  }

  async request(method, endpoint, { query, body } = {}) {
    const verb = String(method || "GET").toUpperCase();
    const operation = `Zernio ${this.family} ${verb} ${endpoint}`;
    // Zernio documents x-request-id idempotency for POST /v1/posts, but not
    // for inbox messaging/comment action POSTs. Never replay an ambiguous
    // inbox POST automatically: the first request may have succeeded even if
    // its response was lost. Reconciliation/action-level retry can decide later.
    const providerAttempts = ["GET", "HEAD", "OPTIONS", "PUT", "PATCH", "DELETE"].includes(verb)
      ? this.config.providerRetryAttempts
      : 1;
    return withRetry(async () => {
      const url = `${this.config.zernioApiBaseUrl}/${endpoint.replace(/^\/+/, "")}${queryString(query)}`;
      let response;
      try {
        response = await this.fetchImpl(url, {
          method: verb,
          timeout: this.config.zernioTimeoutMs,
          headers: {
            authorization: `Bearer ${this.familyConfig.apiKey}`,
            accept: "application/json",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (cause) {
        throw new CommsHubError(502, "zernio_unreachable", `${operation} could not reach Zernio.`, {
          cause,
          retryable: true,
          failureClass: "temporary",
          publicMessage: "Zernio is temporarily unavailable.",
        });
      }
      return parseJson(response, operation);
    }, {
      attempts: providerAttempts,
      baseMs: this.config.providerRetryBaseMs,
      maxMs: this.config.providerRetryMaxMs,
      onRetry: ({ attempt, maxAttempts, delayMs, error }) => logRetry("commsHub.zernio.retry", {
        family: this.family,
        attempt,
        maxAttempts,
        delayMs,
        code: error?.code || null,
        statusCode: error?.statusCode || null,
      }),
    });
  }

  listConversations({ platform, cursor = "", limit = 50, status = "active" } = {}) {
    return this.request("GET", "inbox/conversations", {
      query: { platform: this.assertPlatform(platform), cursor, limit, status, sortOrder: "desc" },
    });
  }

  listMessages({ platform, conversationId, accountId, cursor = "", limit = 100, sortOrder = "asc" }) {
    this.assertPlatform(platform);
    return this.request("GET", `inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      query: { accountId, cursor, limit, sortOrder },
    });
  }

  listCommentedPosts({ platform, cursor = "", limit = 50, since = "" } = {}) {
    return this.request("GET", "inbox/comments", {
      query: { platform: this.assertPlatform(platform), cursor, limit, since, minComments: 1, sortBy: "date", sortOrder: "desc" },
    });
  }

  listPostComments({ platform, postId, accountId, cursor = "", limit = 100 } = {}) {
    this.assertPlatform(platform);
    return this.request("GET", `inbox/comments/${encodeURIComponent(postId)}`, {
      query: { accountId, cursor, limit },
    });
  }

  sendMessage({ platform, conversationId, accountId, message, attachmentUrl, attachmentType, quickReplies, buttons, messagingType, messageTag }) {
    this.assertPlatform(platform);
    return this.request("POST", `inbox/conversations/${encodeURIComponent(conversationId)}/messages`, {
      body: {
        accountId,
        message,
        ...(attachmentUrl ? { attachmentUrl, attachmentType: attachmentType || "file" } : {}),
        ...(Array.isArray(quickReplies) && quickReplies.length ? { quickReplies } : {}),
        ...(Array.isArray(buttons) && buttons.length ? { buttons } : {}),
        ...(messagingType ? { messagingType } : {}),
        ...(messageTag ? { messageTag } : {}),
      },
    });
  }

  markConversationRead({ platform, conversationId, accountId }) {
    this.assertPlatform(platform);
    return this.request("POST", `inbox/conversations/${encodeURIComponent(conversationId)}/read`, { body: { accountId } });
  }

  updateConversationStatus({ platform, conversationId, accountId, status }) {
    this.assertPlatform(platform);
    return this.request("PUT", `inbox/conversations/${encodeURIComponent(conversationId)}`, { body: { accountId, status } });
  }

  replyToComment({ platform, postId, commentId, accountId, message, attachmentUrl }) {
    this.assertPlatform(platform);
    return this.request("POST", `inbox/comments/${encodeURIComponent(postId)}`, {
      body: { accountId, message, commentId, ...(attachmentUrl ? { attachmentUrl } : {}) },
    });
  }

  privateReplyToComment({ platform, postId, commentId, accountId, message, quickReplies, buttons }) {
    const normalisedPlatform = this.assertPlatform(platform);
    if (!["facebook", "instagram"].includes(normalisedPlatform)) {
      throw new CommsHubError(400, "zernio_private_reply_unsupported", "Private comment replies are available only for Facebook and Instagram.", {
        publicMessage: "Private reply is not supported for this platform.",
      });
    }
    return this.request("POST", `inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/private-reply`, {
      body: {
        accountId,
        message,
        ...(Array.isArray(quickReplies) && quickReplies.length ? { quickReplies } : {}),
        ...(Array.isArray(buttons) && buttons.length ? { buttons } : {}),
      },
    });
  }

  setCommentHidden({ platform, postId, commentId, accountId, hidden }) {
    this.assertPlatform(platform);
    const endpoint = `inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/hide`;
    if (hidden) return this.request("POST", endpoint, { body: { accountId } });
    return this.request("DELETE", endpoint, { query: { accountId } });
  }

  deleteComment({ platform, postId, commentId, accountId }) {
    this.assertPlatform(platform);
    return this.request("DELETE", `inbox/comments/${encodeURIComponent(postId)}`, {
      query: { accountId, commentId },
    });
  }

  moderateYouTubeComment({ platform, postId, commentId, accountId, moderationStatus, banAuthor = false }) {
    if (this.assertPlatform(platform) !== "youtube") {
      throw new CommsHubError(400, "zernio_moderation_unsupported", "Moderation status is available only for YouTube comments.", {
        publicMessage: "Moderation action is not supported for this platform.",
      });
    }
    return this.request("POST", `inbox/comments/${encodeURIComponent(postId)}/${encodeURIComponent(commentId)}/moderation`, {
      body: { accountId, platform: "youtube", moderationStatus, ...(banAuthor ? { banAuthor: true } : {}) },
    });
  }

  listWebhooks() {
    return this.request("GET", "webhooks/settings");
  }

  createWebhook(body) {
    return this.request("POST", "webhooks/settings", { body });
  }

  updateWebhook(body) {
    return this.request("PUT", "webhooks/settings", { body });
  }
}

export default ZernioInboxClient;
