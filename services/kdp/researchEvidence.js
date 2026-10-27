import { auditPublicCatalogue } from "./publicListingAudit.js";

/** Capture product pages for search leads without treating them as comparable books. */
export async function captureCompetitorEvidence(research, { audit = auditPublicCatalogue, maxPerMarket = 5 } = {}) {
  if (!Number.isSafeInteger(maxPerMarket) || maxPerMarket < 1 || maxPerMarket > 10) throw new RangeError("Invalid competitor limit");
  const markets = {};
  let blocked = false;
  for (const marketplace of ["US", "UK"]) {
    const leads = (research.competitors?.[marketplace] || []).slice(0, maxPerMarket);
    if (blocked) {
      markets[marketplace] = { status: "skipped_after_block", listings: [] };
      continue;
    }
    if (!leads.length) {
      markets[marketplace] = { status: "no_candidates", listings: [] };
      continue;
    }
    const auditResult = await audit(leads.map((lead, i) => ({ ebookId: i + 1, asin: lead.asin })), { marketplace, delayMs: 1500 });
    const listings = auditResult.listings.map((row) => {
      const data = row.publicListing.data;
      return {
        asin: row.asin, url: row.url, status: row.publicListing.status, observedAt: row.publicListing.checkedAt,
        title: data?.title || null, description: data?.description || null, pageCount: data?.pageCount ?? null,
        price: data?.price || null, priceSource: data?.priceSource || "not_captured",
        comparability: "unverified", promotionalStatus: "unknown",
      };
    });
    blocked = listings.some((row) => row.status === "blocked");
    const captured = listings.filter((row) => row.status === "captured").length;
    markets[marketplace] = { status: blocked ? "blocked" : captured === listings.length ? "captured" : "incomplete", listings };
  }
  return { markets, limitations: ["Identity verification alone does not establish comparability or exclude promotions."] };
}
