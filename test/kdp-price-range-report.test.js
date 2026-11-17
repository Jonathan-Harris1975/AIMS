import test from "node:test";
import assert from "node:assert/strict";
import { previewKdpFormatPriceRanges } from "../services/kdp/priceRangeReport.js";

const asin = "B0ABCDE123";
const catalogue = async () => [{ ebookId: 12, asin, title: "AI for Business", pageCount: 300 }];
const snapshot = async () => ({ syncedAt: new Date().toISOString(), books: [{
  format: "kindle", asin, titleId: "ABC123456789", royaltyPlan: "70_PERCENT",
  fileSizeKb: "313", prices: { GBP: "5.99" },
}] });

test("per-book report explains true Kindle size and provisional print page-count ranges", async () => {
  const report = await previewKdpFormatPriceRanges({ catalogue, snapshot });
  assert.equal(report.ok, true);
  assert.equal(report.readOnly, true);
  assert.equal(report.kdpWritesPerformed, false);
  assert.equal(report.catalogueCount, 1);
  const row = report.rows[0];
  assert.equal(row.kindle.status, "calculated_verified_70_percent");
  assert.equal(row.kindle.GBP.minimum, "6.99");
  assert.equal(row.kindle.GBP.maximum, "7.99");
  assert.equal(row.kindle.fileSizeKb, 313);
  assert.equal(row.kindle.observedSignedInPriceGBP, "5.99");
  assert.ok(row.kindle.GBP.explanation.includes("313 KB"));
  assert.equal(row.paperback.GBP.minimum, "15.99");
  assert.equal(row.paperback.GBP.maximum, "19.99");
  assert.equal(row.hardcover.GBP.minimum, "21.99");
  assert.equal(row.hardcover.GBP.maximum, "26.99");
  assert.equal(row.paperback.status, "catalogue_page_count_estimate_only");
  assert.equal(row.hardcover.finalPdfVerificationRequired, true);
  assert.ok(row.paperback.GBP.estimatedRoyaltyAtMinimum >= 4.50);
});

test("unknown signed-in royalty plan remains unverified, not presumed safe", async () => {
  const report = await previewKdpFormatPriceRanges({
    catalogue, snapshot: async () => ({ syncedAt: new Date().toISOString(),
      books: [{ format: "kindle", asin, fileSizeKb: "464", royaltyPlan: "" }] }),
  });
  assert.equal(report.rows[0].kindle.status, "awaiting_signed_in_70_percent_confirmation");
  assert.equal(report.rows[0].kindle.GBP.maximum, "10.99");
  assert.equal(report.rows[0].kindle.verified70PercentPlan, false);
});

test("missing metadata and unknown print pagination fail closed", async () => {
  const report = await previewKdpFormatPriceRanges({
    catalogue: async () => [{ ebookId: 12, asin, title: "AI for Business", pageCount: null }],
    snapshot: async () => ({ syncedAt: new Date().toISOString(), books: [] }),
  });
  assert.equal(report.rows[0].kindle.GBP, null);
  assert.equal(report.rows[0].kindle.status, "missing_signed_in_kdp_metadata");
  assert.equal(report.rows[0].paperback.status, "page_count_unavailable");
});

test("duplicate signed-in ASIN blocks an untrustworthy report", async () => {
  await assert.rejects(
    () => previewKdpFormatPriceRanges({
      catalogue, snapshot: async () => ({ syncedAt: new Date().toISOString(),
        books: [{ asin, format: "kindle" }, { asin, format: "kindle" }] }),
    }),
    /duplicated signed-in Kindle ASIN/,
  );
});
