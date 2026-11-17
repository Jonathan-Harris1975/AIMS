// A catalogue preflight is deliberately read-only. It does not create KDP titles,
// reuse Kindle ASINs as print identifiers, or assert that an interior has passed QA.
export const PRINT_FORMATS = Object.freeze({
  paperback: { minimumPages: 24 },
  hardcover: { minimumPages: 76, maximumPages: 550 },
});
export const PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT = 2;
// KDP permits only two new titles created and two first submissions per format per UTC week.
export const PRINT_DAILY_TARGET_TITLES = 2;
export const PRINT_ROLLOUT_WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday"]);

export function parsePrintWeeklyLimit(configuredLimit) {
  const normalized = typeof configuredLimit === "string" ? configuredLimit.trim() : "";
  if (!/^\d+$/.test(normalized)) return PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT
    ? parsed : PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT;
}

export function buildPrintPreflight(books, {
  observedAt = new Date().toISOString(),
  existingSourceKeys = null,
  sourcePdfInspections = null,
} = {}) {
  if (!Array.isArray(books)) throw new TypeError("KDP catalogue must be an array.");
  if (existingSourceKeys !== null && !(existingSourceKeys instanceof Set)) {
    throw new TypeError("existingSourceKeys must be a Set populated from private KDP R2.");
  }
  if (sourcePdfInspections !== null && !(sourcePdfInspections instanceof Map)) {
    throw new TypeError("sourcePdfInspections must be a Map of source PDF inspection results.");
  }
  const ids = new Set();
  const asinCounts = new Map();
  for (const book of books) {
    const asin = String(book?.asin || "").trim().toUpperCase();
    if (asin) asinCounts.set(asin, (asinCounts.get(asin) || 0) + 1);
  }
  const records = [];
  for (const book of books) {
    const ebookId = Number(book?.ebookId);
    if (!Number.isSafeInteger(ebookId) || ebookId < 1 || ids.has(ebookId)) {
      throw new Error("KDP catalogue contains an invalid or duplicate ebookId.");
    }
    ids.add(ebookId);
    const asin = String(book.asin || "").trim().toUpperCase();
    const duplicateAsin = !!asin && asinCounts.get(asin) > 1;
    const cataloguePages = Number.isSafeInteger(book.pageCount) && book.pageCount > 0 ? book.pageCount : null;
    const sourcePdf = sourcePdfInspections?.get(ebookId) ?? null;
    const pages = sourcePdf?.ok ? sourcePdf.observedPageCount : cataloguePages;
    const manuscriptRefValid = book.storageBucket === "kdp"
      && book.manuscriptFormat === "PDF"
      && String(book.manuscriptR2Key || "").startsWith("Manuscripts pdf format/")
      && String(book.manuscriptR2Key || "").toLowerCase().endsWith(".pdf");
    // An R2 key with a valid shape is not proof that the private source exists.
    // When the runtime supplies its authoritative object inventory, missing PDFs
    // block preparation rather than failing later in the KDP browser wizard.
    const sourcePdfPresent = existingSourceKeys === null
      ? null : manuscriptRefValid && existingSourceKeys.has(book.manuscriptR2Key);
    for (const [format, limits] of Object.entries(PRINT_FORMATS)) {
      const blockers = [];
      if (!String(book.title || "").trim() || !String(book.author || "").trim()) blockers.push("missing_title_or_author");
      if (!asin || duplicateAsin) blockers.push(duplicateAsin ? "duplicate_kindle_asin" : "missing_kindle_asin");
      if (!manuscriptRefValid) blockers.push("missing_private_source_pdf");
      else if (sourcePdfPresent === false) blockers.push("missing_private_source_pdf_object");
      if (sourcePdfInspections !== null && sourcePdf?.ok !== true) blockers.push("source_pdf_inspection_missing_or_failed");
      if (sourcePdf?.ok && sourcePdf.requiresReflow) blockers.push("source_pdf_requires_print_reflow");
      if (pages === null) blockers.push("unverified_catalogue_page_count");
      else if (pages < limits.minimumPages) blockers.push("catalogue_page_count_below_print_minimum");
      else if (limits.maximumPages && pages > limits.maximumPages) blockers.push("catalogue_page_count_above_print_maximum");
      records.push({
        ebookId, slug: String(book.slug || ""), title: String(book.title || ""),
        kindleAsin: asin, format, cataloguePages,
        sourcePdfPagesObserved: sourcePdf?.ok ? sourcePdf.observedPageCount : null,
        sourcePdfPageWidthPt: sourcePdf?.ok ? sourcePdf.pageWidthPt : null,
        sourcePdfPageHeightPt: sourcePdf?.ok ? sourcePdf.pageHeightPt : null,
        sourcePdfRequiresReflow: sourcePdf?.ok ? sourcePdf.requiresReflow : null,
        cataloguePdfPageMismatch: sourcePdf?.ok ? cataloguePages !== sourcePdf.observedPageCount : null,
        sourcePdfPresent,
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
      dailyTargetTitles: PRINT_DAILY_TARGET_TITLES,
      rolloutWeekdays: PRINT_ROLLOUT_WEEKDAYS,
      // This is a preparation queue, not authorisation to create or submit to KDP.
      preparationQueue: items.filter((item) => item.state === "source_pdf_review_required").map((item) => item.ebookId),
    }];
  }));
  return {
    ok: true, schemaVersion: "kdp-print-preflight/v1", observedAt,
    catalogueCount: books.length, editionCount: records.length,
    sourceObjectExistenceChecked: existingSourceKeys !== null,
    sourcePdfGeometryInspected: sourcePdfInspections !== null,
    sourcePdfReflowRequired: sourcePdfInspections === null ? null :
      new Set(records.filter((r) => r.sourcePdfRequiresReflow).map((r) => r.ebookId)).size,
    sourcePdfCataloguePageMismatches: sourcePdfInspections === null ? null :
      new Set(records.filter((r) => r.cataloguePdfPageMismatch).map((r) => r.ebookId)).size,
    missingSourceObjects: existingSourceKeys === null ? null
      : new Set(records.filter((r) => r.sourcePdfPresent === false).map((r) => r.ebookId)).size,
    byFormat, records, kdpWritesPerformed: false,
    message: "Preparation-only inventory. Observed PDF geometry is not final print QA. " +
      "Non-6x9 PDFs need proper reflow. KDP title creation and publishing remain unauthorised.",
  };
}

/**
 * Return planning capacity, not permission to publish. Amazon currently documents
 * a two-title weekly creation and first-submission limit per format.
 * Configuration must never raise this cap.
 *
 * KDP resets weekly quotas at Sunday 00:00 UTC. MAST is the sole run clock and
 * schedules these slots on Monday–Thursday in Europe/London.
 */
export function getPrintRolloutCapacity({
  observedAt = new Date().toISOString(),
  weeklyLimit = PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT,
} = {}) {
  if (!Number.isInteger(weeklyLimit) || weeklyLimit < 1 || weeklyLimit > PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT) {
    throw new RangeError("Print weekly limit must be an integer between 1 and the official per-format maximum.");
  }
  const when = new Date(observedAt);
  if (!Number.isFinite(when.getTime())) throw new TypeError("Invalid print rollout observedAt.");
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long",
  }).format(when).toLowerCase();
  const dayIndex = PRINT_ROLLOUT_WEEKDAYS.indexOf(weekday);
  // A scheduled read-only plan does NOT consume a KDP creation or submission
  // slot. Never decrement Tuesday–Thursday capacity based on Monday's plan;
  // only exact signed-in KDP reconciliation and durable writes determine usage.
  const slotsPerFormat = dayIndex === -1 ? 0 : Math.min(PRINT_DAILY_TARGET_TITLES, weeklyLimit);
  // Date.UTC normalises negative days across month boundaries as intended.
  const sundayUtc = new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate() - when.getUTCDay()));
  return {
    observedAt: when.toISOString(), localWeekday: weekday,
    quotaResetsAt: "Sunday 00:00 UTC", quotaWeekStartUtc: sundayUtc.toISOString(),
    dailyTargetTitles: PRINT_DAILY_TARGET_TITLES,
    weeklyLimitPerFormat: weeklyLimit,
    scheduledWeekdays: PRINT_ROLLOUT_WEEKDAYS,
    scheduledSlotsPerFormatToday: slotsPerFormat,
    scheduledSlotsTodayTotal: slotsPerFormat * Object.keys(PRINT_FORMATS).length,
    scheduledSlotsAreUnreconciledUpperBounds: true,
    fridayReservedForNewBooks: true,
    // Creation and first submission are independently metered by KDP;
    // actual usage must be reconciled before any live write.
    requiresLiveQuotaReconciliation: true,
    authorisesKdpWrites: false,
  };
}
