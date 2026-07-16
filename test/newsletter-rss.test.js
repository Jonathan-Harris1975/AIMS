import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { withinWindow, collectCandidateStories, fetchFeedResilient } from "../services/newsletter/engine/rss.js";

describe("newsletter engine/rss.js — withinWindow (pure)", () => {
  test("accepts an item published within the window", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const item = { publishedAt: new Date("2026-07-16T02:00:00Z").toISOString() };
    assert.equal(withinWindow(item, { now, windowHours: 24 }), true);
  });

  test("rejects an item published before the window", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const item = { publishedAt: new Date("2026-07-14T02:00:00Z").toISOString() };
    assert.equal(withinWindow(item, { now, windowHours: 24 }), false);
  });

  test("rejects an item with no publish date", () => {
    assert.equal(withinWindow({ publishedAt: null }, { now: new Date(), windowHours: 24 }), false);
  });
});

describe("newsletter engine/rss.js — network behaviour", () => {
  let server;
  let baseUrl;
  let requestLog = [];

  before(async () => {
    server = http.createServer((req, res) => {
      requestLog.push(req.url);

      if (req.url === "/good-feed.xml") {
        const now = new Date().toUTCString();
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        res.end(`<?xml version="1.0"?>
<rss version="2.0"><channel>
<title>Test Feed</title>
<item><title>Story A</title><link>https://source.example.com/a</link><pubDate>${now}</pubDate><description>About story A</description></item>
<item><title>Story A</title><link>https://source.example.com/a?utm_source=x</link><pubDate>${now}</pubDate><description>Duplicate of A via tracking param</description></item>
<item><title>Story B</title><link>https://source.example.com/b</link><pubDate>${now}</pubDate><description>About story B</description></item>
</channel></rss>`);
        return;
      }

      if (req.url === "/malformed-feed.xml") {
        res.writeHead(200, { "Content-Type": "application/rss+xml" });
        res.end("<rss><channel><item><title>Broken</title" /* truncated, invalid XML */);
        return;
      }

      res.writeHead(404);
      res.end("not found");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  test("fetchFeedResilient returns items for a valid feed", async () => {
    const result = await fetchFeedResilient(`${baseUrl}/good-feed.xml`, { retries: 0 });
    assert.equal(result.ok, true);
    assert.equal(result.items.length, 3);
  });

  test("fetchFeedResilient fails gracefully (does not throw) on a malformed feed", async () => {
    const result = await fetchFeedResilient(`${baseUrl}/malformed-feed.xml`, { retries: 0 });
    assert.equal(result.ok, false);
    assert.ok(result.error);
  });

  test("collectCandidateStories dedupes by canonical link and skips a broken feed without failing the run", async () => {
    requestLog = [];
    const profile = { id: "test-profile", feedUrls: [`${baseUrl}/good-feed.xml`, `${baseUrl}/malformed-feed.xml`] };
    const { items, feedResults } = await collectCandidateStories(profile, { now: new Date() });

    assert.equal(items.length, 2, "Story A duplicate (tracking param) should be deduped");
    const titles = items.map((i) => i.title).sort();
    assert.deepEqual(titles, ["Story A", "Story B"]);
    assert.equal(feedResults.some((r) => !r.ok), true, "malformed feed should be reported as failed");
    assert.equal(feedResults.some((r) => r.ok), true, "good feed should still succeed");
  });
});
