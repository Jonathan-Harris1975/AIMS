const DEFAULT_FEED_TITLE = "Jonathan Harris | Weekly AI Briefings";
const DEFAULT_FEED_DESCRIPTION = "Weekly AI briefings from Jonathan Harris. Plain English, sharp judgement, no AI perfume.";
const DEFAULT_FEED_LANGUAGE = "en-gb";
const DEFAULT_FEED_IMAGE = "https://images.jonathan-harris.online/site-logo";
const DEFAULT_FEED_GENERATOR = "AI Management Suite blog service";

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

function toUtcRssDate(value) {
  const parsed = Date.parse(String(value || ""));
  if (!Number.isFinite(parsed)) {
    return "";
  }
  return new Date(parsed).toUTCString();
}

function cdata(value) {
  return `<![CDATA[${String(value ?? "").replace(/]]>/g, "]]]]><![CDATA[>")}]]>`;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function splitUrlSuffix(value = "") {
  const match = String(value || "").match(/^([^?#]*)([?#].*)?$/);

  return {
    base: match?.[1] || "",
    suffix: match?.[2] || "",
  };
}

function ensureSocialPostIndexUrl(value = "") {
  const url = cleanString(value);
  if (!url || !/\/blog\/social\/posts\//i.test(url)) return url;

  const { base, suffix } = splitUrlSuffix(url);

  if (/\/index\.html$/i.test(base)) {
    return `${base}${suffix}`;
  }

  if (base.endsWith("/")) {
    return `${base}index.html${suffix}`;
  }

  return `${base}/index.html${suffix}`;
}

export function normaliseBlogManifestItems(payload = {}) {
  const rawItems = Array.isArray(payload?.items)
    ? payload.items
    : Array.isArray(payload?.posts)
      ? payload.posts
      : [];

  return rawItems
    .map((item) => {
      const title = cleanString(item?.title) || cleanString(item?.headline);
      const url = cleanString(item?.url) || cleanString(item?.canonical_url) || cleanString(item?.link);
      const summary = cleanString(item?.summary) || cleanString(item?.excerpt) || cleanString(item?.description);
      const publishedAt = cleanString(item?.published_at) || cleanString(item?.published) || cleanString(item?.pubDate) || cleanString(item?.datePublished);
      const imageUrl = cleanString(item?.image) || cleanString(item?.image_url);
      const themes = Array.isArray(item?.themes)
        ? item.themes.map(cleanString).filter(Boolean)
        : [];

      if (!title || !url) {
        return null;
      }

      return {
        title,
        url,
        summary,
        publishedAt,
        imageUrl,
        themes,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b?.publishedAt || "").localeCompare(String(a?.publishedAt || "")));
}

export function buildBlogRssXml({
  manifest,
  feedUrl,
  channelLink,
  title = DEFAULT_FEED_TITLE,
  description = DEFAULT_FEED_DESCRIPTION,
  language = DEFAULT_FEED_LANGUAGE,
  imageUrl = DEFAULT_FEED_IMAGE,
  generator = DEFAULT_FEED_GENERATOR,
} = {}) {
  const items = normaliseBlogManifestItems(manifest);
  const lastBuildDate = toUtcRssDate(manifest?.updated_at) || new Date().toUTCString();
  const channelHref = cleanString(channelLink);
  const selfHref = cleanString(feedUrl);

  const parts = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0"',
    '  xmlns:atom="http://www.w3.org/2005/Atom"',
    '  xmlns:content="http://purl.org/rss/1.0/modules/content/">',
    '<channel>',
    tag("title", title),
    channelHref ? tag("link", channelHref) : "",
    tag("description", description),
    tag("language", language),
    tag("lastBuildDate", lastBuildDate),
    tag("ttl", "60"),
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
    const contentHtml = [
      item.summary ? `<p>${escapeHtml(item.summary)}</p>` : "",
      `<p><a href="${escapeHtml(item.url)}">Read the full briefing</a></p>`,
    ].filter(Boolean).join("");

    parts.push("<item>");
    parts.push(tag("title", item.title));
    parts.push(tag("link", item.url));
    parts.push(`<guid isPermaLink="true">${escapeXml(item.url)}</guid>`);
    parts.push(tag("pubDate", itemPubDate));

    if (item.summary) {
      parts.push(tag("description", item.summary));
    }

    parts.push(`<content:encoded>${cdata(contentHtml)}</content:encoded>`);

    for (const theme of item.themes) {
      parts.push(tag("category", theme));
    }

    parts.push("</item>");
  }

  parts.push("</channel>");
  parts.push("</rss>");

  return parts.join("\n");
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
      const rawUrl = cleanString(item?.url) || cleanString(item?.link) || cleanString(item?.canonical_url);
      const url = ensureSocialPostIndexUrl(rawUrl);
      const path = cleanString(item?.path);
      const isSocialPath = /\/blog\/social\/posts\//i.test(`${url} ${path}`);
      const explicitSocialCaption = cleanString(item?.social_caption);
      const hasSocialFields = Boolean(explicitSocialCaption || cleanString(item?.hook) || cleanString(item?.takeaway));

      if (!isSocialPath && !hasSocialFields) return null;

      const summary = cleanString(item?.summary) || cleanString(item?.excerpt) || cleanString(item?.description);
      const socialCaption = explicitSocialCaption || cleanString(item?.description) || summary;
      const publishedAt = cleanString(item?.published_at) || cleanString(item?.published) || cleanString(item?.pubDate) || cleanString(item?.datePublished);
      const imageUrl = cleanString(item?.image) || cleanString(item?.image_url);
      const themes = Array.isArray(item?.themes) ? item.themes.map(cleanString).filter(Boolean) : [];
      const hashtags = Array.isArray(item?.hashtags) ? item.hashtags.map(cleanString).filter(Boolean) : [];

      if (!title || !url) return null;

      return {
        title,
        url,
        summary,
        socialCaption,
        hook: cleanString(item?.hook),
        bodyHtml: typeof item?.body_html === "string" ? item.body_html.trim() : "",
        takeaway: cleanString(item?.takeaway),
        publishedAt,
        imageUrl,
        themes,
        hashtags,
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b?.publishedAt || "").localeCompare(String(a?.publishedAt || "")));
}

function stripHtmlForRss(value = "") {
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
    parts.push(stripHtmlForRss(item.bodyHtml));
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
  title = "Jonathan Harris | Daily AI Social Briefings",
  description = "Daily AI briefing posts built for social media: sharp, visual, grounded, and no-hype.",
  language = DEFAULT_FEED_LANGUAGE,
  imageUrl = DEFAULT_FEED_IMAGE,
  generator = "AI Management Suite social blog service",
  ttl = 60,
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