import test from "node:test";
import assert from "node:assert/strict";

import { buildBlogRssXml, normaliseBlogManifestItems } from "../services/blog/utils/rssFeed.js";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) {
      delete process.env[key];
    }
  }

  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

test.afterEach(() => {
  restoreEnv();
});

test("buildBlogRssXml emits the post URL from the blog manifest and a self-link for the feed", () => {
  const xml = buildBlogRssXml({
    manifest: {
      updated_at: "2026-04-22T08:00:00.000Z",
      items: [
        {
          title: "What Actually Mattered in AI",
          url: "https://jonathan-harris.online/blog/posts/2026-w16-what-actually-mattered/",
          summary: "Sharp weekly summary.",
          published_at: "2026-04-22T08:00:00.000Z",
          themes: ["Models", "Regulation"],
        },
      ],
    },
    feedUrl: "https://blog-rss.jonathan-harris.online/feed.xml",
    channelLink: "https://jonathan-harris.online/blog/",
  });

  assert.match(xml, /<atom:link href="https:\/\/blog-rss\.jonathan-harris\.online\/feed\.xml" rel="self" type="application\/rss\+xml" \/>/);
  assert.match(xml, /<link>https:\/\/jonathan-harris\.online\/blog\/posts\/2026-w16-what-actually-mattered\/<\/link>/);
  assert.match(xml, /<guid isPermaLink="true">https:\/\/jonathan-harris\.online\/blog\/posts\/2026-w16-what-actually-mattered\/<\/guid>/);
  assert.match(xml, /<category>Models<\/category>/);
  assert.match(xml, /<category>Regulation<\/category>/);
});

test("normaliseBlogManifestItems keeps the latest published post first", () => {
  const items = normaliseBlogManifestItems({
    items: [
      {
        title: "Older briefing",
        url: "https://jonathan-harris.online/blog/posts/older/",
        published_at: "2026-04-15T08:00:00.000Z",
      },
      {
        title: "Latest briefing",
        url: "https://jonathan-harris.online/blog/posts/latest/",
        published_at: "2026-04-22T08:00:00.000Z",
      },
    ],
  });

  assert.equal(items[0].title, "Latest briefing");
  assert.equal(items[1].title, "Older briefing");
});
