import test from "node:test";
import assert from "node:assert/strict";
import { runPhase5OrganicGrowthGate, phase5SkillsSummary } from "../services/content-quality/phase5OrganicGrowthGates.js";

const FEATURED_BOOK = {
  title: "Practical AI Thinking",
  bookUrl: "https://example.com/practical-ai-thinking",
  coverArtUrl: "https://example.com/practical-ai-thinking-cover.jpg",
  summary: "A plain-English guide to using artificial intelligence tools without swallowing the hype.",
  audience: "Curious readers, authors, creators and small business owners",
  whatYouWillLearn: "How to judge artificial intelligence use cases, spot weak claims and apply tools sensibly.",
};

test("Phase 5 allows source-backed organic ebook conversion posts", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "ebook-conversion-social-post",
    featuredBook: FEATURED_BOOK,
    day: "tuesday",
    generated: {
      title: "Practical AI Thinking angle",
      topic: "Practical AI judgement",
      imageUrl: FEATURED_BOOK.coverArtUrl,
      content: `For readers trying to understand artificial intelligence without buying the theatre, this book gives a practical way to spot weak claims, ask better questions and decide where the tools actually help. It keeps the promise grounded, which is usually where the useful work begins. Readers get a calmer route through the noise before they commit time, money or trust.\n\nRead more: ${FEATURED_BOOK.bookUrl}`,
      firstComment: `Featured book: ${FEATURED_BOOK.title}\nRead more: ${FEATURED_BOOK.bookUrl}`,
    },
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.decision, "auto_publish");
});

test("Phase 5 blocks hard-sell ebook posts with unsupported conversion claims", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "ebook-conversion-social-post",
    featuredBook: FEATURED_BOOK,
    generated: {
      title: "Buy now",
      content: "Buy now before this limited time secret formula disappears. Guaranteed results for everyone.",
      firstComment: "Featured book: Practical AI Thinking",
    },
  });

  assert.equal(gate.ok, false);
  assert.match(gate.defects.join(" | "), /Organic tone breach|Main ebook post must include the exact featured book URL|Unsupported social proof/i);
});

test("Phase 5 requires the ebook URL in the main Zernio post, not only first-comment metadata", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "ebook-conversion-social-post",
    featuredBook: FEATURED_BOOK,
    day: "tuesday",
    generated: {
      title: "Practical AI Thinking angle",
      topic: "Practical AI judgement",
      imageUrl: FEATURED_BOOK.coverArtUrl,
      content: "For readers trying to understand artificial intelligence without buying the theatre, this book gives a practical way to spot weak claims, ask better questions and decide where tools actually help. The point is useful judgement before committing time, money or trust, with enough practical detail to apply the ideas rather than merely admire them.",
      firstComment: `Featured book: ${FEATURED_BOOK.title}\nRead more: ${FEATURED_BOOK.bookUrl}`,
    },
  });

  assert.equal(gate.ok, false);
  assert.match(gate.defects.join(" | "), /Main ebook post must include the exact featured book URL/i);
});

test("Phase 5 visual social gate favours branded non-cluttered prompts", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "organic-visual-social",
    generated: {
      social_caption: "A short, practical caption about useful artificial intelligence adoption without the fireworks.",
      hashtags: ["#AIReality", "#AIBusiness", "#PracticalAI"],
      imagePrompt: "Premium editorial card, dark navy and charcoal base, controlled neon teal and muted purple accents, no text, no logos, no numbers, strong contrast.",
    },
    sources: [{ title: "Source", rewritten: "Useful artificial intelligence adoption requires practical governance." }],
    platforms: ["facebook", "instagram", "tiktok"],
  });

  assert.equal(gate.ok, true);
});

test("Phase 5 does not mistake a negated guarantee for promotional hype", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "organic-visual-social",
    generated: {
      social_caption: "Reliable artificial intelligence performance is not guaranteed. The useful work is monitoring failures, testing assumptions and keeping a human checkpoint where the risk warrants one.",
      hashtags: ["#AIReality", "#AIGovernance", "#PracticalAI"],
      imagePrompt: "Create high-impact premium editorial artwork with a dark navy and charcoal base, electric teal and muted coral accents, cinematic strong contrast, no text, no letters, no numbers, no logos, no watermarks, portrait 4:5 composition.",
    },
    sources: [{ title: "Source", rewritten: "Reliable artificial intelligence performance is not guaranteed and requires monitoring." }],
    platforms: ["facebook", "instagram", "tiktok"],
  });

  assert.equal(gate.ok, true, gate.defects.join(" | "));
  assert.doesNotMatch(gate.defects.join(" | "), /Organic tone breach: guaranteed/i);
});

test("Phase 5 still blocks a positive guarantee claim", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "organic-visual-social",
    generated: {
      social_caption: "This system delivers guaranteed results for every team, which is exactly the sort of claim the organic gate should reject before publication.",
      hashtags: ["#AIReality", "#AIGovernance", "#PracticalAI"],
      imagePrompt: "Create high-impact premium editorial artwork with a dark navy and charcoal base, electric teal and muted coral accents, cinematic strong contrast, no text, no letters, no numbers, no logos, no watermarks, portrait 4:5 composition.",
    },
    sources: [{ title: "Source", rewritten: "The system requires testing and monitoring." }],
    platforms: ["facebook", "instagram", "tiktok"],
  });

  assert.equal(gate.ok, false);
  assert.match(gate.defects.join(" | "), /Organic tone breach: guaranteed/i);
});

test("Phase 5 summary keeps paid ads and analytics parked", () => {
  const summary = phase5SkillsSummary();
  assert.match(summary.parked.paidAds, /organic/i);
  assert.match(summary.parked.analyticsTracking, /Metricool|Google Analytics/i);
  assert.deepEqual(summary.skills.podcastSeo, ["podcast-seo"]);
  assert.match(summary.rules.join(" "), /Podcast SEO enrichment/);
});


test("Phase 5 visual social gate ignores date fragments in generated artefact URLs", () => {
  const gate = runPhase5OrganicGrowthGate({
    contentType: "organic-visual-social",
    generated: {
      title: "Chatbots could hide ads, AI science digest",
      summary: "Researchers warn chatbots might embed ads disguised as genuine recommendations, while a May digest highlights steady artificial intelligence research progress.",
      social_caption: "The latest from the artificial intelligence trenches: chatbots are getting clever enough to weave ads into conversations, making them hard to spot. Researchers are flagging this as a plausible trust problem, not a scandal to inflate. The practical point is transparency: users need to know when advice is advice and when it is monetised persuasion.",
      imagePrompt: "Premium editorial card, dark navy and charcoal base, controlled neon teal and muted purple accents, no text, no logos, no numbers, portrait 4:5 social card.",
      imageUrl: "https://pub-example.r2.dev/social-media-blog/BLOG-SOCIAL-2026-05-28.png",
      hashtags: ["#AIethics", "#Chatbots", "#ArtificialIntelligence"],
    },
    sources: [
      {
        title: "Chatbots can slip ads into replies and users may not notice",
        rewritten: "Researchers warn chatbots might embed ads disguised as genuine recommendations, creating transparency and trust issues.",
        pubDate: "Fri, 29 May 2026 08:00:55 GMT",
      },
      {
        title: "May 2026 digest: AI for science, world models and the lottery ticket",
        rewritten: "A May 2026 digest covers steady artificial intelligence work in science, world models and efficiency.",
        pubDate: "Fri, 29 May 2026 08:00:34 GMT",
      },
    ],
    platforms: ["facebook", "instagram", "tiktok"],
  });

  assert.equal(gate.ok, true, gate.defects.join(" | "));
  assert.doesNotMatch(gate.defects.join(" | "), /Unsupported number or metric: 05|Unsupported number or metric: 28/);
});
