import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("unified website audit routes are mounted and MAST-facing run endpoint exists", () => {
  const index = read("audits/routes/index.js");
  const website = read("audits/routes/website.js");
  const digital = read("audits/routes/digitalGrowth.js");
  assert.match(index, /router\.use\("\/website", websiteRoutes\)/);
  assert.match(index, /router\.use\("\/digital-growth", digitalGrowthRoutes\)/);
  assert.match(website, /router\.post\("\/run", hookdeckDedupe\("audits:website:run"\)/);
  assert.match(website, /retentionPolicy: "final-pdf-only"/);
  assert.match(digital, /WORKFLOW_ID = "digital-growth-audit\.yml"/);
});

test("AIMS owns the sequential website audit stages and one final PDF retention contract", () => {
  const pipeline = read("audits/utils/websiteAuditPipeline.js");
  assert.match(pipeline, /auditType: "digital-growth"/);
  assert.match(pipeline, /auditType: "seo-aeo-geo"/);
  assert.match(pipeline, /auditType: "mobile-ux"/);
  assert.match(pipeline, /audits\/_tmp\/website/);
  assert.match(pipeline, /website-audit\.pdf/);
  assert.match(pipeline, /retainedArtefacts: \[finalReportUrl\]/);
  assert.match(pipeline, /strictTemporaryCleanup/);
  assert.match(pipeline, /cleanupAuditPrefix\(\{ reportPrefix: tempPrefix \}\)/);
  assert.match(pipeline, /stale child callback/);
  assert.match(pipeline, /out-of-order child callback/);
});

test("pipeline child audits suppress standalone latest pointers and legacy councils", () => {
  const orchestrator = read("audits/utils/orchestrator.js");
  const seo = read("audits/routes/seoAeoGeo.js");
  const mobile = read("audits/routes/mobileUx.js");
  assert.match(orchestrator, /const suppressLatest = body\.suppressLatest === true \|\| body\.temporaryArtifacts === true \|\| Boolean\(pipelineSessionId\)/);
  assert.match(orchestrator, /if \(!suppressLatest\) \{/);
  assert.match(seo, /if \(result\?\.job\?\.pipelineSessionId\) return null/);
  assert.match(mobile, /if \(result\?\.job\?\.pipelineSessionId\) return null/);
  assert.match(seo, /resumeWebsiteAuditPipelineFromChild/);
  assert.match(mobile, /resumeWebsiteAuditPipelineFromChild/);
});

test("final website council has 24 specialist seats and rendered Mobile UX remains hard-gated", () => {
  const council = read("audits/utils/websiteAuditCouncil.js");
  const seatMatches = council.match(/\{ seat: \d+, role:/g) || [];
  assert.equal(seatMatches.length, 24);
  assert.match(council, /Independent Red-Team Auditor/);
  assert.match(council, /Not Scored - Evidence Gate Not Met/);
  assert.match(council, /renderWebsiteAuditPdf/);
  assert.match(council, /playwright-core/);
});

test("audit publisher supports binary final PDFs and verified recursive temporary cleanup", () => {
  const publisher = read("audits/utils/publishAuditArtifacts.js");
  assert.match(publisher, /export async function publishAuditBuffer/);
  assert.match(publisher, /index \+= 1000/);
  assert.match(publisher, /Audit cleanup left \$\{remaining\.length\} object/);
  assert.match(publisher, /remaining/);
});
