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
// Price positioning: 10% headroom above the minimum viable list price,
// rounded UP to a reader-friendly .99; never sacrifice the royalty floor.
export const KDP_PRINT_RETAIL_HEADROOM = 1.10;
export const KDP_PRINT_RETAIL_CEILINGS = Object.freeze({
  GBP: Object.freeze({ paperback: 19.99, hardcover: 27.99 }),
  USD: Object.freeze({ paperback: 29.99, hardcover: 39.99 }),
});
export const KDP_PRINT_PRICING_POLICY_VERSION = "2026-11-17-v3";

function charmPriceAtOrAbove(value) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError("Invalid print price.");
  const floorPounds = Math.floor(value);
  const candidate = floorPounds + .99;
  return Number((candidate + 1e-9 >= value ? candidate : floorPounds + 1.99).toFixed(2));
}


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
  const minimumViablePrice = Math.max(bracketFloor, (printCost + profitFloor) / .60);
  const ceiling = KDP_PRINT_RETAIL_CEILINGS[market][format];
  const price = charmPriceAtOrAbove(minimumViablePrice * KDP_PRINT_RETAIL_HEADROOM);
  const royalty = Math.round((.60 * price - printCost) * 100) / 100;
  if (price > ceiling || royalty + 0.001 < profitFloor) {
    throw new Error("Print list price would exceed the sensible retail ceiling or violate the minimum royalty.");
  }
  // Additional testing headroom scales with verified final printed pages.
  // The static cap remains a hard safety ceiling, never a universal target.
  const maxPriceUplift = (format === "paperback" ? 1 : 2) + Math.ceil(pages / 100);
  const maximumPrice = Number(Math.min(ceiling, price + maxPriceUplift).toFixed(2));
  const estimatedRoyaltyAtMaximum = Math.round((.60 * maximumPrice - printCost) * 100) / 100;
  return {
    market, format, pages, printCost: Math.round(printCost * 1000) / 1000,
    price: price.toFixed(2), estimatedRoyalty: royalty,
    minimumPrice: price.toFixed(2), maximumPrice: maximumPrice.toFixed(2),
    estimatedRoyaltyAtMaximum,
    priceRangeBasis: "final_print_pdf_page_count_6x9_black_ink_white_paper",
    priceRationale: `${format} ${pages} final PDF pages, ${market} manufacturing cost ${printCost.toFixed(2)}. ` +
      `A ${market === "GBP" ? "£4.50" : "$6"} direct-Amazon royalty floor, 10% headroom and upwards .99 rounding ` +
      `give the lower price. A page-count-based testing allowance gives the upper price, ` +
      `never exceeding the ${ceiling.toFixed(2)} ${market} hard retail cap. ` +
      "Verified market demand, not page count alone, decides a price within this range.",
    royaltyRate: .60, minimumViablePrice: Math.ceil(minimumViablePrice * 100) / 100,
    sensibleRetailCeiling: ceiling, pricingPolicyVersion: KDP_PRINT_PRICING_POLICY_VERSION,
    retailHeadroom: KDP_PRINT_RETAIL_HEADROOM, calculatedAt: new Date().toISOString(),
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
