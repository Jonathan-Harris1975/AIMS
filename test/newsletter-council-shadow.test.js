import test from "node:test";
import assert from "node:assert/strict";
import { selectCouncilGroups, runTargetedCouncil, compareCouncilShadow, maybeCompareCouncilShadow } from "../services/newsletter/engine/councilShadow.js";
import { evaluateCouncilShadow } from "../services/newsletter/engine/evaluateCouncilShadow.js";
import { withTaskRepairBudget, currentTaskRepairBudget, claimRepairAction } from "../services/shared/utils/taskRepairBudget.js";

const input = () => ({ profile: { id: "shadow-fixture", brandVoice: "Direct British English" },
  newsletter: { subject: "Source-supported update", bigThree: [], onRadar: [] },
  lead: { title: "A source", link: "https://source.example/article", summary: "A supported statement." }, stories: [],
  sessionId: "shadow-unit", defects: ["British English spelling"],
  baseline: { ok: true, score: 90, reviews: [], chair: { blocking: false }, attendance: { complete: true } },
});

test("targeted selection always retains evidence and unknown defects retain all groups", () => {
  assert.deepEqual(selectCouncilGroups(["British English spelling"]), ["evidence", "voice"]);
  assert.deepEqual(selectCouncilGroups(["source mismatch"]), ["evidence"]);
  assert.deepEqual(selectCouncilGroups(["subject length"]), ["evidence", "reader"]);
  assert.deepEqual(selectCouncilGroups(["unclassified defect"]), ["evidence", "voice", "reader"]);
});

test("shadow requests use configured routes and cannot consume the publishing recovery allowance", async () => {
  const calls = [];
  await withTaskRepairBudget(async () => {
    claimRepairAction("recoveries");
    const budget = currentTaskRepairBudget();
    const result = await runTargetedCouncil(input(), { request: async (route, options) => {
      assert.notEqual(currentTaskRepairBudget(), budget);
      calls.push({ route, options });
      return { content: JSON.stringify({ score: 95, blocking: false, issues: [] }), usage: { cost: 0.001 } };
    } });
    assert.equal(result.ok, true);
    assert.deepEqual(calls.map(call => call.route), ["newsletterFactCheck", "targetedRepair", "newsletterCouncilChair"]);
    assert.ok(calls.every(call => call.options.maxRetries === 0 && call.options.sessionId.endsWith("-targeted-shadow")));
    assert.equal(result.metrics.successfulResponseCostUsd, 0.003);
    assert.equal(result.metrics.fullCostAvailable, false);
    assert.equal(budget.snapshot().used.recoveries, 1);
  }, { repairs: 4, recoveries: 1 });
});

test("shadow specialist blockers cannot be overruled by its chair", async () => {
  let call = 0;
  const result = await runTargetedCouncil({ ...input(), defects: ["source mismatch"] }, { request: async () =>
    JSON.stringify({ score: 95, blocking: call++ === 0, issues: [] }) });
  assert.equal(result.ok, false);
  assert.equal(result.blocking, true);
});

test("comparison cannot change baseline approval, even on disagreement or malformed output", async () => {
  for (const approved of [false, true]) {
    const task = input(); task.baseline.ok = approved;
    const before = structuredClone(task.baseline);
    const comparison = await compareCouncilShadow(task, { run: async () => ({ completed: true, ok: !approved, blocking: false }) });
    assert.deepEqual(task.baseline, before);
    assert.equal(comparison.disagreement, true);
    assert.equal(comparison.publicationAuthority, "existing-qa-only");
  }
  const result = await compareCouncilShadow(input(), { run: async () => runTargetedCouncil(input(), { request: async () => "{}" }) });
  assert.equal(result.candidate.completed, false);
  assert.equal(result.baseline.ok, true);
  assert.equal(result.disagreement, null);
});

test("daily process sampler reserves before awaiting and disabled mode makes no calls", async () => {
  const previous = process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED;
  let calls = 0;
  const compare = async () => { calls += 1; await Promise.resolve(); return { mode: "shadow", completed: true }; };
  try {
    delete process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED;
    assert.equal(await maybeCompareCouncilShadow(input(), { compare }), null);
    process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED = "true";
    const results = await Promise.all([1, 2].map(() => maybeCompareCouncilShadow(input(), { now: new Date("2026-10-28T12:00:00Z"), compare })));
    assert.equal(calls, 1);
    assert.equal(results.filter(result => result.skipped).length, 1);
  } finally {
    if (previous === undefined) delete process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED;
    else process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED = previous;
  }
});

test("comparison evidence stays in private storage and storage failure remains observational", async () => {
  const previous = process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED;
  process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED = "true";
  try {
    const task = input(); task.profile = { ...task.profile, id: "private-shadow-case", storage: { htmlBucketKey: "newsletter" } };
    const baseline = structuredClone(task.baseline);
    const result = await maybeCompareCouncilShadow(task, { now: new Date("2026-10-29T12:00:00Z"),
      compare: async () => ({ mode: "shadow", fingerprint: "test-fingerprint" }),
      store: async (key, record) => {
        assert.match(key, /^evaluations\/newsletter-council-shadow\//);
        assert.deepEqual(record.evidence.newsletter, task.newsletter);
        throw new Error("storage unavailable");
      },
    });
    assert.equal(result.storage.stored, false);
    assert.deepEqual(task.baseline, baseline);
  } finally {
    if (previous === undefined) delete process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED;
    else process.env.NEWSLETTER_TARGETED_COUNCIL_SHADOW_ENABLED = previous;
  }
});

function labelledCases() {
  return Array.from({ length: 50 }, (_, index) => ({ caseId: `synthetic-unit-${index}`, expectedBlocking: index < 10,
    qualityDelta: 0, fullCostVerified: true, baselineCostGbp: 0.1, candidateCostGbp: 0.04,
    baseline: { ok: index >= 10, blocking: index < 10, attendanceComplete: true },
    candidate: { completed: true, ok: index >= 10, blocking: index < 10 } }));
}

test("evaluation requires independent labels, blocker coverage, complete costs and no unsafe approvals", () => {
  const rows = labelledCases();
  assert.equal(evaluateCouncilShadow(rows).readyForReview, true);
  assert.equal(evaluateCouncilShadow(rows).promotionAllowed, false);
  assert.equal(evaluateCouncilShadow(rows.slice(0, 3)).sufficientEvidence, false);
  rows[0].candidate.ok = true; rows[0].candidate.blocking = false;
  assert.equal(evaluateCouncilShadow(rows).readyForReview, false);
  assert.equal(evaluateCouncilShadow(rows).missedKnownBlockers, 1);
  rows[0].fullCostVerified = false;
  assert.equal(evaluateCouncilShadow(rows).sufficientEvidence, false);
  assert.throws(() => evaluateCouncilShadow([rows[0], rows[0]]), /duplicate/);
});
