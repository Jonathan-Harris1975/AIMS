// Read-only, per-title rationale for dynamic UK format-price ranges.
// Kindle numbers come from the signed-in KDP delivery-size snapshot.
// Print numbers are labelled PROVISIONAL until a final PDF manifest exists;
// live print repricing uses the independent manifest rather than these estimates.
import { listKdpEbooks } from "./catalogue.js";
import { readKdpMetadataSnapshot } from "./storage.js";
import { uk70RoyaltyPriceRange, parseKdpPriceMinorUnits } from "./engine/kdpPriceRules.ts";
import { calculatePrintPrice, KDP_PRINT_PRICING_POLICY_VERSION } from "./printPricePolicy.js";
import { currentKdpPrice } from "./metadataValues.js";

function estimatePrintRange(format, pageCount) {
  if (!Number.isSafeInteger(pageCount) || pageCount <= 0) {
    return { status: "page_count_unavailable", finalPdfVerificationRequired: true };
  }
  try {
    const uk = calculatePrintPrice(format, pageCount, "GBP");
    const us = calculatePrintPrice(format, pageCount, "USD");
    return {
      status: "catalogue_page_count_estimate_only",
      finalPdfVerificationRequired: true,
      recordedCataloguePageCount: pageCount,
      GBP: { minimum: uk.minimumPrice, maximum: uk.maximumPrice,
        estimatedRoyaltyAtMinimum: uk.estimatedRoyalty, printingCost: uk.printCost,
        basis: uk.priceRangeBasis, explanation: uk.priceRationale },
      USD: { minimum: us.minimumPrice, maximum: us.maximumPrice,
        estimatedRoyaltyAtMinimum: us.estimatedRoyalty, printingCost: us.printCost,
        basis: us.priceRangeBasis, explanation: us.priceRationale },
    };
  } catch (error) {
    return { status: "unsupported_print_page_count_or_cost", finalPdfVerificationRequired: true,
      recordedCataloguePageCount: pageCount, reason: String(error.message || error) };
  }
}

export async function previewKdpFormatPriceRanges({
  catalogue = listKdpEbooks, snapshot = readKdpMetadataSnapshot,
} = {}) {
  const [books, metadata] = await Promise.all([catalogue(), snapshot()]);
  if (!Array.isArray(books) || !Array.isArray(metadata?.books)) {
    throw new Error("KDP catalogue or signed-in metadata is unavailable.");
  }
  const signedIn = new Map();
  for (const row of metadata.books.filter(item => item.format === "kindle")) {
    const asin = String(row.asin || "").toUpperCase();
    if (!/^B0[A-Z0-9]{8}$/.test(asin) || signedIn.has(asin)) {
      throw new Error("Invalid or duplicated signed-in Kindle ASIN; cannot issue a trustworthy price-range report.");
    }
    signedIn.set(asin, row);
  }
  const seen = new Set();
  const rows = books.map(book => {
    const asin = String(book.asin || "").toUpperCase();
    if (seen.has(asin) || !/^B0[A-Z0-9]{8}$/.test(asin)) {
      throw new Error("Invalid or duplicated catalogue Kindle ASIN.");
    }
    seen.add(asin);
    const signed = signedIn.get(asin);
    const range = signed ? uk70RoyaltyPriceRange(signed.fileSizeKb) : null;
    const verified70 = Boolean(signed && /70/.test(String(signed.royaltyPlan || "")));
    return {
      ebookId: book.ebookId, asin, title: book.title,
      kindle: {
        status: !signed ? "missing_signed_in_kdp_metadata" :
          !range ? "missing_delivery_size_or_royalty_safe_band" :
          verified70 ? "calculated_verified_70_percent" : "awaiting_signed_in_70_percent_confirmation",
        observedSignedInPriceGBP: signed ? currentKdpPrice(signed, "GBP") : null,
        verified70PercentPlan: verified70,
        fileSizeKb: range?.fileSizeKb ?? signed?.fileSizeKb ?? null,
        GBP: range ? {
          minimum: range.minimumPrice, maximum: range.maximumPrice,
          deliveryCostPence: range.deliveryCostMinor,
          estimatedRoyaltyAtMinimum: range.estimatedRoyaltyAtMinimum,
          basis: range.priceRangeBasis, explanation: range.priceRationale,
        } : null,
      },
      paperback: estimatePrintRange("paperback", book.pageCount),
      hardcover: estimatePrintRange("hardcover", book.pageCount),
    };
  });
  const observedAt = Date.parse(metadata.syncedAt || "");
  return {
    ok: true, readOnly: true, kdpWritesPerformed: false,
    catalogueCount: books.length, signedInKindleMatches: rows.filter(row =>
      row.kindle.status !== "missing_signed_in_kdp_metadata").length,
    snapshotAt: metadata.syncedAt || null,
    signedInSnapshotFresh: Number.isFinite(observedAt) && observedAt <= Date.now() &&
      Date.now() - observedAt <= 8 * 86400000,
    printPricingPolicyVersion: KDP_PRINT_PRICING_POLICY_VERSION,
    notes: [
      "Kindle GBP test bounds use genuine KDP delivery KB; £4.50 is minimum estimated eligible UK author royalty, not the retail price.",
      "File-size tiers are pricing experiments, not evidence of book quality or demand.",
      "Paperback/hardcover use D1 page counts for planning only. Publication and repricing require verified final print PDFs and signed-in KDP price evidence.",
      "Amazon's official 70% Kindle UK limit is £12.99; this strategy normally sets a lower ceiling per book.",
      "Ranges are not evidence that a retail listing has already changed.",
    ],
    rows,
  };
}
