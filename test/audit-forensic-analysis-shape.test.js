import test from "node:test";
import assert from "node:assert/strict";
import { __seoAeoGeoAnalysisTestHooks } from "../audits/utils/seoAeoGeoAnalysis.js";

const payload = {
  baseUrl: "https://jonathan-harris.online",
  sessionId: "test-session",
  generatedAt: "2026-05-03T00:00:00.000Z",
  priorityPages: [
    {
      url: "https://jonathan-harris.online/blog/",
      pageType: "blog archive",
      total: 69,
      grade: "D",
      title: "Blog",
      metaDescription: "Weekly AI briefing archive",
      canonical: "https://jonathan-harris.online/blog/",
      h1: "Blog",
      schemaCount: 1,
      scores: { aeo: 12, geo: 11, entity: 7, internalLinking: 7, conversion: 0 },
      coverageState: "Fully analysed",
    },
  ],
  allRoutes: [
    {
      url: "https://jonathan-harris.online/blog/",
      pageType: "blog archive",
      statusCode: 200,
      coverageState: "Fully analysed",
      total: 69,
      grade: "D",
      scores: { technicalSeo: 15, onPageIntent: 11, aeo: 12, geo: 11, entity: 7, internalLinking: 7, conversion: 0 },
    },
  ],
  coverageFamilies: [
    { pageType: "blog archive", discovered: 1, analysed: 1, excluded: 0, failed: 0, coveragePercent: 100, averageScore: 69 },
  ],
};

function validAnalysis(overrides = {}) {
  return {
    auditCompletionState: "Complete",
    aiAnalysisStatus: "valid",
    executiveSummary: "The dynamic estate is weaker than the static estate because blog governance relies on feed-derived output.",
    overallVerdict: "The estate is release-reviewable, but the dynamic blog family needs deterministic governance before it can be treated as fully hardened.",
    scoreTable: {
      seo: { score: 72, grade: "C", headline: "Static hygiene is stronger than dynamic governance." },
      aeo: { score: 74, grade: "C", headline: "Answer-first patterns are uneven." },
      geo: { score: 68, grade: "D", headline: "Generative retrieval is weakest in dynamic families." },
      entityAuthority: { score: 82, grade: "B", headline: "Entity signals are clear." },
      conversionSupport: { score: 78, grade: "C", headline: "Commercial paths are clear." },
    },
    topFivePriorities: ["Govern blog manifest output as a release gate."],
    quickWins: ["Add crawlable archive metadata to /blog/ before release."],
    majorRisks: ["Dynamic route drift can hide stale or missing pages."],
    estateLabels: ["partially ready", "template-constrained"],
    scopeInputsMethod: { inspected: ["repo", "coverage ledger"] },
    inventoryReconciliationSummary: { summary: "One blog archive URL was analysed." },
    findingsByAuditLens: { technicalSeo: "The /blog/ route is available but depends on dynamic feed inventory." },
    rankedIssueLedger: [
      {
        issueId: "JH-SEO-001",
        severity: "High",
        confidence: "Confirmed",
        auditLens: "SEO / Technical",
        rootCauseLevel: "system",
        affectedPagesTemplatesFilesOrRoutes: "/blog/ and scripts/generate-blog-from-rss.mjs",
        evidenceObserved: "The supplied coverage family contains /blog/ as a dynamic archive route.",
        whyItMatters: "Dynamic archive drift reduces crawl confidence and release predictability.",
        exactRemediation: "Persist the feed-derived blog URL inventory during build and fail CI when /blog/ archive URLs are absent from coverage.json.",
        expectedGain: "More reliable crawlable archive output and fewer repo-live mismatches.",
        estimatedEffort: "Medium",
        recommendedOwner: "Engineering",
        verificationMethod: "Rerun the audit and confirm /blog/ remains Fully analysed in coverage.json with a generated feed inventory entry.",
      },
    ],
    pageTypeFindings: [{ pageType: "blog archive", count: 1, coverageState: "Fully analysed", score: 69, grade: "D", judgement: "Needs governance hardening.", keyNote: "Dynamic output is the risk." }],
    priorityPageAnnex: [{ url: "https://jonathan-harris.online/blog/", pageType: "blog archive", templateSource: "blog/index.html", titleStatus: "Healthy", metaStatus: "Healthy", canonicalStatus: "Healthy", schemaStatus: "Healthy", aeoStatus: "Mixed", geoStatus: "Weak", score: 69, grade: "D", confirmedIssueIds: ["JH-SEO-001"], keyNote: "Governance issue." }],
    templateComponentGeneratorAnnex: [{ sourceFile: "scripts/generate-blog-from-rss.mjs", area: "Blog generation", observedLogic: "Feed-derived archive output", repeatedEffect: "Potential repo-live drift", fixPriority: "High" }],
    codeMarkupContentRemediationAppendix: [{ target: "scripts/generate-blog-from-rss.mjs", issueId: "JH-SEO-001", currentPattern: "Feed output is not treated as a release inventory.", correctedPattern: "Write deterministic blog inventory JSON and compare it to coverage.json during CI.", rationale: "Prevents hidden dynamic drift." }],
    bestPracticeGapMatrix: [{ pageType: "blog archive", seo: "Partial", aeo: "Partial", geo: "Weak", confidence: "Confirmed", topMissingElement: "Deterministic dynamic inventory", businessImpact: "High" }],
    finalVerdictAndImplementationOrder: { narrative: "Fix dynamic governance before polishing copy.", steps: ["Add deterministic blog inventory validation."], expectedGains: ["Reduced drift."] },
    fullUrlCoverageAppendix: [{ url: "https://jonathan-harris.online/blog/", pageType: "blog archive", coverageState: "Fully analysed", status: 200, risk: "Medium" }],
    limitations: ["No Search Console export was supplied."],
    verificationItems: ["Check coverage.json after rerun."],
    ...overrides,
  };
}

test("valid forensic JSON is normalised with compatibility aliases", () => {
  const normalised = __seoAeoGeoAnalysisTestHooks.validateAndNormaliseAnalysisShape(validAnalysis(), payload);
  assert.equal(normalised.auditCompletionState, "Complete");
  assert.equal(normalised.scoreTable.seo.score, 72);
  assert.equal(normalised.executiveSummary.scores.seo.score, 72);
  assert.equal(normalised.issues[0].affected, "/blog/ and scripts/generate-blog-from-rss.mjs");
  assert.equal(normalised.templateAnnex[0].sourceFile, "scripts/generate-blog-from-rss.mjs");
});

test("generic issue remediation is rejected", () => {
  const bad = validAnalysis({
    rankedIssueLedger: [
      {
        ...validAnalysis().rankedIssueLedger[0],
        exactRemediation: "Improve metadata.",
      },
    ],
  });
  assert.throws(() => __seoAeoGeoAnalysisTestHooks.validateAndNormaliseAnalysisShape(bad, payload), /too generic/);
});

test("extractJson returns the first complete JSON object from fenced or trailing output", () => {
  assert.deepEqual(
    __seoAeoGeoAnalysisTestHooks.extractJson('```json\n{"ok":true,"items":[1,2,],}\n``` trailing commentary'),
    { ok: true, items: [1, 2] }
  );
  assert.deepEqual(
    __seoAeoGeoAnalysisTestHooks.extractJson('prefix {"outer":{"value":"brace } inside string"}} suffix'),
    { outer: { value: "brace } inside string" } }
  );
});

test("deterministic fallback produces a valid forensic payload when model JSON cannot be repaired", () => {
  const fallback = __seoAeoGeoAnalysisTestHooks.buildDeterministicFallback(
    payload,
    new SyntaxError("Unexpected end of JSON input"),
    new SyntaxError("Expected ',' or '}' after property value in JSON")
  );
  assert.equal(fallback.auditCompletionState, "Complete");
  assert.equal(fallback.aiAnalysisStatus, "valid-deterministic-fallback");
  assert.ok(fallback.rankedIssueLedger.length >= 1);
  assert.ok(fallback.fullUrlCoverageAppendix.length >= 1);
});

test("deterministic forensic fallback fixes transcript evidence wording and adds page-specific gap labels", () => {
  const transcriptPayload = {
    ...payload,
    allRoutes: [
      ...payload.allRoutes,
      { url: "https://jonathan-harris.online/transcripts/TT-2026-05-01.html", pageType: "podcast transcript", coverageState: "Fully analysed", statusCode: 200, total: 68, scores: { technicalSeo: 16, onPageIntent: 10, aeo: 5, geo: 16, entity: 7, internalLinking: 6, conversion: 0 } },
    ],
    coverageFamilies: [
      ...payload.coverageFamilies,
      { pageType: "podcast transcript", discovered: 1, analysed: 1, excluded: 0, failed: 0, coveragePercent: 100, averageScore: 68 },
    ],
    familyDiagnostics: [
      {
        pageType: "podcast transcript",
        analysedUrls: 21,
        totalUrls: 21,
        averageScore: 68,
        observedTemplateEvidence: ["0 transcript pages behave as long transcript-first pages without enough above-the-fold summary or sectioning evidence."],
        sampleUrls: [{ url: "https://jonathan-harris.online/transcripts/TT-2026-05-01.html" }],
      },
    ],
  };

  const fallback = __seoAeoGeoAnalysisTestHooks.buildDeterministicFallback(
    transcriptPayload,
    new SyntaxError("bad json"),
    new SyntaxError("still bad")
  );

  const transcriptIssue = fallback.rankedIssueLedger.find((issue) => issue.issueId === "JH-AEO-002");
  assert.ok(transcriptIssue);
  assert.match(transcriptIssue.evidenceObserved, /21\/21 transcript page\(s\) lack verified above-the-fold summary/);
  assert.doesNotMatch(transcriptIssue.evidenceObserved, /^0 transcript pages behave/);

  const gap = fallback.bestPracticeGapMatrix.find((row) => row.pageType === "podcast transcript");
  assert.equal(gap.topMissingElement, "Missing summary, entity index, timestamp/section anchors before transcript body");
});

test("weak executive fallback text is replaced with a forensic estate narrative", () => {
  const normalised = __seoAeoGeoAnalysisTestHooks.validateAndNormaliseAnalysisShape(
    validAnalysis({
      executiveSummary: "Implementation order derived from the ranked issue ledger.",
      overallVerdict: "Implementation order derived from the ranked issue ledger.",
      finalVerdictAndImplementationOrder: {
        narrative: "Implementation order derived from the ranked issue ledger.",
        steps: ["Fix dynamic governance."],
        expectedGains: ["Reduced drift."],
      },
    }),
    payload
  );

  assert.doesNotMatch(normalised.executiveSummary.summary, /Implementation order derived/);
  assert.match(normalised.executiveSummary.summary, /static estate|dynamic editorial estate|source-of-truth drift/i);
  assert.doesNotMatch(normalised.overallVerdict, /Implementation order derived/);
});

test("echoed audit evidence request is rejected instead of being treated as analysis", () => {
  const echoedRequest = {
    ...payload,
    workflowRequirements: {
      requiredTopLevelKeys: ["auditCompletionState", "rankedIssueLedger"],
    },
  };

  assert.equal(__seoAeoGeoAnalysisTestHooks.looksLikeAuditEvidenceRequestPayload(echoedRequest), true);
  assert.throws(
    () => __seoAeoGeoAnalysisTestHooks.validateAndNormaliseAnalysisShape(echoedRequest, payload),
    /repeated the audit evidence request/
  );

  const fallback = __seoAeoGeoAnalysisTestHooks.buildDeterministicFallback(
    payload,
    new Error("AI forensic provider repeated the audit evidence request instead of returning forensic analysis JSON"),
    new Error("repair response also repeated the request")
  );
  assert.equal(fallback.auditCompletionState, "Complete");
  assert.equal(fallback.aiAnalysisStatus, "valid-deterministic-fallback");
  assert.notEqual(fallback.rankedIssueLedger.length, 0);
});

test("raw prompt/request echoes are detected before JSON repair is attempted", () => {
  const echoedText = [
    "FORENSIC SEO + AEO + GEO AUDIT - FULL ESTATE EVIDENCE PACKAGE",
    "Use the evidence payload only. Do not invent evidence.",
    JSON.stringify({ allRoutes: payload.allRoutes, repoSignals: {}, workflowRequirements: { rejectSilentSampling: true } }),
  ].join("\n");

  assert.equal(__seoAeoGeoAnalysisTestHooks.looksLikeAuditPromptEchoText(echoedText), true);
  assert.throws(
    () => __seoAeoGeoAnalysisTestHooks.rejectRawPromptEcho(echoedText),
    /repeated the prompt\/request text/
  );
});
