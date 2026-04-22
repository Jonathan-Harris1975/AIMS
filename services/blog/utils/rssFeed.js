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
    tag('title', title),
    channelHref ? tag('link', channelHref) : '',
    tag('description', description),
    tag('language', language),
    tag('lastBuildDate', lastBuildDate),
    tag('ttl', '60'),
    tag('generator', generator),
    selfHref ? `<atom:link href="${escapeXml(selfHref)}" rel="self" type="application/rss+xml" />` : '',
    imageUrl ? [
      '<image>',
      tag('url', imageUrl),
      channelHref ? tag('link', channelHref) : '',
      tag('title', title),
      '</image>',
    ].join('\n') : '',
  ].filter(Boolean);

  for (const item of items) {
    const itemPubDate = toUtcRssDate(item.publishedAt) || lastBuildDate;
    const contentHtml = [
      item.summary ? `<p>${escapeHtml(item.summary)}</p>` : '',
      `<p><a href="${escapeHtml(item.url)}">Read the full briefing</a></p>`,
    ].filter(Boolean).join('');

    parts.push('<item>');
    parts.push(tag('title', item.title));
    parts.push(tag('link', item.url));
    parts.push(`<guid isPermaLink="true">${escapeXml(item.url)}</guid>`);
    parts.push(tag('pubDate', itemPubDate));
    if (item.summary) {
      parts.push(tag('description', item.summary));
    }
    parts.push(`<content:encoded>${cdata(contentHtml)}</content:encoded>`);
    for (const theme of item.themes) {
      parts.push(tag('category', theme));
    }
    parts.push('</item>');
  }

  parts.push('</channel>');
  parts.push('</rss>');

  return parts.join('\n');
}
