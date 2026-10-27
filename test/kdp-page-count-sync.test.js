import test from "node:test";
import assert from "node:assert/strict";
import { pageCountCandidates, processPageCountIntent, queuePageCountSync, websiteShowsCount } from "../services/kdp/pageCountSync.js";

const book = { ebookId: 2, asin: "B0DQK6C563", slug: "sample-book", pageCount: 205 };
const captured = {
  catalogue: book, url: "https://www.amazon.com/dp/B0DQK6C563",
  publicListing: { status: "captured", checkedAt: "2026-10-27T00:00:00Z",
    data: { asin: book.asin, pageCount: 215, pageCountSource: "print_length" } },
};
const expected = { ebookId: 2, asin: book.asin, slug: book.slug, previousPageCount: 205, pageCount: 215,
  sourceUrl: captured.url, checkedAt: captured.publicListing.checkedAt };
const key = "audit/page-count-sync/pending/test.json";

function deps(overrides = {}) {
  const events = [];
  return { events, env: { WEBSITE_REBUILD_HOOK: "https://example.com/hook" },
    write: async (_bucket, _key, value) => events.push(`write:${value.status}`),
    update: async () => { events.push("update"); return { status: "updated" }; },
    readBook: async () => ({ asin: book.asin, pageCount: 215 }),
    validatePurge: () => {}, purge: async () => events.push("purge"),
    rebuild: async () => { events.push("rebuild"); return { ok: true }; },
    verify: async () => false, remove: async () => events.push("remove"), ...overrides };
}

test("only verified Kindle ASINs with explicit print-length evidence produce updates", () => {
  assert.deepEqual(pageCountCandidates({ listings: [captured] }), [expected]);
  for (const changes of [
    { status: "blocked" },
    { data: { asin: "B0WRONG123", pageCount: 215, pageCountSource: "print_length" } },
    { data: { asin: book.asin, pageCount: 215, pageCountSource: null } },
    { data: { asin: book.asin, pageCount: 0, pageCountSource: "print_length" } },
  ]) assert.deepEqual(pageCountCandidates({ listings: [{ ...captured, publicListing: { ...captured.publicListing, ...changes } }] }), []);
  assert.deepEqual(pageCountCandidates({ listings: [{ ...captured, catalogue: { ...book, pageCount: 215 } }] }), []);
});

test("sync intent is durable before an update is attempted", async () => {
  const calls = [];
  const result = await queuePageCountSync("59025e25-4150-4830-b5d3-2f2a4823a481", { listings: [captured] }, {
    write: async (_bucket, target, intent) => calls.push({ target, intent }),
  });
  assert.equal(result.queued, 1);
  assert.equal(calls[0].intent.status, "prepared");
  assert.deepEqual(calls[0].intent.items, [expected]);
});

test("missing build or purge configuration leaves D1 untouched", async () => {
  const intent = { status: "prepared", items: [expected] };
  const missingHook = deps({ env: {} });
  assert.equal((await processPageCountIntent(key, intent, missingHook)).status, "waiting_for_website_hook");
  assert.deepEqual(missingHook.events, ["write:prepared"]);
  const missingPurge = deps({ validatePurge: () => { throw new Error("not configured"); } });
  assert.equal((await processPageCountIntent(key, intent, missingPurge)).status, "waiting_for_cache_purge_config");
  assert.deepEqual(missingPurge.events, ["write:prepared"]);
});

test("updates D1, purges cached API and starts a rebuild, then waits for live verification", async () => {
  const intent = { status: "prepared", items: [expected] };
  const d = deps();
  const result = await processPageCountIntent(key, intent, d);
  assert.equal(result.status, "awaiting_website");
  assert.equal(result.updated, 1);
  assert.deepEqual(d.events, ["update", "write:pending_rebuild", "purge", "rebuild", "write:rebuild_requested"]);
  d.verify = async () => true;
  assert.equal((await processPageCountIntent(key, intent, d)).status, "verified");
  assert.equal(d.events.at(-1), "remove");
});

test("conflicting D1 edits are not overwritten or followed by a rebuild", async () => {
  const intent = { status: "prepared", items: [expected] };
  const d = deps({ update: async () => ({ status: "conflict" }) });
  assert.equal((await processPageCountIntent(key, intent, d)).status, "conflict");
  assert.equal(d.events.includes("rebuild"), false);
});

test("a failed rebuild is retried without repeating the D1 write", async () => {
  const intent = { status: "prepared", items: [expected] };
  const d = deps({ rebuild: async () => ({ ok: false, reason: "unavailable" }) });
  assert.equal((await processPageCountIntent(key, intent, d)).status, "rebuild_pending");
  assert.equal(intent.status, "pending_rebuild");
  d.rebuild = async () => ({ ok: true });
  assert.equal((await processPageCountIntent(key, intent, d)).status, "awaiting_website");
  assert.equal(d.events.filter((event) => event === "update").length, 1);
});

test("website verification requires the right ASIN and both visible and structured counts", () => {
  const html = `<script type="application/ld+json">{"@type":"Book","identifier":[` +
    `{"propertyID":"ASIN","value":"${book.asin}"}],"numberOfPages":215}</script><li><strong>Length:</strong> 215 pages</li>`;
  assert.equal(websiteShowsCount(html, book.asin, 215), true);
  assert.equal(websiteShowsCount(html, book.asin, 205), false);
  assert.equal(websiteShowsCount(html, "B0WRONG123", 215), false);
  assert.equal(websiteShowsCount(html.replace("215 pages", "205 pages"), book.asin, 215), false);
});
