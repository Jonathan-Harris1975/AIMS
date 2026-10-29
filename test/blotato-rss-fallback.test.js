import test from "node:test";
import assert from "node:assert/strict";
import { parseFeedPayload, selectRssArticleForBlotato } from "../services/blotato/utils/rssArticleSource.js";

test("Blotato receives a clearly labelled evergreen fallback when every RSS source fails", async () => {
  const result = await selectRssArticleForBlotato({
    laneSlug: "news-insight",
    fallbackKey: "PM",
    loaders: [
      { label: "stale-r2", run: async () => { throw new Error("R2 unavailable"); } },
      { label: "upstream", run: async () => { throw new Error("HTTP 521"); } },
    ],
  });
  assert.equal(result.deterministicFallback, true);
  assert.equal(result.rssSource, "deterministic-evergreen-fallback");
  assert.equal(result.itemCount, 0);
  assert.equal(result.article.title, "A practical AI workflow check — PM");
  assert.equal(result.article.source, "Jonathan Harris editorial fallback");
  assert.equal(result.article.link, undefined);
  assert.match(result.article.guid, /^aims-editorial-fallback:/);
  assert.match(result.article.summary, /one real task/);
});

test("Blotato uses a usable RSS story instead of the evergreen fallback", async () => {
  const result = await selectRssArticleForBlotato({
    laneSlug: "news-insight",
    loaders: [{ label: "feed", run: async () => [{
      title: "A source-grounded AI story",
      summary: "A specific report with a verified link.",
      link: "https://source.example/story",
      source: "Example publication",
    }] }],
  });
  assert.equal(result.deterministicFallback, undefined);
  assert.equal(result.rssSource, "feed");
  assert.equal(result.article.title, "A source-grounded AI story");
});


test("Blotato unwraps the observed RSS JSON CDATA description before using it as source evidence", async () => {
  const rows = await parseFeedPayload(JSON.stringify({ rss: { channel: { title: "AI news", item: [{
    title: "Drunken Text Makes Chatbots Leak Secrets",
    description: { __cdata: "<p>Researchers trained language models on drunken text and exposed security weaknesses.</p>" },
    link: "https://source.example/drunken-text",
  }] } } }), "observed-json-feed");
  assert.equal(rows[0].summary, "Researchers trained language models on drunken text and exposed security weaknesses.");
  assert.equal(rows[0].summary.includes("[object Object]"), false);
});

test("an unsupported summary object cannot hide a usable nested description", async () => {
  const rows = await parseFeedPayload(JSON.stringify({ items: [{ title: "Grounded AI", summary: {},
    description: { "#text": "Verified evidence from the source." }, link: "https://source.example/evidence" }] }), "nested-feed");
  assert.equal(rows[0].summary, "Verified evidence from the source.");
});
