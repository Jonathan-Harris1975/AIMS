import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.AI_MAX_RETRIES = "0";
process.env.NEWSLETTER_MAX_REWRITE_ITERATIONS = "2";
process.env.NEWSLETTER_QA_PASS_THRESHOLD = "85";
// draftNewsletter() below fixtures exactly 2 stories. THRESHOLDS.newsletter
// .storyCount defaults to 10, and runQaLoop's deterministic validator
// checks the newsletter's actual story count against it — so without this
// override, validateStructuralCompleteness always reports "story_count_short"
// regardless of AI review score, and every subtest falls through to
// quarantine no matter what reviewScores says.
process.env.NEWSLETTER_STORY_COUNT = "2";

// The newsletter AI routes (config/ai-config.js) resolve each provider's
// model name purely from env — there is no static fallback — so every
// provider that appears in newsletterCompose / newsletterQaReview /
// newsletterSubject's chains must be stubbed here. Without this, a
// provider with no model env var resolves to `null` in getProviderConfig()
// and is silently skipped as "misconfigured" *before* any HTTP request is
// made, so the local mock server below is never reached — regardless of
// OPENROUTER_BASE_URL — and resilientRequest throws "All providers failed"
// once every provider in the chain has been skipped this way. Relying on
// whatever model env vars happen to be set in the ambient CI environment
// made this test non-deterministic; stubbing them all here makes it not.
process.env.OPENROUTER_ANTHROPIC_4_6 = "mock/anthropic-46";
process.env.OPENROUTER_GOOGLE_2_5_flashlite = "mock/google-25-flashlite";
process.env.OPENROUTER_GPT_5_6_LUNA = "mock/gpt-5.6-luna";
process.env.OPENROUTER_DEEPSEEK_v4_pro = "mock/deepseek-v4-pro";

let server;
let reviewScores = []; // one score consumed per AI review call, in order
let reviewCallCount = 0;

function chatCompletionResponse(content) {
  return { choices: [{ message: { content } }] };
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const systemMsg = parsed.messages?.[0]?.content || "";

      res.writeHead(200, { "Content-Type": "application/json" });

      if (systemMsg.includes("editorial QA reviewer")) {
        const score = reviewScores[Math.min(reviewCallCount, reviewScores.length - 1)];
        reviewCallCount += 1;
        const verdict = score >= 85 ? "pass" : "revise";
        res.end(JSON.stringify(chatCompletionResponse(JSON.stringify({ score, issues: verdict === "pass" ? [] : ["needs tightening"], verdict }))));
        return;
      }

      if (systemMsg.includes("lead editor")) {
        res.end(JSON.stringify(chatCompletionResponse(JSON.stringify({
          heroHeadline: "A revised, tighter headline",
          leadArticleHtml: "<p>A revised lead paragraph grounded in the source.</p>",
        }))));
        return;
      }

      if (systemMsg.includes("daily AI news digest")) {
        res.end(JSON.stringify(chatCompletionResponse(JSON.stringify({ summaries: ["Revised summary one.", "Revised summary two."] }))));
        return;
      }

      if (systemMsg.includes("subject lines")) {
        res.end(JSON.stringify(chatCompletionResponse(JSON.stringify({ subject: "Revised subject", previewText: "Revised preview" }))));
        return;
      }

      res.end(JSON.stringify(chatCompletionResponse("{}")));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  reviewCallCount = 0;
});

function draftNewsletter() {
  return {
    subject: "Draft subject",
    previewText: "Draft preview",
    heroHeadline: "Draft headline",
    leadArticleHtml: "<p>Draft lead paragraph.</p>",
    heroImageUrl: "https://images.example.com/hero.png",
    sourceLink: "https://news.example.com/lead",
    stories: [
      { title: "Story A", link: "https://news.example.com/a", summary: "Summary A" },
      { title: "Story B", link: "https://news.example.com/b", summary: "Summary B" },
    ],
    footer: { text: "footer" },
  };
}

const profile = {
  id: "test-profile",
  displayName: "Test Newsletter",
  brandVoice: "Clear and practical.",
};

describe("newsletter engine/qaLoop.js — runQaLoop", () => {
  test("passes immediately when the first review scores above threshold", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    reviewScores = [92];
    const result = await runQaLoop({
      profile, newsletter: draftNewsletter(), lead: { title: "Lead", link: "https://news.example.com/lead", summary: "s" },
      stories: draftNewsletter().stories, sessionId: "test-pass",
    });
    assert.equal(result.ok, true);
    assert.equal(result.quarantined, false);
    assert.equal(result.iterations, 1);
  });

  test("rewrites once then passes when the second review clears the threshold", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    reviewScores = [60, 90];
    const result = await runQaLoop({
      profile, newsletter: draftNewsletter(), lead: { title: "Lead", link: "https://news.example.com/lead", summary: "s" },
      stories: draftNewsletter().stories, sessionId: "test-rewrite",
    });
    assert.equal(result.ok, true);
    assert.equal(result.iterations, 2);
    assert.equal(result.newsletter.heroHeadline, "A revised, tighter headline");
  });

  test("quarantines after exhausting the max rewrite iterations", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    reviewScores = [40, 45]; // NEWSLETTER_MAX_REWRITE_ITERATIONS=2, never passes
    const result = await runQaLoop({
      profile, newsletter: draftNewsletter(), lead: { title: "Lead", link: "https://news.example.com/lead", summary: "s" },
      stories: draftNewsletter().stories, sessionId: "test-quarantine",
    });
    assert.equal(result.ok, false);
    assert.equal(result.quarantined, true);
    assert.equal(result.iterations, 2);
  });
});
