import test from "node:test";
import assert from "node:assert/strict";
import { researchCandidateSources } from "../services/outreach/bookFeature/organizationResearch.js";

function candidate(index, overrides = {}) {
  return { id: `candidate-${index}`, name: `Organisation ${index}`, entityType: "company",
    sentiment: "positive", mentionType: "recommended", confidence: 90, ...overrides };
}

const cacheMiss = async () => { throw Object.assign(new Error("missing cache"), { name: "NoSuchKey" }); };

test("source research records bounded unverified leads and filters unsafe URLs", async () => {
  const result = await researchCandidateSources([candidate(1)], {
    apiKey: "test-key", now: () => new Date("2026-01-02T03:04:05.000Z"),
    readCache: cacheMiss, writeCache: async () => {},
    search: async ({ query, country, freshness, apiKey }) => {
      assert.match(query, /Organisation 1/);
      assert.equal(country, "GB");
      assert.equal(freshness, "pm");
      assert.equal(apiKey, "test-key");
      return [
        { title: " Official site\n ", url: "https://example.org/path", snippet: " A current source. ", published: "2026-01-01" },
        { title: "Unsafe", url: "http://example.org" },
        { title: "Credentials", url: "https://user:pass@example.org" },
        { title: "Port", url: "https://example.org:8443" },
        { title: "IP host", url: "https://203.0.113.8/company" },
        { title: "Local host", url: "https://service.local/company" },
        { title: "Internal host", url: "https://service.internal/company" },
        { title: "Single-label host", url: "https://intranet/company" },
      ];
    },
  });
  assert.equal(result.sources[0].status, "source_leads_found_unverified");
  assert.equal(result.sources[0].sources.length, 1);
  assert.equal(result.sources[0].sources[0].title, "Official site");
  assert.equal(result.sources[0].retrievedAt, "2026-01-02T03:04:05.000Z");
  assert.deepEqual(result.sources[0].cache, { read: "miss", write: "written" });
  assert.equal(result.unverified, true);
  assert.equal(result.verifiedOrganisations, 0);
  assert.equal(result.contactEligibleOpportunities, 0);
});

test("research skips unsuitable or malformed classifications and reports missing configuration", async () => {
  let calls = 0;
  const entities = [candidate(1, { sentiment: "critical" }), candidate(2, { mentionType: "historical" }),
    candidate(3, { confidence: undefined }), candidate(4, { confidence: 101 }), candidate(5)];
  const result = await researchCandidateSources(entities, { apiKey: "", readCache: cacheMiss,
    search: async () => { calls++; return []; } });
  assert.equal(calls, 0);
  assert.equal(result.sources.slice(0, 4).every((row) => row.status === "not_researched"), true);
  assert.equal(result.sources[4].status, "unavailable");
});

test("research is capped at five candidates and isolates provider failures", async () => {
  let calls = 0;
  const result = await researchCandidateSources(Array.from({ length: 7 }, (_, index) => candidate(index)), {
    apiKey: "test-key", readCache: cacheMiss, writeCache: async () => {}, search: async () => {
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

test("normalised duplicate organisations do not consume additional provider calls", async () => {
  let calls = 0;
  const result = await researchCandidateSources([
    candidate(1, { name: "Example Organisation" }),
    candidate(2, { name: " example organisation " }),
  ], { apiKey: "test-key", readCache: cacheMiss, writeCache: async () => {},
    search: async () => { calls++; return []; } });
  assert.equal(calls, 1);
  assert.equal(result.searched, 1);
  assert.equal(result.sources[1].status, "duplicate_candidate");
  assert.equal(result.sources[1].duplicateOf, "candidate-1");
});

test("fresh source leads are reused from cache and expired entries are refreshed", async () => {
  const now = new Date("2026-01-10T00:00:00.000Z");
  let cached = null;
  let searches = 0;
  const options = {
    apiKey: "test-key", now: () => now,
    readCache: async () => {
      if (!cached) throw Object.assign(new Error("missing cache"), { name: "NoSuchKey" });
      return JSON.stringify(cached);
    },
    writeCache: async (_bucket, _key, value) => { cached = value; },
    search: async () => { searches++; return [{ title: "Official page", url: "https://example.org/about", snippet: "Public source" }]; },
  };
  const first = await researchCandidateSources([candidate(1)], options);
  assert.deepEqual(first.sources[0].cache, { read: "miss", write: "written" });
  const second = await researchCandidateSources([candidate(1)], options);
  assert.deepEqual(second.sources[0].cache, { read: "hit", write: "not_needed" });
  assert.equal(searches, 1);
  cached.expiresAt = "2026-01-09T23:59:59.000Z";
  const refreshed = await researchCandidateSources([candidate(1)], options);
  assert.deepEqual(refreshed.sources[0].cache, { read: "miss", write: "written" });
  assert.equal(searches, 2);
});

test("cache read failure is recorded while bounded research continues", async () => {
  let searches = 0;
  const result = await researchCandidateSources([candidate(1)], {
    apiKey: "test-key", readCache: async () => { throw Object.assign(new Error("storage unavailable"), { code: "storage_unavailable" }); },
    writeCache: async () => {}, search: async () => { searches++; return []; },
  });
  assert.equal(searches, 1);
  assert.equal(result.sources[0].status, "no_source_leads_found");
  assert.deepEqual(result.sources[0].cache, { read: "failed", write: "written" });
});
