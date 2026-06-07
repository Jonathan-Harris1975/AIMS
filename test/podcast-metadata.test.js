import test from "node:test";
import assert from "node:assert/strict";

import { calculateDuration } from "../services/script/utils/durationCalculator.js";
import { getTitleDescriptionPrompt, getSEOKeywordsPrompt, __testing as metadataTesting } from "../services/script/utils/podcastHelper.js";
import { generateFeedXML } from "../services/rss-feed-podcast/generateFeed.js";

const sampleMain = `
Agentic artificial intelligence systems are being pushed as independent workers, but the awkward bit is control.
OpenAI and Anthropic are releasing new models, with benchmarks doing most of the public relations work.
Companies are also finding that their data infrastructure is too messy for serious artificial intelligence deployment.
Workflow automation then raises questions about surveillance, jobs, productivity, and who gets the benefit.
`;

test("duration planner honours explicit 30/45/60 minute targets", () => {
  const shortPlan = calculateDuration("main", { sessionId: "TT-test", targetMins: 30 }, 6);
  const longPlan = calculateDuration("main", { sessionId: "TT-test", targetMins: 60 }, 6);

  assert.equal(shortPlan.targetMins, 30);
  assert.equal(shortPlan.totalSeconds, 1800);
  assert.equal(shortPlan.mainSeconds, 1655);

  assert.equal(longPlan.targetMins, 60);
  assert.equal(longPlan.totalSeconds, 3600);
  assert.equal(longPlan.mainSeconds, 3415);
});

test("metadata fallback is specific, hosted, and runtime-aware", () => {
  const plan = calculateDuration("episode", { sessionId: "TT-test", targetMins: 60 });
  const title = metadataTesting.buildFallbackTitle(sampleMain);
  const description = metadataTesting.buildFallbackDescription(sampleMain, plan);
  const validation = metadataTesting.validateMetaCandidate({ title, description }, plan);

  assert.equal(title, "Agentic AI, Model Hype, and Dirty Data");
  assert.match(description, /Jonathan Harris/);
  assert.match(description, /60-minute/);
  assert.equal(validation.ok, true, validation.reasons.join("; "));
});

test("metadata prompt forbids generic titles and scales description length by runtime", () => {
  const plan = calculateDuration("episode", { sessionId: "TT-test", targetMins: 30 });
  const prompt = getTitleDescriptionPrompt(sampleMain, plan);

  assert.match(prompt, /Host: Jonathan Harris/);
  assert.match(prompt, /Planned episode length: 30 minutes/);
  assert.match(prompt, /Description: 300-560 characters/);
  assert.equal(metadataTesting.isLikelyGenericTitle("AI Weekly"), true);
});


test("metadata prompt surfaces natural SEO keyword candidates", () => {
  const plan = calculateDuration("episode", { sessionId: "TT-test", targetMins: 45 });
  const candidates = metadataTesting.detectSeoKeywordCandidates(sampleMain);
  const prompt = getTitleDescriptionPrompt(sampleMain, plan);

  assert.ok(candidates.includes("agentic AI"));
  assert.ok(candidates.includes("AI governance"));
  assert.match(prompt, /SEO keyword candidates/);
  assert.match(prompt, /agentic AI/);
  assert.match(prompt, /Do not keyword-stuff/);

  const fallbackTitle = metadataTesting.buildFallbackTitle(sampleMain);
  const fallbackDescription = metadataTesting.buildFallbackDescription(sampleMain, plan);
  const validation = metadataTesting.validateMetaCandidate(
    { title: fallbackTitle, description: fallbackDescription },
    plan,
    candidates
  );

  assert.equal(validation.ok, true, validation.reasons.join("; "));
});

test("SEO keyword prompt uses title, description and main content", () => {
  const prompt = getSEOKeywordsPrompt({
    title: "Agentic AI, Model Hype, and Dirty Data",
    description: "Jonathan Harris cuts through artificial intelligence governance and AI automation without vendor fireworks.",
    mainOnly: sampleMain,
    keywordCandidates: ["agentic AI", "AI governance", "AI automation"],
  });

  assert.match(prompt, /Candidate phrases already detected: agentic AI, AI governance, AI automation/);
  assert.match(prompt, /Title: Agentic AI, Model Hype, and Dirty Data/);
  assert.match(prompt, /Main content excerpt:/);
});

test("podcast RSS channel defaults are branded, hosted, and non-generic", () => {
  const original = {
    PODCAST_TITLE: process.env.PODCAST_TITLE,
    PODCAST_DESCRIPTION: process.env.PODCAST_DESCRIPTION,
    PODCAST_AUTHOR: process.env.PODCAST_AUTHOR,
    PODCAST_LINK: process.env.PODCAST_LINK,
  };

  process.env.PODCAST_TITLE = "";
  process.env.PODCAST_DESCRIPTION = "";
  process.env.PODCAST_AUTHOR = "";
  process.env.PODCAST_LINK = "";

  try {
    const xml = generateFeedXML([
      {
        sessionId: "TT-2026-05-01",
        title: "Agentic AI, Model Hype, and Dirty Data",
        description: "Jonathan Harris cuts through the week in artificial intelligence without vendor glitter.",
        podcastUrl: "https://podcast.jonathan-harris.online/TT-2026-05-01.mp3",
        plannedDurationSeconds: 2700,
        fileSize: 123,
      },
    ]);

    assert.match(xml, /<title>Turing’s Torch: Artificial Intelligence Weekly<\/title>/);
    assert.match(xml, /Hosted by Jonathan Harris/);
    assert.match(xml, /<itunes:author>Jonathan Harris<\/itunes:author>/);
    assert.match(xml, /<itunes:duration>45:00<\/itunes:duration>/);
    assert.doesNotMatch(xml, /<title>Podcast<\/title>/);
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});


test("podcast discovery metadata keeps keywords useful but not stuffed", async () => {
  const {
    buildLegacyItunesKeywordsCsv,
    buildPodcastDiscoveryMetadata,
    normaliseDiscoveryTerm,
  } = await import("../services/rss-feed-podcast/discoveryMetadata.js");

  assert.equal(normaliseDiscoveryTerm("aartificial intelligence"), "artificial intelligence");

  const discovery = buildPodcastDiscoveryMetadata({
    title: "Agentic AI, Model Hype, and Dirty Data",
    description: "Jonathan Harris cuts through artificial intelligence governance, agentic AI and dirty data without vendor fireworks.",
    mainOnly: sampleMain,
    keywordCandidates: ["agentic AI", "AI governance", "AI automation", "artificial intelligence", "AI news"],
    keywords: ["AI", "weekly", "agentic AI", "dirty data", "AI governance"],
    categories: ["Technology", "Tech News"],
  });

  assert.equal(discovery.strategy, "supportive_metadata_not_keyword_stuffing");
  assert.ok(discovery.primaryTerms.includes("agentic AI"));
  assert.ok(discovery.episodeTerms.length <= 14);
  assert.ok(discovery.legacy.itunesKeywordsCsv.length <= 255);
  assert.doesNotMatch(discovery.legacy.itunesKeywordsCsv, /aartificial/i);

  const legacy = buildLegacyItunesKeywordsCsv(
    "aartificial intelligence, tech news, machine learning, AI podcast, Gen X, AI roundup, chatbot advancements, ai jobs impact, open ai news, ai bias, autonomous systems, llm updates, ai policy, gpt news, ai safety",
    { context: sampleMain }
  );
  assert.ok(legacy.length <= 255);
  assert.ok(legacy.split(",").length <= 12);
  assert.doesNotMatch(legacy, /aartificial/i);
});
