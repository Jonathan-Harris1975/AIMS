import test from "node:test";
import assert from "node:assert/strict";
import {
  normaliseMonthlyGrowthEvidence, renderMonthlyGrowthAppendix, collectMonthlyGrowthEvidence,
} from "../services/podcast-growth/monthlyEvidence.js";

const now = new Date("2026-11-17T12:00:00Z");

test("monthly appendix distinguishes sampled search results from actual chart rankings", async () => {
  const report = normaliseMonthlyGrowthEvidence({ now, snapshot: {
    schemaVersion: "podcast-growth-discovery/v1",
    date: "2026-11-16",
    status: "complete",
    evidence: [{ provider: "apple-itunes-search", country: "GB", term: "AI podcast",
      ownPositionInSample: 4, sampledResults: 25,
      competitors: [{ title: "AI competitor" }, { title: "<script>alert('x')</script>" }] }],
    limitations: [],
  }, sales: {
    status: "workbook-present", workbookCount: 2, workbookCountKnown: true,
    latest: { metadata: { startDate: "2026-10-01", endDate: "2026-10-31" } },
  } });
  assert.equal(report.discovery.status, "complete");
  assert.equal(report.discovery.observations[0].ownPositionInSample, 4);
  assert.equal(report.discovery.apiSurface, "public-search-API-samples-not-podcast-app-rankings");
  assert.equal(report.bookSales.royaltiesGBP, null);
  assert.equal(report.bookSales.soldUnits, null);
  assert.equal(report.bookSales.attributableBookSales, null);
  const html = renderMonthlyGrowthAppendix(report);
  assert.match(html, /AI podcast/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(html.includes("<script>"), false);
  assert.match(html, /not Apple Podcasts/);
  assert.match(html, /£0/);
});

test("missing or stale discovery and KDP source evidence are unavailable, not zero outcomes", async () => {
  const old = normaliseMonthlyGrowthEvidence({ now, snapshot: {
    schemaVersion: "podcast-growth-discovery/v1", date: "2026-09-01",
    status: "complete", evidence: [{ provider: "apple", ownPositionInSample: 1 }],
  } });
  assert.equal(old.discovery.status, "unavailable");
  assert.deepEqual(old.discovery.observations, []);
  assert.equal(old.bookSales.workbookCount, null);
  assert.equal(old.bookSales.royaltiesGBP, null);
  const missing = await collectMonthlyGrowthEvidence({
    now, readSnapshot: async () => { throw new Error("R2 unavailable"); },
    readBookSales: async () => { throw new Error("KDP unavailable"); },
  });
  assert.equal(missing.discovery.status, "unavailable");
  assert.equal(missing.bookSales.status, "unavailable");
  assert.match(renderMonthlyGrowthAppendix(missing), /No verified, recent discovery samples/);
});

test("API 'not observed' is never described as rank zero or a failure", async () => {
  const report = normaliseMonthlyGrowthEvidence({ now, snapshot: {
    schemaVersion: "podcast-growth-discovery/v1", date: "2026-11-17",
    status: "partial", evidence: [{ provider: "podcast-index-search", term: "AI news",
      ownPositionInSample: null, sampledResults: 25, competitors: [] }],
    limitations: ["Apple temporarily unavailable"],
  } });
  assert.equal(report.discovery.status, "partial");
  assert.equal(report.discovery.observations[0].ownPositionInSample, null);
  assert.match(renderMonthlyGrowthAppendix(report), /Not observed/);
  assert.match(renderMonthlyGrowthAppendix(report), /Apple temporarily unavailable/);
});
