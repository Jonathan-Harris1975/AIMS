import { info } from "../../../logger.js";
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

  await putText(rssBucketKey, rssObjectKey, xml, "application/rss+xml; charset=utf-8");

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
