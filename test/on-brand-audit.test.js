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
        exactRemediation: "Remove prefix.",
        verificationMethod: "Rerun audit.",
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
