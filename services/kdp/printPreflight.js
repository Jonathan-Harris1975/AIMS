// A catalogue preflight is deliberately read-only. It does not create KDP titles,
// reuse Kindle ASINs as print identifiers, or assert that an interior has passed QA.
export const PRINT_FORMATS = Object.freeze({
  paperback: { minimumPages: 24 },
  hardcover: { minimumPages: 75, maximumPages: 550 },
});
export const PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT = 2;

export function buildPrintPreflight(books, { observedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(books)) throw new TypeError("KDP catalogue must be an array.");
  const ids = new Set();
  const asins = new Set();
  const records = [];
  for (const book of books) {
    const ebookId = Number(book?.ebookId);
    if (!Number.isSafeInteger(ebookId) || ebookId < 1 || ids.has(ebookId)) {
      throw new Error("KDP catalogue contains an invalid or duplicate ebookId.");
    }
    ids.add(ebookId);
    const asin = String(book.asin || "").trim().toUpperCase();
    const duplicateAsin = !!asin && asins.has(asin);
    if (asin) asins.add(asin);
    const pages = Number.isSafeInteger(book.pageCount) && book.pageCount > 0 ? book.pageCount : null;
    const manuscriptRefValid = book.storageBucket === "kdp"
      && book.manuscriptFormat === "PDF"
      && String(book.manuscriptR2Key || "").startsWith("Manuscripts pdf format/")
      && String(book.manuscriptR2Key || "").toLowerCase().endsWith(".pdf");
    for (const [format, limits] of Object.entries(PRINT_FORMATS)) {
      const blockers = [];
      if (!String(book.title || "").trim() || !String(book.author || "").trim()) blockers.push("missing_title_or_author");
      if (!asin || duplicateAsin) blockers.push(duplicateAsin ? "duplicate_kindle_asin" : "missing_kindle_asin");
      if (!manuscriptRefValid) blockers.push("missing_private_source_pdf");
      if (pages === null) blockers.push("unverified_catalogue_page_count");
      else if (pages < limits.minimumPages) blockers.push("catalogue_page_count_below_print_minimum");
      else if (limits.maximumPages && pages > limits.maximumPages) blockers.push("catalogue_page_count_above_print_maximum");
      records.push({
        ebookId, slug: String(book.slug || ""), title: String(book.title || ""),
        kindleAsin: asin, format, cataloguePages: pages,
        state: blockers.length ? "catalogue_blocked" : "source_pdf_review_required",
        blockers,
        // Print layout, cover QA, rights, distinct ISBN and actual KDP costs still need verification.
        requires: ["source_pdf_page_count", "print_interior_qa", "wraparound_cover_qa", "distinct_print_isbn", "print_royalty_check", "kdp_live_verification"],
      });
    }
  }
  const byFormat = Object.fromEntries(Object.keys(PRINT_FORMATS).map((format) => {
    const items = records.filter((record) => record.format === format);
    return [format, {
      total: items.length,
      catalogueBlocked: items.filter((item) => item.state === "catalogue_blocked").length,
      sourceReviewRequired: items.filter((item) => item.state === "source_pdf_review_required").length,
      weeklyCreationCap: PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT,
      weeklyFirstSubmissionCap: PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT,
      // This is a preparation queue, not authorisation to create or submit to KDP.
      preparationQueue: items.filter((item) => item.state === "source_pdf_review_required").map((item) => item.ebookId),
    }];
  }));
  return {
    ok: true, schemaVersion: "kdp-print-preflight/v1", observedAt,
    catalogueCount: books.length, editionCount: records.length,
    byFormat, records, kdpWritesPerformed: false,
    message: "Preparation-only inventory. Catalogue page counts are not verified PDF print counts. No KDP title creation or publishing is authorised by this report.",
  };
}
