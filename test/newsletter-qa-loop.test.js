import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.NEWSLETTER_MAX_REWRITE_ITERATIONS = "5";
process.env.NEWSLETTER_QA_PASS_THRESHOLD = "85";
process.env.NEWSLETTER_STORY_COUNT = "6";
process.env.NEWSLETTER_MODEL_EDITORIAL = "mock/sonnet";
process.env.OPENROUTER_GPT_5_6_SOL = "mock/sol";
process.env.OPENROUTER_GPT_5_6_LUNA = "mock/luna";
process.env.AI_MODEL_HIGH_QUALITY = "mock/high";
process.env.AI_MODEL_AUDIT = "mock/audit";
process.env.AI_MODEL_FAST = "mock/fast";
process.env.AI_MODEL_SUMMARY = "mock/summary";

let server;
let iterationScores = [];
let chairCallCount = 0;

function chat(content) {
  return { choices: [{ message: { content } }] };
}

function reviewResponse(score) {
  return JSON.stringify({ score, verdict: score >= 85 ? "pass" : "revise", issues: score >= 85 ? [] : ["needs work"], strengths: ["clear"] });
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const system = parsed.messages?.[0]?.content || "";
      const score = iterationScores[Math.min(chairCallCount, iterationScores.length - 1)] ?? 90;
      res.writeHead(200, { "Content-Type": "application/json" });

      if (system.includes("Source Integrity and Fact-Checking Reviewer") ||
          system.includes("Jonathan Harris Voice and Editorial Reviewer") ||
          system.includes("Audience Value and Newsletter Performance Reviewer")) {
        res.end(JSON.stringify(chat(reviewResponse(score))));
        return;
      }

      if (system.includes("chair the AI Edge editorial council")) {
        chairCallCount += 1;
        res.end(JSON.stringify(chat(JSON.stringify({ score, verdict: score >= 85 ? "pass" : "revise", issues: score >= 85 ? [] : ["chair says revise"], priorityFixes: [] }))));
        return;
      }

      if (system.includes("senior editor writing")) {
        res.end(JSON.stringify(chat(JSON.stringify({
          heroHeadline: "A revised headline",
          openingNoteHtml: "<p>A revised opening note with practical judgement.</p>",
          bigThree: [
            { whatHappened: "A happened.", whyItMatters: "A matters.", jonathanTake: "A take." },
            { whatHappened: "B happened.", whyItMatters: "B matters.", jonathanTake: "B take." },
            { whatHappened: "C happened.", whyItMatters: "C matters.", jonathanTake: "C take." },
          ],
          worthUsing: { label: "Worth Watching", summary: "D summary.", whyUseful: "D useful." },
          onRadar: ["E summary.", "F summary."],
          realityCheck: { claim: "A claim", assessment: "The evidence is narrower." },
          yourTurn: "Which deserves a deeper look?",
        }))));
        return;
      }

      if (system.includes("email subject and preview")) {
        res.end(JSON.stringify(chat(JSON.stringify({ subject: "Revised subject", previewText: "Revised preview" }))));
        return;
      }

      res.end(JSON.stringify(chat("{}")));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${server.address().port}`;
});

after(async () => { await new Promise((resolve) => server.close(resolve)); });
beforeEach(() => { chairCallCount = 0; });

const lead = { title: "A", link: "https://news.example.com/a", summary: "A source summary." };
const stories = [
  { title: "B", link: "https://news.example.com/b", summary: "B source." },
  { title: "C", link: "https://news.example.com/c", summary: "C source." },
  { title: "D", link: "https://news.example.com/d", summary: "D source." },
  { title: "E", link: "https://news.example.com/e", summary: "E source." },
  { title: "F", link: "https://news.example.com/f", summary: "F source." },
];

function draftNewsletter() {
  return {
    subject: "Draft subject",
    previewText: "Draft preview",
    heroHeadline: "Draft headline",
    openingNoteHtml: "<p>Draft opening note.</p>",
    heroImageUrl: "https://images.example.com/hero.png",
    bigThree: [lead, ...stories.slice(0, 2)].map((s) => ({ ...s, whatHappened: "Happened.", whyItMatters: "Matters.", jonathanTake: "Take." })),
    worthUsing: { ...stories[2], label: "Worth Watching", summary: "Summary.", whyUseful: "Useful." },
    onRadar: stories.slice(3).map((s) => ({ ...s, summary: "Summary." })),
    realityCheck: { claim: "Claim", assessment: "Assessment.", link: lead.link },
    yourTurn: "Question?",
    promotion: null,
    footer: { text: "footer" },
  };
}

const profile = { id: "test-profile", displayName: "AI Edge", brandVoice: "Clear and practical." };

describe("newsletter engine/qaLoop.js", () => {
  test("passes immediately when every council specialist and chair clears the threshold", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    iterationScores = [92];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-pass" });
    assert.equal(result.ok, true);
    assert.equal(result.iterations, 1);
    assert.equal(result.council.reviews.length, 3);
  });

  test("rewrites and re-runs the full council before approval", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    iterationScores = [70, 91];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-rewrite" });
    assert.equal(result.ok, true);
    assert.equal(result.iterations, 2);
    assert.equal(result.newsletter.heroHeadline, "A revised headline");
  });

  test("quarantines after five failed council passes", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    iterationScores = [60, 60, 60, 60, 60];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-quarantine" });
    assert.equal(result.ok, false);
    assert.equal(result.quarantined, true);
    assert.equal(result.iterations, 5);
  });
});
