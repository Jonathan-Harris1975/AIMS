import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrintPrice, KDP_PRINT_PRICING_POLICY_VERSION } from "../services/kdp/printPricePolicy.js";
import { planPublishedPrintPrice, reconcilePrintPricing } from "../services/kdp/printPricingRollout.js";

const book = { ebookId: 12, title: "AI for Business", author: "Author", asin: "B0ABCDE123",
  manuscriptR2Key: "Manuscripts pdf format/ai-for-business.pdf" };
const job = { ebookId: 12, format: "paperback", state: "live_verified",
  titleId: "ABC123456789", isbn: "9781234567897",
  manifestKey: "print/assets/12/paperback/manifest.json" };
const manifest = { schemaVersion: 1, ebookId: 12, format: "paperback",
  title: book.title, finalPageCount: 300, sourceR2Key: book.manuscriptR2Key };
const signedIn = { titleId: job.titleId, format: "paperback", title: book.title,
  isbn: job.isbn, asin: "123456789X", publishingStatus: "Live",
  prices: { GBP: "11.99", USD: "14.99" } };

test("six-by-nine print price policy preserves the direct-sale floor with sensible .99 retail and 10% headroom", () => {
  const paperback = calculatePrintPrice("paperback", 300, "GBP");
  const hardcover = calculatePrintPrice("hardcover", 300, "GBP");
  assert.equal(paperback.price, "15.99");
  assert.equal(hardcover.price, "21.99");
  assert.equal(paperback.estimatedRoyalty, 5.74);
  assert.equal(hardcover.estimatedRoyalty, 6.04);
  assert.equal(paperback.minimumPrice, "15.99");
  assert.equal(paperback.maximumPrice, "19.99");
  assert.equal(hardcover.minimumPrice, "21.99");
  assert.equal(hardcover.maximumPrice, "26.99");
  assert.match(hardcover.priceRationale, /300 final PDF pages/);
  assert.ok(paperback.estimatedRoyalty >= 4.50);
  assert.ok(hardcover.estimatedRoyalty >= 4.50);
  assert.equal(paperback.sensibleRetailCeiling, 19.99);
  assert.equal(hardcover.sensibleRetailCeiling, 27.99);
  for (const pages of [185, 200, 300, 393]) {
    for (const format of ["paperback", "hardcover"]) {
      for (const market of ["GBP", "USD"]) {
        const entry = calculatePrintPrice(format, pages, market);
        assert.ok(entry.price.endsWith(".99"));
        assert.ok(Number(entry.price) <= entry.sensibleRetailCeiling);
        assert.ok(Number(entry.maximumPrice) >= Number(entry.minimumPrice));
        assert.ok(Number(entry.maximumPrice) <= entry.sensibleRetailCeiling);
        assert.ok(entry.estimatedRoyaltyAtMaximum >= entry.estimatedRoyalty);
        assert.match(entry.priceRationale, new RegExp(String(pages) + " final PDF pages"));
        assert.ok(entry.estimatedRoyalty >= (market === "GBP" ? 4.50 : 6));
        assert.equal(entry.pricingPolicyVersion, KDP_PRINT_PRICING_POLICY_VERSION);
      }
    }
  }
  assert.throws(() => calculatePrintPrice("paperback", 828, "GBP"), /sensible retail ceiling/);
});

test("print repricer raises insufficient prices and reduces prices only beyond retail ceilings", () => {
  const plan = planPublishedPrintPrice(book, job, manifest, signedIn);
  assert.deepEqual(plan.changes, { GBP: "15.99", USD: "19.99" });
  assert.deepEqual(plan.observedPrices, { GBP: "11.99", USD: "14.99" });
  assert.deepEqual(plan.maximumPrices, { GBP: "19.99", USD: "23.99" });
  const healthy = planPublishedPrintPrice(book, job, manifest, {
    ...signedIn, prices: { GBP: "17.99", USD: "21.99" },
  });
  assert.deepEqual(healthy.changes, {});
  const over = planPublishedPrintPrice(book, job, manifest, {
    ...signedIn, prices: { GBP: "35.00", USD: "45.00" },
  });
  assert.deepEqual(over.changes, { GBP: "19.99", USD: "23.99" });
  assert.throws(() => planPublishedPrintPrice(book, job, manifest, {
    ...signedIn, isbn: "9781111111111" }), /identity/);
  assert.throws(() => planPublishedPrintPrice(book, job, {
    ...manifest, finalPageCount: 399, ebookId: 13 }, signedIn), /manifest/);
  assert.throws(() => planPublishedPrintPrice(book, job, manifest, {
    ...signedIn, prices: { GBP: "15.99" } }), /USD signed-in/);
});

function harness(overrides = {}) {
  const store = new Map();
  const published = [];
  let instant = new Date("2026-11-17T17:40:00Z");
  return {
    store, published,
    setNow: value => { instant = new Date(value); },
    run: options => reconcilePrintPricing({
      dryRun: false, now: () => instant,
      catalogue: async () => [book], jobs: async () => [job],
      load: async key => key === job.manifestKey ? manifest : store.get(key) || null,
      save: async (key, data) => { store.set(key, JSON.parse(JSON.stringify(data))); },
      sync: async () => signedIn,
      publish: async payload => { published.push(payload); return { published: true, errors: [] }; },
      claim: async () => ({ claimed: true, lease: { backend: "r2" } }),
      release: async () => {},
      ...overrides, ...options,
    }),
  };
}

test("dry-run inventories formats without browser work or publication", async () => {
  const dry = await reconcilePrintPricing({
    catalogue: async () => [book], jobs: async () => [job],
    sync: async () => { throw new Error("Must never sign in during dry-run"); },
  });
  assert.equal(dry.publishedPrintEditions, 1);
  assert.equal(dry.kdpWritesPerformed, false);
});

test("live repricer writes an intent before publishing; waits for verification and never resubmits", async () => {
  let signed = signedIn;
  const h = harness({ sync: async () => signed });
  const first = await h.run();
  assert.equal(first.ok, true);
  assert.equal(first.kdpWritesPerformed, true);
  assert.equal(h.published.length, 1);
  assert.deepEqual(h.published[0].pricing, { prices: { GBP: "15.99", USD: "19.99" } });
  assert.equal(h.store.get("pricing/print/ledger.json").entries["12:paperback"].status, "submitted");
  const second = await h.run();
  assert.equal(second.kdpWritesPerformed, false);
  assert.equal(h.published.length, 1);
  assert.equal(second.results[0].status, "awaiting_kdp_price_propagation");
  h.setNow("2026-11-23T18:00:00Z");
  signed = { ...signedIn, prices: { GBP: "15.99", USD: "19.99" } };
  const third = await h.run();
  assert.equal(third.results[0].status, "verified_signed_in");
  assert.equal(h.published.length, 1);
  assert.equal(h.store.get("pricing/print/ledger.json").entries["12:paperback"].retailPricePropagation,
    "not_independently_verified");
});

test("a KDP failed publish remains uncertain, reports failure and is never replayed", async () => {
  const h = harness({
    publish: async () => ({ published: false, errors: ["KDP publish not verified"] }),
  });
  const first = await h.run();
  assert.equal(first.ok, false);
  assert.equal(first.results[0].status, "submission_uncertain");
  h.setNow("2026-11-23T18:00:00Z");
  const second = await h.run();
  assert.equal(second.kdpWritesPerformed, false);
  assert.ok(["awaiting_signed_in_price", "needs_attention"].includes(second.results[0].status));
});

test("unverifiable print assets cannot trigger any KDP write", async () => {
  const h = harness({ load: async () => null });
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.equal(result.results[0].status, "blocked");
  assert.equal(h.published.length, 0);
});


test("different final page counts set different automatic print maximums", () => {
  const shorter = calculatePrintPrice("paperback", 185, "GBP");
  const longer = calculatePrintPrice("paperback", 300, "GBP");
  assert.equal(shorter.minimumPrice, "13.99");
  assert.equal(shorter.maximumPrice, "16.99");
  assert.equal(longer.maximumPrice, "19.99");
  assert.ok(Number(shorter.maximumPrice) < Number(longer.maximumPrice));
  const plan = planPublishedPrintPrice(book, job, { ...manifest, finalPageCount: 185 }, {
    ...signedIn, prices: { GBP: "18.99", USD: "25.99" },
  });
  assert.deepEqual(plan.changes, { GBP: "16.99", USD: "19.99" });
  assert.match(plan.priceExplanations.GBP, /185 final PDF pages/);
});
