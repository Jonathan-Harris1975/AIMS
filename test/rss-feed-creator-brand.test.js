import test from "node:test";
import assert from "node:assert/strict";
import { XMLBuilder } from "fast-xml-parser";

import { RSS_PROMPTS } from "../services/rss-feed-creator/utils/rss-prompts.js";
import { __testing as feedGeneratorTesting } from "../services/rss-feed-creator/utils/feedGenerator.js";

function longPlainSummary() {
  return Array.from({ length: 90 }, (_, index) =>
    `Sentence ${index + 1} says the system needs sharper checks before publication.`
  ).join(" ");
}

test("RSS title validation rejects audited formula scaffolds", () => {
  const rejectedTitles = [
    "AI agents and the challenge of architectural flexibility",
    "AI latency poses significant business risks",
    "AI's integration in businesses requires robust data infrastructure",
    "AI adoption hampers progress in public services",
  ];

  for (const title of rejectedTitles) {
    const validation = RSS_PROMPTS.validateTitleBrand(title);
    assert.equal(validation.valid, false, `${title} should fail brand validation`);
  }
});

test("RSS summary validation flags audited corporate filler phrases", () => {
  const summary = [
    "The vendor says a robust data fabric will help teams deliver meaningful business value.",
    "That pitch leans on seamless data integration, competitive advantage, and a holistic approach.",
  ].join(" ");

  const banned = RSS_PROMPTS.findBannedSummaryPhrases(summary);

  assert.ok(banned.includes("robust data fabric"));
  assert.ok(banned.includes("seamless data integration"));
  assert.ok(banned.includes("meaningful business value"));
  assert.ok(banned.includes("competitive advantage"));
  assert.ok(banned.includes("holistic approach"));
});

test("feed XML text nodes are escaped once, not pre-escaped twice", () => {
  const feedObj = feedGeneratorTesting.buildXmlFeedObject({
    rss: {
      channel: {
        title: "AI's sharper week",
        link: "https://jonathan-harris.online",
        description: "AI's weekly briefing",
        language: "en-gb",
        lastBuildDate: new Date("2026-04-29T08:00:00Z").toUTCString(),
        pubDate: new Date("2026-04-29T08:00:00Z").toUTCString(),
        generator: "test",
        "atom:link": {
          "@_href": "https://jonathan-harris.online/feed.xml",
          "@_rel": "self",
          "@_type": "application/rss+xml",
        },
        item: [
          {
            title: "AI's integration needs plainer tests",
            link: "https://example.com/story",
            guid: { "@_isPermaLink": "false", "#text": "story-1" },
            pubDate: new Date("2026-04-29T08:00:00Z").toUTCString(),
            description: { __cdata: "<p>Plain summary.</p>" },
          },
        ],
      },
    },
  });

  const xml = new XMLBuilder({
    format: true,
    ignoreAttributes: false,
    suppressEmptyNode: true,
    cdataPropName: "__cdata",
  }).build(feedObj);

  assert.doesNotMatch(xml, /AI&amp;apos;s/);
  assert.match(xml, /AI&apos;s|AI's/);
});

test("feed publication issues reject over-long summaries", () => {
  const overLong = `${longPlainSummary()} ${longPlainSummary()}`;
  const issues = feedGeneratorTesting.getPublicationIssues({
    title: "Sharper feed tests stop dull copy",
    rewritten: overLong,
  });

  assert.ok(
    issues.some((issue) => /Summary too long for publication/.test(issue)),
    issues.join("; ")
  );
});

test("feed normalisation clamps rewritten summaries before publication", () => {
  const item = feedGeneratorTesting.normalizeItem(
    {
      title: "Sharper feed tests stop dull copy",
      link: "https://example.com/story",
      rewritten: `${longPlainSummary()} ${longPlainSummary()}`,
      pubDate: new Date("2026-04-29T08:00:00Z").toUTCString(),
    },
    "https://jonathan-harris.online",
    new Date("2026-04-29T08:00:00Z")
  );

  assert.ok(item.rewritten.length <= RSS_PROMPTS.MAX_SUMMARY_CHARS);
});

test("RSS summaries are capped to the preferred 60-word editorial brief", () => {
  const summary = Array.from({ length: 72 }, (_, index) => `word${index + 1}`).join(" ");
  const clamped = RSS_PROMPTS.clampSummaryToPreferredBrief(summary);
  assert.ok(RSS_PROMPTS.summaryWordCount(clamped) <= 60, clamped);
});

test("feed normalisation publishes RSS summaries at or below 60 words", () => {
  const item = feedGeneratorTesting.normalizeItem(
    {
      title: "Sharper RSS summaries keep brand drift down",
      link: "https://example.com/story-two",
      rewritten: Array.from({ length: 76 }, (_, index) => `word${index + 1}`).join(" "),
      pubDate: new Date("2026-04-29T08:00:00Z").toUTCString(),
    },
    "https://jonathan-harris.online",
    new Date("2026-04-29T08:00:00Z")
  );

  assert.ok(RSS_PROMPTS.summaryWordCount(item.rewritten) <= 60, item.rewritten);
});
