import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

process.env.OPENROUTER_API_KEY = "test-key";
process.env.NEWSLETTER_MAX_REWRITE_ITERATIONS = "4";
process.env.NEWSLETTER_SELF_IMPROVE_MAX_LOOPS = "4";
process.env.NEWSLETTER_COUNCIL_MAX_RUNS = "2";
process.env.NEWSLETTER_COUNCIL_NEAR_THRESHOLD_TOLERANCE = "0.05";
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
let selfScores = [];
let councilScores = [];
let selfCallCount = 0;
let chairCallCount = 0;

function chat(content) { return { choices: [{ message: { content } }] }; }
function reviewResponse(score) {
  return JSON.stringify({ score, verdict: score >= 85 ? "pass" : "revise", blocking: false, issues: score >= 85 ? [] : ["needs work"], strengths: ["clear"] });
}

before(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = {};
      try { parsed = JSON.parse(body); } catch {}
      const system = parsed.messages?.[0]?.content || "";
      res.writeHead(200, { "Content-Type": "application/json" });

      if (system.includes("economical pre-council editor")) {
        const score = selfScores[Math.min(selfCallCount, selfScores.length - 1)] ?? 90;
        selfCallCount += 1;
        res.end(JSON.stringify(chat(JSON.stringify({ score, blocking: false, issues: score >= 85 ? [] : ["needs a tighter edit"] }))));
        return;
      }

      if (system.includes("on the AI Edge editorial council")) {
        const score = councilScores[Math.min(chairCallCount, councilScores.length - 1)] ?? 90;
        res.end(JSON.stringify(chat(reviewResponse(score))));
        return;
      }

      if (system.includes("AI Edge Editorial Chair")) {
        const score = councilScores[Math.min(chairCallCount, councilScores.length - 1)] ?? 90;
        chairCallCount += 1;
        res.end(JSON.stringify(chat(JSON.stringify({ score, verdict: score >= 85 ? "pass" : "revise", blocking: false, issues: score >= 85 ? [] : ["chair says revise"], priorityFixes: [] }))));
        return;
      }

      if (system.includes("senior editor writing")) {
        res.end(JSON.stringify(chat(JSON.stringify({
          heroHeadline: "A revised headline",
          openingNoteHtml: "<p>A revised opening note with practical judgement.</p>",
          bigThree: [
            { sourceId: "S0", whatHappened: "A happened.", whyItMatters: "A matters.", jonathanTake: "A take." },
            { sourceId: "S1", whatHappened: "B happened.", whyItMatters: "B matters.", jonathanTake: "B take." },
            { sourceId: "S2", whatHappened: "C happened.", whyItMatters: "C matters.", jonathanTake: "C take." },
          ],
          worthUsing: { sourceId: "S3", label: "Worth Watching", summary: "D summary.", whyUseful: "D useful." },
          onRadar: [{ sourceId: "S4", summary: "E summary." }, { sourceId: "S5", summary: "F summary." }],
          realityCheck: { sourceId: "S0", claim: "A claim", assessment: "The evidence is narrower." },
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
beforeEach(() => { selfCallCount = 0; chairCallCount = 0; selfScores = []; councilScores = []; });

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
    subject: "Draft subject", previewText: "Draft preview", heroHeadline: "Draft headline",
    openingNoteHtml: "<p>Draft opening note.</p>", heroImageUrl: "https://images.example.com/hero.png",
    bigThree: [lead, ...stories.slice(0, 2)].map((s) => ({ ...s, whatHappened: "Happened.", whyItMatters: "Matters.", jonathanTake: "Take." })),
    worthUsing: { ...stories[2], label: "Worth Watching", summary: "Summary.", whyUseful: "Useful." },
    onRadar: stories.slice(3).map((s) => ({ ...s, summary: "Summary." })),
    realityCheck: { claim: "Claim", assessment: "Assessment.", link: lead.link },
    yourTurn: "Question?", promotion: null, footer: { text: "footer" },
  };
}

const profile = { id: "test-profile", displayName: "AI Edge", brandVoice: "Clear and practical." };

describe("newsletter engine/qaLoop.js", () => {
  test("publishes after the lightweight self-review without convening a council", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    selfScores = [92];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-pass" });
    assert.equal(result.ok, true);
    assert.equal(result.selfImproveIterations, 1);
    assert.equal(result.councilRuns, 0);
    assert.equal(chairCallCount, 0);
  });

  test("escalates only after four loops and seats every declared council member", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    selfScores = [70, 70, 70, 70];
    councilScores = [91];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-escalate" });
    assert.equal(result.ok, true);
    assert.equal(result.selfImproveIterations, 4);
    assert.equal(result.councilRuns, 1);
    assert.equal(result.council.reviews.length, 13);
    assert.equal(result.council.attendance.complete, true);
    assert.equal(result.council.attendance.present, 14);
  });

  test("accepts a non-blocking council result within five percent of threshold", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    selfScores = [70, 70, 70, 70];
    councilScores = [82];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-tolerance" });
    assert.equal(result.ok, true);
    assert.equal(result.councilRuns, 1);
    assert.equal(result.council.nearThresholdAccepted, true);
    assert.equal(result.council.verdict, "pass_with_tolerance");
  });

  test("quarantines after no more than two failed full councils", async () => {
    const { runQaLoop } = await import("../services/newsletter/engine/qaLoop.js");
    selfScores = [60, 60, 60, 60];
    councilScores = [60, 60];
    const result = await runQaLoop({ profile, newsletter: draftNewsletter(), lead, stories, sessionId: "test-quarantine" });
    assert.equal(result.ok, false);
    assert.equal(result.quarantined, true);
    assert.equal(result.selfImproveIterations, 4);
    assert.equal(result.councilRuns, 2);
    assert.equal(chairCallCount, 2);
  });
});
