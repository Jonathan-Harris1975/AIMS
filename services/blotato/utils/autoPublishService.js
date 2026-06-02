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
import { buildBlotatoVideoInputs, buildBlotatoVisualPrompt, buildShortLanePack } from "./newsShortsService.js";
import { DEFAULT_BLOTATO_SHORT_LANE, getShortLaneJobTypes, requireShortLaneConfig } from "./shortLanes.js";
import { selectRssArticleForBlotato } from "./rssArticleSource.js";
import { info, warn } from "../../../logger.js";
import { recordUsedSocialSource } from "../../oneup/utils/state.js";
import { buildBlotatoGateError, runBlotatoShortGate } from "./shortGate.js";
import { completeEditorialReservation, releaseEditorialReservation, reserveEditorialSource } from "../../social/editorialLedger.js";

export const BLOTATO_PUBLISH_JOB_TYPE = "blotato-news-insight-publish";
export const DEFAULT_AI_STORY_TEMPLATE_PATH =
  "/base/v2/ai-story-video/5903fe43-514d-40ee-a060-0d6628c5f8fd/v1";

const VIDEO_DONE_STATUSES = new Set(["done", "completed", "complete", "success", "ready", "finished", "rendered", "processed", "available"]);
const VIDEO_FAILED_STATUSES = new Set(["creation-from-template-failed", "failed", "error", "cancelled", "canceled", "timed-out", "timeout"]);
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

function positiveIntEnv(name, fallback, max = Number.POSITIVE_INFINITY) {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function normaliseTemplateId(value = DEFAULT_AI_STORY_TEMPLATE_PATH) {
  const raw = trim(value, DEFAULT_AI_STORY_TEMPLATE_PATH);
  return raw.startsWith("base/v2/") ? `/${raw}` : raw;
}

function slugPart(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36);
}

function createSessionId(article, laneSlug = DEFAULT_BLOTATO_SHORT_LANE) {
  const base = slugPart(article?.title || "rss-article") || "rss-article";
  const lanePrefix = laneSlug === DEFAULT_BLOTATO_SHORT_LANE ? "" : `${laneSlug}-`;
  return `BLT-blotato-${lanePrefix}${Date.now()}-${base}`;
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

async function pollUntil({ label, run, isDone, isDonePayload, isFailed, extractStatus, maxAttempts, intervalMs, progressEvery = 30, finalGraceMs = 0 }) {
  let latest = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    latest = await run();
    const status = extractStatus(latest);
    if (isDone(status) || isDonePayload?.(latest, status)) return latest;
    if (isFailed(status)) {
      const err = new Error(`${label} failed with status: ${status || "unknown"}`);
      err.statusCode = 502;
      err.details = latest;
      throw err;
    }
    if (progressEvery > 0 && attempt % progressEvery === 0) {
      info("blotato.poll.still_waiting", { label, attempt, maxAttempts, status: status || "unknown" });
    }
    await sleep(intervalMs);
  }

  if (finalGraceMs > 0) {
    await sleep(finalGraceMs);
    latest = await run();
    const status = extractStatus(latest);
    if (isDone(status) || isDonePayload?.(latest, status)) return latest;
    if (isFailed(status)) {
      const err = new Error(`${label} failed with status: ${status || "unknown"}`);
      err.statusCode = 502;
      err.details = latest;
      throw err;
    }
  }

  const err = new Error(`${label} did not complete before polling limit`);
  err.statusCode = 504;
  err.details = latest;
  throw err;
}

async function createAndWaitForVideo({ templateId, pack, apiKey }) {
  const visualPrompt = buildBlotatoVisualPrompt(pack);
  const visualInputs = buildBlotatoVideoInputs(pack);
  const visual = await createVisual({
    templateId,
    inputs: visualInputs,
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

  const maxAttempts = positiveIntEnv("BLOTATO_VIDEO_POLL_ATTEMPTS", 480, 1440);
  const intervalMs = positiveIntEnv("BLOTATO_VIDEO_POLL_INTERVAL_MS", 5000, 60_000);
  const finalGraceMs = positiveIntEnv("BLOTATO_VIDEO_FINAL_GRACE_MS", 15_000, 180_000);
  const completed = await pollUntil({
    label: "Blotato video render",
    run: () => getVisualStatus(visualId, apiKey),
    extractStatus: extractVideoStatus,
    isDone: (status) => VIDEO_DONE_STATUSES.has(status),
    isDonePayload: (payload) => Boolean(findMediaUrl(payload)),
    isFailed: (status) => VIDEO_FAILED_STATUSES.has(status),
    maxAttempts,
    intervalMs,
    finalGraceMs,
    progressEvery: positiveIntEnv("BLOTATO_VIDEO_POLL_PROGRESS_EVERY", 30, 240),
  });

  const mediaUrl = findMediaUrl(completed) || findMediaUrl(visual);
  if (!mediaUrl) {
    const err = new Error("Blotato video completed but no public media URL was found");
    err.statusCode = 502;
    err.details = completed;
    throw err;
  }

  return { visualId, visual, completed, mediaUrl, visualPrompt, visualInputs };
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

  if (platform === "facebook") {
    const pageId = trim(process.env.BLOTATO_FACEBOOK_PAGE_ID || process.env.BLOTATO_FACEBOOK_SUBACCOUNT_ID);
    return {
      targetType: "facebook",
      ...(pageId ? { pageId } : {}),
    };
  }

  return { targetType: platform };
}

function limitHashtags(text = "", max = 5) {
  const source = String(text || "");
  let seen = 0;
  return source
    .replace(/(^|\s)(#[\p{L}\p{N}_]+)/gu, (match, prefix, tag) => {
      seen += 1;
      return seen <= max ? `${prefix}${tag}` : "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}


function normalisePackForPublish(pack = {}) {
  return {
    ...pack,
    instagramCaption: limitHashtags(pack.instagramCaption || pack.tiktokCaption || pack.facebookCaption || pack.script, 5),
    tiktokCaption: limitHashtags(pack.tiktokCaption || pack.instagramCaption || pack.facebookCaption || pack.script, 5),
    youtubeDescription: limitHashtags(pack.youtubeDescription || pack.facebookCaption || pack.script, 5),
  };
}

function buildPlatformText(platform, pack) {
  if (platform === "youtube") return pack.youtubeDescription || pack.facebookCaption || pack.script;
  if (platform === "instagram") {
    return limitHashtags(pack.instagramCaption || pack.tiktokCaption || pack.facebookCaption || pack.script, 5);
  }
  if (platform === "tiktok") {
    return limitHashtags(pack.tiktokCaption || pack.instagramCaption || pack.facebookCaption || pack.script, 5);
  }
  if (platform === "facebook") return pack.facebookCaption || pack.tiktokCaption || pack.script;
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

  const maxAttempts = positiveIntEnv("BLOTATO_POST_POLL_ATTEMPTS", 90, 720);
  const intervalMs = positiveIntEnv("BLOTATO_POST_POLL_INTERVAL_MS", 3000, 60_000);
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
  return trim(process.env.BLOTATO_DEFAULT_CHANNELS, "instagram,youtube,tiktok,facebook")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function buildDefaults(laneSlug = DEFAULT_BLOTATO_SHORT_LANE) {
  const lane = requireShortLaneConfig(laneSlug);
  return {
    lane: lane.slug,
    laneLabel: lane.label,
    weekday: lane.weekday,
    channels: getDefaultPlatforms(),
    templateId: normaliseTemplateId(process.env.BLOTATO_NEWS_TEMPLATE_ID || DEFAULT_AI_STORY_TEMPLATE_PATH),
    templatePath: trim(process.env.BLOTATO_NEWS_TEMPLATE_ID || DEFAULT_AI_STORY_TEMPLATE_PATH, DEFAULT_AI_STORY_TEMPLATE_PATH),
    pickMode: trim(process.env.BLOTATO_RSS_PICK_MODE, "latest"),
    minDurationSeconds: 30,
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

async function runPublishJob({ sessionId, articleSource, laneSlug = DEFAULT_BLOTATO_SHORT_LANE, apiKey, editorialReservation = null }) {
  const lane = requireShortLaneConfig(laneSlug);
  try {
    info("blotato.publish_now.job.start", { sessionId, lane: lane.slug, rssSource: articleSource.rssSource });
    const defaults = buildDefaults(lane.slug);
    const templateId = defaults.templateId;
    const platforms = defaults.channels;

    const generatedPack = await buildShortLanePack({
      article: articleSource.article,
      lane: lane.slug,
      theme: trim(process.env.BLOTATO_NEWS_THEME, lane.theme),
      durationSeconds: Math.max(30, Number(process.env.BLOTATO_NEWS_DURATION_SECONDS || 45)),
      audience: trim(
        process.env.BLOTATO_NEWS_AUDIENCE,
        "curious readers, creators, authors, and small business owners"
      ),
      cta: trim(
        process.env.BLOTATO_NEWS_CTA,
        "For more straight-talking AI analysis, follow Jonathan Harris and listen to Turing's Torch AI Weekly."
      ),
    });
    const pack = normalisePackForPublish(generatedPack);

    const blotatoShortGate = runBlotatoShortGate({
      pack,
      article: articleSource.article,
      lane: lane.slug,
    });
    if (!blotatoShortGate.ok) throw buildBlotatoGateError(blotatoShortGate);

    const video = await createAndWaitForVideo({ templateId, pack, apiKey });
    const settledPublishes = await Promise.allSettled(
      platforms.map((platform) => publishAndWait({ platform, pack, mediaUrl: video.mediaUrl, apiKey }))
    );
    const publishes = settledPublishes
      .filter((item) => item.status === "fulfilled")
      .map((item) => item.value);
    const failedPublishes = settledPublishes
      .map((item, index) => ({ platform: platforms[index], result: item }))
      .filter((item) => item.result.status === "rejected")
      .map((item) => ({
        platform: item.platform,
        error: item.result.reason?.message || String(item.result.reason),
        statusCode: item.result.reason?.statusCode || item.result.reason?.status || null,
      }));

    if (failedPublishes.length) {
      warn("blotato.publish_now.platform_failures", { sessionId, lane: lane.slug, failedPublishes });
    }

    const requireAllChannels = parseBoolean(process.env.BLOTATO_REQUIRE_ALL_CHANNELS, false);
    if (!publishes.length || (requireAllChannels && failedPublishes.length)) {
      const err = new Error(
        !publishes.length
          ? "Blotato media rendered but publishing failed on every configured channel"
          : `Blotato publishing failed on required channels: ${failedPublishes.map((item) => item.platform).join(", ")}`
      );
      err.statusCode = 502;
      err.failedPublishes = failedPublishes;
      throw err;
    }

    recordUsedSocialSource({
      lane: `blotato:${lane.slug}`,
      title: articleSource.article?.title,
      link: articleSource.article?.link,
      pubDate: articleSource.article?.pubDate,
      scheduledDateTime: new Date().toISOString(),
    });
    if (editorialReservation) {
      completeEditorialReservation(editorialReservation, {
        pipeline: "blotato",
        lane: lane.slug,
        source: articleSource.article,
        audienceIntent: lane.theme,
        angle: pack.angle || pack.internalTitle,
        scheduledDateTime: new Date().toISOString(),
        text: pack.script,
        meta: { contentType: "blotato-short", platforms },
      });
    }

    const result = {
      ok: true,
      service: "blotato",
      lane: `${lane.slug}-publish-now`,
      sessionId,
      defaults,
      templateId,
      rss: buildRssSummary(articleSource),
      source: articleSource,
      pack,
      blotatoShortGate,
      visualId: video.visualId,
      mediaUrl: video.mediaUrl,
      video,
      partial: failedPublishes.length > 0,
      failedPublishes,
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

    completeJob(lane.jobType, sessionId, { result });
    info("blotato.publish_now.job.complete", { sessionId, lane: lane.slug, platforms });
    return result;
  } catch (error) {
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    failJob(lane.jobType, sessionId, error);
    warn("blotato.publish_now.job.fail", { sessionId, error: error?.message || String(error) });
    throw error;
  }
}

export async function triggerPublishNowJob(req = {}, laneSlug = DEFAULT_BLOTATO_SHORT_LANE) {
  const lane = requireShortLaneConfig(laneSlug);
  const articleSource = await selectRssArticleForBlotato();
  const reservationResult = await reserveEditorialSource({
    pipeline: "blotato",
    lane: lane.slug,
    source: articleSource.article,
    audienceIntent: lane.theme,
    angle: lane.label,
    scheduledDateTime: new Date().toISOString(),
  });
  if (reservationResult.duplicatePrevented) {
    const err = new Error(`Selected RSS article is already reserved for another social pipeline: ${articleSource.article?.title || "untitled"}`);
    err.statusCode = 409;
    throw err;
  }
  const editorialReservation = reservationResult.reservation || null;
  const sessionId = createSessionId(articleSource.article, lane.slug);
  const defaults = buildDefaults(lane.slug);
  const statusUrl = publicJobUrl(req, sessionId);
  const { started, job } = beginJob(lane.jobType, sessionId, {
    rss: buildRssSummary(articleSource),
    source: articleSource,
    defaults,
    lane: lane.slug,
    statusUrl,
    editorialReservation,
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
    editorialReservation,
    job: publicJob,
  };

  if (!started) {
    if (editorialReservation) releaseEditorialReservation(editorialReservation);
    return response;
  }

  const run = () => runPublishJob({ sessionId, articleSource, laneSlug: lane.slug, editorialReservation });
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
  for (const jobType of getShortLaneJobTypes()) {
    const job = await getPublicJobFresh(jobType, sessionId);
    if (job) return job;
  }
  return null;
}
