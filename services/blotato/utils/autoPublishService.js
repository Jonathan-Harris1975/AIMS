import {
  beginJob,
  completeJob,
  failJob,
  getPublicJobFresh,
  toPublicJob,
} from "../../shared/utils/jobStore.js";
import {
  createVisual,
  getVisualStatus,
  listAccounts,
  publishPost,
  getPostStatus,
} from "./blotatoClient.js";
import { buildBlotatoVisualPrompt, buildNewsInsightShortPack } from "./newsShortsService.js";
import { selectRssArticleForBlotato } from "./rssArticleSource.js";
import { info, warn } from "../../../logger.js";

export const BLOTATO_PUBLISH_JOB_TYPE = "blotato-news-insight-publish";
export const DEFAULT_AI_STORY_TEMPLATE_PATH =
  "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";

const VIDEO_DONE_STATUSES = new Set(["done", "completed", "complete", "success"]);
const VIDEO_FAILED_STATUSES = new Set(["creation-from-template-failed", "failed", "error"]);
const POST_DONE_STATUSES = new Set(["published", "completed", "complete", "success"]);
const POST_FAILED_STATUSES = new Set(["failed", "error"]);

function trim(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  const cleaned = String(value).trim();
  return cleaned || fallback;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalised = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on", "y"].includes(normalised)) return true;
  if (["0", "false", "no", "off", "n"].includes(normalised)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normaliseTemplateId(value = DEFAULT_AI_STORY_TEMPLATE_PATH) {
  const raw = trim(value, DEFAULT_AI_STORY_TEMPLATE_PATH);

  if (raw === "5903fe43-514d-40ee-a060-0d6628c5f8fd") {
    return DEFAULT_AI_STORY_TEMPLATE_PATH;
  }

  if (raw === DEFAULT_AI_STORY_TEMPLATE_PATH.slice(1)) {
    return DEFAULT_AI_STORY_TEMPLATE_PATH;
  }

  return raw.startsWith("base/") ? `/${raw}` : raw;
}

function slugPart(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function createSessionId(article) {
  const base = slugPart(article?.title || "rss-article") || "rss-article";
  return `BLT-blotato-${Date.now()}-${base}`;
}

function publicJobUrl(req, sessionId) {
  const proto = req.get?.("x-forwarded-proto") || req.protocol || "https";
  const host = req.get?.("x-forwarded-host") || req.get?.("host") || "Jonathan-harris.online";
  return `${proto}://${host}/blotato/jobs/${encodeURIComponent(sessionId)}`;
}

function extractItem(payload = {}) {
  return payload.item || payload.data || payload.visual || payload;
}

function extractVideoId(payload = {}) {
  const item = extractItem(payload);
  return item?.id || payload.id || payload.visualId || payload.creationId;
}

function extractVideoStatus(payload = {}) {
  const item = extractItem(payload);
  return String(item?.status || payload.status || "").trim().toLowerCase();
}

function findMediaUrl(value, depth = 0) {
  if (!value || depth > 5) return "";
  if (typeof value === "string") {
    return /^https?:\/\//i.test(value) && /\.(mp4|mov|m4v|webm)(?:[?#].*)?$/i.test(value) ? value : "";
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findMediaUrl(entry, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";

  for (const key of ["mediaUrl", "videoUrl", "url", "publicUrl", "downloadUrl", "src"]) {
    const candidate = value[key];
    if (typeof candidate === "string" && /^https?:\/\//i.test(candidate)) return candidate;
  }

  for (const nested of Object.values(value)) {
    const found = findMediaUrl(nested, depth + 1);
    if (found) return found;
  }

  return "";
}

async function pollUntil({ label, run, isDone, isFailed, extractStatus, maxAttempts, intervalMs }) {
  let latest = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await run();
    const status = extractStatus(latest);
    if (isDone(status)) return latest;
    if (isFailed(status)) {
      const err = new Error(`${label} failed with status: ${status || "unknown"}`);
      err.statusCode = 502;
      err.details = latest;
      throw err;
    }
    await sleep(intervalMs);
  }

  const err = new Error(`${label} did not complete before polling limit`);
  err.statusCode = 504;
  err.details = latest;
  throw err;
}

async function createAndWaitForVideo({ templateId, pack, apiKey }) {
  const visualPrompt = buildBlotatoVisualPrompt(pack);
  const visual = await createVisual({
    templateId,
    inputs: {},
    prompt: visualPrompt,
    render: true,
    isDraft: false,
  }, apiKey);

  const visualId = extractVideoId(visual);
  if (!visualId) {
    const err = new Error("Blotato visual response did not include item.id");
    err.statusCode = 502;
    err.details = visual;
    throw err;
  }

  const maxAttempts = Number(process.env.BLOTATO_VIDEO_POLL_ATTEMPTS || 90);
  const intervalMs = Number(process.env.BLOTATO_VIDEO_POLL_INTERVAL_MS || 3000);
  const completed = await pollUntil({
    label: "Blotato video render",
    run: () => getVisualStatus(visualId, apiKey),
    extractStatus: extractVideoStatus,
    isDone: (status) => VIDEO_DONE_STATUSES.has(status),
    isFailed: (status) => VIDEO_FAILED_STATUSES.has(status),
    maxAttempts,
    intervalMs,
  });

  const mediaUrl = findMediaUrl(completed) || findMediaUrl(visual);
  if (!mediaUrl) {
    const err = new Error("Blotato video completed but no public media URL was found");
    err.statusCode = 502;
    err.details = completed;
    throw err;
  }

  return { visualId, visual, completed, mediaUrl, visualPrompt };
}

async function resolveAccountId(platform, apiKey) {
  const specificEnv = `BLOTATO_${platform.toUpperCase()}_ACCOUNT_ID`;
  const configured = trim(process.env[specificEnv]);
  if (configured) return configured;

  const accounts = await listAccounts({ platform }, apiKey);
  const items = Array.isArray(accounts?.items) ? accounts.items : [];
  const match = items.find((item) => String(item?.platform || "").toLowerCase() === platform) || items[0];
  const id = trim(match?.id || match?.accountId);
  if (id) return id;

  const err = new Error(`No connected Blotato ${platform} account found`);
  err.statusCode = 400;
  err.details = accounts;
  throw err;
}

function buildTarget(platform, pack) {
  if (platform === "instagram") {
    return {
      targetType: "instagram",
      mediaType: "reel",
      shareToFeed: parseBoolean(process.env.BLOTATO_INSTAGRAM_SHARE_TO_FEED, true),
      altText: pack.thumbnailText || pack.internalTitle || "AI news short",
    };
  }

  if (platform === "youtube") {
    return {
      targetType: "youtube",
      title: pack.youtubeTitle || pack.internalTitle || "AI news insight",
      privacyStatus: trim(process.env.BLOTATO_YOUTUBE_PRIVACY_STATUS, "public"),
      shouldNotifySubscribers: parseBoolean(process.env.BLOTATO_YOUTUBE_NOTIFY_SUBSCRIBERS, false),
      isMadeForKids: false,
      containsSyntheticMedia: true,
    };
  }

  return { targetType: platform };
}

function buildPlatformText(platform, pack) {
  if (platform === "youtube") return pack.youtubeDescription || pack.facebookCaption || pack.script;
  if (platform === "instagram") return pack.instagramCaption || pack.tiktokCaption || pack.facebookCaption || pack.script;
  return pack.facebookCaption || pack.tiktokCaption || pack.script;
}

async function publishAndWait({ platform, pack, mediaUrl, apiKey }) {
  const accountId = await resolveAccountId(platform, apiKey);
  const target = buildTarget(platform, pack);
  const post = await publishPost({
    accountId,
    platform,
    text: buildPlatformText(platform, pack),
    mediaUrls: [mediaUrl],
    target,
  }, apiKey);

  const postSubmissionId = trim(post?.postSubmissionId || post?.id || post?.item?.postSubmissionId || post?.item?.id);
  if (!postSubmissionId) {
    const err = new Error(`Blotato ${platform} post response did not include postSubmissionId`);
    err.statusCode = 502;
    err.details = post;
    throw err;
  }

  const maxAttempts = Number(process.env.BLOTATO_POST_POLL_ATTEMPTS || 60);
  const intervalMs = Number(process.env.BLOTATO_POST_POLL_INTERVAL_MS || 3000);
  const status = await pollUntil({
    label: `Blotato ${platform} publish`,
    run: () => getPostStatus(postSubmissionId, apiKey),
    extractStatus: (payload) => String(payload?.status || payload?.item?.status || "").trim().toLowerCase(),
    isDone: (value) => POST_DONE_STATUSES.has(value),
    isFailed: (value) => POST_FAILED_STATUSES.has(value),
    maxAttempts,
    intervalMs,
  });

  return { platform, accountId, target, postSubmissionId, post, status };
}

function getDefaultPlatforms() {
  return trim(process.env.BLOTATO_DEFAULT_CHANNELS, "instagram,youtube")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildDefaults() {
  return {
    channels: getDefaultPlatforms(),
    templateId: normaliseTemplateId(process.env.BLOTATO_NEWS_TEMPLATE_ID || DEFAULT_AI_STORY_TEMPLATE_PATH),
    templatePath: trim(process.env.BLOTATO_NEWS_TEMPLATE_ID || DEFAULT_AI_STORY_TEMPLATE_PATH, DEFAULT_AI_STORY_TEMPLATE_PATH),
    pickMode: trim(process.env.BLOTATO_RSS_PICK_MODE, "latest"),
  };
}

function buildRssSummary(articleSource = {}) {
  return {
    source: articleSource.rssSource || articleSource.source || null,
    sourceType: articleSource.sourceType || "rss",
    itemCount: articleSource.itemCount ?? articleSource.totalItems ?? null,
    article: articleSource.article,
  };
}

async function runPublishJob({ sessionId, articleSource, apiKey }) {
  try {
    info("blotato.publish_now.job.start", { sessionId, rssSource: articleSource.rssSource });
    const defaults = buildDefaults();
    const templateId = defaults.templateId;
    const platforms = defaults.channels;

    const pack = await buildNewsInsightShortPack({
      article: articleSource.article,
      theme: trim(process.env.BLOTATO_NEWS_THEME, "what-it-means"),
      durationSeconds: Number(process.env.BLOTATO_NEWS_DURATION_SECONDS || 45),
      audience: trim(
        process.env.BLOTATO_NEWS_AUDIENCE,
        "curious readers, creators, authors, and small business owners"
      ),
      cta: trim(
        process.env.BLOTATO_NEWS_CTA,
        "For more straight-talking AI analysis, follow Jonathan Harris and listen to Turing's Torch AI Weekly."
      ),
    });

    const video = await createAndWaitForVideo({ templateId, pack, apiKey });
    const publishes = [];
    for (const platform of platforms) {
      publishes.push(await publishAndWait({ platform, pack, mediaUrl: video.mediaUrl, apiKey }));
    }

    const result = {
      ok: true,
      service: "blotato",
      lane: "news-insight-publish-now",
      sessionId,
      defaults,
      templateId,
      rss: buildRssSummary(articleSource),
      source: articleSource,
      pack,
      visualId: video.visualId,
      mediaUrl: video.mediaUrl,
      video,
      posts: publishes.map((item) => ({
        platform: item.platform,
        accountId: item.accountId,
        postSubmissionId: item.postSubmissionId,
        status: String(item.status?.status || item.status?.item?.status || item.post?.status || "published").trim().toLowerCase() || "published",
        target: item.target,
        post: item.post,
        rawStatus: item.status,
      })),
      publishes,
    };

    completeJob(BLOTATO_PUBLISH_JOB_TYPE, sessionId, { result });
    info("blotato.publish_now.job.complete", { sessionId, platforms });
    return result;
  } catch (error) {
    failJob(BLOTATO_PUBLISH_JOB_TYPE, sessionId, error);
    warn("blotato.publish_now.job.fail", { sessionId, error: error?.message || String(error) });
    throw error;
  }
}

export async function triggerPublishNowJob(req = {}) {
  const articleSource = await selectRssArticleForBlotato();
  const sessionId = createSessionId(articleSource.article);
  const defaults = buildDefaults();
  const statusUrl = publicJobUrl(req, sessionId);
  const { started, job } = beginJob(BLOTATO_PUBLISH_JOB_TYPE, sessionId, {
    rss: buildRssSummary(articleSource),
    source: articleSource,
    defaults,
    statusUrl,
  });

  const publicJob = toPublicJob(job);
  const response = {
    statusCode: 202,
    started,
    sessionId,
    status: publicJob?.status || "running",
    statusUrl,
    defaults,
    rss: buildRssSummary(articleSource),
    job: publicJob,
  };

  if (!started) {
    return response;
  }

  const run = () => runPublishJob({ sessionId, articleSource });
  if (parseBoolean(process.env.BLOTATO_INLINE_PUBLISH_JOBS, false)) {
    await run();
  } else {
    setImmediate(() => {
      run().catch(() => {});
    });
  }

  return response;
}

export async function getPublishNowJob(sessionId) {
  return getPublicJobFresh(BLOTATO_PUBLISH_JOB_TYPE, sessionId);
}
