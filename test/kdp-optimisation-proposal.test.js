import test from "node:test";
import assert from "node:assert/strict";
import { draftOptimisation } from "../services/kdp/optimisationProposal.js";

const now = new Date("2026-10-27T12:00:00Z");
const book = {
  asin: "B012345678", title: "Artificial intelligence",
  description: "Machine learning supports grid operations. This practical guide covers grid data and forecasting for electricity networks.",
  whatBookCovers: "Machine learning supports grid operations.",
};
const metadata = { syncedAt: "2026-10-26T12:00:00Z", books: [{ asin: book.asin, titleId: "A123456789012", format: "kindle" }] };
const research = { trendSources: { US: [{ url: "https://example.org/story", published: "2026-10-25", snippet: "Machine learning supports grid operations as a growing research area." }], UK: [] } };
const liveListing = { publicListing: { status: "captured", data: { asin: book.asin, title: book.title, description: book.description } } };

test("unmatched or stale KDP metadata never calls the model", async () => {
  let called = false;
  const request = async () => { called = true; };
  assert.equal((await draftOptimisation(book, research, { ...metadata, books: [] }, { now, request })).reason, "kdp_identity_unmatched");
  assert.equal((await draftOptimisation(book, research, { ...metadata, syncedAt: "2026-10-01" }, { now, request })).reason, "metadata_stale");
  assert.equal(called, false);
});

test("model suggestions require supporting book text and a recent dated source", async () => {
  const request = async () => ({ content: JSON.stringify({
    description: "Machine learning supports grid operations. New topics invented here.", keywords: ["machine learning", "new invention"],
  }), model: "free" });
  const result = await draftOptimisation(book, research, metadata, { now, request, liveListing });
  assert.deepEqual(result.keywords, ["machine learning"]);
  assert.equal(result.description, null);
  assert.equal(result.listingUpdated, false);
  assert.equal(result.price.status, "blocked");
});

test("undated or stale sources do not generate a proposal", async () => {
  const old = { trendSources: { US: [{ ...research.trendSources.US[0], published: "2020-01-01" }] } };
  assert.equal((await draftOptimisation(book, old, metadata, { now, liveListing })).reason, "insufficient_content_or_dated_sources");
});

test("drafts require the ASIN-verified live product page, not cached catalogue text", async () => {
  assert.equal((await draftOptimisation(book, research, metadata, { now })).reason, "live_listing_unverified");
  const wrong = { publicListing: { status: "captured", data: { asin: "B099999999" } } };
  assert.equal((await draftOptimisation(book, research, metadata, { now, liveListing: wrong })).reason, "live_listing_unverified");
});
