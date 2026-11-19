import test from "node:test";
import assert from "node:assert/strict";
import { getWebsiteAuditPolicy } from "../audits/utils/websiteAuditPolicy.js";
import { buildWebsiteAuditHtml } from "../audits/utils/websiteAuditCouncil.js";
import {
  extractIssue170Checklist,
  buildWebsiteIssue170Coverage,
  issue170CoverageLedger,
} from "../audits/utils/websiteIssue170Coverage.js";

const site = "https://jonathan-harris.online";
const issueApi = "https://api.github.com/repos/Jonathan-Harris1975/jonathan-harris-website/issues/170";
const acceptance = getWebsiteAuditPolicy().issue170Acceptance;

function mockFetch({
  issueAvailable = true, extraIssueLine = "", amendedIssue = false,
  sitemapMissing = false, staticMissing = false, dateMissing = false, headersValid = true,
  manifest = [{ slug: "2026-w46-weekly-publish", published_at: "2026-11-16T09:00:00Z" }],
} = {}) {
  const checklist = acceptance.rules.filter((r) => r.issueText)
    .map((r) => "- [ ] " + r.issueText);
  if (amendedIssue) checklist[4] += " A second independent accessibility certification is now required.";
  if (extraIssueLine) checklist.push("- [ ] " + extraIssueLine);

  const staticRows = [site + "/", site + "/blog/", site + "/ebooks/"];
  const postRows = manifest.filter((_, index) => !sitemapMissing || index > 0)
    .map((row) => ({
      loc: site + "/blog/posts/" + row.slug + "/",
      date: dateMissing ? "" : String(row.published_at).slice(0, 10),
    }));
  const xml = (rows) => '<?xml version="1.0"?><urlset>'
    + rows.map((row) => "<url><loc>" + row.loc + "</loc>"
      + (row.date ? "<lastmod>" + row.date + "</lastmod>" : "") + "</url>").join("")
    + "</urlset>";
  const staticXml = xml(staticRows.map((loc) => ({ loc })));
  const liveXml = xml([
    ...staticRows.filter((row) => !staticMissing || !row.endsWith("/ebooks/")).map((loc) => ({ loc })),
    ...postRows,
  ]);

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
      return new Response(liveXml, {
        status: 200,
        headers: {
          "x-blog-sitemap-source": headersValid ? "r2" : "static",
          "x-blog-posts-in-sitemap": String(manifest.length),
        },
      });
    }
    if (url === "https://raw.githubusercontent.com/Jonathan-Harris1975/jonathan-harris-website/main/sitemap.xml") {
      return new Response(staticXml, { status: 200 });
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

  const amended = await buildWebsiteIssue170Coverage({ fetchImpl: mockFetch({ amendedIssue: true }) });
  assert.ok(amended.rows.some((row) => row.id.startsWith("W170-UNMAPPED-")));
  assert.equal(amended.rows.find((row) => row.id === "W170-05").status, "not_verified");
  assert.equal(amended.acceptanceComplete, false);
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

test("sitemap requires every governed URL and the actual publication dates", async () => {
  for (const input of [{ staticMissing: true }, { dateMissing: true }]) {
    const coverage = await buildWebsiteIssue170Coverage({ fetchImpl: mockFetch(input) });
    const sitemap = coverage.rows.find((row) => row.id === "W170-12");
    assert.equal(sitemap.status, "failed");
  }
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
  const stage = { status: "completed", requiredArtifactSetReady: true, reportJsonLoaded: true,
    sourceRevisionSha: "a".repeat(40), liveSourceParity: "matched", acceptanceEvidence: [valid] };
  const coverage = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch(), stageReports: { mobileUx: stage },
    now: new Date("2026-11-19T01:05:00Z"),
  });
  assert.equal(coverage.rows.find((row) => row.id === "W170-05").status, "passed");
  const unsafe = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch(), stageReports: { mobileUx: { ...stage, acceptanceEvidence: [{ ...valid, sourceRevisionSha: "guess", artifactUrl: "https://example.com/unverified" }] } },
  });
  assert.equal(unsafe.rows.find((row) => row.id === "W170-05").status, "not_verified");
  const mismatched = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch(), stageReports: { mobileUx: { ...stage, liveSourceParity: "mismatched" } },
  });
  assert.equal(mismatched.rows.find((row) => row.id === "W170-05").status, "not_verified");
  const old = await buildWebsiteIssue170Coverage({
    fetchImpl: mockFetch(), stageReports: { mobileUx: stage }, now: new Date("2027-01-01T01:05:00Z"),
  });
  assert.equal(old.rows.find((row) => row.id === "W170-05").status, "not_verified");
  assert.equal(unsafe.acceptanceComplete, false);
});

test("rendered website HTML and PDF report includes full issue 170 acceptance matrix", async () => {
  const coverage = await buildWebsiteIssue170Coverage({ fetchImpl: mockFetch() });
  const html = buildWebsiteAuditHtml({
    websiteUrl: site,
    sessionId: "monthly-website-audit",
    generatedAt: "2026-11-19T01:00:00Z",
    council: {
      synthesisState: "Complete",
      executiveSummary: "The audit ran, but full site acceptance is not verified.",
      scorecard: {}, targetAssessment: { target: 8.5, belowTarget: [], unscored: [] },
      councilVerdict: {}, councilRecord: {}, implementationProgramme: {},
      issue170Coverage: coverage,
    },
    stageReports: { digitalGrowth: {}, seoAeoGeo: {}, mobileUx: {} },
  });
  assert.ok(html.includes("Issue #170: mandatory monthly website acceptance"));
  assert.ok(html.includes("W170-01 Full live static and dynamic route inventory"));
  assert.ok(html.includes("W170-08 R2 publishing"));
  assert.ok(html.includes("W170-12 Weekly R2 blog sitemap publication parity"));
  assert.ok(html.includes("Website accepted:</strong> No"));
});
