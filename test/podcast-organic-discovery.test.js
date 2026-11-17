import test from "node:test";
import assert from "node:assert/strict";
import {
  SEARCH_TERMS, TURINGS_TORCH_APPLE_ID, TURINGS_TORCH_RSS_URL,
  summariseAppleSearch, summarisePodcastIndexSearch, collectPodcastGrowthSnapshot,
} from "../services/podcast-growth/organicDiscovery.js";

test("Apple catalogue positions are public API samples, not Apple Podcasts charts", () => {
  const result = summariseAppleSearch({ results: [
    { collectionId: 3, collectionName: "Competitor", artistName: "Other host" },
    { collectionId: TURINGS_TORCH_APPLE_ID, collectionName: "Turing's Torch", artistName: "Jonathan Harris" },
  ] }, "AI news podcast");
  assert.equal(result.country, "GB");
  assert.equal(result.ownPositionInSample, 2);
  assert.equal(result.competitors.length, 1);
  assert.match(result.surface, /not-apple-podcasts-app/);
  const absent = summariseAppleSearch({ results: [] }, "AI news podcast");
  assert.equal(absent.ownPositionInSample, null);
  assert.equal(absent.ownNotObservedInSample, true);
  assert.throws(() => summariseAppleSearch({}, "AI"), /invalid JSON results/);
});

test("Podcast Index uses exact RSS identity, not a fuzzy title match", () => {
  const result = summarisePodcastIndexSearch({ feeds: [
    { id: 1, url: "https://other.example/feed.xml", title: "Turing's Torch clone" },
    { id: 2, url: TURINGS_TORCH_RSS_URL, title: "Turing's Torch" },
  ] }, "AI automation podcast");
  assert.equal(result.ownPositionInSample, 2);
  assert.equal(result.competitors.length, 1);
  assert.equal(result.competitors[0].id, 1);
  assert.equal(result.country, null);
  const variant = summarisePodcastIndexSearch({ feeds: [
    { url: TURINGS_TORCH_RSS_URL.replace("https://", "http://www.") + "?utm_source=test" },
  ] }, "AI");
  assert.equal(variant.ownPositionInSample, 1);
  assert.equal(summarisePodcastIndexSearch({ feeds: [{ id: null, url: "https://other.example/feed" }] }, "AI").competitors[0].id, null);
  assert.throws(() => summarisePodcastIndexSearch({ feeds: {} }, "AI"), /invalid JSON feeds/);
});

test("snapshot persists only public API evidence privately and reuses same-day data", async () => {
  const writes = [], sleeps = [], stored = new Map();
  const readText = async (bucket, key) => {
    assert.equal(bucket, "audits");
    if (!stored.has(key)) throw new Error("NoSuchKey");
    return JSON.stringify(stored.get(key));
  };
  const persist = async (bucket, key, payload) => {
    assert.equal(bucket, "audits");
    writes.push(key); stored.set(key, payload);
  };
  let appleCalls = 0, indexCalls = 0;
  const options = {
    now: new Date("2026-11-17T12:00:00.000Z"), terms: ["AI automation", "AI news"],
    indexCredentialsAvailable: true, readText, persist,
    sleep: async (ms) => { sleeps.push(ms); },
    searchApple: async () => {
      appleCalls += 1; return { results: [{ collectionId: TURINGS_TORCH_APPLE_ID }] };
    },
    searchIndex: async () => {
      indexCalls += 1; return { feeds: [{ url: TURINGS_TORCH_RSS_URL }] };
    },
  };
  const first = await collectPodcastGrowthSnapshot(options);
  assert.equal(first.status, "complete");
  assert.equal(first.persisted, true);
  assert.equal(first.evidence.length, 4);
  assert.equal(appleCalls, 2);
  assert.equal(indexCalls, 2);
  assert.deepEqual(sleeps, [3200]);
  assert.ok(writes.includes("audits/podcast-growth/discovery/2026-11-17.json"));
  assert.ok(writes.includes("audits/podcast-growth/discovery/latest.json"));
  assert.ok(first.evidence.every((item) => !Object.hasOwn(item, "downloads")));
  const reused = await collectPodcastGrowthSnapshot(options);
  assert.equal(reused.reused, true);
  assert.equal(appleCalls, 2);
  assert.equal(indexCalls, 2);
  assert.equal(writes.length, 3); // same-day reuse refreshes the latest pointer
});

test("failed sources are unavailable, not fabricated as zero ranking", async () => {
  let persisted = false;
  const result = await collectPodcastGrowthSnapshot({
    now: new Date("2026-11-17T12:00:00Z"), terms: ["AI news"],
    searchApple: async () => { throw new Error("429 temporary rate limit"); },
    indexCredentialsAvailable: false,
    readText: async () => { throw new Error("NoSuchKey"); },
    persist: async () => { persisted = true; }, sleep: async () => {},
  });
  assert.equal(result.status, "unavailable");
  assert.equal(result.persisted, false);
  assert.equal(result.evidence.length, 0);
  assert.equal(result.limitations.length, 2);
  assert.equal(persisted, false);
  assert.ok(SEARCH_TERMS.length > 0);
});

test("partial provider failures retain verified evidence", async () => {
  const result = await collectPodcastGrowthSnapshot({
    now: new Date("2026-11-18T00:00:00Z"), terms: ["AI podcast"],
    indexCredentialsAvailable: true,
    searchApple: async () => ({ results: [] }),
    searchIndex: async () => { throw new Error("offline"); },
    readText: async () => { throw new Error("NoSuchKey"); },
    persist: async () => {},
  });
  assert.equal(result.status, "partial");
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].ownPositionInSample, null);
  assert.deepEqual(result.providers, ["apple-itunes-search"]);
  assert.deepEqual(result.attemptedProviders, ["apple-itunes-search", "podcast-index-search"]);
  assert.equal(result.persisted, true);
});
