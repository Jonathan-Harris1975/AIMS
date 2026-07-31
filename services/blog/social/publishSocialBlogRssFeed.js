import { info } from "../../../logger.js";
import { buildPublicUrl, getObjectAsText, putText } from "../../shared/utils/r2-client.js";

const DEFAULT_SOCIAL_PREFIX = "social-media-blog";
const DEFAULT_SOCIAL_PUBLIC_BASE_URL = "https://blog.jonathan-harris.online/social-media-blog";
const DEFAULT_SOCIAL_PUBLIC_POSTS_BASE_URL = "https://blog.jonathan-harris.online/social-media-blog/posts";
const DEFAULT_FEED_TITLE = "Jonathan Harris | Daily AI Social Briefings";
const DEFAULT_FEED_DESCRIPTION = "Daily AI briefing posts built for social media: sharp, visual, grounded, and no-hype.";
const DEFAULT_FEED_LANGUAGE = "en-gb";
const DEFAULT_FEED_IMAGE = "https://images.jonathan-harris.online/site-logo";
const DEFAULT_FEED_GENERATOR = "AI Management Suite social blog service";
const DEFAULT_FEED_TTL = 60;

function normalisePrefix(value = DEFAULT_SOCIAL_PREFIX) {
  return String(value || DEFAULT_SOCIAL_PREFIX)
    .trim()
    .replace(/^\/+|\/+$/g, "") || DEFAULT_SOCIAL_PREFIX;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function tag(name, value) {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function cdata(value) {
  return `<![CDATA[${String(value ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function toUtcRssDate(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toUTCString() : "";
}

function splitUrlSuffix(value = "") {
  const match = String(value || "").match(/^([^?#]*)([?#].*)?$/);

  return {
    base: match?.[1] || "",
    suffix: match?.[2] || "",
  };
}

function getSocialPrefix() {
  return normalisePrefix(process.env.BLOG_SOCIAL_PREFIX || DEFAULT_SOCIAL_PREFIX);
}

function getSocialPublicBaseUrl() {
  return String(
    process.env.BLOG_SOCIAL_PUBLIC_BASE_URL ||
    DEFAULT_SOCIAL_PUBLIC_BASE_URL,
  )
    .trim()
    .replace(/\/$/, "");
}

function getSocialPublicPostsBaseUrl() {
  return String(
    process.env.BLOG_SOCIAL_PUBLIC_POSTS_BASE_URL ||
    DEFAULT_SOCIAL_PUBLIC_POSTS_BASE_URL,
  )
    .trim()
    .replace(/\/$/, "");
}

function getSocialRssObjectKey() {
  return String(process.env.BLOG_SOCIAL_RSS_OBJECT_KEY || `${getSocialPrefix()}/feed.xml`)
    .trim()
    .replace(/^\/+/, "") || `${DEFAULT_SOCIAL_PREFIX}/feed.xml`;
}

function extractSlugFromSocialUrl(value = "") {
  const cleaned = cleanString(value);

  return cleaned.match(/\/(?:blog\/social|social-media-blog)\/posts\/([^/?#]+)\/?(?:index\.html)?(?:[?#].*)?$/i)?.[1] || "";
}

function ensureIndexUrl(value = "") {
  const url = cleanString(value);
  if (!url) return "";

  const { base, suffix } = splitUrlSuffix(url);

  if (/\/index\.html$/i.test(base)) {
    return `${base}${suffix}`;
  }

  if (base.endsWith("/")) {
    return `${base}index.html${suffix}`;
  }

  return `${base}/index.html${suffix}`;
}

function buildPublicPostUrl(item = {}) {
  const rawUrl = cleanString(item?.url) ||
    cleanString(item?.link) ||
    cleanString(item?.canonical_url);

  const rawPath = cleanString(item?.path);

  const slug = cleanString(item?.slug) ||
    extractSlugFromSocialUrl(rawUrl) ||
    extractSlugFromSocialUrl(rawPath);

  if (slug) {
    return joinUrl(getSocialPublicPostsBaseUrl(), `/${encodeURIComponent(slug)}/index.html`);
  }

  if (/\/social-media-blog\/posts\//i.test(rawUrl)) {
    return ensureIndexUrl(rawUrl);
  }

  if (/\/blog\/social\/posts\//i.test(rawUrl)) {
    return ensureIndexUrl(
      rawUrl.replace(
        /https?:\/\/[^/]+\/blog\/social\/posts\//i,
        `${getSocialPublicPostsBaseUrl()}/`,
      ),
    );
  }

  return ensureIndexUrl(rawUrl);
}

function normaliseList(values = []) {
  return Array.isArray(values)
    ? values.map(cleanString).filter(Boolean)
    : [];
}

function looksLikeSocialPost(item = {}, url = "") {
  const haystack = `${url} ${cleanString(item?.path)}`;

  if (/\/(?:blog\/social|social-media-blog)\/posts\//i.test(haystack)) {
    return true;
  }

  return Boolean(
    cleanString(item?.social_caption) ||
    cleanString(item?.hook) ||
    cleanString(item?.takeaway),
  );
}

export function normaliseSocialBlogManifestItems(payload = {}) {
  const rawItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.posts)
      ? payload.posts
      : [];

  return rawItems
    .map((item) => {
      const title = cleanString(item?.title) || cleanString(item?.headline);
      const url = buildPublicPostUrl(item);

      if (!looksLikeSocialPost(item, url)) return null;
      if (!title || !url) return null;

      const summary = cleanString(item?.summary) ||
        cleanString(item?.excerpt) ||
        cleanString(item?.description);

      const socialCaption = cleanString(item?.social_caption) ||
        cleanString(item?.description) ||
        summary;

      const publishedAt = cleanString(item?.published_at) ||
        cleanString(item?.published) ||
        cleanString(item?.pubDate) ||
        cleanString(item?.datePublished);

      const imageUrl = cleanString(item?.image) || cleanString(item?.image_url);
      const bodyHtml = typeof item?.body_html === "string" ? item.body_html.trim() : "";

      return {
        title,
        url,
        summary,
        socialCaption,
        hook: cleanString(item?.hook),
        bodyHtml,
        takeaway: cleanString(item?.takeaway),
        publishedAt,
        imageUrl,
        themes: normaliseList(item?.themes),
        hashtags: normaliseList(item?.hashtags),
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b?.publishedAt || "").localeCompare(String(a?.publishedAt || "")));
}

function stripUnsafeHtml(value = "") {
  return String(value || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .trim();
}

function buildSocialContentHtml(item = {}) {
  const parts = [];

  if (item.imageUrl) {
    parts.push(`<p><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.title)}" /></p>`);
  }

  if (item.hook) {
    parts.push(`<p><strong>${escapeHtml(item.hook)}</strong></p>`);
  }

  if (item.bodyHtml) {
    parts.push(stripUnsafeHtml(item.bodyHtml));
  } else if (item.summary) {
    parts.push(`<p>${escapeHtml(item.summary)}</p>`);
  }

  if (item.takeaway) {
    parts.push(`<p><strong>Takeaway:</strong> ${escapeHtml(item.takeaway)}</p>`);
  }

  parts.push(`<p><a href="${escapeHtml(item.url)}">Read the full daily briefing</a></p>`);

  return parts.filter(Boolean).join("\n");
}

export function buildSocialBlogRssXml({
  manifest,
  feedUrl,
  channelLink,
  title = DEFAULT_FEED_TITLE,
  description = DEFAULT_FEED_DESCRIPTION,
  language = DEFAULT_FEED_LANGUAGE,
  imageUrl = DEFAULT_FEED_IMAGE,
  generator = DEFAULT_FEED_GENERATOR,
  ttl = DEFAULT_FEED_TTL,
} = {}) {
  const items = normaliseSocialBlogManifestItems(manifest);
  const lastBuildDate = toUtcRssDate(manifest?.updated_at) || new Date().toUTCString();
  const channelHref = cleanString(channelLink);
  const selfHref = cleanString(feedUrl);

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"',
    '  xmlns:atom="http://www.w3.org/2005/Atom"',
    '  xmlns:content="http://purl.org/rss/1.0/modules/content/"',
    '  xmlns:media="http://search.yahoo.com/mrss/">',
    "<channel>",
    tag("title", title),
    channelHref ? tag("link", channelHref) : "",
    tag("description", description),
    tag("language", language),
    tag("lastBuildDate", lastBuildDate),
    tag("ttl", String(ttl)),
    tag("generator", generator),
    selfHref ? `<atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml" />` : "",
    imageUrl ? [
      "<image>",
      tag("url", imageUrl),
      channelHref ? tag("link", channelHref) : "",
      tag("title", title),
      "</image>",
    ].join("\n") : "",
  ].filter(Boolean);

  for (const item of items) {
    const itemPubDate = toUtcRssDate(item.publishedAt) || lastBuildDate;
    const descriptionText = item.socialCaption || item.summary;
    const categories = [...new Set([...item.themes, ...item.hashtags].map(cleanString).filter(Boolean))];

    parts.push("<item>");
    parts.push(tag("title", item.title));
    parts.push(tag("link", item.url));
    parts.push(`<guid isPermaLink="true">${escapeXml(item.url)}</guid>`);
    parts.push(tag("pubDate", itemPubDate));

    if (descriptionText) {
      parts.push(tag("description", descriptionText));
    }

    parts.push(`<content:encoded>${cdata(buildSocialContentHtml(item))}</content:encoded>`);

    for (const category of categories) {
      parts.push(tag("category", category));
    }

    if (item.imageUrl) {
      const safeImage = escapeXml(item.imageUrl);

      parts.push(`<enclosure url="${safeImage}" type="image/png" />`);
      parts.push(`<media:content url="${safeImage}" medium="image" type="image/png" />`);
      parts.push(`<media:thumbnail url="${safeImage}" />`);
    }

    parts.push("</item>");
  }

  parts.push("</channel>");
  parts.push("</rss>");

  return parts.join("\n");
}

async function loadSocialPostsManifest(prefix = getSocialPrefix()) {
  const raw = await getObjectAsText("blog", `${normalisePrefix(prefix)}/posts.json`);
  return JSON.parse(raw);
}

export async function publishSocialBlogRssFeed({
  manifest,
  prefix = getSocialPrefix(),
} = {}) {
  const rssBucketKey = "blogRss";
  const rssObjectKey = getSocialRssObjectKey();
  const channelLink = getSocialPublicBaseUrl();
  const feedUrl = buildPublicUrl(rssBucketKey, rssObjectKey);
  const items = normaliseSocialBlogManifestItems(manifest);

  info("blog.social.rss.publish.start", {
    rssBucketKey,
    rssObjectKey,
    itemCount: items.length,
    feedUrl,
    channelLink,
  });

  const xml = buildSocialBlogRssXml({
    manifest,
    feedUrl,
    channelLink,
    title: process.env.BLOG_SOCIAL_RSS_TITLE || DEFAULT_FEED_TITLE,
    description: process.env.BLOG_SOCIAL_RSS_DESCRIPTION || DEFAULT_FEED_DESCRIPTION,
    imageUrl: process.env.BLOG_RSS_IMAGE_URL || DEFAULT_FEED_IMAGE,
    generator: DEFAULT_FEED_GENERATOR,
  });

  await putText(rssBucketKey, rssObjectKey, xml, "application/rss+xml; charset=utf-8");

  info("blog.social.rss.publish.success", {
    rssBucketKey,
    rssObjectKey,
    itemCount: items.length,
    feedUrl,
    channelLink,
  });

  return {
    ok: true,
    bucketKey: rssBucketKey,
    objectKey: rssObjectKey,
    feedUrl,
    itemCount: items.length,
    socialHubUrl: channelLink,
    prefix: normalisePrefix(prefix),
  };
}

export async function rebuildSocialBlogRssFeed({
  prefix = getSocialPrefix(),
} = {}) {
  const manifest = await loadSocialPostsManifest(prefix);
  return publishSocialBlogRssFeed({ manifest, prefix });
}
