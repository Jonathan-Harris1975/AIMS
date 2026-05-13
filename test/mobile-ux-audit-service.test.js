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
