import test from "node:test";
import assert from "node:assert/strict";
import { inWeeklyWindow, matchKdpMetadata, priceFromComparables, selectWeeklyBatch } from "../services/kdp/weeklyResearch.js";

test("London windows respect summer and winter clock changes and the end is exclusive", () => {
  assert.equal(inWeeklyWindow(new Date("2026-07-06T11:00:00Z"), "audit"), true);
  assert.equal(inWeeklyWindow(new Date("2026-07-07T13:59:00Z"), "update"), true);
  assert.equal(inWeeklyWindow(new Date("2026-07-07T14:00:00Z"), "update"), false);
  assert.equal(inWeeklyWindow(new Date("2026-10-27T12:00:00Z"), "update"), true);
  assert.equal(inWeeklyWindow(new Date("2026-10-30T12:00:00Z"), "update"), false);
});

test("selection advances and wraps without returning duplicate books", () => {
  const books = [1, 2, 3].map((ebookId) => ({ ebookId, asin: `B0${String(ebookId).padStart(8, "0")}` }));
  assert.deepEqual(selectWeeklyBatch(books, 2, 15).books.map((x) => x.ebookId), [3, 1, 2]);
  assert.equal(selectWeeklyBatch(books, 0, 2).nextCursor, 2);
  assert.throws(() => selectWeeklyBatch([...books, books[0]], 0, 2), /Duplicate/);
});

test("pricing requires current unique matching Kindle evidence and respects both floors", () => {
  const observedAt = "2026-10-27T12:00:00Z";
  const evidence = [1, 2, 3].map((id) => ({
    asin: `B0${String(id).padStart(8, "0")}`, url: `https://www.amazon.co.uk/dp/B0${String(id).padStart(8, "0")}`,
    marketplace: "UK", currency: "GBP", format: "kindle", comparable: true, promotional: false, priceMinor: 350 + id * 10, observedAt,
  }));
  const params = { marketplace: "UK", ownAsin: "B099999999", comparables: evidence, observedAt };
  assert.equal(priceFromComparables(params).priceMinor, 400);
  assert.equal(priceFromComparables({ ...params, comparables: [...evidence.slice(0, 2), evidence[0]] }).status, "insufficient_evidence");
  assert.equal(priceFromComparables({ ...params, observedAt: "2026-10-30T12:00:00Z" }).status, "insufficient_evidence");
  assert.equal(priceFromComparables({ ...params, comparables: evidence.map((x) => ({ ...x, promotional: true })) }).status, "insufficient_evidence");
  assert.equal(priceFromComparables({ ...params, comparables: evidence.map((x) => ({ ...x, url: x.url.replace("amazon.co.uk", "example.com") })) }).status, "insufficient_evidence");
});

test("KDP title ID is never assumed to be an ASIN", () => {
  const book = { asin: "B012345678" };
  const entry = { asin: "B012345678", titleId: "A123456789012", format: "kindle" };
  assert.equal(matchKdpMetadata(book, [entry]).metadata.titleId, entry.titleId);
  assert.equal(matchKdpMetadata(book, [{ ...entry, asin: "", titleId: book.asin }]).status, "unmatched");
  assert.equal(matchKdpMetadata(book, [entry, entry]).status, "ambiguous");
});
