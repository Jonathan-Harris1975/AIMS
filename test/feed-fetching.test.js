import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFeedText,
  filterAndScoreFeedItems,
} from "../services/script/utils/fetchFeeds.js";

test("parseFeedText accepts JSON feeds", async () => {
  const now = new Date().toUTCString();
  const feed = await parseFeedText(
    JSON.stringify({
      title: "JSON Feed",
      items: [{ title: "Story", pubDate: now, contentSnippet: "x".repeat(150) }],
    })
  );

  assert.equal(feed.title, "JSON Feed");
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, "Story");
});

test("filterAndScoreFeedItems keeps only items inside the requested window", () => {
  const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toUTCString();
  const stale = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toUTCString();

  const items = filterAndScoreFeedItems(
    {
      items: [
        { title: "Recent story with enough title length", pubDate: recent, contentSnippet: "x".repeat(150) },
        { title: "Old story", pubDate: stale, contentSnippet: "x".repeat(150) },
      ],
    },
    7
  );

  assert.equal(items.length, 1);
  assert.equal(items[0].title, "Recent story with enough title length");
  assert.ok(items[0].score > 0);
});
