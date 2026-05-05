import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";

const ORIGINAL_ENV = { ...process.env };

function restoreEnv() {
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    process.env[key] = value;
  }
}

test.afterEach(() => restoreEnv());

test("R2 shared client resolves the audits bucket alias and public URL", async () => {
  process.env.R2_BUCKET_AUDITS = "audits";
  process.env.R2_PUBLIC_BASE_URL_AUDITS = "https://audits.example.test";
  process.env.R2_ACCESS_KEY_ID = "test";
  process.env.R2_SECRET_ACCESS_KEY = "test";
  process.env.R2_ENDPOINT = "https://r2.example.test";

  const mod = await import(`../services/shared/utils/r2-client.js?r2-audits=${Date.now()}`);
  assert.equal(mod.ensureBucketKey("audits"), "audits");
  assert.equal(mod.buildPublicUrl("audits", "audits/on-brand/latest.json"), "https://audits.example.test/audits/on-brand/latest.json");
});

test("audit publisher is configured for the audits bucket, not brand-assets", async () => {
  const mod = await import(`../audits/utils/publishAuditArtifacts.js?publish-config=${Date.now()}`);
  assert.equal(mod.getAuditPublishConfig().bucketAlias, "audits");
  assert.equal(mod.getAuditPublishConfig().bucketEnv, "R2_BUCKET_AUDITS");
  assert.equal(mod.getAuditPublishConfig().publicBaseEnv, "R2_PUBLIC_BASE_URL_AUDITS");
});

test("on-brand deterministic preflight catches key brand defects", async () => {
  const { __testing } = await import(`../audits/utils/onBrandEvidence.js?preflight=${Date.now()}`);
  const longSentence = Array.from({ length: 42 }, (_, index) => `word${index}`).join(" ") + ".";
  const findings = __testing.runDeterministicPreflight({
    oneUpBlogSocial: {
      items: [
        {
          title: "Title: AI changes everything",
          content: "In a significant development, teams can optimize the rapidly evolving landscape. Note: draft copy.",
          firstComment: "",
        },
      ],
    },
    rss: {
      items: [
        {
          title: "Why AI governance needs adults",
          summary: "This groundbreaking update includes <b>HTML</b> and Read on Jonathan-Harris RSS Feed.",
          validationFindings: [],
        },
      ],
    },
    podcastTranscripts: {
      items: [
        {
          title: "Transcript",
          textExcerpt: longSentence,
        },
      ],
    },
  });

  const types = findings.map((item) => item.issueType);
  assert.ok(types.includes("banned title prefix"));
  assert.ok(types.includes("formulaic headline start"));
  assert.ok(types.includes("metadata leak"));
  assert.ok(types.includes("overlong podcast sentence"));
  assert.ok(types.includes("RSS wrapper CTA leakage"));
});

test("on-brand report normalisation preserves contract and merges deterministic defects", async () => {
  const { __testing } = await import(`../audits/utils/onBrandAudit.js?normalise=${Date.now()}`);
  const evidence = {
    metadata: {
      sessionId: "brand-test",
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-05-05T00:00:00.000Z",
      lookbackDays: 4,
      blockedSources: [],
      partialSources: [{ sourceType: "oneup_blog_social", limitations: ["scheduled only"] }],
    },
    oneUpBlogSocial: { sourceType: "oneup_blog_social", status: "partial", items: [{}], evidenceMethod: "scheduled posts", limitations: ["scheduled only"] },
    podcastTranscripts: { sourceType: "podcast_transcript", status: "blocked", items: [], evidenceMethod: "R2", limitations: ["missing bucket"] },
    rss: { sourceType: "rss_feed", status: "complete", items: [{ title: "Clean title" }], evidenceMethod: "feed.json", limitations: [] },
    deterministicPreflight: [
      {
        issueId: "OB-001",
        severity: "high",
        confidence: "confirmed",
        sourceType: "rss_feed",
        itemTitleOrId: "Title: Bad",
        issueType: "banned title prefix",
        exactEvidence: "Title: Bad",
        whyItIsOffBrand: "Prefix.",
        violatedRule: "No prefixes.",
        rootCauseLevel: "content",
        exactRemediation: "For future RSS output, remove prefix.",
        verificationMethod: "Generate fresh output and rerun audit.",
      },
    ],
  };

  const report = __testing.normaliseOnBrandReport({ scorecard: { overallBrandFit: 88 } }, evidence);
  assert.equal(report.auditCompletionState, "Partial");
  assert.equal(report.sessionId, "brand-test");
  assert.equal(report.scorecard.overallBrandFit, 88);
  assert.equal(report.confirmedDefectsLedger.length, 1);
  assert.equal(report.sourceCoverage.length, 3);
});

test("/audits/on-brand/health returns ok and audit routes mount cleanly", async () => {
  const { default: router } = await import(`../audits/routes/index.js?onbrand-route=${Date.now()}`);
  const app = express();
  app.use(express.json());
  app.use("/audits", router);

  const response = await request(app).get("/audits/on-brand/health").expect(200);
  assert.equal(response.body.ok, true);
  assert.equal(response.body.auditType, "on-brand");
});

test("OneUp client fetches historic published posts with pagination and date filtering", async () => {
  process.env.ONEUP_API_KEY = "test-key";
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url) => {
    const parsed = new URL(String(url));
    calls.push({ pathname: parsed.pathname, start: parsed.searchParams.get("start"), apiKey: parsed.searchParams.get("apiKey") });
    const start = Number(parsed.searchParams.get("start") || 0);
    const rows = start === 0
      ? Array.from({ length: 50 }, (_, index) => ({ content: `Post ${index}`, created_at: "2026-05-04 10:00:00", post_id: `A${index}` }))
      : [
          { content: "Older post", created_at: "2026-04-01 10:00:00", post_id: "OLD" },
          { content: "Recent post", created_at: "2026-05-03 10:00:00", post_id: "NEW" },
        ];
    return new Response(JSON.stringify({ message: "OK", error: false, data: rows }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const { fetchPublishedPostsHistory } = await import(`../services/oneup/utils/oneupClient.js?published-history=${Date.now()}`);
    const result = await fetchPublishedPostsHistory({
      maxPages: 2,
      windowStart: new Date("2026-05-01T00:00:00.000Z"),
      windowEnd: new Date("2026-05-05T00:00:00.000Z"),
    });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].pathname, "/api/getpublishedposts");
    assert.equal(calls[0].start, "0");
    assert.equal(calls[1].start, "50");
    assert.equal(calls[0].apiKey, "test-key");
    assert.equal(result.rawCount, 52);
    assert.equal(result.filteredCount, 51);
    assert.equal(result.data.some((row) => row.post_id === "OLD"), false);
    assert.equal(result.data.some((row) => row.post_id === "NEW"), true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("transcript discovery ranks latest html or txt object per session", async () => {
  const { __testing } = await import(`../audits/utils/onBrandEvidence.js?transcript-rank=${Date.now()}`);
  const ranked = __testing.normaliseTranscriptObjects([
    { key: "episode-a.txt", lastModified: "2026-05-01T09:00:00.000Z", size: 100 },
    { key: "episode-a.html", lastModified: "2026-05-01T10:00:00.000Z", size: 200 },
    { key: "episode-b.txt", lastModified: "2026-05-02T08:00:00.000Z", size: 100 },
    { key: "notes/readme.md", lastModified: "2026-05-05T08:00:00.000Z", size: 10 },
  ]);

  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].key, "episode-b.txt");
  assert.equal(ranked[1].key, "episode-a.html");
  assert.equal(ranked[1].extension, "html");
});

test("transcript HTML extraction keeps audit evidence out of navigation chrome", async () => {
  const { __testing } = await import(`../audits/utils/onBrandEvidence.js?html-extract=${Date.now()}`);
  const html = `<!doctype html><html><body>
    <header>Jonathan Harris Home eBooks Podcast Newsletter Topics About Resources Blog Glossary Topics Comparisons Contact Browse Books</header>
    <main><section class="transcript-text">
      <h2 class="transcript-heading">Full Episode Transcript</h2>
      <p class="transcript-para">First real spoken paragraph. It contains the actual podcast copy.</p>
      <p class="transcript-para">Second real spoken paragraph with no site navigation.</p>
    </section></main>
    <footer>Browse transcript archive</footer>
  </body></html>`;

  const text = __testing.extractTranscriptText(html, { isHtml: true });
  assert.match(text, /First real spoken paragraph/);
  assert.match(text, /Second real spoken paragraph/);
  assert.doesNotMatch(text, /Jonathan Harris Home eBooks/);
  assert.doesNotMatch(text, /Full Episode Transcript/);
});

test("dry-run report normalisation derives useful source sections and remediation", async () => {
  const { __testing } = await import(`../audits/utils/onBrandAudit.js?derive-report=${Date.now()}`);
  const evidence = {
    metadata: {
      sessionId: "dry-report-test",
      windowStart: "2026-05-01T00:00:00.000Z",
      windowEnd: "2026-05-05T00:00:00.000Z",
      lookbackDays: 4,
      blockedSources: [],
      partialSources: [],
    },
    oneUpBlogSocial: {
      sourceType: "oneup_blog_social",
      status: "complete",
      items: [{ title: "Published post" }],
      evidenceMethod: "OneUp getpublishedposts paginated historic scan",
      limitations: [],
    },
    podcastTranscripts: {
      sourceType: "podcast_transcript",
      status: "complete",
      items: [{ title: "Transcript" }],
      evidenceMethod: "R2 transcript bucket object scan, transcript-body extraction for HTML",
      limitations: [],
    },
    rss: {
      sourceType: "rss_feed",
      status: "complete",
      items: [{ title: "RSS item" }],
      evidenceMethod: "R2 rss/feed.json",
      limitations: [],
    },
    deterministicPreflight: [
      {
        issueId: "OB-001",
        severity: "high",
        confidence: "confirmed",
        sourceType: "rss_feed",
        itemTitleOrId: "RSS item",
        issueType: "existing RSS validator finding",
        exactEvidence: "Summary contains banned filler",
        whyItIsOffBrand: "The validator caught filler.",
        violatedRule: "RSS prompt and feedGenerator publication rules.",
        rootCauseLevel: "validator",
        exactRemediation: "For future RSS output, tighten the RSS rewrite retry path.",
        verificationMethod: "Generate fresh output and rerun audit.",
      },
    ],
  };

  const report = __testing.normaliseOnBrandReport({}, evidence, { rawModelError: "dryRun=true" });
  assert.equal(report.oneUpBlogSocialFindings.postPatternAnalysis.includes("getpublishedposts"), true);
  assert.equal(report.rssFindings.defects.length, 1);
  assert.ok(report.confirmedStrengths.length >= 3);
  assert.ok(report.rankedRemediationPlan.length >= 1);
  assert.match(report.executiveVerdict.bluntAssessment, /future/i);
  assert.match(report.rankedRemediationPlan[0].whyThisComesFirst, /future generated output|future-output/i);
});


test("on-brand report HTML frames findings as future QA guardrails", async () => {
  const { renderOnBrandReportHtml } = await import(`../audits/utils/onBrandReportHtml.js?future-html=${Date.now()}`);
  const html = renderOnBrandReportHtml({
    sessionId: "future-report",
    generatedAt: "2026-05-05T00:00:00.000Z",
    window: { start: "2026-05-01T00:00:00.000Z", end: "2026-05-05T00:00:00.000Z" },
    executiveVerdict: { status: "Mostly on-brand", summary: "QA calibration", bluntAssessment: "Use evidence for future output." },
    scorecard: {},
    sourceCoverage: [],
    confirmedDefectsLedger: [
      {
        issueId: "OB-001",
        severity: "medium",
        sourceType: "rss_feed",
        confidence: "confirmed",
        issueType: "future wording risk",
        itemTitleOrId: "RSS item",
        exactEvidence: "the future of",
        whyItIsOffBrand: "Filler",
        violatedRule: "No filler",
        exactRemediation: "For future RSS output, cut the filler.",
        verificationMethod: "Generate fresh RSS output and rerun the audit.",
      },
    ],
  });

  assert.match(html, /How to use this QA report/);
  assert.match(html, /future social posts, podcast transcript layouts, spoken-copy passes, and RSS feed wording/);
  assert.match(html, /Future QA findings ledger/);
  assert.match(html, /Future guardrail/);
  assert.match(html, /Ranked future QA refinement plan/);
});
