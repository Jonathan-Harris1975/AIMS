import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  getWebsiteAuditPolicy,
  websiteAuditDefaultExclusions,
  isDelegatedWebsiteRoute,
} from "../audits/utils/websiteAuditPolicy.js";

const read = (path) => fs.readFileSync(path, "utf8");

test("website audit policy keeps blog and transcripts delegated while podcast remains in scope", () => {
  const policy = getWebsiteAuditPolicy();
  assert.deepEqual(policy.delegatedAuditFamilies.map((row) => row.prefix), ["/blog", "/transcripts"]);
  assert.ok(policy.websiteAuditIncludedRoutes.includes("/podcast"));
  assert.equal(isDelegatedWebsiteRoute("/blog/posts/example"), true);
  assert.equal(isDelegatedWebsiteRoute("/transcripts/TT-2026-07-01.html"), true);
  assert.equal(isDelegatedWebsiteRoute("/podcast"), false);
  for (const auditType of ["digital-growth", "seo-aeo-geo", "mobile-ux"]) {
    assert.deepEqual(websiteAuditDefaultExclusions(auditType), ["/blog", "/transcripts"]);
  }
});

test("website policy centralises current form, accessibility, performance and deployment contracts", () => {
  const policy = getWebsiteAuditPolicy();
  assert.equal(policy.minimumTargetScore, 8.5);
  assert.equal(policy.forms.newsletter.formId, "260277027608054");
  assert.equal(policy.forms.newsletter.timeOrCadenceClaimsAllowed, false);
  assert.equal(policy.forms.contribute.formId, "262063136008044");
  assert.equal(policy.podcast.elfsightWidgetId, "76cc65a0-0bcf-4dc0-ad36-1046c5a20e3d");
  assert.equal(policy.accessibility.targetSizeAaCssPx, 24);
  assert.equal(policy.accessibility.preferredPrimaryControlCssPx, 44);
  assert.equal(policy.performance.coreWebVitals.lcpGoodMs, 2500);
  assert.equal(policy.performance.coreWebVitals.inpGoodMs, 200);
  assert.equal(policy.performance.coreWebVitals.clsGood, 0.1);
  assert.equal(policy.searchAndAiDiscovery.llmsTxtIsOptionalSupportingInfrastructure, true);
  assert.equal(policy.searchAndAiDiscovery.faqSchemaOnlyWhenVisibleFaqExists, true);
  assert.equal(policy.deployment.releaseMarkerPath, "/release.json");
  assert.equal(policy.deployment.cloudflarePurge.passes, 3);
  assert.equal(policy.deployment.cloudflarePurge.waitSecondsBetweenPasses, 300);
  assert.equal(policy.securityPlatform.requireHttps, true);
  assert.equal(policy.securityPlatform.checkMixedContent, true);
  assert.equal(policy.securityPlatform.checkContentSecurityPolicy, true);
  assert.equal(policy.securityPlatform.checkStrictTransportSecurity, true);
  assert.equal(policy.securityPlatform.inventoryThirdPartyScripts, true);
  assert.ok(policy.scoring.technicalQualityPanel.includes("securityPlatformHygiene"));
  assert.equal(policy.evidenceGates.accessibility, "accessibilityEvidence");
  assert.equal(policy.evidenceGates.visualDesignSystemConsistency, "visualDesignEvidence");
  assert.equal(policy.evidenceGates.coreWebVitalsPerformance, "performanceEvidence");
  assert.equal(policy.evidenceGates.securityPlatformHygiene, "securityEvidence");
});

test("website audit synthesis uses the policy as a non-inflating evidence contract", () => {
  const council = read("audits/utils/websiteAuditCouncil.js");
  const digital = read("audits/utils/digitalGrowthAnalysis.js");
  const seo = read("audits/utils/seoAeoGeoAnalysis.js");
  const orchestrator = read("audits/utils/orchestrator.js");

  assert.match(orchestrator, /websiteAuditDefaultExclusions/);
  assert.doesNotMatch(orchestrator, /\["\/podcast", "\/blog"\]/);
  assert.match(council, /minimumTargetScore \(8\.5\/10\).*acceptance target, never as a score floor/);
  assert.match(council, /\/blog and \/transcripts are deliberately delegated/);
  assert.match(council, /\/podcast remains in scope/);
  assert.match(council, /LCP <= 2500 ms, INP <= 200 ms and CLS <= 0\.1/);
  assert.match(council, /llms\.txt or special AI markup as ranking requirements|llms\.txt or special AI markup/);
  assert.match(council, /FAQPage schema only when a real visible FAQ\/Q&A block exists/);
  assert.match(council, /Security\/platform hygiene must use supplied evidence rather than assumption/);
  assert.match(council, /securityPlatformHygiene/);
  assert.match(council, /Not Scored - Accessibility Evidence Not Supplied/);
  assert.match(council, /Not Scored - Visual Evidence Not Supplied/);
  assert.match(digital, /\/podcast remains in scope/);
  assert.match(seo, /dynamicFamiliesMandatory: \["podcast", "archive", "utility", "programmatic"\]/);
  assert.match(seo, /delegatedFamilies: \["\/blog", "\/transcripts"\]/);
});
