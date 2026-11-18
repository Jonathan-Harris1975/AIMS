// services/podcast-growth/monthlyEvidence.js
// Evidence-only monthly appendix. No external search, model or KDP writes.
import { readLatestPodcastGrowthSnapshot } from "./organicDiscovery.js";
import { getBookSalesEvidence } from "./bookSalesEvidence.js";

const esc = (v) => String(v == null ? "" : v)
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
const clean = (v, max = 180) => String(v == null ? "" : v).trim().slice(0, max);

export function normaliseMonthlyGrowthEvidence({ snapshot = null, sales = null, now = new Date() } = {}) {
  const nowTime = new Date(now).getTime();
  const age = snapshot?.date ? Math.floor((nowTime - Date.parse(snapshot.date + "T00:00:00Z")) / 86400000) : null;
  const validSnapshot = snapshot?.schemaVersion === "podcast-growth-discovery/v1"
    && Number.isFinite(age) && age >= 0 && age <= 31;
  const providerRows = validSnapshot && Array.isArray(snapshot.evidence) ? snapshot.evidence : [];
  const limitation = validSnapshot ? [] : ["No recent (within 31 days) verified public-API discovery snapshot is available."];
  return {
    schemaVersion: "podcast-growth-monthly-evidence/v1",
    generatedAt: Number.isFinite(nowTime) ? new Date(nowTime).toISOString() : new Date().toISOString(),
    discovery: {
      status: !validSnapshot ? "unavailable" : snapshot.status === "complete" ? "complete" : "partial",
      snapshotDate: validSnapshot ? snapshot.date : null,
      apiSurface: "public-search-API-samples-not-podcast-app-rankings",
      observations: providerRows.slice(0, 12).map(row => ({
        term: clean(row.term, 75),
        provider: clean(row.provider, 70),
        country: clean(row.country, 5) || null,
        ownPositionInSample: Number.isSafeInteger(row.ownPositionInSample) && row.ownPositionInSample > 0
          ? row.ownPositionInSample : null,
        sampledResults: Number.isSafeInteger(row.sampledResults) && row.sampledResults >= 0
          ? row.sampledResults : null,
        competitors: Array.isArray(row.competitors)
          ? row.competitors.slice(0, 3).map(item => clean(item.title, 100)).filter(Boolean) : [],
      })),
      limitations: [...limitation, ...(validSnapshot ? (snapshot.limitations || []).filter(x => typeof x === "string").slice(0, 8) : [])],
    },
    bookSales: {
      status: sales?.status || "unavailable",
      workbookCount: Number.isSafeInteger(sales?.workbookCount) && sales.workbookCount >= 0
        ? sales.workbookCount : null,
      workbookCountKnown: sales?.workbookCountKnown === true,
      sourcePeriod: sales?.latest?.metadata?.startDate && sales?.latest?.metadata?.endDate
        ? { startDate: sales.latest.metadata.startDate, endDate: sales.latest.metadata.endDate } : null,
      royaltiesGBP: null,
      soldUnits: null,
      attributableBookSales: null,
      limitation: "No sales or royalty claim is made without verified KDP workbook parsing and reconciliation.",
    },
    operatingPolicy: {
      paidAdvertisingBudgetGBP: 0,
      podseoFreePlanRequired: true,
      productionPublishingModified: false,
      additionalCouncilCalls: 0,
    },
  };
}

export function renderMonthlyGrowthAppendix(report) {
  const rows = report.discovery.observations.map(row => {
    const position = row.ownPositionInSample === null ? "Not observed" : String(row.ownPositionInSample);
    const competitors = row.competitors.length ? row.competitors.join(", ") : "None captured";
    return "<tr><td>" + esc(row.term) + "</td><td>" + esc(row.provider)
      + "</td><td>" + esc(row.country || "Not country-specific") + "</td><td>"
      + esc(position) + "</td><td>" + esc(competitors) + "</td></tr>";
  }).join("");
  const table = rows ? "<table><thead><tr><th>Search term</th><th>Public API</th><th>Country</th><th>Position in sampled results</th><th>Sample competitors</th></tr></thead><tbody>"
    + rows + "</tbody></table>" : "<p>No verified, recent discovery samples are available.</p>";
  return "<section class=\"podcast-growth-appendix\" aria-labelledby=\"podcast-growth-heading\">"
    + "<h2 id=\"podcast-growth-heading\">Podcast organic growth: measured evidence</h2>"
    + "<p>Public API search results are not Apple Podcasts, Spotify or Amazon Music chart rankings or listener counts.</p>"
    + table
    + "<h3>Book-sales evidence</h3><p>KDP report status: " + esc(report.bookSales.status)
    + "; workbooks located: " + esc(report.bookSales.workbookCount === null ? "unknown" : String(report.bookSales.workbookCount))
    + ". Actual sales, royalties and podcast-attributable purchases remain unverified until KDP report data has been reconciled.</p>"
    + "<h3>Measurement limitations</h3><p>" + esc(report.discovery.limitations.join(" | ") || "No source outages recorded.")
    + "</p><p>Additional paid advertising budget: £0. No additional council calls. PodSEO Free preserved.</p></section>";
}

export async function collectMonthlyGrowthEvidence({
  readSnapshot = readLatestPodcastGrowthSnapshot,
  readBookSales = getBookSalesEvidence,
  now = new Date(),
} = {}) {
  // Optional source failure must not quarantine the governing content-master audit.
  const [snapshot, sales] = await Promise.all([
    Promise.resolve().then(readSnapshot).catch(() => null),
    Promise.resolve().then(readBookSales).catch(() => null),
  ]);
  return normaliseMonthlyGrowthEvidence({ snapshot, sales, now });
}
