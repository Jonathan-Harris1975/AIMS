import test from "node:test";
import assert from "node:assert/strict";

import { buildSocialBlogRssXml, normaliseSocialBlogManifestItems, buildBlogRssXml } from "../services/blog/utils/rssFeed.js";

const imageUrl = "https://images.jonathan-harris.online/social-media-blog/BLOG-SOCIAL-2026-05-06.png";
const manifest = {
  updated_at: "2026-05-06T08:00:00.000Z",
  items: [{
    id: "daily-2026-05-06",
    slug: "2026-05-06-ai-meets-the-plumbing",
    title: "AI meets the awkward plumbing",
    summary: "First sentence. Second sentence.",
    social_caption: "A practical daily AI briefing for social channels, written with enough energy to travel but enough scepticism to stay useful. It keeps the focus on what the source material supports, not launch theatre or invented sparkle.",
    hook: "The useful bit sat under the demo.",
    body_html: "<section><h2>The pressure point</h2><p>Delivery mattered more than gloss.</p></section>",
    takeaway: "Judge the story by delivery, cost and control.",
    url: "https://jonathan-harris.online/blog/social/posts/2026-05-06-ai-meets-the-plumbing/",
    path: "/blog/social/posts/2026-05-06-ai-meets-the-plumbing/",
    image_url: imageUrl,
    published_at: "2026-05-06T08:00:00.000Z",
    themes: ["Infrastructure", "Risk"],
    hashtags: ["#AIReality", "#AIBusiness"],
  }],
};

test("buildSocialBlogRssXml emits the media namespace for social RSS", () => {
  const xml = buildSocialBlogRssXml({ manifest, feedUrl: "https://blog-rss.jonathan-harris.online/social-media-blog/feed.xml", channelLink: "https://jonathan-harris.online/blog/social/" });
  assert.match(xml, /xmlns:media="http:\/\/search\.yahoo\.com\/mrss\/"/);
  assert.match(xml, /<title>Jonathan Harris \| Daily AI Social Briefings<\/title>/);
  assert.match(xml, /<generator>AI Management Suite social blog service<\/generator>/);
});

test("social RSS items expose image enclosure and media tags when imageUrl exists", () => {
  const xml = buildSocialBlogRssXml({ manifest, feedUrl: "https://blog-rss.jonathan-harris.online/social-media-blog/feed.xml", channelLink: "https://jonathan-harris.online/blog/social/" });
  assert.match(xml, new RegExp(`<enclosure url="${imageUrl}" type="image/png" \/>`));
  assert.match(xml, new RegExp(`<media:content url="${imageUrl}" medium="image" type="image/png" \/>`));
  assert.match(xml, new RegExp(`<media:thumbnail url="${imageUrl}" \/>`));
  assert.match(xml, /<description>A practical daily AI briefing for social channels/);
  assert.match(xml, /<category>Infrastructure<\/category>/);
  assert.match(xml, /<category>#AIReality<\/category>/);
});

test("normaliseSocialBlogManifestItems filters weekly posts out of social manifests", () => {
  const items = normaliseSocialBlogManifestItems({ items: [...manifest.items, { title: "Weekly post", url: "https://jonathan-harris.online/blog/posts/2026-w18-weekly-post/", path: "/blog/posts/2026-w18-weekly-post/", summary: "Weekly summary.", published_at: "2026-05-05T08:00:00.000Z" }] });
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "AI meets the awkward plumbing");
});

test("existing weekly RSS builder still emits the weekly feed without media namespace", () => {
  const xml = buildBlogRssXml({ manifest: { updated_at: "2026-05-06T08:00:00.000Z", items: [{ title: "Weekly AI briefing keeps working", url: "https://jonathan-harris.online/blog/posts/2026-w18-weekly-ai-briefing/", summary: "Weekly summary.", published_at: "2026-05-06T08:00:00.000Z", themes: ["Models"] }] }, feedUrl: "https://blog-rss.jonathan-harris.online/feed.xml", channelLink: "https://jonathan-harris.online/blog/" });
  assert.match(xml, /xmlns:content="http:\/\/purl\.org\/rss\/1\.0\/modules\/content\/"/);
  assert.doesNotMatch(xml, /xmlns:media=/);
  assert.match(xml, /<link>https:\/\/jonathan-harris\.online\/blog\/posts\/2026-w18-weekly-ai-briefing\/<\/link>/);
});
