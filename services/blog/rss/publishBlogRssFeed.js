import { info, warn } from "../../../logger.js";
import { buildPublicUrl, getObjectAsText, putText } from "../../shared/utils/r2-client.js";
import { buildBlogRssXml, normaliseBlogManifestItems } from "../utils/rssFeed.js";

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`;
}

function buildSiteBlogBaseUrls(prefix = "blog") {
  const siteBaseUrl = String(process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const normalisedPrefix = String(prefix || "blog").replace(/^\/+|\/+$/g, "") || "blog";
  const blogBasePath = `/${normalisedPrefix}`;

  return {
    siteBaseUrl,
    blogBasePath,
    blogHubUrl: joinUrl(siteBaseUrl, `${blogBasePath}/`),
    weeklyArchiveUrl: joinUrl(siteBaseUrl, `${blogBasePath}/weekly/`),
  };
}

async function loadPostsManifest(prefix = "blog") {
  const normalisedPrefix = String(prefix || "blog").replace(/^\/+|\/+$/g, "") || "blog";
  const manifestKey = `${normalisedPrefix}/posts.json`;
  const raw = await getObjectAsText("blog", manifestKey);
  return JSON.parse(raw);
}

function positiveInteger(value, fallback, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(Math.floor(parsed), maximum);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheBustUrl(rawUrl, attempt) {
  const url = new URL(rawUrl);
  url.searchParams.set("_jh_publish_bust", `${Date.now()}-${attempt}`);
  return url.toString();
}

export async function verifyPublicBlogRssFeed({
  feedUrl,
  expectedPostUrl,
  fetchImpl = globalThis.fetch,
  sleepImpl = sleep,
  attempts = positiveInteger(process.env.BLOG_RSS_PUBLIC_VERIFY_ATTEMPTS, 5, 10),
  baseDelayMs = positiveInteger(process.env.BLOG_RSS_PUBLIC_VERIFY_BASE_MS, 750, 10000),
  timeoutMs = positiveInteger(process.env.BLOG_RSS_PUBLIC_VERIFY_TIMEOUT_MS, 10000, 60000),
} = {}) {
  const targetFeedUrl = String(feedUrl || "").trim();
  const targetPostUrl = String(expectedPostUrl || "").trim();

  if (!targetFeedUrl || !targetPostUrl || typeof fetchImpl !== "function") {
    return {
      ok: false,
      reason: "missing-verification-input",
      feedUrl: targetFeedUrl || null,
      expectedPostUrl: targetPostUrl || null,
    };
  }

  let lastError = null;
  let lastStatus = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(cacheBustUrl(targetFeedUrl, attempt), {
        method: "GET",
        cache: "no-store",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "Cache-Control": "no-cache, no-store, max-age=0",
          Pragma: "no-cache",
        },
      });
      lastStatus = response?.status ?? null;
      const body = await response.text().catch(() => "");
      if (response.ok && body.includes(targetPostUrl)) {
        return {
          ok: true,
          attempt,
          status: response.status,
          feedUrl: targetFeedUrl,
          expectedPostUrl: targetPostUrl,
        };
      }
      lastError = response.ok
        ? new Error("freshly published post URL is not visible in the public RSS body")
        : new Error(`public RSS returned HTTP ${response.status}`);
    } catch (verifyError) {
      lastError = verifyError;
    } finally {
      clearTimeout(timer);
    }

    if (attempt < attempts) {
      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      warn("blog.rss.public.verify.retry", {
        attempt,
        attempts,
        delayMs,
        status: lastStatus,
        error: lastError?.message || "Unknown public RSS verification error",
      });
      await sleepImpl(delayMs);
    }
  }

  return {
    ok: false,
    reason: "public-rss-not-fresh-after-publish",
    attempts,
    status: lastStatus,
    feedUrl: targetFeedUrl,
    expectedPostUrl: targetPostUrl,
    error: lastError?.message || "Unknown public RSS verification error",
  };
}

export async function publishBlogRssFeed({ manifest, prefix = "blog" } = {}) {
  const rssBucketKey = "blogRss";
  const rssObjectKey = String(process.env.BLOG_RSS_OBJECT_KEY || "feed.xml").trim().replace(/^\/+/, "") || "feed.xml";
  const urls = buildSiteBlogBaseUrls(prefix);
  const feedUrl = String(process.env.BLOG_RSS_FEED_URL || "").trim() || buildPublicUrl(rssBucketKey, rssObjectKey);
  const items = normaliseBlogManifestItems(manifest);

  info("blog.rss.publish.start", {
    rssBucketKey,
    rssObjectKey,
    itemCount: items.length,
    feedUrl,
  });

  const xml = buildBlogRssXml({
    manifest,
    feedUrl,
    channelLink: urls.blogHubUrl,
    title: process.env.BLOG_RSS_TITLE || "Jonathan Harris | Weekly AI Briefings",
    description: process.env.BLOG_RSS_DESCRIPTION || "Weekly AI briefings from Jonathan Harris. Plain English, sharp judgement, no AI perfume.",
    imageUrl: process.env.BLOG_RSS_IMAGE_URL || "https://images.jonathan-harris.online/site-logo",
  });

  await putText(
    rssBucketKey,
    rssObjectKey,
    xml,
    "application/rss+xml; charset=utf-8",
    { cacheControl: "no-cache, no-store, must-revalidate, max-age=0" }
  );

  info("blog.rss.publish.success", {
    rssBucketKey,
    rssObjectKey,
    itemCount: items.length,
    feedUrl,
  });

  return {
    ok: true,
    bucketKey: rssBucketKey,
    objectKey: rssObjectKey,
    feedUrl,
    itemCount: items.length,
    blogHubUrl: urls.blogHubUrl,
    weeklyArchiveUrl: urls.weeklyArchiveUrl,
  };
}

export async function rebuildBlogRssFeed({ prefix = "blog" } = {}) {
  const manifest = await loadPostsManifest(prefix);
  return publishBlogRssFeed({ manifest, prefix });
}
