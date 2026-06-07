import test from "node:test";
import assert from "node:assert/strict";

process.env.SITE_BASE_URL = "https://jonathan-harris.online";
process.env.R2_PUBLIC_BASE_URL_TRANSCRIPT = "https://transcripts.jonathan-harris.online";
process.env.PODCAST_TRANSCRIPT_HTML_BASE_URL = "https://jonathan-harris.online/transcripts";

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
      transcriptHtmlUrl: "https://jonathan-harris.online/transcripts/TT-2026-04-17.html",
      pubDate: "Fri, 17 Apr 2026 00:00:00 GMT",
      duration: 1800,
      fileSize: 123456,
      episodeNumber: 42,
      keywords: ["AI", "governance"],
    },
  ]);

  assert.match(xml, /<link>https:\/\/jonathan-harris\.online\/podcast\/episodes\/ai-accountability-costs-and-local-control\/<\/link>/);
  assert.match(xml, /<enclosure url="https:\/\/podcast\.jonathan-harris\.online\/TT-2026-04-17\.mp3" length="123456" type="audio\/mpeg" \/>/);
  assert.match(xml, /<podcast:transcript url="https:\/\/jonathan-harris\.online\/transcripts\/TT-2026-04-17\.html" type="text\/html" \/>/);
  assert.doesNotMatch(xml, /<link>https:\/\/transcripts\.jonathan-harris\.online\/TT-2026-04-17\.txt<\/link>/);
});


test("generateFeedXML emits concise legacy iTunes keywords instead of stuffed keyword dumps", () => {
  const original = process.env.PODCAST_ITUNES_KEYWORDS;
  process.env.PODCAST_ITUNES_KEYWORDS = "aartificial intelligence, tech news, machine learning, AI podcast, Gen X, AI roundup, chatgpt, chatbot advancements, ai jobs impact, open ai news, ai bias, autonomous systems, llm updates, ai policy, gpt news, ai safety, tech culture, neural networks explained, ai companies, deepfake detection, ai weekly, ai news, ai breakthroughs";

  try {
    const xml = generateFeedXML([
      {
        sessionId: "TT-2026-04-24",
        title: "Agentic AI and Governance Drift",
        description: "Jonathan Harris explains why artificial intelligence agents, AI governance and messy data are becoming a practical control problem rather than a vendor fireworks show.",
        episodeSlug: "agentic-ai-and-governance-drift",
        podcastUrl: "https://podcast.jonathan-harris.online/TT-2026-04-24.mp3",
        pubDate: "Fri, 24 Apr 2026 00:00:00 GMT",
        duration: 1800,
        fileSize: 123456,
        keywords: ["agentic AI", "AI governance", "AI agents", "artificial intelligence", "AI"],
      },
    ]);

    const channelKeywords = xml.match(/<channel>[\s\S]*?<itunes:keywords>([^<]+)<\/itunes:keywords>/)?.[1] || "";
    const itemKeywords = xml.match(/<item>[\s\S]*?<itunes:keywords>([^<]+)<\/itunes:keywords>/)?.[1] || "";

    assert.ok(channelKeywords.length <= 255);
    assert.ok(channelKeywords.split(",").length <= 12);
    assert.ok(itemKeywords.length <= 255);
    assert.ok(itemKeywords.split(",").length <= 12);
    assert.doesNotMatch(xml, /aartificial/i);
    assert.match(itemKeywords, /agentic AI|AI governance/);
  } finally {
    if (original === undefined) delete process.env.PODCAST_ITUNES_KEYWORDS;
    else process.env.PODCAST_ITUNES_KEYWORDS = original;
  }
});
