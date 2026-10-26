import test from "node:test";
import assert from "node:assert/strict";
import { selectRssArticleForBlotato } from "../services/blotato/utils/rssArticleSource.js";

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
