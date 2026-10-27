import test from "node:test";
import assert from "node:assert/strict";
import { tavilySearch, competitorCandidates, discoverBookResearch } from "../services/kdp/researchDiscovery.js";
import { latestAudit, londonWeek, runResearchTick, validMondayAudit } from "../services/kdp/researchWorker.js";

test("research searches both storefronts and recent topics without treating snippets as verified prices", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return { ok: true, json: async () => ({ results: [{ title: "Book", url: "https://www.amazon.com/dp/B012345678?ref=x", content: "$4.99" }] }) };
  };
  const result = await discoverBookResearch({ ebookId: 1, asin: "B099999999", topic: "AI security" }, { apiKey: "test", fetchImpl, now: () => new Date("2026-10-27T12:00:00Z") });
  assert.equal(calls.length, 4);
  assert.equal(JSON.parse(calls[2].options.body).time_range, "month");
  assert.equal(JSON.parse(calls[1].options.body).country, "united kingdom");
  assert.equal(result.competitors.US[0].price, null);
  assert.equal(result.competitors.US[0].verification, "unverified");
  assert.equal(result.competitors.UK.length, 0);
  assert.equal(result.trendSources.US.length, 1);
});

test("competitors exclude own ASIN, duplicates and foreign or deceptive hosts", () => {
  const urls = ["https://www.amazon.com/dp/B012345678", "https://www.amazon.com/dp/B012345678?x=1",
    "https://www.amazon.com/dp/B099999999", "https://amazon.com.evil.test/dp/B011111111", "https://www.amazon.co.uk/dp/B022222222"];
  const found = competitorCandidates(urls.map((url) => ({ url })), "US", "B099999999");
  assert.deepEqual(found.map((x) => x.asin), ["B012345678"]);
});

test("search failure never treats an invalid provider response as success", async () => {
  await assert.rejects(tavilySearch({ query: "test", country: "US", apiKey: "test", fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
  await assert.rejects(tavilySearch({ query: "test", country: "US", apiKey: "test", fetchImpl: async () => ({ ok: true, json: async () => ({}) }) }), /invalid response/);
});

test("worker requires a successful audit from this Monday and saves rotating progress", async () => {
  const date = new Date("2026-10-27T12:00:00Z");
  const audit = { ok: true, complete: true, mode: "public", runId: "audit-1", createdAt: "2026-10-26T12:05:00Z", completedAt: "2026-10-26T12:30:00Z" };
  assert.equal(londonWeek(date), "2026-10-26");
  assert.equal(validMondayAudit(audit, date), true);
  assert.equal(validMondayAudit({ ...audit, complete: false }, date), false);
  let saved = null, archived = null;
  const env = { TAVILY_SEARCH_API: "test", R2_ENDPOINT: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET_META_SYSTEM: "test", KDP_RESEARCH_BATCH_SIZE: "1" };
  const options = {
    now: () => date, env, getMetadata: async () => null, readState: async () => saved && structuredClone(saved),
    writeState: async (s) => { saved = structuredClone(s); }, archive: async (_week, s) => { archived = structuredClone(s); },
    getAudit: async () => audit, getBooks: async () => [{ ebookId: 1, asin: "B012345678" }, { ebookId: 2, asin: "B012345679" }],
    discover: async (book) => ({ ebookId: book.ebookId }), claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => {},
  };
  assert.equal((await runResearchTick(options)).status, "complete");
  assert.equal(saved.cursor, 1);
  assert.equal(archived.results[0].ebookId, 1);
  assert.equal((await runResearchTick(options)).status, "already_complete");
});

test("worker does not advance when the audit or search fails", async () => {
  const date = new Date("2026-10-27T12:00:00Z");
  const env = { TAVILY_SEARCH_API: "test", R2_ENDPOINT: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET_META_SYSTEM: "test" };
  let saved = null;
  const options = {
    now: () => date, env, getMetadata: async () => null, readState: async () => saved && structuredClone(saved),
    writeState: async (s) => { saved = structuredClone(s); }, archive: async () => {},
    getAudit: async () => null, getBooks: async () => [{ ebookId: 1, asin: "B012345678" }],
    discover: async () => { throw new Error("provider failed"); },
    claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => {},
  };
  assert.equal((await runResearchTick(options)).status, "monday_audit_unavailable");
  assert.equal(saved, null);
  options.getAudit = async () => ({ ok: true, complete: true, mode: "public", runId: "1", createdAt: "2026-10-26T12:00:00Z", completedAt: "2026-10-26T12:10:00Z" });
  await assert.rejects(runResearchTick(options), /provider failed/);
  assert.equal(saved.cursor, 0);
  assert.equal(saved.pending.length, 1);
});

test("monthly quota is persisted before provider calls and prevents the next call", async () => {
  const date = new Date("2026-10-27T12:00:00Z");
  const env = { TAVILY_SEARCH_API: "test", R2_ENDPOINT: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test",
    R2_BUCKET_META_SYSTEM: "test", KDP_RESEARCH_MONTHLY_SEARCH_LIMIT: "1" };
  let saved = null;
  const options = {
    now: () => date, env, getMetadata: async () => null, readState: async () => saved && structuredClone(saved),
    writeState: async (s) => { saved = structuredClone(s); }, archive: async () => {},
    getAudit: async () => ({ ok: true, complete: true, mode: "public", runId: "1", createdAt: "2026-10-26T12:00:00Z", completedAt: "2026-10-26T12:10:00Z" }),
    getBooks: async () => [{ ebookId: 1, asin: "B012345678" }],
    discover: async (_book, { beforeRequest }) => { await beforeRequest(); await beforeRequest(); },
    claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => {},
  };
  await assert.rejects(runResearchTick(options), /Monthly search limit/);
  assert.equal(saved.requestsReserved, 1);
  assert.equal(saved.pending.length, 1);
});

test("Amazon blocks stop the batch and retries reuse the saved search", async () => {
  const date = new Date("2026-10-27T12:00:00Z");
  const env = { TAVILY_SEARCH_API: "test", R2_ENDPOINT: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test",
    R2_BUCKET_META_SYSTEM: "test" };
  let saved = null, searches = 0, blocked = true;
  const options = {
    now: () => date, env, getMetadata: async () => null, readState: async () => saved && structuredClone(saved),
    writeState: async (s) => { saved = structuredClone(s); }, archive: async () => {},
    getAudit: async () => ({ ok: true, complete: true, mode: "public", runId: "1", createdAt: "2026-10-26T12:00:00Z", completedAt: "2026-10-26T12:10:00Z" }),
    getBooks: async () => [{ ebookId: 1, asin: "B012345678" }],
    discover: async () => { searches++; return { ebookId: 1 }; },
    captureEvidence: async () => ({ markets: { US: { status: blocked ? "blocked" : "captured" } } }),
    claim: async () => ({ claimed: true, lease: { backend: "r2" } }), release: async () => {},
  };
  assert.equal((await runResearchTick(options)).status, "amazon_blocked");
  assert.equal(saved.cursor, 0);
  blocked = false;
  assert.equal((await runResearchTick(options)).status, "complete");
  assert.equal(searches, 1);
});

test("a later signed-in audit does not hide the valid Monday public report", async () => {
  const report = { mode: "public", ok: true, complete: true, runId: "public", createdAt: "2026-10-26T12:00:00Z", completedAt: "2026-10-26T12:10:00Z" };
  const found = await latestAudit(new Date("2026-10-27T12:00:00Z"), {
    readPointer: async () => ({ reportRef: "r2://kdp/audit/reports/2026-10-27/signed.json" }),
    readReport: async (key) => key.endsWith("signed.json") ? { mode: "kdp" } : report,
    listReports: async (_bucket, prefix) => [{ key: `${prefix}public.json` }],
  });
  assert.equal(found.runId, "public");
});
