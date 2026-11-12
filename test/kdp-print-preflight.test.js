import test from "node:test";
import assert from "node:assert/strict";
import { buildPrintPreflight, getPrintRolloutCapacity } from "../services/kdp/printPreflight.js";

const book = (ebookId, pageCount = 200) => ({
  ebookId, slug: "book-" + ebookId, title: "Book " + ebookId, author: "Author",
  asin: "B0" + String(ebookId).padStart(8, "0"), pageCount,
  storageBucket: "kdp", manuscriptFormat: "PDF",
  manuscriptR2Key: "Manuscripts pdf format/book-" + ebookId + ".pdf",
});

test("40 titles create 80 preparation-only edition records, no live claims", () => {
  const report = buildPrintPreflight(Array.from({ length: 40 }, (_, i) => book(i + 1)));
  assert.equal(report.catalogueCount, 40);
  assert.equal(report.editionCount, 80);
  assert.equal(report.kdpWritesPerformed, false);
  for (const format of ["paperback", "hardcover"]) {
    assert.equal(report.byFormat[format].total, 40);
    assert.equal(report.byFormat[format].weeklyCreationCap, 10);
    assert.equal(report.byFormat[format].weeklyFirstSubmissionCap, 10);
    assert.equal(report.byFormat[format].sourceReviewRequired, 40);
  }
  assert.ok(report.records.every((x) => x.state === "source_pdf_review_required"));
});

test("14-page ebook cannot be admitted to paperback or hardback production", () => {
  const report = buildPrintPreflight([book(7, 14)]);
  assert.ok(report.records.every((r) => r.state === "catalogue_blocked"));
  assert.ok(report.records.every((r) => r.blockers.includes("catalogue_page_count_below_print_minimum")));
});

test("paperback can pass catalogue range while hardcover is blocked", () => {
  const report = buildPrintPreflight([book(1, 50)]);
  assert.equal(report.records.find((r) => r.format === "paperback").state, "source_pdf_review_required");
  assert.equal(report.records.find((r) => r.format === "hardcover").state, "catalogue_blocked");
});

test("private source and distinct Kindle identity are prerequisites", () => {
  const invalid = { ...book(2), manuscriptR2Key: "public.pdf" };
  const report = buildPrintPreflight([book(1), invalid]);
  assert.ok(report.records.filter((r) => r.ebookId === 2).every((r) => r.blockers.includes("missing_private_source_pdf")));
  assert.throws(() => buildPrintPreflight([book(1), book(1)]), /duplicate ebookId/);
});

test("every record sharing a normalized Kindle ASIN is blocked from preparation", () => {
  const first = book(1);
  const second = { ...book(2), asin: " " + first.asin.toLowerCase() + " " };
  const report = buildPrintPreflight([first, second]);

  assert.ok(report.records.every((record) => record.state === "catalogue_blocked"));
  assert.ok(report.records.every((record) => record.blockers.includes("duplicate_kindle_asin")));
  for (const format of ["paperback", "hardcover"]) {
    assert.deepEqual(report.byFormat[format].preparationQueue, []);
    assert.equal(report.byFormat[format].sourceReviewRequired, 0);
  }
});

test("print rollout capacity is three per weekday until the weekly ten-per-format cap", () => {
  const dates = [
    "2026-11-16", // Monday
    "2026-11-17", // Tuesday
    "2026-11-18", // Wednesday
    "2026-11-19", // Thursday
    "2026-11-20", // Friday
    "2026-11-21", // Saturday
    "2026-11-22", // Sunday
  ];
  const expected = [3, 3, 3, 1, 0, 0, 0];
  for (let i = 0; i < dates.length; i++) {
    const plan = getPrintRolloutCapacity({ observedAt: dates[i] + "T17:10:00Z" });
    assert.equal(plan.scheduledSlotsPerFormatToday, expected[i], dates[i]);
    assert.equal(plan.scheduledSlotsTodayTotal, expected[i] * 2);
    assert.equal(plan.authorisesKdpWrites, false);
    assert.equal(plan.fridayReservedForNewBooks, true);
  }
});
test("only a configured higher cap opens all three Thursday slots", () => {
  const thursday = "2026-11-19T17:10:00Z";
  assert.equal(getPrintRolloutCapacity({ observedAt: thursday }).scheduledSlotsPerFormatToday, 1);
  assert.equal(getPrintRolloutCapacity({ observedAt: thursday, weeklyLimit: 12 }).scheduledSlotsPerFormatToday, 3);
  assert.throws(() => getPrintRolloutCapacity({ observedAt: thursday, weeklyLimit: 0 }), /weekly limit/);
  assert.throws(() => getPrintRolloutCapacity({ observedAt: thursday, weeklyLimit: 12.5 }), /weekly limit/);
});
