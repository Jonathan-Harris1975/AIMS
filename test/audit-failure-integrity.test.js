import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { __digitalGrowthAnalysisTestHooks } from "../audits/utils/digitalGrowthAnalysis.js";
import {
  __websiteAuditCouncilTestHooks,
  evaluateWebsiteAuditStageHealth,
  enforceCouncilInvariants,
} from "../audits/utils/websiteAuditCouncil.js";
import { buildAuditCallbackDiagnostics } from "../audits/utils/auditCallbackDiagnostics.js";

const completedStages = {
  digitalGrowth: { status: "completed", analysis: { auditCompletionState: "Complete" } },
  seoAeoGeo: { status: "completed", coverage: { auditCompletionState: "Complete" } },
  mobileUx: { status: "completed", hardGateBlocked: false, mobileQualityScore: 86, coverage: { auditCompletionState: "Complete" } },
};

test("three failed source stages can never produce a complete synthesis", () => {
  const stageReports = {
    digitalGrowth: { status: "failed", jobError: { message: "schema failure" }, workflowRunUrl: "https://example.test/digital" },
    seoAeoGeo: { status: "failed", jobError: { message: "exit code 1" }, workflowRunUrl: "https://example.test/seo" },
    mobileUx: { status: "failed", jobError: { message: "browser failed" }, workflowRunUrl: "https://example.test/mobile" },
  };
  const health = evaluateWebsiteAuditStageHealth(stageReports);
  assert.equal(health.ok, false);
  assert.equal(health.failures.length, 3);

  const council = enforceCouncilInvariants({
    synthesisState: "Complete",
    executiveSummary: "Everything is fine.",
    scorecard: {
      trafficGrowth: { score: 9, status: "Scored", basis: "partial" },
      technicalSeo: { score: 9, status: "Scored", basis: "partial" },
      mobileUx: { score: 9, status: "Scored", basis: "partial" },
      councilConfidence: { score: 9, status: "Scored", basis: "partial" },
    },
    blockers: [],
    unifiedFindings: [],
    masterIssueLedger: [],
    councilRecord: { unresolvedVerificationItems: [], rejectedAssumptions: [] },
    definitionOfDone: [],
  }, stageReports);

  assert.equal(council.synthesisState, "Incomplete");
  assert.equal(council.blockers.length, 3);
  assert.equal(council.scorecard.trafficGrowth.score, null);
  assert.equal(council.scorecard.technicalSeo.score, null);
  assert.equal(council.scorecard.mobileUx.score, null);
  assert.ok(council.scorecard.councilConfidence.score <= 3);
  assert.equal(council.councilRecord.unresolvedVerificationItems.length, 3);
});

test("all complete source stages satisfy the evidence contract", () => {
  const health = evaluateWebsiteAuditStageHealth(completedStages);
  assert.equal(health.ok, true);
  assert.equal(health.failures.length, 0);
});

test("digital growth normaliser accepts nested and aliased model output", () => {
  const result = __digitalGrowthAnalysisTestHooks.normaliseAnalysis({
    result: {
      analysis: {
        completionState: "Complete",
        scores: { traffic: { score: 7, basis: "Observed routes" } },
        issues: [{ id: "DG-X", issue: "Weak CTA", action: "Add a CTA", route: "/" }],
        executiveSummary: { priorities: ["Add a CTA"] },
      },
    },
  });
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].findingId, "DG-X");
  assert.equal(result.executiveSummary.top10Actions[0], "Add a CTA");
  assert.equal(result.scorecard.trafficGrowth.score, 7);
});

test("digital growth falls back deterministically when AI JSON has no usable ledger", () => {
  const result = __digitalGrowthAnalysisTestHooks.normaliseAnalysis(
    { response: { prose: "No schema" } },
    { fallbackEvidence: { baseUrl: "https://example.test", heuristicIssues: [{ id: "H-1", title: "CTA missing", remediation: "Add CTA" }] } }
  );
  assert.equal(result.auditCompletionState, "Incomplete");
  assert.equal(result.diagnostics.fallbackUsed, true);
  assert.equal(result.findings[0].findingId, "H-1");
});

test("digital growth evidence bundle is bounded before model dispatch", () => {
  const payload = {
    allRoutes: Array.from({ length: 400 }, (_, index) => ({ route: `/route-${index}`, body: "x".repeat(3000) })),
    heuristicIssues: Array.from({ length: 200 }, (_, index) => ({ id: index, evidence: "y".repeat(4000) })),
    repoSignals: Object.fromEntries(Array.from({ length: 150 }, (_, index) => [`key${index}`, Array.from({ length: 100 }, () => "z".repeat(500))])),
  };
  const compact = __digitalGrowthAnalysisTestHooks.compactPayload(payload);
  const bounded = __digitalGrowthAnalysisTestHooks.enforcePayloadBudget(compact, 30000);
  assert.ok(JSON.stringify(bounded).length < 50000);
  assert.ok(bounded.allRoutes.length <= 50);
});

test("pipeline source enforces RAMS-before-cleanup and retains evidence on failure", () => {
  const source = fs.readFileSync("audits/utils/websiteAuditPipeline.js", "utf8");
  const dispatchAt = source.indexOf("ramsDispatch = await dispatchWebsiteAuditToRams");
  const cleanupAt = source.indexOf("cleanupResult = await strictTemporaryCleanup", dispatchAt);
  assert.ok(dispatchAt > 0);
  assert.ok(cleanupAt > dispatchAt);
  assert.match(source, /RAMS dispatch is prohibited until all required source audit stages complete/);
  assert.match(source, /retained-for-diagnosis-and-rerun/);
  assert.match(source, /phase: "controlled-audit-failure"/);
  assert.match(source, /failJob\(WEBSITE_PIPELINE_JOB_TYPE, parentSessionId, incompleteError/);
});

test("fallback council itself is invariant-safe", () => {
  const result = __websiteAuditCouncilTestHooks.deterministicFallback({
    digitalGrowth: { status: "failed", jobError: "failed" },
    seoAeoGeo: { status: "failed", jobError: "failed" },
    mobileUx: { status: "failed", jobError: "failed" },
  }, "council unavailable");
  assert.equal(result.synthesisState, "Incomplete");
  assert.equal(result.blockers.length, 3);
});


test("callback diagnostics retain the exact failing step, exit code and workflow log tail", () => {
  const diagnostics = buildAuditCallbackDiagnostics({
    status: "failed",
    message: "workflow failed",
    failedStep: "Run forensic audit",
    exitCode: 1,
    sourceRevisionSha: "abcdef123456",
    workflowLogTail: "Traceback: exact failure",
  }, { workflowRunUrl: "https://example.test/run/1" });

  assert.equal(diagnostics.workflowRunUrl, "https://example.test/run/1");
  assert.equal(diagnostics.failedStep, "Run forensic audit");
  assert.equal(diagnostics.exitCode, 1);
  assert.equal(diagnostics.workflowLogTail, "Traceback: exact failure");
});

test("stage health uses retained callback diagnostics when the job error is absent", () => {
  const health = evaluateWebsiteAuditStageHealth({
    ...completedStages,
    seoAeoGeo: {
      status: "failed",
      callbackDiagnostics: {
        failedStep: "Run SEO audit",
        exitCode: 1,
        workflowRunUrl: "https://example.test/seo-run",
      },
    },
  });
  assert.equal(health.ok, false);
  assert.match(health.failures[0].reason, /Run SEO audit/);
  assert.match(health.failures[0].reason, /Exit code: 1/);
  assert.equal(health.failures[0].workflowRunUrl, "https://example.test/seo-run");
});

test("raw AI responses are retained with an explicit truncation signal", () => {
  const old = process.env.DIGITAL_GROWTH_RAW_RESPONSE_MAX_CHARS;
  process.env.DIGITAL_GROWTH_RAW_RESPONSE_MAX_CHARS = "10";
  try {
    const retained = __digitalGrowthAnalysisTestHooks.retainedRawResponse("1234567890ABC");
    assert.equal(retained.value, "1234567890");
    assert.equal(retained.originalCharacters, 13);
    assert.equal(retained.truncated, true);
  } finally {
    if (old === undefined) delete process.env.DIGITAL_GROWTH_RAW_RESPONSE_MAX_CHARS;
    else process.env.DIGITAL_GROWTH_RAW_RESPONSE_MAX_CHARS = old;
  }
});
