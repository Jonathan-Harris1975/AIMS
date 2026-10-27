import test from "node:test";
import assert from "node:assert/strict";
import { auditPublicCatalogue, compareListing, fetchProductPage, productUrl } from "../services/kdp/publicListingAudit.js";
import { __kdpCatalogueTestHooks } from "../services/kdp/catalogue.js";

const books = [
  { ebookId: 1, asin: "B0DQHSD858", title: "Book One", author: "Jonathan Harris", pageCount: 227 },
  { ebookId: 2, asin: "B0DQK6C563", title: "Book Two", author: "Jonathan Harris", pageCount: 205 },
];

function fakeBrowser(data) {
  let closed = false;
  return {
    get closed() { return closed; },
    async newContext(options) {
      assert.equal(options.javaScriptEnabled, false);
      return {
        async route() {},
        async newPage() { return { async setContent() {}, async evaluate() { return data; } }; },
        async close() {},
      };
    },
    async close() { closed = true; },
  };
}

test("D1 mapping exposes actual catalogue ASIN and page metadata", () => {
  const book = __kdpCatalogueTestHooks.mapBook({ ebook_id: 1, asin: "B0DQHSD858", page_count: 227, publication_date: "2024-12-14", keywords_json: '["AI"]', book_url: "https://example.com" });
  assert.equal(book.asin, "B0DQHSD858");
  assert.equal(book.pageCount, 227);
  assert.equal(book.publicationDate, "2024-12-14");
  assert.deepEqual(book.keywords, ["AI"]);
  assert.equal(book.bookUrl, "https://example.com");
});

test("public audit retains every D1 book and stops on Amazon block", async () => {
  const browser = fakeBrowser({ asin: books[0].asin, title: "Book One", author: "Jonathan Harris", pageCount: 227, categories: [] });
  let calls = 0;
  const result = await auditPublicCatalogue([...books, { ebookId: 3, asin: "B0DQK6C564" }], {
    delayMs: 0, browserFactory: async () => browser,
    fetchPage: async () => ++calls === 1 ? { status: "fetched", html: "<html></html>", httpStatus: 200 } : { status: "blocked", httpStatus: 429 },
  });
  assert.equal(result.catalogueBooks, 3);
  assert.equal(result.captured, 1);
  assert.equal(result.notCaptured, 2);
  assert.deepEqual(result.statusCounts, { captured: 1, blocked: 1, skipped_after_block: 1 });
  assert.equal(result.listings[0].comparisons.pageCount.status, "match");
  assert.equal(result.listings[0].publicListing.fieldAvailability.categories, "not_captured");
  assert.equal(calls, 2);
  assert.equal(browser.closed, true);
});

test("public audit does not attribute a different or unverified ASIN to the D1 book", async () => {
  const browser = fakeBrowser({ asin: "B0OTHER123", title: "Different book", pageCount: 42 });
  const result = await auditPublicCatalogue([books[0]], { delayMs: 0, browserFactory: async () => browser, fetchPage: async () => ({ status: "fetched", html: "x" }) });
  assert.equal(result.listings[0].publicListing.status, "identity_unverified");
  assert.equal(result.listings[0].publicListing.data, null);
  assert.equal(result.listings[0].comparisons, null);
});

test("public URL rejects invalid ASINs and redirects outside the marketplace", async () => {
  assert.equal(productUrl("A25YKUAYB2XJF"), null);
  assert.equal(productUrl("B0DQHSD858", "UK"), "https://www.amazon.co.uk/dp/B0DQHSD858");
  let calls = 0;
  const result = await fetchProductPage(productUrl(books[0].asin), { fetchImpl: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/private" } });
  } });
  assert.equal(result.status, "redirect_rejected");
  assert.equal(calls, 1);
});

test("unavailable values do not produce mismatch findings", () => {
  const comparison = compareListing(books[0], { title: "Book One", author: "", pageCount: null });
  assert.equal(comparison.title.status, "match");
  assert.equal(comparison.author.status, "not_captured");
  assert.equal(comparison.pageCount.status, "not_captured");
});

test("public fetch detects challenges and oversized pages", async () => {
  const url = productUrl(books[0].asin);
  const blocked = await fetchProductPage(url, {
    fetchImpl: async () => new Response("<html>validateCaptcha</html>", { status: 200 }),
  });
  assert.equal(blocked.status, "blocked");
  await assert.rejects(() => fetchProductPage(url, {
    fetchImpl: async () => new Response("x", { status: 200, headers: { "content-length": "6000000" } }),
  }), /page_too_large/);
});

test("browser startup failures still report every catalogue entry", async () => {
  const result = await auditPublicCatalogue(books, { browserFactory: async () => { throw new Error("no browser"); } });
  assert.equal(result.catalogueBooks, 2);
  assert.deepEqual(result.statusCounts, { parser_unavailable: 2 });
  assert.equal(result.listings[0].catalogue.pageCount, 227);
});
