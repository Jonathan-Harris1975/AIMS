import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("mobile UX audit route wiring declares the health, run, callback, and job-status surfaces", () => {
  const routeIndex = fs.readFileSync("audits/routes/index.js", "utf8");
  const mobileRoute = fs.readFileSync("audits/routes/mobileUx.js", "utf8");

  assert.match(routeIndex, /router\.use\("\/mobile-ux", mobileUxRoutes\)/);
  assert.match(mobileRoute, /router\.get\("\/health"/);
  assert.match(mobileRoute, /router\.post\("\/run"/);
  assert.match(mobileRoute, /router\.post\("\/callback", requireAuditCallbackAuth/);
  assert.match(mobileRoute, /router\.get\("\/jobs\/:sessionId"/);
});

test("mobile UX dispatch inputs match the website workflow compatibility contract", () => {
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");
  for (const inputName of [
    "session_id",
    "report_prefix",
    "base_url",
    "exclude_prefixes",
    "callback_url",
    "analysis_url",
    "callback_token",
    "audit_bucket",
    "audit_public_base_url",
    "audit_bucket_env",
    "audit_public_base_env",
  ]) {
    assert.match(orchestrator, new RegExp(`${inputName}:`), `${inputName} missing from dispatch inputs`);
  }
});

test("audit artefact validation is wired to the dedicated audits bucket/public base only", () => {
  const publisher = fs.readFileSync("audits/utils/publishAuditArtifacts.js", "utf8");
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");

  assert.match(publisher, /R2_BUCKET_AUDITS/);
  assert.match(publisher, /R2_PUBLIC_BASE_URL_AUDITS/);
  assert.match(publisher, /outside \$\{AUDIT_PUBLIC_BASE_ENV\}/);
  assert.match(orchestrator, /assertAuditArtifactUrls\(payload, \{ requireAny: false \}\)/);
  assert.match(orchestrator, /assertCompletedAuditArtifactUrls\(payload\)/);
  assert.match(orchestrator, /Audit callback type mismatch/);
});


test("mobile UX failed callbacks preserve hard-gate diagnostic metadata in job/latest state", () => {
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");

  assert.match(orchestrator, /function optionalCompletionMetadata\(payload = \{\}\)/);
  assert.match(orchestrator, /"hardGateBlocked"/);
  assert.match(orchestrator, /"blockedTests"/);
  assert.match(orchestrator, /\.\.\.optionalCompletionMetadata\(payload\)/);
});

test("completed mobile UX cleanup preserves screenshot and appendix prefixes", () => {
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");
  const publisher = fs.readFileSync("audits/utils/publishAuditArtifacts.js", "utf8");

  assert.match(orchestrator, /keepPrefixes:\s*\["screenshots", "appendices", "capability-probe"\]/);
  assert.match(orchestrator, /"screenshot-manifest\.json"/);
  assert.match(orchestrator, /"mandatory-mobile-scorecard\.json"/);
  assert.match(publisher, /function shouldKeepAuditKey/);
  assert.match(publisher, /relative\.startsWith\(prefix\)/);
});


test("mobile UX callback schema and metadata preserve production report artefact URLs", () => {
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");
  const publisher = fs.readFileSync("audits/utils/publishAuditArtifacts.js", "utf8");
  const schemas = fs.readFileSync("services/shared/utils/requestSchemas.js", "utf8");

  for (const [field, artefactName] of [
    ["reportJsonUrl", "report.json"],
    ["screenshotManifestUrl", "screenshot-manifest.json"],
    ["focusedPageAppendixUrl", "focused-page-appendix.json"],
    ["repositoryIssueAppendixUrl", "repository-issue-appendix.json"],
    ["mandatoryMobileScorecardUrl", "mandatory-mobile-scorecard.json"],
    ["responsiveFixAppendixUrl", "responsive-fix-appendix.json"],
  ]) {
    assert.ok(
      orchestrator.includes(`${field}: callbackUrlForArtefact(payload, "${field}", "${artefactName}")`),
      `${field} missing from job metadata artefact fallback`
    );
    assert.ok(publisher.includes(`payload.${field}`), `${field} missing from artefact URL extraction`);
    assert.ok(schemas.includes(`${field}: z.string().trim().url().optional()`), `${field} missing from callback schema`);
  }
});

test("completed mobile UX callbacks require the full production artefact set", () => {
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");

  assert.match(orchestrator, /const MOBILE_UX_REQUIRED_COMPLETION_URLS = \[/);
  for (const artefact of [
    "report.html",
    "report.json",
    "summary.json",
    "coverage.json",
    "execution.json",
    "preflight.json",
    "evidence.json",
    "screenshot-manifest.json",
    "focused-page-appendix.json",
    "repository-issue-appendix.json",
    "mandatory-mobile-scorecard.json",
    "responsive-fix-appendix.json",
  ]) {
    assert.ok(orchestrator.includes(artefact), `${artefact} not required`);
  }
  assert.match(orchestrator, /assertCompletedMobileUxPayload\(payload\)/);
  assert.match(orchestrator, /Completed Mobile UX callback is missing required artefact URL/);
  assert.match(orchestrator, /Completed Mobile UX callback must include screenshotCount greater than 0/);
  assert.match(orchestrator, /Completed Mobile UX callback must include mobileFailureCount/);
});

test("mobile UX job metadata preserves artefact URLs from nested artefact maps and split confidence", () => {
  const orchestrator = fs.readFileSync("audits/utils/orchestrator.js", "utf8");
  const schemas = fs.readFileSync("services/shared/utils/requestSchemas.js", "utf8");

  assert.match(orchestrator, /callbackUrlForArtefact\(payload, "reportJsonUrl", "report\.json"\)/);
  assert.match(orchestrator, /evidenceUrl: callbackUrlForArtefact\(payload, "evidenceUrl", "evidence\.json"\)/);
  assert.match(orchestrator, /"confidenceModel"/);
  assert.match(orchestrator, /"executionCoverageConfidence"/);
  assert.match(orchestrator, /"releaseConfidence"/);
  assert.match(orchestrator, /"rootCauseGroupCount"/);
  assert.match(schemas, /confidenceModel: z\.record\(z\.string\(\), z\.any\(\)\)\.optional\(\)/);
  assert.match(schemas, /rootCauseGroupCount: z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.optional\(\)/);
});
