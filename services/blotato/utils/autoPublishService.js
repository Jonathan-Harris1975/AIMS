import { info, error as logError } from "../../../logger.js";
import { wait } from "../../shared/utils/wait.js";
import {
  createSourceResolution,
  createVisual,
  getPostStatus,
  getSourceResolutionStatus,
  getVisualStatus,
  listAccounts,
  normaliseBlotatoTemplateId,
  publishPost,
} from "./blotatoClient.js";
import {
  buildBlotatoVisualPrompt,
  buildNewsInsightShortPack,
} from "./newsShortsService.js";

export const DEFAULT_AI_STORY_VIDEO_TEMPLATE_PATH =
  "base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";

const DEFAULT_CHANNELS = ["instagram", "youtube"];
const SOURCE_POLL_TERMINAL_SUCCESS = new Set(["completed"]);
const SOURCE_POLL_TERMINAL_FAILURE = new Set(["failed"]);
const VISUAL_POLL_TERMINAL_SUCCESS = new Set(["done"]);
const VISUAL_POLL_TERMINAL_FAILURE = new Set(["creation-from-template-failed", "failed"]);
const POST_POLL_TERMINAL_SUCCESS = new Set(["published"]);
const POST_POLL_TERMINAL_FAILURE = new Set(["failed"]);

function cleanText(value = "", max = 2500) {
  const text = String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max).trim()}…` : text;
}

function parseCsv(value = "") {
  return String(value || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function uniqueChannels(channels = DEFAULT_CHANNELS) {
  const requested = Array.isArray(channels) && channels.length ? channels : DEFAULT_CHANNELS;
  return [...new Set(requested.map((channel) => String(channel || "").trim().toLowerCase()))]
    .filter((channel) => DEFAULT_CHANNELS.includes(channel));
}

export function getDefaultBlotatoChannels() {
  const fromEnv = parseCsv(process.env.BLOTATO_DEFAULT_CHANNELS);
  return uniqueChannels(fromEnv.length ? fromEnv : DEFAULT_CHANNELS);
}

export function getDefaultBlotatoTemplateId() {
  return normaliseBlotatoTemplateId(
    process.env.BLOTATO_DEFAULT_TEMPLATE_ID || DEFAULT_AI_STORY_VIDEO_TEMPLATE_PATH
  );
}

function resolvePollSettings(prefix, fallbackTimeoutMs, fallbackIntervalMs) {
  return {
    timeoutMs: Number(process.env[`${prefix}_TIMEOUT_MS`] || fallbackTimeoutMs),
    intervalMs: Number(process.env[`${prefix}_INTERVAL_MS`] || fallbackIntervalMs),
  };
}

async function pollUntil({ label, request, readStatus, isSuccess, isFailure, timeoutMs, intervalMs }) {
  const started = Date.now();
  let last;

  while (Date.now() - started <= timeoutMs) {
    last = await request();
    const status = String(readStatus(last) || "").toLowerCase();

    if (isSuccess(status, last)) return last;
    if (isFailure(status, last)) {
      const err = new Error(`${label} failed with status: ${status || "unknown"}`);
      err.statusCode = 502;
      err.details = last;
      throw err;
    }

    await wait(intervalMs);
  }

  const err = new Error(`${label} timed out after ${timeoutMs}ms`);
  err.statusCode = 504;
  err.details = last;
  throw err;
}

function getItem(value = {}) {
  return value?.item || value?.source || value?.post || value || {};
}

function getStatus(value = {}) {
  return getItem(value).status || value?.status;
}

function getSourceId(response = {}) {
  return response.id || response.sourceResolutionId || response.item?.id;
}

function getVisualId(response = {}) {
  return response.item?.id || response.id || response.videoId || response.creationId;
}

function getPostSubmissionId(response = {}) {
  return response.postSubmissionId || response.id || response.item?.postSubmissionId || response.item?.id;
}

function stringifyContent(value) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(stringifyContent).filter(Boolean).join("\n");
  if (value && typeof value === "object") {
    return [
      value.summary,
      value.text,
      value.content,
      value.transcript,
      value.markdown,
      value.description,
      value.body,
    ]
      .map((item) => (typeof item === "string" ? item : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function sourceResultToArticle(result = {}, fallbackSource = {}) {
  const item = getItem(result);
  const title = cleanText(item.title || item.name || fallbackSource.url || fallbackSource.text || "Resolved Blotato source", 300);
  const summary = cleanText(stringifyContent(item.content || item.result || item.data || item), 2500);

  return {
    title,
    summary: summary || cleanText(fallbackSource.text || fallbackSource.url || "", 1200),
    link: fallbackSource.url,
    source: "Blotato source extraction",
  };
}

async function resolveSourceArticle(options = {}, apiKey) {
  const source = options.source || (options.articleUrl ? { sourceType: "article", url: options.articleUrl } : null);
  if (!source) return null;

  const created = await createSourceResolution({ source }, apiKey);
  const sourceId = getSourceId(created);
  if (!sourceId) {
    const err = new Error("Blotato source resolution response did not include an id");
    err.statusCode = 502;
    err.details = created;
    throw err;
  }

  const { timeoutMs, intervalMs } = resolvePollSettings("BLOTATO_SOURCE_POLL", 180_000, 3_000);
  const completed = await pollUntil({
    label: "Blotato source extraction",
    request: () => getSourceResolutionStatus(sourceId, apiKey),
    readStatus: getStatus,
    isSuccess: (status) => SOURCE_POLL_TERMINAL_SUCCESS.has(status),
    isFailure: (status) => SOURCE_POLL_TERMINAL_FAILURE.has(status),
    timeoutMs,
    intervalMs,
  });

  return {
    sourceRequest: source,
    sourceResolutionId: sourceId,
    sourceResolution: completed,
    article: sourceResultToArticle(completed, source),
  };
}

function envAccountKey(platform) {
  return process.env[`BLOTATO_${String(platform || "").toUpperCase()}_ACCOUNT_ID`];
}

async function resolveAccountId(platform, { accounts = {}, apiKey } = {}) {
  const supplied = accounts?.[platform] || envAccountKey(platform);
  if (supplied) return supplied;

  const result = await listAccounts({ platform }, apiKey);
  const items = Array.isArray(result?.items) ? result.items : [];
  const match = items.find((item) => String(item.platform || "").toLowerCase() === platform) || items[0];

  if (!match?.id) {
    const err = new Error(`No connected Blotato ${platform} account found`);
    err.statusCode = 400;
    err.details = { platform, accountCount: items.length };
    throw err;
  }

  return match.id;
}

function buildInstagramPost({ accountId, caption, mediaUrl, scheduledTime, useNextFreeSlot, targetOverrides = {}, instagram = {} }) {
  const target = {
    targetType: "instagram",
    mediaType: instagram.mediaType || "reel",
    shareToFeed: instagram.shareToFeed ?? true,
    ...targetOverrides,
  };

  return {
    accountId,
    platform: "instagram",
    text: caption,
    mediaUrls: [mediaUrl],
    target,
    scheduledTime,
    useNextFreeSlot,
  };
}

function buildYoutubePost({ accountId, pack, mediaUrl, scheduledTime, useNextFreeSlot, targetOverrides = {}, youtube = {} }) {
  const target = {
    targetType: "youtube",
    title: cleanText(youtube.title || pack.youtubeTitle || pack.internalTitle, 95),
    privacyStatus: youtube.privacyStatus || process.env.BLOTATO_YOUTUBE_PRIVACY_STATUS || "public",
    shouldNotifySubscribers: youtube.shouldNotifySubscribers ?? false,
    isMadeForKids: youtube.isMadeForKids ?? false,
    containsSyntheticMedia: youtube.containsSyntheticMedia ?? true,
    ...targetOverrides,
  };

  return {
    accountId,
    platform: "youtube",
    text: youtube.description || pack.youtubeDescription || pack.instagramCaption,
    mediaUrls: [mediaUrl],
    target,
    scheduledTime,
    useNextFreeSlot,
  };
}

function buildPublishPayload({ platform, accountId, pack, mediaUrl, options = {} }) {
  const common = {
    accountId,
    mediaUrl,
    scheduledTime: options.scheduledTime,
    useNextFreeSlot: options.useNextFreeSlot,
    targetOverrides: options.targets?.[platform] || {},
  };

  if (platform === "instagram") {
    return buildInstagramPost({
      ...common,
      caption: options.instagram?.caption || pack.instagramCaption,
      instagram: options.instagram || {},
    });
  }

  if (platform === "youtube") {
    return buildYoutubePost({
      ...common,
      pack,
      youtube: options.youtube || {},
    });
  }

  const err = new Error(`Unsupported Blotato auto-publish channel: ${platform}`);
  err.statusCode = 400;
  throw err;
}

function extractMediaUrl(visualStatus = {}) {
  const item = getItem(visualStatus);
  return item.mediaUrl || item.videoUrl || item.url || item.imageUrls?.[0] || visualStatus.mediaUrl || null;
}

async function createAndPollVisual(options = {}, pack, apiKey) {
  const templateId = normaliseBlotatoTemplateId(options.templateId || getDefaultBlotatoTemplateId());
  const visualPrompt = buildBlotatoVisualPrompt(pack);
  const visualRequest = {
    templateId,
    inputs: options.inputs || {},
    prompt: visualPrompt,
    render: options.render ?? true,
    isDraft: options.isDraft ?? false,
  };

  const created = await createVisual(visualRequest, apiKey);
  const visualId = getVisualId(created);
  if (!visualId) {
    const err = new Error("Blotato visual response did not include an id");
    err.statusCode = 502;
    err.details = created;
    throw err;
  }

  const { timeoutMs, intervalMs } = resolvePollSettings("BLOTATO_VISUAL_POLL", 420_000, 5_000);
  const completed = await pollUntil({
    label: "Blotato visual render",
    request: () => getVisualStatus(visualId, apiKey),
    readStatus: getStatus,
    isSuccess: (status) => VISUAL_POLL_TERMINAL_SUCCESS.has(status),
    isFailure: (status) => VISUAL_POLL_TERMINAL_FAILURE.has(status),
    timeoutMs,
    intervalMs,
  });

  const mediaUrl = extractMediaUrl(completed);
  if (!mediaUrl) {
    const err = new Error("Blotato visual completed without a mediaUrl");
    err.statusCode = 502;
    err.details = completed;
    throw err;
  }

  return { templateId, visualPrompt, visualRequest, visual: created, visualStatus: completed, visualId, mediaUrl };
}

async function publishAndPollPlatform({ platform, pack, mediaUrl, options = {}, apiKey }) {
  const accountId = await resolveAccountId(platform, { accounts: options.accounts || {}, apiKey });
  const publishPayload = buildPublishPayload({ platform, accountId, pack, mediaUrl, options });
  const submitted = await publishPost(publishPayload, apiKey);
  const postSubmissionId = getPostSubmissionId(submitted);

  if (!postSubmissionId) {
    const err = new Error(`Blotato ${platform} publish response did not include postSubmissionId`);
    err.statusCode = 502;
    err.details = submitted;
    throw err;
  }

  const { timeoutMs, intervalMs } = resolvePollSettings("BLOTATO_POST_POLL", 180_000, 5_000);
  const status = await pollUntil({
    label: `Blotato ${platform} publishing`,
    request: () => getPostStatus(postSubmissionId, apiKey),
    readStatus: getStatus,
    isSuccess: (value) => POST_POLL_TERMINAL_SUCCESS.has(value),
    isFailure: (value) => POST_POLL_TERMINAL_FAILURE.has(value),
    timeoutMs,
    intervalMs,
  });

  return {
    platform,
    accountId,
    postSubmissionId,
    request: publishPayload,
    submitted,
    status,
    publicUrl: getItem(status).publicUrl || status.publicUrl || null,
  };
}

function buildPackOptions(options = {}, resolvedSource) {
  return {
    ...options,
    article: resolvedSource?.article || options.article,
    articles: options.articles,
  };
}

export async function runBlotatoNewsInsightAutoPublish(options = {}) {
  const apiKey = options.apiKey;
  const channels = uniqueChannels(options.channels?.length ? options.channels : getDefaultBlotatoChannels());

  info("blotato.autopublish.start", { sessionId: options.sessionId, channels });

  const resolvedSource = await resolveSourceArticle(options, apiKey);
  const pack = await buildNewsInsightShortPack(buildPackOptions(options, resolvedSource));
  const visualResult = await createAndPollVisual(options, pack, apiKey);

  const posts = options.publish === false
    ? []
    : await Promise.all(channels.map((platform) => publishAndPollPlatform({
        platform,
        pack,
        mediaUrl: visualResult.mediaUrl,
        options,
        apiKey,
      })));

  const result = {
    ok: true,
    service: "blotato",
    lane: "news-insight-auto-publish",
    sessionId: options.sessionId,
    channels,
    published: options.publish !== false,
    source: resolvedSource
      ? {
          sourceRequest: resolvedSource.sourceRequest,
          sourceResolutionId: resolvedSource.sourceResolutionId,
          article: resolvedSource.article,
        }
      : null,
    templateId: visualResult.templateId,
    pack,
    visualPrompt: visualResult.visualPrompt,
    visualRequest: visualResult.visualRequest,
    visualId: visualResult.visualId,
    mediaUrl: visualResult.mediaUrl,
    posts: posts.map((post) => ({
      platform: post.platform,
      accountId: post.accountId,
      postSubmissionId: post.postSubmissionId,
      publicUrl: post.publicUrl,
      status: getStatus(post.status),
    })),
  };

  info("blotato.autopublish.complete", {
    sessionId: options.sessionId,
    channels,
    visualId: visualResult.visualId,
    postCount: posts.length,
  });

  return result;
}

export function startBlotatoNewsInsightAutoPublishJob({ sessionId, options, completeJob, failJob }) {
  void (async () => {
    try {
      const result = await runBlotatoNewsInsightAutoPublish({ ...options, sessionId });
      completeJob("blotato", sessionId, { result });
    } catch (err) {
      logError("blotato.autopublish.fail", {
        sessionId,
        error: err?.stack || err?.message || String(err),
      });
      failJob("blotato", sessionId, err, {
        result: {
          service: "blotato",
          lane: "news-insight-auto-publish",
          sessionId,
        },
      });
    }
  })();
}
