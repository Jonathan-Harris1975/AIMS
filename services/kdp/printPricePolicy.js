// Verified black-ink, white-paper 6x9 printing cost tables for UK/US markets.
// Source: KDP Paperback Printing Cost / Hardcover Printing Cost (checked 2026-11-17).
// UK royalty floor is the existing ecosystem's £4.50-per-sale target, applied
// to print only after manufacturing costs. US uses a $6 floor for local pricing.
export const KDP_PRINT_COST_REVIEWED_AT = "2026-11-17";
export const KDP_PRINT_COST_SOURCES = Object.freeze({
  paperback: "https://kdp.amazon.com/en_US/help/topic/G201834340",
  hardcover: "https://kdp.amazon.com/en_US/help/topic/GHT976ZKSKUXBB6H",
});
export const KDP_UK_PRINT_MIN_ROYALTY = 4.50;
export const KDP_US_PRINT_MIN_ROYALTY = 6;

export function calculatePrintPrice(format, pages, market) {
  if (!["paperback", "hardcover"].includes(format) ||
      !Number.isInteger(pages) || pages < 24 || pages > 828 ||
      !["GBP", "USD"].includes(market)) {
    throw new TypeError("Unsupported print format, page count or market.");
  }
  if (format === "hardcover" && (pages < 76 || pages > 550)) {
    throw new RangeError("Hardcover requires 76–550 final pages.");
  }
  const short = pages <= (format === "paperback" ? 110 : 108);
  const printCost = market === "GBP"
    ? (format === "paperback" ? (short ? 1.93 : 0.85 + 0.010 * pages) :
      (short ? 5.23 : 4.15 + 0.010 * pages))
    : (format === "paperback" ? (short ? 2.30 : 1.00 + 0.012 * pages) :
      (short ? 6.80 : 5.65 + 0.012 * pages));
  const profitFloor = market === "GBP" ? KDP_UK_PRINT_MIN_ROYALTY : KDP_US_PRINT_MIN_ROYALTY;
  // At/above £7.99 / $9.99 KDP direct sales carry a 60% print royalty
  // before manufacturing. Never apply the Kindle 70% rate to print editions.
  const bracketFloor = market === "GBP" ? 7.99 : 9.99;
  const price = Math.max(bracketFloor, Math.ceil((printCost + profitFloor) / .60 * 100) / 100);
  const royalty = Math.round((.60 * price - printCost) * 100) / 100;
  if (price > 250 || royalty + 0.001 < profitFloor) throw new Error("Print list price cannot preserve the royalty floor.");
  return {
    market, format, pages, printCost: Math.round(printCost * 1000) / 1000,
    price: price.toFixed(2), estimatedRoyalty: royalty,
    royaltyRate: .60, calculatedAt: new Date().toISOString(),
    rulesReviewedAt: KDP_PRINT_COST_REVIEWED_AT,
    source: KDP_PRINT_COST_SOURCES[format],
    requiresActualKdpPricingConfirmation: true,
  };
}

export function planPrintPrices(format, pages) {
  const uk = calculatePrintPrice(format, pages, "GBP");
  const us = calculatePrintPrice(format, pages, "USD");
  return {
    uk, us, pricing: { listPriceUsd: us.price, prices: { GBP: uk.price, USD: us.price }, territory: "worldwide" },
  };
}
