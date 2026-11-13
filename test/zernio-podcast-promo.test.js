import test from "node:test";
import assert from "node:assert/strict";
import { fetchLatestPodcastEpisode, fetchPodcastPromoEpisode } from "../services/zernio/utils/podcastRssFeed.js";
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

test("Thursday podcast promotion selects last week's verified transcript, not tomorrow's draft", async () => {
  const entries = {
    "episode-41.json": JSON.stringify({
      sessionId: "episode-41", title: "AI Security: The Access Problem",
      description: "A practical episode on permissions and agent security.",
      pubDate: "2026-07-24T13:00:00Z", productionComplete: true,
      episodeNumber: 41, episodePageUrl: "https://example.com/podcast/episode-41",
    }),
    "episode-42.json": JSON.stringify({
      sessionId: "episode-42", title: "Unfinished Friday Show",
      description: "This has not yet been published.", pubDate: "2026-07-31T13:00:00Z",
      episodeNumber: 42, productionComplete: false,
    }),
    "episode-41.txt": "Turing's Torch discusses why agents require scoped tool permissions. We cover monitoring and the consequences of excessive access.".repeat(10),
  };
  const episode = await fetchPodcastPromoEpisode({
    publishDate: "2026-07-30", feedUrl: "https://example.com/feed.xml",
    listKeysImpl: async () => ["episode-42.json", "episode-41.json"],
    getObjectAsTextImpl: async (_bucket, key) => entries[key],
    fetchImpl: async () => { throw new Error("RSS should not be needed when a real transcript exists"); },
  });
  assert.equal(episode.title, "AI Security: The Access Problem");
  assert.equal(episode.source, "published-transcript");
  assert.match(episode.transcriptExcerpt, /scoped tool permissions/);
  assert.doesNotMatch(episode.title, /Unfinished/);
});

test("Thursday podcast promotion uses published RSS fallback without pretending old content is new", async () => {
  const xml = '<?xml version="1.0"?><rss version="2.0"><channel><title>Turing</title>' +
    '<item><title>Unreleased</title><pubDate>Fri, 31 Jul 2026 13:00:00 GMT</pubDate><description>Future</description></item>' +
    '<item><title>Published</title><pubDate>Fri, 24 Jul 2026 13:00:00 GMT</pubDate><description>Verified</description></item></channel></rss>';
  const episode = await fetchPodcastPromoEpisode({
    publishDate: "2026-07-30", feedUrl: "https://example.com/feed.xml",
    listKeysImpl: async () => [],
    getObjectAsTextImpl: async () => "",
    fetchImpl: async () => ({ ok: true, text: async () => xml }),
  });
  assert.equal(episode.title, "Published");
  assert.equal(episode.source, "published-rss");
});

test("Thursday promotion retains the original brand voice and podcast-only audio policy", () => {
  const prompt = buildPodcastPromoPrompt({
    publishDate: "2026-07-30",
    episode: { title: "Real Episode", description: "A concrete AI security incident", transcriptExcerpt: "Security failures are usually permissions failures." },
  });
  assert.match(prompt.system, /not a podcast performance/i);
  assert.match(prompt.system, /Never synthesise or replace the show voice/i);
  assert.match(prompt.system, /Do not write voiceover/i);
  assert.match(prompt.system, /recommend it truthfully as available/i);
  assert.match(prompt.user, /approved transcript excerpt/i);
  assert.match(prompt.user, /permissions failures/);
});


test("verified upcoming Friday metadata uses the previous week's transcript only for style", async () => {
  const entries = {
    "episode-41.json": JSON.stringify({
      sessionId: "episode-41", title: "Previous Week: Permissions",
      description: "An analysis of agent permissions.",
      pubDate: "2026-07-24T13:00:00Z", productionComplete: true,
      episodeNumber: 41, episodePageUrl: "https://example.com/episode-41",
    }),
    "episode-42.json": JSON.stringify({
      sessionId: "episode-42", title: "Upcoming Friday: Model Pricing",
      description: "A specific look at inference pricing and deployment costs.",
      createdAt: "2026-07-29T12:00:00Z", updatedAt: "2026-07-29T14:00:00Z",
      pubDate: "2026-07-31T13:00:00Z", episodeNumber: 42,
      productionComplete: false,
    }),
    "episode-41.txt": "Turing's Torch examines scoped agent permissions and evidence. ".repeat(30),
  };
  const episode = await fetchPodcastPromoEpisode({
    publishDate: "2026-07-30", feedUrl: "https://example.com/feed.xml",
    listKeysImpl: async () => ["episode-41.json", "episode-42.json"],
    getObjectAsTextImpl: async (_bucket, key) => entries[key],
    fetchImpl: async () => { throw new Error("A verified preview should not need RSS."); },
  });
  assert.equal(episode.mode, "preview");
  assert.equal(episode.title, "Upcoming Friday: Model Pricing");
  assert.equal(episode.previousTranscriptTitle, "Previous Week: Permissions");
  assert.match(episode.transcriptExcerpt, /agent permissions/);
  const prompt = buildPodcastPromoPrompt({ publishDate: "2026-07-30", episode });
  assert.match(prompt.user, /lands Friday/);
  assert.match(prompt.system, /NOT facts for the upcoming episode/i);
  assert.match(prompt.user, /Upcoming Friday: Model Pricing/);
  assert.match(prompt.user, /Previous Week: Permissions/);
  assert.match(prompt.user, /STYLE CONTEXT ONLY/i);
});
