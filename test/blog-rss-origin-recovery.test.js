import test from "node:test";
import assert from "node:assert/strict";
import { fetchBlogRssOriginItems } from "../services/zernio/utils/blogRssFeed.js";

test("origin recovery preserves published caption, date, source and generated artwork", async () => {
  const old = process.env.ZERNIO_BLOG_RSS_FEED_URL;
  delete process.env.ZERNIO_BLOG_RSS_FEED_URL;
  try {
    const result = await fetchBlogRssOriginItems(async (bucket, key) => {
      assert.equal(bucket, "blog");
      assert.equal(key, "social-media-blog/posts.json");
      return JSON.stringify({ items: [{ title: "Today's briefing", slug: "2026-10-30-daily-ai-briefing",
        social_caption: "Published social caption.", published_at: "2026-10-30T08:00:00Z",
        image_url: "https://images.example/today.png" }] });
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].caption, "Published social caption.");
    assert.equal(result.items[0].imageUrl, "https://images.example/today.png");
    assert.equal(result.items[0].pubDate, "2026-10-30T08:00:00.000Z");
    process.env.ZERNIO_BLOG_RSS_FEED_URL = "https://other.example/feed.xml";
    assert.equal(await fetchBlogRssOriginItems(() => { throw new Error("must not substitute origin for a custom feed"); }), null);
  } finally {
    if (old === undefined) delete process.env.ZERNIO_BLOG_RSS_FEED_URL;
    else process.env.ZERNIO_BLOG_RSS_FEED_URL = old;
  }
});
