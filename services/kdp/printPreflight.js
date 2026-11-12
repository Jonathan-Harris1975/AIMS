// A catalogue preflight is deliberately read-only. It does not create KDP titles,
// reuse Kindle ASINs as print identifiers, or assert that an interior has passed QA.
export const PRINT_FORMATS = Object.freeze({
  paperback: { minimumPages: 24 },
  hardcover: { minimumPages: 75, maximumPages: 550 },
});
export const PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT = 10;
// Target three existing-catalogue titles per format Mon-Wed; the default weekly cap leaves one for Thu.
export const PRINT_DAILY_TARGET_TITLES = 3;
export const PRINT_ROLLOUT_WEEKDAYS = Object.freeze(["monday", "tuesday", "wednesday", "thursday"]);

export function buildPrintPreflight(books, { observedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(books)) throw new TypeError("KDP catalogue must be an array.");
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
      dailyTargetTitles: PRINT_DAILY_TARGET_TITLES,
      rolloutWeekdays: PRINT_ROLLOUT_WEEKDAYS,
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

/**
 * Return planning capacity, not permission to publish. Amazon currently documents
 * a 10-title weekly creation limit per format. Only an independently authorised
 * higher allowance should be configured by KDP_PRINT_WEEKLY_LIMIT_PER_FORMAT.
 *
 * KDP resets weekly quotas at Sunday 00:00 UTC. MAST is the sole run clock and
 * schedules these slots on Monday–Thursday in Europe/London.
 */
export function getPrintRolloutCapacity({
  observedAt = new Date().toISOString(),
  weeklyLimit = PRINT_KDP_WEEKLY_LIMIT_PER_FORMAT,
} = {}) {
  if (!Number.isInteger(weeklyLimit) || weeklyLimit < 1 || weeklyLimit > 100) {
    throw new RangeError("Print weekly limit must be an integer between 1 and 100.");
  }
  const when = new Date(observedAt);
  if (!Number.isFinite(when.getTime())) throw new TypeError("Invalid print rollout observedAt.");
  const weekday = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long",
  }).format(when).toLowerCase();
  const dayIndex = PRINT_ROLLOUT_WEEKDAYS.indexOf(weekday);
  const alreadyAllocated = dayIndex === -1 ? 0 : Math.min(weeklyLimit, dayIndex * PRINT_DAILY_TARGET_TITLES);
  const slotsPerFormat = dayIndex === -1
    ? 0 : Math.min(PRINT_DAILY_TARGET_TITLES, Math.max(0, weeklyLimit - alreadyAllocated));
  // The baseline allowance means three slots Mon/Tue/Wed, one Thu. At a
  // documented account-specific 12/week allowance this becomes 3 each day.
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
    fridayReservedForNewBooks: true,
    // Creation and first submission are independently metered by KDP;
    // actual usage must be reconciled before any live write.
    requiresLiveQuotaReconciliation: true,
    authorisesKdpWrites: false,
  };
}
