import test from "node:test";
import assert from "node:assert/strict";

process.env.SITE_BASE_URL = "https://jonathan-harris.online";
process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT = "https://transcripts.jonathan-harris.online";

const { generateFeedXML } = await import("../services/rss-feed-podcast/generateFeed.js");

test("generateFeedXML keeps episode page, audio enclosure, and transcript URLs distinct", () => {
  const xml = generateFeedXML([
    {
      sessionId: "TT-2026-04-17",
      title: "AI Accountability, Costs, and Local Control",
      description: "A grounded episode summary.",
      episodeSlug: "ai-accountability-costs-and-local-control",
      episodePageUrl: "https://jonathan-harris.online/podcast/episodes/ai-accountability-costs-and-local-control/",
      podcastUrl: "https://podcast.jonathan-harris.online/TT-2026-04-17.mp3",
      transcriptTextUrl: "https://transcripts.jonathan-harris.online/TT-2026-04-17.txt",
      transcriptHtmlUrl: "https://transcripts.jonathan-harris.online/TT-2026-04-17.html",
      pubDate: "Fri, 17 Apr 2026 00:00:00 GMT",
      duration: 1800,
      fileSize: 123456,
      episodeNumber: 42,
      keywords: ["AI", "governance"],
    },
  ]);

  assert.match(xml, /<link>https:\/\/jonathan-harris\.online\/podcast\/episodes\/ai-accountability-costs-and-local-control\/<\/link>/);
  assert.match(xml, /<enclosure url="https:\/\/podcast\.jonathan-harris\.online\/TT-2026-04-17\.mp3" length="123456" type="audio\/mpeg" \/>/);
  assert.match(xml, /<podcast:transcript url="https:\/\/transcripts\.jonathan-harris\.online\/TT-2026-04-17\.html" type="text\/html" \/>/);
  assert.doesNotMatch(xml, /<link>https:\/\/transcripts\.jonathan-harris\.online\/TT-2026-04-17\.txt<\/link>/);
});
