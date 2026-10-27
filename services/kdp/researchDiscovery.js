const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const MARKETS = { US: { country: "US", host: "www.amazon.com" }, UK: { country: "GB", host: "www.amazon.co.uk" } };

function safeText(value, max = 300) {
  return String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function searchQueries(book) {
  const topic = safeText(book.topic || book.whatBookCovers || book.title, 180);
  if (!topic) throw new Error("Book has no usable research topic");
  // Search phrases are catalogue data, never instructions to a model.
  return {
    US: `site:amazon.com/dp/ ${topic} kindle ebook`,
    UK: `site:amazon.co.uk/dp/ ${topic} kindle ebook`,
    trendsUS: `${topic} recent developments trends`,
    trendsUK: `${topic} recent developments trends`,
  };
}

export async function braveSearch({ query, country, freshness, apiKey, fetchImpl = fetch }) {
  if (!apiKey || !query || !["US", "GB"].includes(country)) throw new Error("Search configuration incomplete");
  const url = new URL(ENDPOINT);
  url.search = new URLSearchParams({ q: query, country, search_lang: "en", count: "10", ...(freshness ? { freshness } : {}) }).toString();
  const response = await fetchImpl(url, { headers: { Accept: "application/json", "X-Subscription-Token": apiKey }, signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!response.ok) {
    const error = new Error(`Search provider returned HTTP ${response.status}`);
    error.code = "research_provider_error";
    error.statusCode = response.status;
    throw error;
  }
  const body = await response.json();
  if (!body || typeof body !== "object" || !Array.isArray(body.web?.results)) throw new Error("Search provider returned an invalid response");
  return body.web.results.slice(0, 10).flatMap((item) => {
    let link;
    try { link = new URL(item.url); } catch { return []; }
    if (link.protocol !== "https:" || link.username || link.password || link.port) return [];
    return [{ title: safeText(item.title), url: link.href, snippet: safeText(item.description, 1000), published: safeText(item.page_age, 50) || null, fetched: safeText(item.age, 50) || null }];
  });
}

export function competitorCandidates(results, market, ownAsin) {
  const config = MARKETS[market];
  if (!config) throw new Error("Unsupported marketplace");
  const found = new Map();
  for (const result of results) {
    let url;
    try { url = new URL(result.url); } catch { continue; }
    if (url.protocol !== "https:" || ![config.host, config.host.slice(4)].includes(url.hostname) || url.username || url.password || url.port) continue;
    const asin = url.pathname.match(/\/(?:dp|gp\/product)\/(B0[A-Z0-9]{8})(?:\/|$)/i)?.[1]?.toUpperCase();
    if (!asin || asin === String(ownAsin || "").toUpperCase() || found.has(asin)) continue;
    found.set(asin, { ...result, asin, marketplace: market, url: `https://${config.host}/dp/${asin}`, verification: "unverified", price: null });
  }
  return [...found.values()];
}

export async function discoverBookResearch(book, { apiKey, fetchImpl = fetch, now = () => new Date() } = {}) {
  const queries = searchQueries(book);
  const calls = [
    { key: "US", country: "US" }, { key: "UK", country: "GB" },
    { key: "trendsUS", country: "US", freshness: "pm" }, { key: "trendsUK", country: "GB", freshness: "pm" },
  ];
  const found = {};
  // Sequential requests reduce bursts and make provider failures stop the run.
  for (const call of calls) found[call.key] = await braveSearch({ query: queries[call.key], country: call.country, freshness: call.freshness, apiKey, fetchImpl });
  return {
    ebookId: book.ebookId, asin: book.asin, topic: safeText(book.topic || book.whatBookCovers || book.title, 180),
    researchedAt: now().toISOString(), queries,
    competitors: { US: competitorCandidates(found.US, "US", book.asin), UK: competitorCandidates(found.UK, "UK", book.asin) },
    trendSources: { US: found.trendsUS, UK: found.trendsUK },
    status: "discovered", limitations: [
      "Search results are leads, not verified prices, comparable titles, or evidence of search demand.",
      "Sources and book content require validation before any KDP change.",
    ],
  };
}
