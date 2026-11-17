import test from "node:test";
import assert from "node:assert/strict";
import { buildPrintPreflight, getPrintRolloutCapacity, parsePrintWeeklyLimit } from "../services/kdp/printPreflight.js";

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
    assert.equal(report.byFormat[format].weeklyCreationCap, 2);
    assert.equal(report.byFormat[format].weeklyFirstSubmissionCap, 2);
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

test("print rollout capacity never exceeds two new titles per format per UTC week", () => {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
  // A read-only Monday plan does not create a book or spend weekly quota.
  const expected = [2, 2, 2, 2, 0];
  for (let i = 0; i < dates.length; i++) {
    const plan = getPrintRolloutCapacity({ observedAt: dates[i] + "T17:10:00Z" });
    assert.equal(plan.scheduledSlotsPerFormatToday, expected[i]);
    assert.equal(plan.scheduledSlotsTodayTotal, expected[i] * 2);
    assert.equal(plan.authorisesKdpWrites, false);
    assert.equal(plan.scheduledSlotsAreUnreconciledUpperBounds, true);
  }
});

test("configuration cannot raise the official two-title weekly limit", () => {
  assert.equal(parsePrintWeeklyLimit("2"), 2);
  for (const value of [undefined, "", "12", "10", "0", "101", "abc"]) {
    assert.equal(parsePrintWeeklyLimit(value), 2);
  }
  assert.throws(() => getPrintRolloutCapacity({ weeklyLimit: 12 }), /weekly limit/);
});

test("R2-backed preflight blocks a missing private source object instead of claiming it is ready", () => {
  const first = book(1, 240);
  const seventh = book(7, 185);
  const presentKeys = new Set([first.manuscriptR2Key]);
  const report = buildPrintPreflight([first, seventh], { existingSourceKeys: presentKeys });
  assert.equal(report.sourceObjectExistenceChecked, true);
  assert.equal(report.missingSourceObjects, 1);
  assert.equal(report.kdpWritesPerformed, false);
  for (const format of ["paperback", "hardcover"]) {
    const valid = report.records.find((r) => r.ebookId === 1 && r.format === format);
    const missing = report.records.find((r) => r.ebookId === 7 && r.format === format);
    assert.equal(valid.sourcePdfPresent, true);
    assert.equal(valid.state, "source_pdf_review_required");
    assert.equal(missing.sourcePdfPresent, false);
    assert.equal(missing.state, "catalogue_blocked");
    assert.ok(missing.blockers.includes("missing_private_source_pdf_object"));
    assert.deepEqual(report.byFormat[format].preparationQueue, [1]);
  }
});

test("missing source inventory is explicitly unverified, not silently treated as a verified R2 listing", () => {
  const report = buildPrintPreflight([book(1)]);
  assert.equal(report.sourceObjectExistenceChecked, false);
  assert.equal(report.missingSourceObjects, null);
  assert.equal(report.records[0].sourcePdfPresent, null);
  assert.throws(() => buildPrintPreflight([book(1)], { existingSourceKeys: [] }), /Set/);
});
