import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { __seoAeoGeoCouncilTestHooks } from "../audits/utils/seoAeoGeoCouncil.js";
import { __mobileUxCouncilTestHooks } from "../audits/utils/mobileUxCouncil.js";

test("SEO/AEO/GEO council exposes RAMS-readable source-ownership findings", () => {
  const bundle = {
    latestLoaded: true,
    latest: { reportPrefix: "audits/seo-aeo-geo/run-1" },
    loaded: {},
    errors: [],
    report: { mandatoryFamiliesIncomplete: ["podcast episode"], scores: { seo: 93, aeo: 43, geo: 96 } },
    summary: {},
    coverage: {},
    repositoryIssueAppendix: { findings: [] },
  };
  const report = __seoAeoGeoCouncilTestHooks.buildCouncilReport({
    sessionId: "test-seo-council",
    reportPrefix: "audits/seo-aeo-geo-council/test",
    bundle,
  });
  assert.equal(report.auditType, "seo-aeo-geo-council");
  assert.equal(report.pipeline, "seo-aeo-geo");
  assert.ok(report.findings.some((finding) => finding.sourceOwner === "aims_r2_podcast"));
  assert.equal(report.ramsPolicy.shouldTriggerRams, false);
});

test("Mobile UX council converts deterministic rendered defects into website code-fix candidates", () => {
  const bundle = {
    latestLoaded: true,
    latest: { reportPrefix: "audits/mobile-ux/run-1", mobileQualityScore: 75.4, releaseVerdict: "BLOCKED" },
    loaded: {},
    errors: [],
    report: {},
    summary: {},
    coverage: {},
    repositoryIssueAppendix: {
      findings: [{
        issueId: "MUX-001",
        title: "hamburgerNavigation failed",
        check: "hamburgerNavigation",
        severity: "critical",
        affectedPaths: ["assets/partials/header.html"],
        allowedFixClass: "accessibility_fix",
        evidence: ["selectorComponentCodeAnchor: .jh-hamburger"],
        requiredOutcome: "Verify mobile drawer opens, closes, handles Escape and resets on desktop breakpoint.",
      }],
    },
    responsiveFixAppendix: {},
    mandatoryMobileScorecard: {},
  };
  const report = __mobileUxCouncilTestHooks.buildCouncilReport({
    sessionId: "test-mobile-council",
    reportPrefix: "audits/mobile-ux-council/test",
    bundle,
  });
  assert.equal(report.auditType, "mobile-ux-council");
  assert.ok(report.findings.some((finding) => finding.classification === "code_fix"));
  assert.ok(report.findings.some((finding) => finding.affectedPaths.includes("assets/partials/header.html")));
});

test("audit routes mount the website council endpoints and callbacks run councils by default", () => {
  const routeIndex = fs.readFileSync("audits/routes/index.js", "utf8");
  const seoRoute = fs.readFileSync("audits/routes/seoAeoGeo.js", "utf8");
  const mobileRoute = fs.readFileSync("audits/routes/mobileUx.js", "utf8");
  assert.match(routeIndex, /seo-aeo-geo-council/);
  assert.match(routeIndex, /mobile-ux-council/);
  assert.match(seoRoute, /SEO_AEO_GEO_COUNCIL_RUN_AFTER_AUDIT/);
  assert.match(mobileRoute, /MOBILE_UX_COUNCIL_RUN_AFTER_AUDIT/);
});
