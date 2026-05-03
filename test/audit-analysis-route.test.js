import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

function validForensicJson() {
  return {
    auditCompletionState: "Complete",
    aiAnalysisStatus: "valid",
    executiveSummary: "The static estate is stronger than the dynamic podcast and blog families.",
    overallVerdict: "The audit is release-ready once dynamic governance and podcast page depth are hardened.",
    scoreTable: {
      seo: { score: 72, grade: "C", headline: "Static metadata is strong; dynamic governance is weaker." },
      aeo: { score: 74, grade: "C", headline: "Answer-first patterns need dynamic-family work." },
      geo: { score: 68, grade: "D", headline: "Podcast and transcript retrieval are the weakest areas." },
      entityAuthority: { score: 82, grade: "B", headline: "Author and book entity signals are clear." },
      conversionSupport: { score: 78, grade: "C", headline: "Commercial paths are clear." },
    },
    topFivePriorities: ["Bring podcast episode routes into deterministic release governance."],
    quickWins: ["Add key takeaways to podcast episode pages."],
    majorRisks: ["Dynamic route drift can hide broken podcast pages."],
    estateLabels: ["partially ready", "template-constrained"],
    scopeInputsMethod: { inspected: ["repo", "coverage"] },
    inventoryReconciliationSummary: { summary: "One podcast page was analysed in the fixture." },
    findingsByAuditLens: { technicalSeo: "The fixture route is crawlable." },
    rankedIssueLedger: [
      {
        issueId: "JH-SEO-001",
        severity: "High",
        confidence: "Confirmed",
        auditLens: "SEO / Technical",
        rootCauseLevel: "system",
        affectedPagesTemplatesFilesOrRoutes: "/podcast/episodes/* and scripts/generate_podcast_episodes.py",
        evidenceObserved: "The coverage payload contains a podcast episode family requiring deterministic validation.",
        whyItMatters: "Podcast route drift weakens crawl trust and breaks internal discovery.",
        exactRemediation: "Write every generated podcast episode URL to a deterministic build inventory and fail CI when any listed canonical URL is absent from coverage.json.",
        expectedGain: "More reliable podcast route discovery and fewer broken canonical episode paths.",
        estimatedEffort: "Medium",
        recommendedOwner: "Engineering",
        verificationMethod: "Rerun the audit and confirm every podcast episode URL appears as Fully analysed in coverage.json.",
      },
    ],
    pageTypeFindings: [{ pageType: "podcast episode", count: 1, coverageState: "Fully analysed", score: 63, grade: "D", judgement: "Thin but crawlable.", keyNote: "Needs richer answer blocks." }],
    priorityPageAnnex: [{ url: "https://jonathan-harris.online/podcast/episodes/example/", pageType: "podcast episode", templateSource: "podcast generator", titleStatus: "Healthy", metaStatus: "Healthy", canonicalStatus: "Healthy", schemaStatus: "Mixed", aeoStatus: "Weak", geoStatus: "Weak", score: 63, grade: "D", confirmedIssueIds: ["JH-SEO-001"], keyNote: "Thin episode page." }],
    templateComponentGeneratorAnnex: [{ sourceFile: "scripts/generate_podcast_episodes.py", area: "Podcast generation", observedLogic: "Generates episode routes", repeatedEffect: "Dynamic route drift risk", fixPriority: "High" }],
    codeMarkupContentRemediationAppendix: [{ target: "scripts/generate_podcast_episodes.py", issueId: "JH-SEO-001", currentPattern: "Generated URLs are not asserted in coverage.", correctedPattern: "Persist and validate a generated URL inventory.", rationale: "Prevents drift." }],
    bestPracticeGapMatrix: [{ pageType: "podcast episode", seo: "Partial", aeo: "Weak", geo: "Weak", confidence: "Confirmed", topMissingElement: "Deterministic inventory", businessImpact: "High" }],
    finalVerdictAndImplementationOrder: { narrative: "Fix dynamic governance first.", steps: ["Add deterministic podcast inventory validation."], expectedGains: ["Reduced route drift."] },
    fullUrlCoverageAppendix: [{ url: "https://jonathan-harris.online/podcast/episodes/example/", pageType: "podcast episode", coverageState: "Fully analysed", status: 200, risk: "Medium" }],
    limitations: ["Fixture does not include live Search Console data."],
    verificationItems: ["Confirm coverage.json lists the podcast episode URL."],
  };
}

function validAnalysisPayload() {
  return {
    auditType: "seo-aeo-geo",
    sessionId: "route-test",
    baseUrl: "https://jonathan-harris.online",
    generatedAt: "2026-05-03T00:00:00Z",
    inventory: { discoveredRouteCount: 1 },
    priorityPages: [{ url: "https://jonathan-harris.online/podcast/episodes/example/", pageType: "podcast episode", total: 63 }],
    allRoutes: [{ url: "https://jonathan-harris.online/podcast/episodes/example/", pageType: "podcast episode", coverageState: "Fully analysed", statusCode: 200, total: 63, scores: { technicalSeo: 16, onPageIntent: 10, aeo: 8, geo: 7, entity: 7, internalLinking: 6, conversion: 0 } }],
    heuristicIssues: [],
    repoSignals: {},
    liveDynamicUrls: [],
    coverage: [],
    coverageFamilies: [{ pageType: "podcast episode", discovered: 1, analysed: 1, excluded: 0, failed: 0, coveragePercent: 100, averageScore: 63 }],
  };
}

test("/analysis returns validated forensic JSON through the shared AI route", async () => {
  const oldEnv = {
    AUDIT_CALLBACK_TOKEN: process.env.AUDIT_CALLBACK_TOKEN,
    OPENROUTER_ANTHROPIC: process.env.OPENROUTER_ANTHROPIC,
    OPENROUTER_API_KEY_ANTHROPIC: process.env.OPENROUTER_API_KEY_ANTHROPIC,
  };
  const oldFetch = globalThis.fetch;

  process.env.AUDIT_CALLBACK_TOKEN = "route-token";
  process.env.OPENROUTER_ANTHROPIC = "anthropic/test-model";
  process.env.OPENROUTER_API_KEY_ANTHROPIC = "test-key";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(validForensicJson()) } }] }),
  });

  try {
    const { default: router } = await import(`../audits/routes/seoAeoGeo.js?routeTest=${Date.now()}`);
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use("/audits/seo-aeo-geo", router);

    const response = await request(app)
      .post("/audits/seo-aeo-geo/analysis")
      .set("Authorization", "Bearer route-token")
      .send(validAnalysisPayload())
      .expect(202);

    assert.equal(response.body.ok, true);
    assert.equal(response.body.statusUrl.endsWith("/audits/seo-aeo-geo/analysis/route-test"), true);

    let statusBody;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await request(app)
        .get("/audits/seo-aeo-geo/analysis/route-test")
        .set("Authorization", "Bearer route-token");
      assert.ok([200, 202].includes(statusResponse.status), `unexpected polling status ${statusResponse.status}: ${statusResponse.text}`);
      statusBody = statusResponse.body;
      if (statusResponse.status === 200 && statusBody.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.status, "completed");
    assert.equal(statusBody.hasAnalysis, true);
    assert.equal(statusBody.analysis.auditCompletionState, "Complete");
    assert.equal(statusBody.analysis.rankedIssueLedger[0].issueId, "JH-SEO-001");
  } finally {
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = oldFetch;
  }
});
