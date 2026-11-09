import test from "node:test";
import assert from "node:assert/strict";
import { selectNewsletterCandidates } from "../services/newsletter/engine/rss.js";
import { publicationContext } from "../services/newsletter/engine/publicationContext.js";
import { buildNewsletter } from "../services/newsletter/engine/buildNewsletter.js";

const now = new Date("2026-11-09T10:00:00Z");
function source(id, hours) {
  return { title: `Verified AI story ${id}`, link: `https://news.example/${id}`,
    pubDate: new Date(now - hours * 3600000).toUTCString(), description: "A dated source report." };
}
const feed = (items) => [{ ok: true, feedUrl: "https://news.example/feed", items }];

test("a quiet Monday expands dated sources to 72 hours without inventing a three-story edition", () => {
  const result = selectNewsletterCandidates(feed([source(1, 2), source(2, 30), source(3, 60), source(4, 73), source(5, -1)]), { now });
  assert.equal(result.expandedWindow, true);
  assert.equal(result.sourceWindowHours, 72);
  assert.equal(result.primaryCandidateCount, 1);
  assert.equal(result.items.length, 3);
  assert.deepEqual(result.items.map(x => x.publishedAt), [2, 30, 60].map(h => new Date(now - h * 3600000).toISOString()));
});

test("a sufficient current source pool never pulls older or future stories into the issue", () => {
  const result = selectNewsletterCandidates(feed([source(1, 1), source(2, 2), source(3, 3), source(4, 30), source(5, -1)]), { now });
  assert.equal(result.expandedWindow, false);
  assert.equal(result.sourceWindowHours, 24);
  assert.equal(result.items.length, 3);
});

test("fallback cannot fill the issue with duplicate, undated or expired material", () => {
  const duplicate = { ...source(1, 2), link: "https://news.example/1?tracking=duplicate" };
  const result = selectNewsletterCandidates(feed([source(1, 2), duplicate, source(2, 90), { ...source(3, 2), pubDate: null }]), { now });
  assert.equal(result.items.length, 1);
});

test("an impossible source pool is rejected before any model composition or council spend", async () => {
  const oldFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests++; throw new Error("No model call is permitted"); };
  try {
    const result = await buildNewsletter({ now, sourceItems: [{ title: "Only one source", link: "https://news.example/1", publishedAt: now.toISOString() }] });
    assert.equal(result.ok, false);
    assert.equal(result.failureKind, "source-intake-unavailable");
    assert.equal(result.retryable, true);
    assert.equal(requests, 0);
  } finally { globalThis.fetch = oldFetch; }
});

test("publication date is explicit London context and respects prepared weekend dates", () => {
  assert.equal(publicationContext({ publicationDate: "2026-11-09" }).publicationDate, "2026-11-09");
  assert.equal(publicationContext({ publicationDate: "2026-11-15" }).publicationDate, "2026-11-15");
  assert.equal(publicationContext({}).timezone, "Europe/London");
  assert.match(publicationContext({}).dateRule, /matching date is not future-dated/);
});
