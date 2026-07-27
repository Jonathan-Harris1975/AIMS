import test from "node:test";
import assert from "node:assert/strict";
import { fetchLatestPodcastEpisode } from "../services/zernio/utils/podcastRssFeed.js";
import { buildPodcastPromoPrompt } from "../services/zernio/utils/prompts.js";

test("podcast RSS helper selects latest episode metadata", async () => {
  const xml = `<?xml version="1.0"?><rss version="2.0"><channel><title>Turing's Torch</title>
  <item><title>Older</title><pubDate>Fri, 17 Jul 2026 08:00:00 GMT</pubDate><link>https://example.com/older</link><description>Old.</description></item>
  <item><title>New Episode</title><pubDate>Fri, 24 Jul 2026 08:00:00 GMT</pubDate><link>https://example.com/new</link><description>AI agents meet the boring reality of deployment.</description></item>
  </channel></rss>`;
  const episode = await fetchLatestPodcastEpisode({ feedUrl: "https://example.com/feed.xml", fetchImpl: async () => ({ ok: true, text: async () => xml }) });
  assert.equal(episode.title, "New Episode");
  assert.equal(episode.link, "https://example.com/new");
});

test("Thursday promo forbids alternate podcast audio", () => {
  const prompt = buildPodcastPromoPrompt({ publishDate: "2026-07-30", episode: { title: "Test", description: "Test description" } });
  assert.match(prompt.system, /not a second podcast performance/i);
  assert.match(prompt.system, /never synthesise or replace the programme voice/i);
  assert.match(prompt.system, /Do not write a voiceover/i);
  assert.match(prompt.user, /lands Friday/i);
});
