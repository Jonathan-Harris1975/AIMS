import test from "node:test";
import assert from "node:assert/strict";
import {
  AIMS_MODEL_GOVERNANCE_POLICY,
  buildAimsModelAdvisories,
  buildAimsModelAssignments,
  inferModelCostTier,
} from "../services/shared/utils/modelGovernance.js";

test("AIMS spend governance is advisory and never blocks runtime requests by price", () => {
  assert.equal(AIMS_MODEL_GOVERNANCE_POLICY.spendControl.mode, "advisory");
  assert.equal(AIMS_MODEL_GOVERNANCE_POLICY.spendControl.runtimeRequestBlocking, false);
  assert.equal(AIMS_MODEL_GOVERNANCE_POLICY.spendControl.hardSpendCaps, false);
  assert.equal(AIMS_MODEL_GOVERNANCE_POLICY.council.schedulerOwnedHere, false);
});

test("explicit council assignments cover specialist AIMS slots and override ranked defaults", () => {
  const assignments = buildAimsModelAssignments({
    fast: [{ model_id: "openai/gpt-oss-20b", score: 90, evaluation_passed: true,
      evaluation_sample_size: 30, evaluation_evidence: "eval/fast.json", cost_per_successful_task: 0.01 }],
    reasoning: [{ model_id: "openai/gpt-5.6-terra", score: 88, evaluation_passed: true,
      evaluation_sample_size: 30, evaluation_evidence: "eval/reasoning.json", cost_per_successful_task: 0.03 }],
    overrides: [
      { model_id: "openai/gpt-5.6-luna", score: 90, evaluation_passed: true,
        evaluation_sample_size: 30, evaluation_evidence: "eval/luna.json", approved_roles: ["AI_MODEL_FAST"] },
      { model_id: "anthropic/claude-sonnet-5.5", score: 88, evaluation_passed: true,
        evaluation_sample_size: 30, evaluation_evidence: "eval/comms.json", approved_roles: ["COMMS_HUB_MODEL_PAID_PRIMARY"] },
      { model_id: "anthropic/claude-opus-5.5", score: 87, evaluation_passed: true,
        evaluation_sample_size: 30, evaluation_evidence: "eval/outreach.json", approved_roles: ["OUTREACH_ARTICLE_REVIEW_MODEL"] },
    ],
  }, {
    AI_MODEL_FAST: "openai/gpt-5.6-luna",
    COMMS_HUB_MODEL_PAID_PRIMARY: "anthropic/claude-sonnet-5.5",
    OUTREACH_ARTICLE_REVIEW_MODEL: "anthropic/claude-opus-5.5",
  });

  assert.equal(assignments.AI_MODEL_FAST, "openai/gpt-5.6-luna");
  assert.equal(assignments.AI_MODEL_STANDARD, "openai/gpt-5.6-terra");
  assert.equal(assignments.COMMS_HUB_MODEL_PAID_PRIMARY, "anthropic/claude-sonnet-5.5");
  assert.equal(assignments.OUTREACH_ARTICLE_REVIEW_MODEL, "anthropic/claude-opus-5.5");
});

test("models without passing task evidence cannot become AIMS defaults", () => {
  assert.deepEqual(buildAimsModelAssignments({
    reasoning: [{ model_id: "openai/unmeasured", score: 100 }],
  }), {});
});

test("explicit AIMS routes require passing evidence approved for that route", () => {
  assert.throws(() => buildAimsModelAssignments({
    fast: [{ model_id: "openai/test", score: 100, evaluation_passed: true,
      evaluation_sample_size: 10, evaluation_evidence: "eval/test.json", approved_roles: ["AI_MODEL_STANDARD"] }],
  }, { AI_MODEL_FAST: "openai/test" }), /approved for that route/);
});

test("expert assignments without a complete decision record are advisory, not rejected", () => {
  const assignments = { AI_MODEL_HIGH_QUALITY: "anthropic/claude-sonnet-5.5" };
  const decisions = {
    AI_MODEL_HIGH_QUALITY: {
      assignment: "AI_MODEL_HIGH_QUALITY",
      modelId: "anthropic/claude-sonnet-5.5",
      costTier: "expert",
      justificationId: null,
      task: null,
      complexity: null,
      cheaperAlternative: null,
      justification: null,
      evaluationEvidence: [],
      approvedBy: null,
    },
  };
  const advisories = buildAimsModelAdvisories({
    assignments,
    decisions,
    retiringModels: [],
    catalogueCheckedAt: "2026-09-11T09:00:00Z",
  });

  assert.equal(assignments.AI_MODEL_HIGH_QUALITY, "anthropic/claude-sonnet-5.5");
  assert.equal(advisories.some((item) => item.code === "expert-justification-incomplete"), true);
});

test("current economy models and retiring assignments are classified for council review", () => {
  assert.equal(inferModelCostTier("openai/gpt-5.6-luna"), "economy");
  assert.equal(inferModelCostTier("anthropic/claude-haiku-5.5"), "economy");
  assert.equal(inferModelCostTier("openrouter/free"), "free");
  assert.equal(inferModelCostTier("anthropic/claude-opus-5.5"), "expert");

  const assignments = { AI_MODEL_FAST: "example/model-preview" };
  const advisories = buildAimsModelAdvisories({
    assignments,
    decisions: {
      AI_MODEL_FAST: {
        assignment: "AI_MODEL_FAST",
        modelId: "example/model-preview",
        costTier: "unknown",
      },
    },
    retiringModels: [{
      modelId: "example/model-preview",
      retirementDate: "2026-10-01T00:00:00.000Z",
      replacement: "example/model-stable",
    }],
    catalogueCheckedAt: "2026-09-11T09:00:00Z",
  });

  assert.equal(advisories.some((item) => item.code === "cost-tier-unclassified"), true);
  assert.equal(advisories.some((item) => item.code === "assigned-model-retiring"), true);
});

test("unknown assignment variables fail configuration validation rather than being ignored", () => {
  assert.throws(
    () => buildAimsModelAssignments({}, { AI_MODEL_TYPO: "example/model" }),
    /Unsupported AIMS model assignment variables/,
  );
});
