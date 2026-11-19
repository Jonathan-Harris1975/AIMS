import test from "node:test";
import assert from "node:assert/strict";
import { getWebsiteAuditPolicy } from "../audits/utils/websiteAuditPolicy.js";
import {
  extractIssue170Checklist,
  buildWebsiteIssue170Coverage,
  issue170CoverageLedger,
} from "../audits/utils/websiteIssue170Coverage.js";

const site = "https://jonathan-harris.online";
const issueApi = "https://api.github.com/repos/Jonathan-Harris1975/jonathan-harris-website/issues/170";
const acceptance = getWebsiteAuditPolicy().issue170Acceptance;

function mockFetch({
  issueAvailable = true, extraIssueLine = "",
  sitemapMissing = false, headersValid = true,
  manifest = [{ slug: "2026-w46-weekly-publish", published_at: "2026-11-16T09:00:00Z" }],
} = {}) {
  const checklist = acceptance.rules.filter((r) => r.issueAnchor)
    .map((r) => "- [ ] " + r.issueAnchor + " and supporting requirements.");
  if (extraIssueLine) checklist.push("- [ ] " + extraIssueLine);
  const xmlUrls = [
    site + "/",
    ...manifest.filter((_, index) => !sitemapMissing || index > 0)
      .map((row) => site + "/blog/posts/" + row.slug + "/"),
  ];
  const xml = '<?xml version="1.0"?><urlset>' + xmlUrls.map((url) => "<url><loc>" + url + "</loc></url>").join("") + "</urlset>";
  return async (url) => {
    if (url === issueApi) {
      if (!issueAvailable) return new Response("not found", { status: 503 });
      return Response.json({
        number: 170, state: "open", updated_at: "2026-11-19T01:00:00Z",
        body: checklist.join("\n"),
      });
    }
    if (url === site + "/blog/posts.json") {
      return new Response(JSON.stringify({ items: manifest }), {
        status: 200, headers: { "x-blog-manifest-source": headersValid ? "r2" : "static" },
      });
    }
    if (url === site + "/sitemap.xml") {
      return new Response(xml, {
        status: 200,
        headers: {
          "x-blog-sitemap-source": headersValid ? "r2" : "static",
          "x-blog-posts-in-sitemap": String(manifest.length),
        },
      });
    }
    throw Error("Unexpected fetch: " + url);
  };
}

test("issue 170 acceptance policy enumerates the ten original checkboxes plus the seasonal and weekly sitemap contracts", () => {
  assert.equal(acceptance.issueNumber, 170);
  assert.equal(acceptance.rules.length, 12);
  assert.equal(new Set(acceptance.rules.map((row) => row.id)).size, 12);
  assert.equal(acceptance.rules.filter((row) => row.issueAnchor).length, 10);
  const parsed = extractIssue170Checklist("- [ ] First\n- [x] Second\n- [X] Third\nordinary text");
  assert.deepEqual(parsed.map((item) => item.checked), [false, true, true]);
});

test("the monthly audit never mistakes source-stage completion or a GitHub checkbox for website acceptance", async () => {
  const coverage = await buildWebsiteIssue170Coverage({ fetchImpl: mockFetch(), githubToken: "test-token" });
  assert.equal(coverage.liveIssueSynced, true);
  assert.equal(coverage.checklistItemsOnIssue, 10);
  assert.equal(coverage.requiredCount, 12);
  assert.equal(coverage.passed, 1);
  assert.equal(coverage.failed, 0);
  assert.equal(coverage.notVerified, 11);
  assert.equal(coverage.acceptanceComplete, false);
  assert.equal(coverage.rows.find((row) => row.id === "W170-12").status, "passed");
  const delegated = coverage.rows.find((row) => row.id === "W170-08");
  assert.deepEqual(delegated.evidenceSources.slice(0, 2), ["delegatedBlog", "delegatedTranscripts"]);
  assert.equal(delegated.status, "not_verified");
  const ledger = issue170CoverageLedger(coverage);
  assert.equal(ledger.length, 11);
  assert.ok(ledger.every((row) => row.classification === "manual_review"));
  assert.ok(ledger.every((row) => row.affectedPaths.length === 0));
  assert.ok(ledger.every((row) => row.sourceFindingIds.length === 1));
});

test("live issue additions and changed requirements are not silently lost", async () => {
  const added = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch({ extraIssueLine: "Audit the new checkout widget when the provider changes." }),
  });
  assert.equal(added.requiredCount, 13);
  assert.equal(added.rows.filter((row) => row.id.startsWith("W170-UNMAPPED-")).length, 1);
  assert.equal(added.acceptanceComplete, false);
});

test("a GitHub API failure adds a synchronisation blocker, not an empty successful checklist", async () => {
  const coverage = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch({ issueAvailable: false }),
  });
  assert.equal(coverage.liveIssueSynced, false);
  assert.ok(coverage.rows.some((row) => row.id === "W170-SYNC"));
  assert.equal(coverage.acceptanceComplete, false);
});

test("the sitemap probe records missing weekly R2 pages as a confirmed failure", async () => {
  const coverage = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch({ sitemapMissing: true }),
  });
  const sitemap = coverage.rows.find((row) => row.id === "W170-12");
  assert.equal(sitemap.status, "failed");
  assert.match(sitemap.reason, /absent from live sitemap/);
  const ledger = issue170CoverageLedger(coverage);
  assert.equal(ledger.find((row) => row.findingId === "W170-12").severity, "High");
});

test("static or unverified blog origins cannot be presented as verified R2 sitemap coverage", async () => {
  const coverage = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch({ headersValid: false }),
  });
  assert.equal(coverage.rows.find((row) => row.id === "W170-12").status, "not_verified");
});

test("an attestation requires completed source evidence, exact revision and private audit artefact", async () => {
  const valid = {
    id: "W170-05", status: "passed", verifiedAt: "2026-11-19T01:00:00Z",
    sourceRevisionSha: "a".repeat(40), artifactUrl: "r2://audits/website/2026-11/accessibility.json",
    summary: "All WCAG 2.2 AA acceptance checks completed with evidence",
  };
  const stage = { status: "completed", requiredArtifactSetReady: true, reportJsonLoaded: true, acceptanceEvidence: [valid] };
  const coverage = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch(), stageReports: { mobileUx: stage },
  });
  assert.equal(coverage.rows.find((row) => row.id === "W170-05").status, "passed");
  const unsafe = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch(), stageReports: { mobileUx: { ...stage, acceptanceEvidence: [{ ...valid, sourceRevisionSha: "guess", artifactUrl: "https://example.com/unverified" }] } },
  });
  assert.equal(unsafe.rows.find((row) => row.id === "W170-05").status, "not_verified");
  assert.equal(unsafe.acceptanceComplete, false);
});
