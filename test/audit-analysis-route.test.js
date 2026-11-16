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
    deterministicRemediationLedger: { findings: [] },
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
    priorityPageAnnex: [{ url: "https://jonathan-harris.online/podcast/episodes/example/", pageType: "podcast episode", templateSource: "podcast generator", titleStatus:
       "Healthy", metaStatus: "Healthy", canonicalStatus: "Healthy", schemaStatus: "Mixed", aeoStatus: "Weak", geoStatus: "Weak", score: 63, grade: "D", confirmedIssueIds: [
         "JH-SEO-001"], keyNote: "Thin episode page." }],
    templateComponentGeneratorAnnex: [{ sourceFile: "scripts/generate_podcast_episodes.py", area: "Podcast generation", observedLogic: "Generates episode routes",
       repeatedEffect: "Dynamic route drift risk", fixPriority: "High" }],
    codeMarkupContentRemediationAppendix: [{ target: "scripts/generate_podcast_episodes.py", issueId: "JH-SEO-001", currentPattern:
       "Generated URLs are not asserted in coverage.", correctedPattern: "Persist and validate a generated URL inventory.", rationale: "Prevents drift." }],
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
    allRoutes: [{ url: "https://jonathan-harris.online/podcast/episodes/example/", pageType: "podcast episode", coverageState: "Fully analysed", statusCode: 200, total: 63,
       scores: { technicalSeo: 16, onPageIntent: 10, aeo: 8, geo: 7, entity: 7, internalLinking: 6, conversion: 0 } }],
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
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_ANTHROPIC: process.env.OPENROUTER_ANTHROPIC,
    OPENROUTER_API_KEY_ANTHROPIC: process.env.OPENROUTER_API_KEY_ANTHROPIC,
  };
  const oldFetch = globalThis.fetch;

  process.env.AUDIT_CALLBACK_TOKEN = "route-token";
  process.env.OPENROUTER_API_KEY = ["synthetic", "shared", "audit", "test"].join("-");
  process.env.OPENROUTER_ANTHROPIC = "anthropic/test-model";
  process.env.OPENROUTER_API_KEY_ANTHROPIC = "test-key";
  const paidCalls = [];
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    const free = body.model.endsWith(":free");
    if (!free) paidCalls.push(body);
    return { ok: true, json: async () => ({ choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify(free ? {summary:"Fixture evidence reviewed",findings:[],limitations:[]} : validForensicJson())
    } }] }) };
  };

  try {
    const { default: router } = await import(`../audits/routes/seoAeoGeo.js?routeTest=${Date.now()}`);
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use("/audits/seo-aeo-geo", router);

    const sessionId = `route-test-${Date.now()}`;
    const response = await request(app)
      .post("/audits/seo-aeo-geo/analysis")
      .set("Authorization", "Bearer route-token")
      .send({ ...validAnalysisPayload(), sessionId })
      .expect(202);

    assert.equal(response.body.ok, true);
    assert.equal(response.body.statusUrl.endsWith(`/audits/seo-aeo-geo/analysis/${sessionId}`), true);

    let statusBody;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await request(app)
        .get(`/audits/seo-aeo-geo/analysis/${sessionId}`)
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
    assert.equal(statusBody.analysis.aiAnalysisStatus, "valid");
    assert.equal(paidCalls.length, 6);
    assert.ok(paidCalls.every(body => body.reasoning?.effort === "none" && body.reasoning?.exclude === true));
    assert.match(paidCalls[0].messages[0].content, /SECTION OUTPUT CONTRACT/);
    const {getPublicJob}=await import('../services/shared/utils/jobStore.js');
    const saved=getPublicJob('audit:seo-aeo-geo:analysis',sessionId).analysisCheckpoint;
    assert.equal(saved.sections.rankedIssueLedger[0].issueId,'JH-SEO-001');
    assert.ok(saved.reviews.length);
    assert.match(saved.evidenceDigest,/^[a-f0-9]{64}$/);
  } finally {
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = oldFetch;
  }
});

test("/analysis completes with deterministic fallback after malformed forensic JSON", async () => {
  const oldEnv = {
    AUDIT_CALLBACK_TOKEN: process.env.AUDIT_CALLBACK_TOKEN,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_ANTHROPIC: process.env.OPENROUTER_ANTHROPIC,
    OPENROUTER_API_KEY_ANTHROPIC: process.env.OPENROUTER_API_KEY_ANTHROPIC,
  };
  const oldFetch = globalThis.fetch;

  process.env.AUDIT_CALLBACK_TOKEN = "route-token";
  process.env.OPENROUTER_API_KEY = ["synthetic", "shared", "audit", "test"].join("-");
  process.env.OPENROUTER_ANTHROPIC = "anthropic/test-model";
  process.env.OPENROUTER_API_KEY_ANTHROPIC = "test-key";
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: '{"auditCompletionState":"Complete","rankedIssueLedger":[{"issueId":"broken"' } }] }),
  });

  try {
    const { default: router } = await import(`../audits/routes/seoAeoGeo.js?routeMalformedTest=${Date.now()}`);
    const app = express();
    app.use(express.json({ limit: "5mb" }));
    app.use("/audits/seo-aeo-geo", router);

    const payload = { ...validAnalysisPayload(), sessionId: `route-malformed-test-${Date.now()}` };
    const response = await request(app)
      .post("/audits/seo-aeo-geo/analysis")
      .set("Authorization", "Bearer route-token")
      .send(payload)
      .expect(202);

    assert.equal(response.body.ok, true);

    let statusBody;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const statusResponse = await request(app)
        .get(`/audits/seo-aeo-geo/analysis/${payload.sessionId}`)
        .set("Authorization", "Bearer route-token");
      assert.ok([200, 202].includes(statusResponse.status), `unexpected polling status ${statusResponse.status}: ${statusResponse.text}`);
      statusBody = statusResponse.body;
      if (statusResponse.status === 200 && statusBody.status === "completed") break;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }

    assert.equal(statusBody.ok, true);
    assert.equal(statusBody.status, "completed");
    assert.equal(statusBody.analysis.aiAnalysisStatus, "valid-deterministic-fallback");
    assert.notEqual(statusBody.analysis.rankedIssueLedger.length, 0);
  } finally {
    for (const [name, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    globalThis.fetch = oldFetch;
  }
});

test('failed SEO analysis resumes saved sections without repeating free reviews or accepted paid work', async () => {
  const oldFetch=globalThis.fetch;
  const oldEnv={...process.env};
  process.env.AUDIT_CALLBACK_TOKEN='test-checkpoint-token';
  process.env.OPENROUTER_API_KEY=['synthetic','checkpoint','test'].join('-');
  let paid=0;let free=0;
  globalThis.fetch=async(_url,options)=>{
    const body=JSON.parse(options.body);
    if(body.model.endsWith(':free'))free++;else paid++;
    return {ok:true,json:async()=>({choices:[{finish_reason:!body.model.endsWith(':free')&&paid===3?'length':'stop',message:{
      content:JSON.stringify(body.model.endsWith(':free')?{summary:'Evidence reviewed',findings:[],limitations:[]}:validForensicJson())}}]})};
  };
  try {
    const {default:router}=await import('../audits/routes/seoAeoGeo.js');
    const app=express();app.use(express.json({limit:'5mb'}));app.use('/audits/seo-aeo-geo',router);
    const sessionId=`checkpoint-test-${Date.now()}`;
    const payload={...validAnalysisPayload(),sessionId};
    const post=()=>request(app).post('/audits/seo-aeo-geo/analysis').set('Authorization','Bearer test-checkpoint-token').send(payload);
    const poll=async()=>{
      for(let i=0;i<50;i++){
        const res=await request(app).get(`/audits/seo-aeo-geo/analysis/${sessionId}`).set('Authorization','Bearer test-checkpoint-token');
        if(['failed','completed'].includes(res.body.status))return res.body;
        await new Promise(resolve=>setTimeout(resolve,20));
      }
      throw new Error('Analysis did not reach a terminal state');
    };
    await post().expect(202);
    assert.equal((await poll()).status,'failed');
    const reviews=free;
    assert.equal(paid,3);
    await post().expect(202);
    assert.equal((await poll()).status,'completed');
    assert.equal(free,reviews);
    assert.equal(paid,7);
  } finally {
    globalThis.fetch=oldFetch;
    for(const key of Object.keys(process.env))if(!(key in oldEnv))delete process.env[key];
    Object.assign(process.env,oldEnv);
  }
});
