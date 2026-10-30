import test from "node:test";
import assert from "node:assert/strict";
import { withTaskRepairBudget, claimRepairAction, currentTaskRepairBudget } from "../services/shared/utils/taskRepairBudget.js";
import { runReviewCouncilGate } from "../services/content-quality/reviewCouncil.js";
import { applyNewsletterEdits } from "../services/newsletter/engine/targetedRepair.js";

test("nested gates share one allowance and exhausted quality remains blocked", async () => {
  await withTaskRepairBudget(async () => {
    const repair = async (artifact) => ({ text: `${artifact.text}!` });
    const first = await runReviewCouncilGate({ councilKey: "quiz-logic", artifact: { text: "first" },
      gate: { ok: false, score: 0, defects: ["missing source"] }, repairArtifact: repair,
      validate: () => ({ ok: false, score: 0, defects: ["missing source"] }), logger() {} });
    assert.equal(first.reviewCouncil.attemptsUsed, 2);
    const second = await withTaskRepairBudget(() => runReviewCouncilGate({ councilKey: "quiz-logic", artifact: { text: "second" },
      gate: { ok: false, score: 84, threshold: 85, defects: ["minor polish"] },
      repairArtifact() { throw new Error("must not call a depleted repair"); }, logger() {} }));
    assert.equal(second.ok, false);
    assert.equal(second.reviewCouncil.budgetExhausted, true);
    assert.equal(second.reviewCouncil.attemptsUsed, 0);
  }, { repairs: 2, recoveries: 1 });
});

test("concurrent tasks have separate recovery budgets; failure cannot refill them", async () => {
  await Promise.all([1, 2].map(() => withTaskRepairBudget(async () => {
    claimRepairAction("recoveries");
    await Promise.resolve();
    assert.throws(() => claimRepairAction("recoveries"), { code: "AI_TASK_REPAIR_BUDGET_EXHAUSTED" });
    assert.equal(currentTaskRepairBudget().snapshot().used.recoveries, 1);
  }, { repairs: 1, recoveries: 1 })));
  assert.equal(currentTaskRepairBudget(), undefined);
});

test("newsletter repairs preserve untouched copy and immutable source fields", () => {
  const draft = { subject: "Original", heroImageUrl: "image", bigThree: [
    { title: "Source", sourceId: "S0", link: "https://source.example", whatHappened: "Before", whyItMatters: "Keep" },
  ] };
  const repaired = applyNewsletterEdits(draft, [{ path: "bigThree.0.whatHappened", value: "After" }]);
  assert.equal(repaired.bigThree[0].whatHappened, "After");
  assert.equal(repaired.bigThree[0].whyItMatters, "Keep");
  assert.equal(repaired.bigThree[0].link, draft.bigThree[0].link);
  assert.equal(repaired.subject, "Original");
  assert.equal(draft.bigThree[0].whatHappened, "Before");
  for (const path of ["bigThree.0.link", "bigThree.0.sourceId", "bigThree.0.title", "__proto__.polluted"]) {
    assert.throws(() => applyNewsletterEdits(draft, [{ path, value: "invalid" }]));
  }
});

test("passing council seats are reused only with identical evidence and model policy", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.AI_MODEL_FAST = "test/luna";
  process.env.AI_MODEL_HIGH_QUALITY = "test/sonnet";
  process.env.AI_MODEL_AUDIT = "test/sol";
  const oldFetch = globalThis.fetch;
  const calls = [];
  let score = 95;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    calls.push(body.model);
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      score, blocking: false, verdict: score >= 85 ? "pass" : "revise", issues: [], strengths: [], priorityFixes: [],
    }) } }] }) };
  };
  try {
    const { runNewsletterEditorialCouncil } = await import("../services/newsletter/engine/editorialCouncil.js");
    const input = { profile: { displayName: "Test", brandVoice: "Clear" }, newsletter: {
      subject: "Unique cache test", bigThree: [], onRadar: [],
    }, lead: { title: "Evidence", link: "https://example.test/source", summary: "Original source" }, stories: [], sessionId: "cache-test" };
    assert.equal((await runNewsletterEditorialCouncil(input)).ok, true);
    const firstCount = calls.length;
    assert.equal(firstCount, 14);
    const reused = await runNewsletterEditorialCouncil(input);
    assert.equal(reused.ok, true);
    assert.equal(calls.length, firstCount);
    assert.ok(reused.reviews.every(review => review.reviewReused));
    input.lead.summary = "Changed source evidence";
    await runNewsletterEditorialCouncil(input);
    assert.ok(calls.length > firstCount, "source-dependent reviewers must rerun");
    const afterEvidence = calls.length;
    process.env.AI_MODEL_HIGH_QUALITY = "test/sonnet-changed";
    await runNewsletterEditorialCouncil(input);
    assert.ok(calls.length > afterEvidence, "changed model policy invalidates reuse");
    input.newsletter.subject = "Failing cache test";
    score = 50;
    assert.equal((await runNewsletterEditorialCouncil(input)).ok, false);
    const failingCount = calls.length;
    assert.equal((await runNewsletterEditorialCouncil(input)).ok, false);
    assert.equal(calls.length - failingCount, 14, "failed reviews are never cached as approvals");
  } finally { globalThis.fetch = oldFetch; }
});

test("all fourteen council seats recover schema routing errors independently of the draft budget", async () => {
  process.env.OPENROUTER_API_KEY = "test-key";
  process.env.AI_MODEL_FAST = "test/luna";
  process.env.AI_MODEL_HIGH_QUALITY = "test/sonnet";
  process.env.AI_MODEL_AUDIT = "test/sol";
  const oldFetch = globalThis.fetch;
  let compatibilityErrors = 0;
  let completed = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (Object.hasOwn(body, "temperature")) {
      compatibilityErrors += 1;
      return { ok: false, status: 404, text: async () => "No endpoints found that can handle requested parameters" };
    }
    assert.deepEqual(body.reasoning, { effort: "none", exclude: true });
    completed += 1;
    return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({
      score: 95, blocking: false, verdict: "pass", issues: [], strengths: [], priorityFixes: [],
    }) } }] }) };
  };
  try {
    const { runNewsletterEditorialCouncil } = await import("../services/newsletter/engine/editorialCouncil.js");
    await withTaskRepairBudget(async () => {
      claimRepairAction("recoveries");
      const result = await runNewsletterEditorialCouncil({ profile: { displayName: "Isolated recovery", brandVoice: "Clear" },
        newsletter: { subject: "Independent transport allowances", bigThree: [], onRadar: [] },
        lead: { title: "Evidence", link: "https://example.test/independent", summary: "Source evidence" },
        stories: [], sessionId: "independent-recovery" });
      assert.equal(result.ok, true);
      assert.equal(result.attendance.complete, true);
      assert.equal(currentTaskRepairBudget().snapshot().used.recoveries, 1);
    }, { repairs: 0, recoveries: 1 });
    assert.equal(completed, 14);
    assert.equal(compatibilityErrors, 14);
  } finally { globalThis.fetch = oldFetch; }
});
