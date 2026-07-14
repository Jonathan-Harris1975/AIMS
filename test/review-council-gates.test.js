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
  assert.equal(reviewed.reviewCouncil.decision, "repair_approved");
});
