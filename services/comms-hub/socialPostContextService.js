import { sanitiseUntrustedText } from "./domain/promptSecurity.js";

function safeJson(value) {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function clean(value, maximum = 2400) {
  return sanitiseUntrustedText(String(value || ""), maximum).replace(/\s+/g, " ").trim();
}

function metadataText(value, maximum = 1200) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, maximum);
}

function latestInbound(conversation) {
  return (conversation?.messages || []).filter((message) => message?.direction !== "outbound").at(-1) || null;
}

function normalisePost(post = {}) {
  return Object.freeze({
    postId: metadataText(post.id || post.platformPostId || post.postId || post.providerPostId || "", 500),
    title: clean(post.title || post.name || post.headline || "", 400),
    text: clean(post.content || post.message || post.caption || post.description || post.text || "", 2400),
    permalink: metadataText(post.permalink || post.url || post.link || "", 1200),
    createdTime: metadataText(post.createdTime || post.createdAt || post.publishedAt || post.timestamp || "", 120),
  });
}

export function currentSocialPostContext(conversation) {
  const thread = conversation?.socialThread;
  if (!thread) return Object.freeze({ available: false, usable: false, context: null });
  const threadMeta = safeJson(thread.metadata_json);
  const messageMeta = safeJson(latestInbound(conversation)?.metadata_json);
  const source = messageMeta?.postContext || threadMeta?.postContext || null;
  if (!source || typeof source !== "object") return Object.freeze({ available: false, usable: false, context: null });
  const context = normalisePost(source);
  const available = Boolean(context.title || context.text || context.permalink || context.postId);
  const usable = Boolean(context.title || context.text);
  return Object.freeze({ available, usable, context });
}

function postMatchesThread(post, thread) {
  const postId = metadataText(post?.id || post?.platformPostId || post?.postId || "", 500);
  if (!postId || postId !== String(thread?.provider_post_id || "")) return false;
  const accountId = metadataText(post?.accountId || post?.account?.accountId || post?.account?.id || "", 500);
  return !accountId || !thread?.account_id || accountId === String(thread.account_id);
}

/**
 * Ensure a fresh social comment can only be answered after AIMS has the source
 * post text/title. Webhook payloads normally carry it already. If a provider
 * omits it, AIMS performs a bounded metadata-only lookup of commented posts.
 * This does not ingest historical comments or conversations.
 */
export async function ensureSocialPostContext({ context, conversation, maximumPages = 3 } = {}) {
  const thread = conversation?.socialThread;
  if (!thread || conversation?.provider !== "zernio") {
    return Object.freeze({ required: false, available: true, enriched: false, context: null, reason: "not_social" });
  }

  const existing = currentSocialPostContext(conversation);
  if (existing.usable) {
    return Object.freeze({ required: thread.thread_type === "comment", available: true, enriched: false, context: existing.context, reason: "already_available" });
  }

  // DMs are only post-bound when Zernio supplies explicit post/story context.
  // Ordinary DMs still receive relevant recent public-content awareness through
  // liveContentAwarenessService, but there is no post ID to resolve blindly.
  if (thread.thread_type !== "comment") {
    return Object.freeze({ required: false, available: existing.usable, enriched: false, context: existing.context, reason: "dm_without_exact_post" });
  }

  const providerPostId = String(thread.provider_post_id || "").trim();
  const family = String(thread.credential_family || "").trim();
  const platform = String(thread.platform || "").trim();
  const client = context?.zernio?.[family];
  if (!providerPostId || !platform || !client?.listCommentedPosts) {
    return Object.freeze({ required: true, available: false, enriched: false, context: existing.context, reason: "post_lookup_unavailable" });
  }

  let cursor = "";
  const pages = Math.max(1, Math.min(5, Number(maximumPages) || 3));
  try {
    for (let page = 0; page < pages; page += 1) {
      const response = await client.listCommentedPosts({ platform, cursor, limit: 100 });
      const posts = Array.isArray(response?.data) ? response.data : [];
      const match = posts.find((post) => postMatchesThread(post, thread));
      if (match) {
        const postContext = normalisePost(match);
        if (postContext.title || postContext.text) {
          if (context?.repository?.mergeSocialPostContext) {
            await context.repository.mergeSocialPostContext({
              conversationId: conversation.id,
              postContext,
              updatedAt: new Date().toISOString(),
            });
          }
          return Object.freeze({ required: true, available: true, enriched: true, context: postContext, reason: "provider_enriched" });
        }
      }
      const next = String(response?.pagination?.nextCursor || response?.pagination?.cursor || "").trim();
      if (!response?.pagination?.hasMore || !next) break;
      cursor = next;
    }
  } catch (error) {
    return Object.freeze({
      required: true,
      available: false,
      enriched: false,
      context: existing.context,
      reason: "post_lookup_failed",
      errorCode: String(error?.code || error?.statusCode || error?.status || "provider_error"),
    });
  }

  return Object.freeze({ required: true, available: false, enriched: false, context: existing.context, reason: "post_context_not_found" });
}

export default ensureSocialPostContext;
