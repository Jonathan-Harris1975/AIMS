import test from "node:test";
import assert from "node:assert/strict";
import { getBookSalesEvidence } from "../services/podcast-growth/bookSalesEvidence.js";

test("book ROI evidence is explicitly unavailable without real KDP royalty reports", async () => {
  const result = await getBookSalesEvidence({ list: async (bucket, prefix) => {
    assert.equal(bucket, "kdp");
    assert.equal(prefix, "reports/royalties/");
    return [];
  } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.workbookCount, 0);
  assert.equal(result.royaltiesGBP, null);
  assert.equal(result.soldUnits, null);
  assert.equal(result.attributableBookSales, null);
});

test("presence of an authenticated KDP workbook is not mistaken for confirmed income", async () => {
  const result = await getBookSalesEvidence({
    list: async () => [{ key: "reports/royalties/kdp-royalties-example.xlsx", lastModified: "2026-11-17T11:00:00Z" }],
    readText: async (bucket, key) => {
      assert.equal(bucket, "kdp");
      assert.match(key, /\.xlsx\.json$/);
      return JSON.stringify({ startDate: "2026-10-01", endDate: "2026-10-31", createdAt: "2026-11-17" });
    },
  });
  assert.equal(result.status, "workbook-present");
  assert.equal(result.workbookCount, 1);
  assert.equal(result.latest.metadata.startDate, "2026-10-01");
  assert.equal(result.royaltiesGBP, null);
  assert.equal(result.attributableBookSales, null);
});

test("KDP R2 failure fails evidence collection closed without impacting other services", async () => {
  const result = await getBookSalesEvidence({ list: async () => { throw new Error("storage offline"); } });
  assert.equal(result.status, "unavailable");
  assert.equal(result.workbookCount, null);
  assert.equal(result.royaltiesGBP, null);
});
