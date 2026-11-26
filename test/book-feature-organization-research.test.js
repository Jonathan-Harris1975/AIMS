import test from "node:test";
import assert from "node:assert/strict";
import { researchCandidateSources } from "../services/outreach/bookFeature/organizationResearch.js";

function candidate(index, overrides = {}) {
  return { id: `candidate-${index}`, name: `Organisation ${index}`, entityType: "company",
    sentiment: "positive", mentionType: "recommended", confidence: 90, ...overrides };
}

test("source research records bounded unverified leads and filters unsafe URLs", async () => {
  const result = await researchCandidateSources([candidate(1)], {
    apiKey: "test-key", now: () => new Date("2026-01-02T03:04:05.000Z"),
    search: async ({ query, country, apiKey }) => {
      assert.match(query, /Organisation 1/);
      assert.equal(country, "GB");
      assert.equal(apiKey, "test-key");
      return [
        { title: " Official site\n ", url: "https://example.org/path", snippet: " A current source. ", published: "2026-01-01" },
        { title: "Unsafe", url: "http://example.org" },
        { title: "Credentials", url: "https://user:pass@example.org" },
        { title: "Port", url: "https://example.org:8443" },
      ];
    },
  });
  assert.equal(result.sources[0].status, "source_leads_found_unverified");
  assert.equal(result.sources[0].sources.length, 1);
  assert.equal(result.sources[0].sources[0].title, "Official site");
  assert.equal(result.sources[0].retrievedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(result.unverified, true);
  assert.equal(result.verifiedOrganisations, 0);
  assert.equal(result.contactEligibleOpportunities, 0);
});

test("research skips unsuitable or malformed classifications and reports missing configuration", async () => {
  let calls = 0;
  const entities = [candidate(1, { sentiment: "critical" }), candidate(2, { mentionType: "historical" }),
    candidate(3, { confidence: undefined }), candidate(4, { confidence: 101 }), candidate(5)];
  const result = await researchCandidateSources(entities, { apiKey: "", search: async () => { calls++; return []; } });
  assert.equal(calls, 0);
  assert.equal(result.sources.slice(0, 4).every((row) => row.status === "not_researched"), true);
  assert.equal(result.sources[4].status, "unavailable");
});

test("research is capped at five candidates and isolates provider failures", async () => {
  let calls = 0;
  const result = await researchCandidateSources(Array.from({ length: 7 }, (_, index) => candidate(index)), {
    apiKey: "test-key", search: async () => {
      calls++;
      if (calls === 2) throw Object.assign(new Error("provider detail must not leak"), { code: "research_provider_error" });
      return [];
    },
  });
  assert.equal(calls, 5);
  assert.equal(result.searched, 5);
  assert.equal(result.deferred, 2);
  const failed = result.sources.find((row) => row.id === "candidate-1");
  assert.equal(failed.status, "search_failed");
  assert.equal(failed.reason, "research_provider_error");
  assert.equal(failed.error, undefined);
  assert.equal(result.sources.filter((row) => row.status === "deferred").length, 2);
});
