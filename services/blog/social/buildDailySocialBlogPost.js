import { info, error, debug, warn } from "../../../logger.js";
import { getObjectAsText, putText, putJson } from "../../shared/utils/r2-client.js";
import { resilientRequest } from "../../shared/utils/ai-service.js";
import { slugify } from "../utils/slug.js";
import { pageTemplate, socialPostBody } from "../utils/templates.js";
import { createBlogArtwork } from "../../artwork/createBlogArtwork.js";
import { publishSocialBlogRssFeed } from "./publishSocialBlogRssFeed.js";
import { cleanSourceText, cleanSourceTitle } from "../utils/weeklyPackage.js";
import {
  parseStructuredSocialBlogPackage,
  normaliseSocialBlogPackage,
  renderSocialBodyHtml,
  buildSocialArtworkPrompt,
  buildSocialPostManifestEntry,
  mergeSocialPostsManifest,
  findExistingSocialPostForDate,
  buildSocialPackagePrompt,
  buildSocialBrandQaPrompt,
  parseSocialBrandQaResponse,
  validateSocialBlogPackageForBrand,
} from "../utils/socialBlogPackage.js";

const DEFAULT_SOCIAL_PREFIX = "social-media-blog";
const SOURCE_RSS_BUCKET_KEY = "rss";
const SOURCE_RSS_FEED_KEY = "feed.json";
const OUT_BLOG_BUCKET_KEY = "blog";
const MS_PER_DAY = 86_400_000;

function normalisePrefix(value = DEFAULT_SOCIAL_PREFIX) {
  return String(value || DEFAULT_SOCIAL_PREFIX).trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SOCIAL_PREFIX;
}

function parsePubDate(value) {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatIsoDate(date) { return date.toISOString().slice(0, 10); }
function formatHumanDate(date) { return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date); }
function parseDateStart(dateString) {
  const match = String(dateString || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 0, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function buildDailySocialWindow({ now = new Date(), date, days = 1 } = {}) {
  const safeDays = Math.min(Math.max(Number.parseInt(days, 10) || 1, 1), 7);
  if (date) {
    const dayStart = parseDateStart(date);
    if (!dayStart) throw new Error(`Invalid date '${date}'. Expected YYYY-MM-DD.`);
    const end = new Date(dayStart.getTime() + MS_PER_DAY);
    const start = new Date(end.getTime() - safeDays * MS_PER_DAY);
    const dateId = formatIsoDate(dayStart);
    return { start, end, days: safeDays, dateId, dateLabel: safeDays === 1 ? dateId : `${formatHumanDate(start)} to ${formatHumanDate(new Date(end.getTime() - MS_PER_DAY))}`, mode: "utc-date-window" };
  }
  const end = new Date(now);
  const start = new Date(end.getTime() - safeDays * MS_PER_DAY);
  const dateId = formatIsoDate(new Date(end.getTime() - MS_PER_DAY));
  return { start, end, days: safeDays, dateId, dateLabel: safeDays === 1 ? dateId : `${formatHumanDate(start)} to ${formatHumanDate(new Date(end.getTime() - MS_PER_DAY))}`, mode: "rolling-previous-hours" };
}

function readItemDescription(item = {}) {
  const description = item?.description;
  if (typeof description === "string") return description;
  if (description?.__cdata) return description.__cdata;
  if (description?._text) return description._text;
  if (item?.content?.__cdata) return item.content.__cdata;
  if (item?.summary) return item.summary;
  return "";
}

function normaliseFeedItems(feed, window) {
  const channel = feed?.rss?.channel || feed?.channel || {};
  const itemsRaw = channel?.item || feed?.items || [];
  const itemsArray = Array.isArray(itemsRaw) ? itemsRaw : [itemsRaw];
  return itemsArray
    .map((item) => {
      const pubDateRaw = item?.pubDate || item?.published || item?.published_at || item?.date;
      const pubDate = parsePubDate(pubDateRaw);
      return { title: cleanSourceTitle(item?.title || item?.shortTitle || item?.headline || "Untitled"), link: String(item?.link || item?.url || "").trim(), pubDate, pubDateRaw, rewritten: cleanSourceText(readItemDescription(item)) };
    })
    .filter((item) => item.pubDate && item.pubDate >= window.start && item.pubDate < window.end && item.rewritten)
    .sort((a, b) => b.pubDate - a.pubDate);
}

async function loadExistingPostsManifest(bucketKey, key) {
  try { const raw = await getObjectAsText(bucketKey, key); const parsed = JSON.parse(raw); return parsed && typeof parsed === "object" ? parsed : { schema_version: 1, updated_at: null, items: [] }; }
  catch { return { schema_version: 1, updated_at: null, items: [] }; }
}

function joinUrl(base, path) { return `${String(base || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`; }
function buildSiteSocialUrls(slug) {
  const siteBaseUrl = String(process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const postPath = `/blog/social/posts/${encodeURIComponent(slug)}/`;
  return { siteBaseUrl, socialHubUrl: joinUrl(siteBaseUrl, "/blog/social/"), postPath, postUrl: joinUrl(siteBaseUrl, postPath), postMetaUrl: joinUrl(siteBaseUrl, `${postPath}post.json`), postsManifestUrl: joinUrl(siteBaseUrl, "/blog/social/posts.json") };
}

async function triggerWebsiteRebuild() {
  const hooks = [String(process.env.WEBSITE_REBUILD_HOOK || "https://hooks.jonathan-harris.online/4q1mkzkfvb566f").trim(), String(process.env.WEBSITE_REBUILD_HOOK_FALLBACK || "").trim()].filter(Boolean);
  if (!hooks.length) return { ok: false, skipped: true, reason: "missing-hook-url" };
  let lastError = null;
  for (const hookUrl of hooks) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        info("blog.social.rebuild.start", { hookUrl, attempt });
        const response = await fetch(hookUrl, { method: "POST" });
        const body = await response.text().catch(() => "");
        if (response.ok) { info("blog.social.rebuild.success", { hookUrl, attempt, status: response.status }); return { ok: true, status: response.status, hookUrl, attempt, body }; }
        lastError = new Error(`non-2xx response ${response.status}`);
        warn("blog.social.rebuild.nonOk", { hookUrl, attempt, status: response.status, body: body.slice(0, 500) });
      } catch (rebuildError) { lastError = rebuildError; warn("blog.social.rebuild.fail", { hookUrl, attempt, error: rebuildError?.message || "Unknown rebuild trigger error" }); }
    }
  }
  return { ok: false, error: lastError?.message || "Unknown rebuild trigger error" };
}

function blogSocialQaEnabled() { return String(process.env.BLOG_SOCIAL_QA_ENABLED || "true").trim().toLowerCase() !== "false"; }
function getSocialFallbackImageUrl() { return String(process.env.BLOG_SOCIAL_FALLBACK_IMAGE_URL || process.env.BLOG_FALLBACK_IMAGE_URL || process.env.BLOG_RSS_IMAGE_URL || "").trim(); }

async function resolveSocialArtwork({ sessionId, imagePrompt, dateId, prefix }) {
  const art = await createBlogArtwork({ sessionId, prompt: imagePrompt, keyPrefix: prefix });
  if (art?.ok && art.publicUrl) return { imageUrl: art.publicUrl, imageStatus: "generated", imageError: null, imageKey: art.key };
  const fallbackImageUrl = getSocialFallbackImageUrl();
  const imageError = art?.error || "Unknown social blog artwork error";
  if (fallbackImageUrl) {
    warn("blog.social.daily.image.fallback", { dateId, sessionId, imageUrl: fallbackImageUrl, error: imageError });
    return { imageUrl: fallbackImageUrl, imageStatus: "fallback", imageError, imageKey: null };
  }
  throw new Error(`Social blog artwork failed and no BLOG_SOCIAL_FALLBACK_IMAGE_URL is configured: ${imageError}`);
}

async function generateStructuredSocialPackage({ sessionId, dateLabel, items }) {
  const prompt = buildSocialPackagePrompt({ dateLabel, items });
  const baseMessages = [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }];
  let raw = await resilientRequest("blogSocial", { sessionId, messages: baseMessages, max_tokens: 2600, temperature: 0.38, response_format: { type: "json_object" } });
  let parsed = parseStructuredSocialBlogPackage(raw);
  let socialPackage = parsed.ok ? normaliseSocialBlogPackage(parsed.data, { dateLabel, items }) : null;
  let brandCheck = socialPackage ? validateSocialBlogPackageForBrand(socialPackage) : { ok: false, defects: [] };

  if (!parsed.ok || !brandCheck.ok) {
    const repairDefects = [...brandCheck.defects, parsed.ok ? "" : `Fix invalid JSON: ${parsed.error}`].filter(Boolean);
    debug("blog.social.daily.package.regen", { dateLabel, reason: parsed.ok ? "brand-gate" : "invalid-json", defects: repairDefects.slice(0, 10), parseError: parsed.ok ? undefined : parsed.error });
    raw = await resilientRequest("blogSocial", { sessionId, messages: [baseMessages[0], { role: "user", content: `${prompt.user}\n\nRepair instructions:\n- Return valid JSON only, using exactly the required top-level keys\n- Fix these defects: ${repairDefects.length ? repairDefects.join(" | ") : "off-brand, generic, unsupported, or weak social output"}\n- Keep all claims traceable to the supplied rewritten RSS material\n- Do not emit HTML, markdown, code fences, notes, or extra keys` }], max_tokens: 2600, temperature: 0.28, response_format: { type: "json_object" } });
    parsed = parseStructuredSocialBlogPackage(raw);
    socialPackage = parsed.ok ? normaliseSocialBlogPackage(parsed.data, { dateLabel, items }) : null;
    brandCheck = socialPackage ? validateSocialBlogPackageForBrand(socialPackage) : { ok: false, defects: [] };
  }

  if (!parsed.ok) { warn("blog.social.daily.package.parseFallback", { dateLabel, error: parsed.error }); return normaliseSocialBlogPackage({}, { dateLabel, items }); }

  if (blogSocialQaEnabled()) {
    const qaPrompt = buildSocialBrandQaPrompt({ items, generatedJson: socialPackage });
    try {
      const qaRaw = await resilientRequest("blogSocial", { sessionId, messages: [{ role: "system", content: qaPrompt.system }, { role: "user", content: qaPrompt.user }], max_tokens: 2400, temperature: 0.18 });
      const qa = parseSocialBrandQaResponse(qaRaw);
      if (qa.ok && qa.pass) debug("blog.social.daily.package.qaPass", { dateLabel });
      else if (qa.ok && qa.data) {
        const corrected = normaliseSocialBlogPackage(qa.data, { dateLabel, items });
        const correctedCheck = validateSocialBlogPackageForBrand(corrected);
        if (correctedCheck.defects.length <= brandCheck.defects.length) { socialPackage = corrected; brandCheck = correctedCheck; info("blog.social.daily.package.qaCorrected", { dateLabel }); }
        else warn("blog.social.daily.package.qaCorrectionRejected", { dateLabel, defects: correctedCheck.defects.slice(0, 10) });
      } else warn("blog.social.daily.package.qaUnclear", { dateLabel, error: qa.error, feedback: qa.feedback?.slice(0, 500) });
    } catch (qaError) { warn("blog.social.daily.package.qaFailed", { dateLabel, error: qaError?.message || "Unknown QA error" }); }
  }
  if (!brandCheck.ok) warn("blog.social.daily.package.brandResidual", { dateLabel, defects: brandCheck.defects.slice(0, 10) });
  return socialPackage;
}

export async function buildDailySocialBlogPost({ date, days = 1, dryRun = false, force = false } = {}) {
  const prefix = normalisePrefix(process.env.BLOG_SOCIAL_PREFIX || DEFAULT_SOCIAL_PREFIX);
  const manifestKey = `${prefix}/posts.json`;
  const window = buildDailySocialWindow({ now: new Date(), date, days });
  const sessionId = `BLOG-SOCIAL-${window.dateId}`;
  const createdAt = new Date().toISOString();

  try {
    info("blog.social.daily.build.start", { date: date || null, dateId: window.dateId, days: window.days, mode: window.mode, dateLabel: window.dateLabel, dryRun: Boolean(dryRun), force: Boolean(force), rssBucketKey: SOURCE_RSS_BUCKET_KEY, feedKey: SOURCE_RSS_FEED_KEY, prefix });
    const existingManifest = await loadExistingPostsManifest(OUT_BLOG_BUCKET_KEY, manifestKey);
    const existingPost = findExistingSocialPostForDate(existingManifest, window.dateId);
    if (existingPost && !force) return { ok: true, skipped: true, reason: `Daily social blog post already exists for ${window.dateId}. Pass force:true to rebuild it.`, existing: existingPost, manifestKey };

    const rawFeed = await getObjectAsText(SOURCE_RSS_BUCKET_KEY, SOURCE_RSS_FEED_KEY);
    const items = normaliseFeedItems(JSON.parse(rawFeed), window);
    if (!items.length) {
      info("blog.social.daily.noItems", { dateId: window.dateId, dateLabel: window.dateLabel, windowStart: window.start.toISOString(), windowEnd: window.end.toISOString() });
      return { ok: false, reason: `No rewritten RSS items found for ${window.dateLabel}.`, window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.dateLabel, mode: window.mode } };
    }

    const socialPackage = await generateStructuredSocialPackage({ sessionId, dateLabel: window.dateLabel, items });
    const title = socialPackage.title;
    const slug = slugify(`${window.dateId}-${title}`);
    const dir = `${prefix}/posts/${slug}`;
    const urls = buildSiteSocialUrls(slug);
    const bodyHtml = renderSocialBodyHtml(socialPackage, { escapeHtml });
    const imagePrompt = buildSocialArtworkPrompt({ title, summary: socialPackage.summary, themes: socialPackage.themes, generatedPrompt: socialPackage.image_prompt });
    const cleanedSources = items.map((item) => ({ title: item.title, link: item.link, pubDate: item.pubDateRaw }));
    const dryRunArtwork = { imageUrl: getSocialFallbackImageUrl() || "", imageStatus: "dry_run", imageError: null, imageKey: null };
    const artwork = dryRun ? dryRunArtwork : await resolveSocialArtwork({ sessionId, imagePrompt, dateId: window.dateId, prefix });
    const imageUrl = artwork.imageUrl;

    const postEntry = buildSocialPostManifestEntry({ id: `daily-${window.dateId}`, slug, title, summary: socialPackage.summary, socialCaption: socialPackage.social_caption, hook: socialPackage.hook, bodyHtml, takeaway: socialPackage.takeaway, postUrl: urls.postUrl, path: urls.postPath, imageUrl, imagePrompt, imageStatus: artwork.imageStatus, imageError: artwork.imageError, dateLabel: window.dateId, themes: socialPackage.themes, hashtags: socialPackage.hashtags, sources: cleanedSources, publishedAt: createdAt });
    const contentHtml = socialPostBody({ title, summary: socialPackage.summary, dateLabel: window.dateLabel, imageUrl, html: bodyHtml, sources: cleanedSources, socialCaption: socialPackage.social_caption, hashtags: socialPackage.hashtags });
    const fullHtml = pageTemplate({ title, description: socialPackage.summary, canonicalUrl: urls.postUrl, imageUrl, publishedAt: createdAt, dateLabel: window.dateLabel, contentHtml });
    const mergedManifest = mergeSocialPostsManifest(existingManifest, postEntry);
    const publishedObjects = { postHtmlKey: `${dir}/index.html`, postMetaKey: `${dir}/post.json`, manifestKey, rssFeedKey: process.env.BLOG_SOCIAL_RSS_OBJECT_KEY || `${prefix}/feed.xml`, imageKey: artwork.imageKey };

    if (dryRun) return { ok: true, dryRun: true, dateId: window.dateId, days: window.days, title, slug, summary: socialPackage.summary, social_caption: socialPackage.social_caption, postPath: urls.postPath, postUrl: urls.postUrl, postMetaUrl: urls.postMetaUrl, postsManifestUrl: urls.postsManifestUrl, imagePrompt, imageStatus: artwork.imageStatus, sourceCount: cleanedSources.length, package: socialPackage, publishedObjects };

    await putText(OUT_BLOG_BUCKET_KEY, `${dir}/index.html`, fullHtml, "text/html; charset=utf-8");
    await putJson(OUT_BLOG_BUCKET_KEY, `${dir}/post.json`, { schema_version: 1, ok: true, ...postEntry, image_generation_status: artwork.imageStatus, image_generation_error: artwork.imageError, days: window.days, window: { start: window.start.toISOString(), end: window.end.toISOString(), label: window.dateLabel, mode: window.mode }, created_at: createdAt });
    await putJson(OUT_BLOG_BUCKET_KEY, manifestKey, mergedManifest);
    const publishedManifest = await loadExistingPostsManifest(OUT_BLOG_BUCKET_KEY, manifestKey);
    const rss = await publishSocialBlogRssFeed({ manifest: publishedManifest, prefix });
    const rebuild = await triggerWebsiteRebuild();
    info("blog.social.daily.build.success", { dateId: window.dateId, postUrl: urls.postUrl, postMetaUrl: urls.postMetaUrl, postsManifestUrl: urls.postsManifestUrl, rssFeedUrl: rss.feedUrl, imageUrl, imageStatus: artwork.imageStatus, sourceCount: cleanedSources.length, themeCount: socialPackage.themes.length });
    return { ok: true, dateId: window.dateId, days: window.days, title, slug, summary: socialPackage.summary, social_caption: socialPackage.social_caption, postPath: urls.postPath, postUrl: urls.postUrl, postMetaUrl: urls.postMetaUrl, postsManifestUrl: urls.postsManifestUrl, socialHubUrl: urls.socialHubUrl, imageUrl, imageStatus: artwork.imageStatus, imageError: artwork.imageError, rssFeedUrl: rss.feedUrl, rss, publishedObjects, sourceCount: cleanedSources.length, rebuild };
  } catch (e) {
    error("blog.social.daily.build.fail", { error: e.message, stack: e.stack });
    return { ok: false, error: e.message };
  }
}
