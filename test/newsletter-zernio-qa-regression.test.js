import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildQaRepairPrompt } from "../services/artwork/utils/artwork.js";
import { buildDailyLaneArtworkPrompt } from "../services/zernio/utils/socialScheduler.js";
import { sourcePayload } from "../services/newsletter/engine/editorialCouncil.js";
import { operationTaskSucceeded } from "../services/ops/operationWindowState.js";

test("image QA repair puts defects before truncated model prompts and keeps actual subject", () => {
  const brief = "Friday post: reduce prompt context-token budgets by choosing only relevant input." + " Corporate filler.".repeat(250);
  const repair = buildQaRepairPrompt(brief, {
    hardDefects: ["Unrelated generic rack of servers", "Tiny pseudo-text on the display"],
    defects: ["There is no visible relationship to prompt context trimming"],
  }, "social");
  assert.match(repair.slice(0, 900), /Unrelated generic rack of servers/);
  assert.match(repair.slice(0, 900), /Tiny pseudo-text on the display/);
  assert.match(repair.slice(0, 900), /relationship to prompt context trimming/);
  assert.match(repair, /reduce prompt context-token budgets/);
  assert.ok(repair.indexOf("Mandatory repairs") < repair.indexOf("Source-specific subject"));
  assert.ok(repair.length < 2000, "the correction must survive limited image-model prompt windows");
});

test("Zernio Friday/Saturday/Sunday artwork briefs prioritise actual scene evidence", () => {
  const friday = buildDailyLaneArtworkPrompt({
    laneKey: "friday",
    post: { topic: "Context-token limits and request trimming",
      content: "Keep the highest-value source passages and drop repetitive prompt context." },
  });
  assert.match(friday.slice(0, 320), /Context-token limits and request trimming/);
  assert.match(friday, /never a made-up server repair/);
  const saturday = buildDailyLaneArtworkPrompt({
    laneKey: "saturday",
    post: { topic: "Human intervention versus autonomous agent decisions",
      content: "An operator permits a safe action while a colleague pauses an unsafe action." },
  });
  assert.match(saturday.slice(0, 320), /Human intervention versus autonomous agent decisions/);
  assert.match(saturday, /visibly enables a source-supported AI-assisted decision/);
  assert.match(saturday, /second pauses the SAME decision/);
  const sunday = buildDailyLaneArtworkPrompt({
    laneKey: "sunday",
    post: { topic: "Marvin Tester's optical research",
      spotlightPerson: "Marvin Tester", content: "A contribution to optical machine-learning sensing" },
  });
  assert.match(sunday.slice(0, 350), /optical research/);
  assert.doesNotMatch(sunday.slice(0, 350), /Marvin Tester/);
  assert.match(sunday, /source-supported technical result or research contribution/);
  assert.match(sunday, /Never render, approximate or imply their face/);
});

test("weekday and weekend newsletter builders enrich original articles before composing", async () => {
  const build = await readFile(new URL("../services/newsletter/engine/buildNewsletter.js", import.meta.url), "utf8");
  const compose = await readFile(new URL("../services/newsletter/engine/compose.js", import.meta.url), "utf8");
  const repair = await readFile(new URL("../services/newsletter/engine/targetedRepair.js", import.meta.url), "utf8");
  assert.match(build, /enrichArticleEvidence\(\[lead, \.\.\.stories\]\)/);
  assert.doesNotMatch(build, /lead && stories\.length >= 2 && !sourceItems/);
  assert.match(compose, /Never introduce specific figures/);
  assert.match(compose, /original article is unavailable/);
  assert.match(repair, /When a claim lacks support, remove the unsupported numbers/);
  assert.match(repair, /\{ repairs: 0, recoveries: 8 \}/);
});

test("independent editorial council receives only verified original-article evidence", () => {
  const lead = { title: "Research summary", summary: "Study reports a pattern", link: "https://example.com/a",
    evidence: "Original publisher: 299 participants; a survey, not a causal experiment.", evidenceVerified: true };
  const unverified = { title: "Unverified vendor claim", summary: "A vendor claims success", link: "https://example.com/b",
    evidence: "Unsourced fabricated statistics", evidenceVerified: false };
  const [a, b] = sourcePayload(lead, [unverified]);
  assert.match(a.originalArticleEvidence, /299 participants/);
  assert.equal(a.evidenceVerified, true);
  assert.equal(b.originalArticleEvidence, undefined);
  assert.equal(b.evidenceVerified, false);
});

test("RSS terminal successful rewrite with verified phase-3 statistics is reusable", () => {
  const base = {
    name: "rss-rewrite", ok: true, asyncStatus: "completed",
    asyncJob: { job: { result: {
      rewrittenItems: 4,
      phase3Quality: { status: "ALL_PASSED_AUTO_PUBLISH", passed: 1, failed: 0 },
    } } },
    result: { ok: true, status: "running" },
  };
  assert.equal(operationTaskSucceeded(base), true);
  assert.equal(operationTaskSucceeded({ ...base, asyncStatus: "running" }), false);
  assert.equal(operationTaskSucceeded({ ...base, asyncJob: { job: { result: {
    rewrittenItems: 4, phase3Quality: { status: "HAS_QUARANTINED_ITEMS", passed: 1, failed: 3 },
  } } } }), false);
  assert.equal(operationTaskSucceeded({ ...base, asyncJob: { job: { result: {
    rewrittenItems: 0, phase3Quality: { status: "ALL_PASSED_AUTO_PUBLISH", passed: 0, failed: 0 },
  } } } }), false);
});
