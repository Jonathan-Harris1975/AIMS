import test from "node:test";
import assert from "node:assert/strict";
import {
  REVIEW_COUNCILS,
  getReviewCouncilMembers,
  isReviewCouncilEnabled,
  repairTextForReviewCouncil,
  runReviewCouncilGate,
} from "../services/content-quality/reviewCouncil.js";

test("all configured review councils have at least six members", () => {
  for (const key of Object.keys(REVIEW_COUNCILS)) {
    assert.ok(getReviewCouncilMembers(key).length >= 6, `${key} should have six or more members`);
  }
});

test("Blotato script quality council is disabled by default", () => {
  assert.equal(isReviewCouncilEnabled("blotato-script-quality", {}), false);
});

test("quiz answer repair restores the required answer marker", () => {
  assert.match(repairTextForReviewCouncil("Answer: B is correct", { contentType: "zernio-quiz-answer" }), /^Quiz Answer!/);
});

test("gate review repairs then revalidates before quarantine", async () => {
  const gate = { ok: false, score: 70, defects: ["Quiz answer must start with the answer marker."], warnings: [] };
  const reviewed = await runReviewCouncilGate({
    councilKey: "quiz-logic",
    gate,
    artifact: { content: "Answer: C is correct" },
    contentType: "zernio-quiz-answer",
    validate: (candidate) => ({
      ok: /^Quiz Answer!/.test(candidate.content),
      score: /^Quiz Answer!/.test(candidate.content) ? 92 : 70,
      defects: /^Quiz Answer!/.test(candidate.content) ? [] : gate.defects,
      warnings: [],
    }),
  });

  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.reviewCouncil.memberCount >= 6, true);
  assert.equal(reviewed.reviewCouncil.decision, "self_improvement_approved");
  assert.equal(reviewed.reviewCouncil.councilRuns, 0);
  assert.ok(reviewed.reviewCouncil.selfImproveLoops <= 4);
});


test("council may accept a non-blocking result within five percent of an explicit threshold", async () => {
  const reviewed = await runReviewCouncilGate({
    councilKey: "quiz-logic",
    gate: { ok: false, score: 80, threshold: 85, defects: ["minor wording polish"], warnings: [] },
    artifact: { content: "Already structurally sound" },
    maxAttempts: 1,
    repairArtifact: async (artifact) => artifact,
    validate: async () => ({ ok: false, score: 82, threshold: 85, defects: ["minor wording polish"], warnings: [] }),
  });
  assert.equal(reviewed.ok, true);
  assert.equal(reviewed.reviewCouncil.councilRuns, 1);
  assert.equal(reviewed.reviewCouncil.acceptedWithinTolerance, true);
  assert.equal(reviewed.reviewCouncil.decision, "council_accepted_within_tolerance");
});

for (const stage of ["repair", "validation"]) {
  test(`${stage} outage retains the last validated artefact and failed gate`, async () => {
    const artifact = { content: "Original verified copy" };
    const gate = { ok: false, score: 84, threshold: 85, defects: ["British English drift: use organise instead of organize"] };
    let attempts = 0;
    const reviewed = await runReviewCouncilGate({
      councilKey: "quiz-logic", gate, artifact, logger: () => {},
      repairArtifact: async () => {
        attempts += 1;
        if (stage === "repair") throw new Error("provider response with private detail");
        return { content: "Unvalidated replacement" };
      },
      validate: async () => { throw new Error("validator unavailable"); },
    });
    assert.equal(attempts, 1);
    assert.equal(reviewed.ok, false);
    assert.deepEqual(reviewed.artifact, artifact);
    assert.deepEqual(reviewed.gate.defects, gate.defects);
    assert.equal(reviewed.reviewCouncil.repairFailure.stage, stage);
    assert.equal(reviewed.reviewCouncil.acceptedWithinTolerance, false);
    assert.doesNotMatch(JSON.stringify(reviewed), /private detail|validator unavailable/);
    const { advisoryDailySocialGate } = await import("../services/blog/social/dailySocialQa.js");
    assert.equal(advisoryDailySocialGate(reviewed.gate).publicationBlocked, false);
  });
}

test("repair outage never downgrades factual or source failures", async () => {
  const gate = { ok: false, score: 84, threshold: 85, defects: ["No source records supplied for source-backed publication."], hardFailure: true };
  const reviewed = await runReviewCouncilGate({
    councilKey: "quiz-logic", gate, artifact: { content: "Unverified claim" }, logger: () => {},
    repairArtifact: async () => { throw new Error("provider unavailable"); },
  });
  const { advisoryDailySocialGate } = await import("../services/blog/social/dailySocialQa.js");
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.gate.hardFailure, true);
  assert.equal(advisoryDailySocialGate(reviewed.gate).publicationBlocked, true);
});

test("later repair outage retains the original pair used by advisory callers", async () => {
  const gate = { ok: false, score: 60, defects: ["Missing source"] };
  let attempts = 0;
  const reviewed = await runReviewCouncilGate({
    councilKey: "quiz-logic", gate, artifact: { content: "Original" }, logger: () => {},
    repairArtifact: async () => {
      if (++attempts === 2) throw new Error("provider unavailable");
      return { content: "First validated repair" };
    },
    validate: async () => ({ ok: false, score: 70, defects: ["British English drift: use organise instead of organize"] }),
  });
  assert.equal(attempts, 2);
  assert.equal(reviewed.artifact.content, "Original");
  assert.equal(reviewed.gate.score, 60);
  assert.equal(reviewed.ok, false);
  const { advisoryDailySocialGate } = await import("../services/blog/social/dailySocialQa.js");
  assert.equal(advisoryDailySocialGate(reviewed.gate).publicationBlocked, true);
});

test("nested repair budget exhaustion is recorded without another attempt", async () => {
  const { withTaskRepairBudget, claimRepairAction } = await import("../services/shared/utils/taskRepairBudget.js");
  const reviewed = await withTaskRepairBudget(() => runReviewCouncilGate({
    councilKey: "quiz-logic", gate: { ok: false, score: 84, threshold: 85, defects: ["Missing source"] },
    artifact: { content: "Original" }, logger: () => {},
    repairArtifact: async () => { claimRepairAction(); },
  }), { repairs: 1, recoveries: 0 });
  assert.equal(reviewed.ok, false);
  assert.equal(reviewed.reviewCouncil.budgetExhausted, true);
  assert.equal(reviewed.reviewCouncil.attemptsUsed, 1);
  assert.equal(reviewed.reviewCouncil.repairFailure.reason, "repair_budget_exhausted");
});
