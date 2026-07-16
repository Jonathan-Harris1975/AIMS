import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { rankAndSelectStories } from "../services/newsletter/engine/rank.js";

function item(overrides = {}) {
  return {
    title: "Untitled",
    link: "https://example.com/a",
    sourceFeed: "https://example.com/feed",
    summary: "",
    publishedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("newsletter engine/rank.js", () => {
  test("returns null lead and empty stories for an empty input", () => {
    const result = rankAndSelectStories([], { storyCount: 10 });
    assert.equal(result.lead, null);
    assert.deepEqual(result.stories, []);
  });

  test("selects the highest-scoring item as lead", () => {
    const now = new Date("2026-07-16T12:00:00Z");
    const items = [
      item({ title: "Old AI news", link: "https://a.com/1", publishedAt: new Date(now.getTime() - 20 * 3600 * 1000).toISOString() }),
      item({
        title: "OpenAI ships new Claude-beating model",
        link: "https://a.com/2",
        summary: "OpenAI announced a new large language model today with major benchmark gains across reasoning tasks.",
        publishedAt: now.toISOString(),
      }),
    ];
    const { lead } = rankAndSelectStories(items, { storyCount: 5, now });
    assert.equal(lead.link, "https://a.com/2");
  });

  test("caps the number of stories per source feed for diversity", () => {
    const now = new Date();
    const items = Array.from({ length: 6 }, (_, i) =>
      item({ title: `Story ${i}`, link: `https://a.com/${i}`, sourceFeed: "https://a.com/feed", publishedAt: now.toISOString() })
    );
    const { lead, stories, droppedForDiversity } = rankAndSelectStories(items, { storyCount: 5, maxPerSourceFeed: 3, now });
    const total = 1 + stories.length; // lead + stories
    assert.ok(total <= 3, "should not exceed maxPerSourceFeed across lead+stories from one feed");
    assert.ok(droppedForDiversity.length > 0);
  });

  test("never returns more than storyCount + 1 items total", () => {
    const now = new Date();
    const items = Array.from({ length: 20 }, (_, i) =>
      item({ title: `Story ${i}`, link: `https://a.com/${i}`, sourceFeed: `https://feed${i}.com`, publishedAt: now.toISOString() })
    );
    const { lead, stories } = rankAndSelectStories(items, { storyCount: 10, now });
    assert.equal(1 + stories.length <= 11, true);
    assert.ok(lead);
  });
});
