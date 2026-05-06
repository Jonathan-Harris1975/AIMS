import { info } from "../../../logger.js";
import { buildPublicUrl, getObjectAsText, putText } from "../../shared/utils/r2-client.js";
import { buildSocialBlogRssXml, normaliseSocialBlogManifestItems } from "../utils/rssFeed.js";

const DEFAULT_SOCIAL_PREFIX = "social-media-blog";

function normalisePrefix(value = DEFAULT_SOCIAL_PREFIX) {
  return String(value || DEFAULT_SOCIAL_PREFIX).trim().replace(/^\/+|\/+$/g, "") || DEFAULT_SOCIAL_PREFIX;
}

function joinUrl(base, path) {
  return `${String(base || "").replace(/\/$/, "")}/${String(path || "").replace(/^\//, "")}`;
}

function getSocialPrefix() {
  return normalisePrefix(process.env.BLOG_SOCIAL_PREFIX || DEFAULT_SOCIAL_PREFIX);
}

function getSocialRssObjectKey() {
  return String(process.env.BLOG_SOCIAL_RSS_OBJECT_KEY || `${getSocialPrefix()}/feed.xml`).trim().replace(/^\/+/, "") || `${DEFAULT_SOCIAL_PREFIX}/feed.xml`;
}

async function loadSocialPostsManifest(prefix = getSocialPrefix()) {
  const raw = await getObjectAsText("blog", `${normalisePrefix(prefix)}/posts.json`);
  return JSON.parse(raw);
}

export async function publishSocialBlogRssFeed({ manifest, prefix = getSocialPrefix() } = {}) {
  const rssBucketKey = "blogRss";
  const rssObjectKey = getSocialRssObjectKey();
  const siteBaseUrl = String(process.env.SITE_BASE_URL || "https://jonathan-harris.online").replace(/\/$/, "");
  const channelLink = joinUrl(siteBaseUrl, "/blog/social/");
  const feedUrl = buildPublicUrl(rssBucketKey, rssObjectKey);
  const items = normaliseSocialBlogManifestItems(manifest);

  info("blog.social.rss.publish.start", { rssBucketKey, rssObjectKey, itemCount: items.length, feedUrl });

  const xml = buildSocialBlogRssXml({
    manifest,
    feedUrl,
    channelLink,
    title: process.env.BLOG_SOCIAL_RSS_TITLE || "Jonathan Harris | Daily AI Social Briefings",
    description: process.env.BLOG_SOCIAL_RSS_DESCRIPTION || "Daily AI briefing posts built for social media: sharp, visual, grounded, and no-hype.",
    imageUrl: process.env.BLOG_RSS_IMAGE_URL || "https://images.jonathan-harris.online/site-logo",
    generator: "AI Management Suite social blog service",
  });

  await putText(rssBucketKey, rssObjectKey, xml, "application/rss+xml; charset=utf-8");

  info("blog.social.rss.publish.success", { rssBucketKey, rssObjectKey, itemCount: items.length, feedUrl });

  return { ok: true, bucketKey: rssBucketKey, objectKey: rssObjectKey, feedUrl, itemCount: items.length, socialHubUrl: channelLink, prefix: normalisePrefix(prefix) };
}

export async function rebuildSocialBlogRssFeed({ prefix = getSocialPrefix() } = {}) {
  const manifest = await loadSocialPostsManifest(prefix);
  return publishSocialBlogRssFeed({ manifest, prefix });
}
