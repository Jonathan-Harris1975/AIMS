import test from "node:test";
import assert from "node:assert/strict";
import { inspectPrintSourcePdf } from "../services/kdp/printSourceAudit.js";
import { buildPrintPreflight } from "../services/kdp/printPreflight.js";

function reportlabLikePdf(pages, widthPt, heightPt) {
  const page = `1 0 obj << /Type /Page /MediaBox [ 0 0 ${widthPt} ${heightPt} ] >> endobj\n`;
  return Buffer.from(`%PDF-1.4\n% Synthetic test PDF, not publication material.\n${page.repeat(pages)}%%EOF\n`);
}

const book = (ebookId, pageCount) => ({
  ebookId, slug: `book-${ebookId}`, title: `Book ${ebookId}`, author: "Author",
  asin: "B0" + String(ebookId).padStart(8, "0"),
  pageCount, storageBucket: "kdp", manuscriptFormat: "PDF",
  manuscriptR2Key: `Manuscripts pdf format/book-${ebookId}.pdf`,
});

test("the source inspector extracts 6x9 page geometry and actual count, but never passes final print QA", () => {
  const report = inspectPrintSourcePdf(reportlabLikePdf(100, 432, 648));
  assert.equal(report.ok, true);
  assert.equal(report.observedPageCount, 100);
  assert.equal(report.geometryMatchesTarget, true);
  assert.equal(report.requiresReflow, false);
  assert.equal(report.printQaPassed, false);
});

test("A4 is explicitly a reflow candidate, not a print-ready 6x9 interior", () => {
  const report = inspectPrintSourcePdf(reportlabLikePdf(100, 595.2756, 841.8898));
  assert.equal(report.ok, true);
  assert.equal(report.requiresReflow, true);
  assert.equal(report.pageWidthPt, 595.28);
  assert.equal(report.pageHeightPt, 841.89);
});

test("untrusted, encrypted, malformed or inconsistent PDF structures fail closed", () => {
  assert.equal(inspectPrintSourcePdf(Buffer.from("hello")).ok, false);
  assert.equal(inspectPrintSourcePdf(Buffer.from("%PDF-1.4\n/Encrypt\n".repeat(10) + "%%EOF")).ok, false);
  const mixed = Buffer.from("%PDF-1.4\n".repeat(5) +
    "/Type /Page /MediaBox [ 0 0 432 648 ]\n" +
    "/Type /Page /MediaBox [ 0 0 595 842 ]\n%%EOF");
  assert.equal(inspectPrintSourcePdf(mixed).reason, "mixed_page_sizes");
});

test("R2 PDF evidence blocks A4 source and uses observed pages without altering catalogue pages", () => {
  const one = book(1, 240);
  const two = book(2, 185);
  const sourcePdfInspections = new Map([
    [1, inspectPrintSourcePdf(reportlabLikePdf(153, 595.2756, 841.8898))],
    [2, inspectPrintSourcePdf(reportlabLikePdf(178, 432, 648))],
  ]);
  const report = buildPrintPreflight([one, two], {
    existingSourceKeys: new Set([one.manuscriptR2Key, two.manuscriptR2Key]),
    sourcePdfInspections,
  });
  assert.equal(report.kdpWritesPerformed, false);
  assert.equal(report.sourcePdfGeometryInspected, true);
  assert.equal(report.sourcePdfReflowRequired, 1);
  assert.equal(report.sourcePdfCataloguePageMismatches, 2);
  for (const format of ["paperback", "hardcover"]) {
    assert.equal(report.records.find((record) => record.ebookId === 1 &&
      record.format === format).blockers.includes("source_pdf_requires_print_reflow"), true);
    assert.equal(report.records.find((record) => record.ebookId === 2 &&
      record.format === format).state, "source_pdf_review_required");
    assert.deepEqual(report.byFormat[format].preparationQueue, [2]);
    assert.equal(report.records.find((record) => record.ebookId === 2 &&
      record.format === format).sourcePdfPagesObserved, 178);
  }
});

test("missing source inspection cannot be promoted into print preparation", () => {
  const one = book(1, 200);
  const report = buildPrintPreflight([one], {
    existingSourceKeys: new Set([one.manuscriptR2Key]), sourcePdfInspections: new Map(),
  });
  assert.equal(report.byFormat.paperback.sourceReviewRequired, 0);
  assert.equal(report.byFormat.hardcover.sourceReviewRequired, 0);
  assert.ok(report.records.every((r) => r.blockers.includes("source_pdf_inspection_missing_or_failed")));
});
