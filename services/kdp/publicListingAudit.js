import { launchKdpBrowser } from "./engine/browser.ts";

const MARKETPLACES = { US: "www.amazon.com", UK: "www.amazon.co.uk" };
const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 12000;

export function productUrl(asin, marketplace = "US") {
  const id = String(asin || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(id) || !MARKETPLACES[marketplace]) return null;
  return `https://${MARKETPLACES[marketplace]}/dp/${id}`;
}

// Runs in an isolated browser page with scripts and network requests disabled.
export function parseProductPage() {
  const text = (selector) => (document.querySelector(selector)?.textContent || "").replace(/\s+/g, " ").trim();
  const attr = (selector, name) => document.querySelector(selector)?.getAttribute(name)?.trim() || "";
  const unique = (items) => [...new Set(items.filter(Boolean))];
  const details = {};
  const detailRows = "#detailBullets_feature_div li, #detailBulletsWrapper_feature_div li, " +
    "#productDetails_detailBullets_sections1 tr, #productDetails_techSpec_section_1 tr";
  for (const row of document.querySelectorAll(detailRows)) {
    const heading = row.querySelector("th, .a-text-bold");
    if (!heading) continue;
    const label = (heading.textContent || "").replace(/[\u200e\u200f\u202a-\u202e:]/g, "").replace(/\s+/g, " ").trim();
    const value = (row.querySelector("td")?.textContent || row.textContent?.replace(heading.textContent || "", "") || "").replace(/\s+/g, " ").trim();
    if (label && value && label.length < 120 && value.length < 2000) details[label] = value;
  }
  const findDetail = (...names) => {
    const found = Object.entries(details).find(([key]) => names.some((name) => key.toLowerCase() === name));
    return found?.[1] || "";
  };
  const canonical = attr('link[rel="canonical"]', "href");
  const canonicalAsin = canonical.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?]|$)/i)?.[1] || "";
  const asin = attr('input[name="ASIN"]', "value") || attr("#ASIN", "value") || findDetail("asin") || canonicalAsin;
  const pageCountText = findDetail("print length", "pages", "paperback", "hardcover") || text('[data-csa-c-content-id="book_pages"]');
  const pageCountMatch = pageCountText.match(/\b([\d,]+)\s*pages?\b/i) || pageCountText.match(/^\s*([\d,]+)\s*$/);
  const categories = unique([...document.querySelectorAll("#wayfinding-breadcrumbs_feature_div a, #zg_hrsr a, #SalesRank a")].map((a) => (a.textContent || "").replace(/\s+/g, " ").trim()));
  return {
    asin: asin.toUpperCase(),
    title: text("#productTitle") || attr('meta[property="og:title"]', "content"),
    subtitle: text("#productSubtitle"),
    author: unique([...document.querySelectorAll("#bylineInfo .author a, #bylineInfo .author .contributorNameID")].map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())).join(", "),
    description: text("#bookDescription_feature_div .a-expander-content") || text("#bookDescription_feature_div") || text("#productDescription"),
    coverUrl: attr("#landingImage", "src") || attr('meta[property="og:image"]', "content"),
    price: text("#kindle-price") || text("#corePrice_feature_div .a-offscreen") || text("#price_inside_buybox") || text("#newBuyBoxPrice"),
    pageCount: pageCountMatch ? Number(pageCountMatch[1].replace(/,/g, "")) : null,
    language: findDetail("language"),
    publisher: findDetail("publisher"),
    publicationDate: findDetail("publication date"),
    isbn10: findDetail("isbn-10"),
    isbn13: findDetail("isbn-13"),
    categories,
    rating: text('#acrPopover .a-icon-alt') || attr("#acrPopover", "title"),
    reviewCount: text("#acrCustomerReviewText"),
    details,
  };
}

async function readLimitedBody(response) {
  if (Number(response.headers.get("content-length")) > MAX_PAGE_BYTES) throw new Error("page_too_large");
  if (!response.body) throw new Error("empty_response");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_PAGE_BYTES) throw new Error("page_too_large");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchProductPage(url, { fetchImpl = fetch } = {}) {
  const initial = new URL(url);
  let current = initial;
  const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (current.protocol !== "https:" || current.hostname !== initial.hostname || current.port || current.username || current.password) return { status: "redirect_rejected" };
    const response = await fetchImpl(current, {
      redirect: "manual", signal,
      headers: { "user-agent": "Mozilla/5.0 (compatible; AIMS-KDP-Audit/1.0)", "accept": "text/html,application/xhtml+xml", "accept-language": "en-US,en;q=0.8" },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirects === 3) return { status: "redirect_rejected", httpStatus: response.status };
      current = new URL(location, current);
      continue;
    }
    if (!response.ok) return { status: [403, 429, 503].includes(response.status) ? "blocked" : "http_error", httpStatus: response.status };
    const html = await readLimitedBody(response);
    if (/validateCaptcha|robot check|enter the characters you see below/i.test(html)) return { status: "blocked", httpStatus: response.status };
    return { status: "fetched", httpStatus: response.status, html };
  }
  return { status: "redirect_rejected" };
}

export function compareListing(book, publicData) {
  const comparisons = {};
  const pairs = {
    title: [book.title, publicData.title], description: [book.description, publicData.description],
    author: [book.author, publicData.author], pageCount: [book.pageCount, publicData.pageCount],
  };
  for (const [field, [catalogueValue, amazonValue]] of Object.entries(pairs)) {
    const present = (value) => value !== null && value !== undefined && String(value).trim() !== "";
    const normalize = (value) => String(value).normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
    const status = !present(catalogueValue) || !present(amazonValue) ? "not_captured" :
      normalize(catalogueValue) === normalize(amazonValue) ? "match" : "different";
    comparisons[field] = { status, catalogueValue: catalogueValue ?? null, amazonValue: amazonValue ?? null };
  }
  return comparisons;
}

export async function auditPublicCatalogue(books, { marketplace = "US", fetchPage = fetchProductPage, browserFactory = launchKdpBrowser, delayMs = 500 } = {}) {
  if (!MARKETPLACES[marketplace]) throw new Error("Unsupported marketplace");
  const listings = [];
  let browser, context, parserPage, parserError = false, blocked = false;
  try {
    try {
      browser = await browserFactory();
      context = await browser.newContext({ javaScriptEnabled: false });
      await context.route("**/*", (route) => route.abort());
      parserPage = await context.newPage();
    } catch {
      parserError = true;
    }
    for (const book of books) {
      const url = productUrl(book.asin, marketplace);
      const row = { ebookId: book.ebookId, asin: book.asin || null, marketplace, url, catalogue: book, publicListing: { status: "not_captured", checkedAt: null, data: null }, comparisons: null };
      listings.push(row);
      if (!url) { row.publicListing.status = "invalid_asin"; continue; }
      if (parserError) { row.publicListing.status = "parser_unavailable"; continue; }
      if (blocked) { row.publicListing.status = "skipped_after_block"; continue; }
      if (delayMs && listings.length > 1) await new Promise((resolve) => setTimeout(resolve, delayMs));
      row.publicListing.checkedAt = new Date().toISOString();
      try {
        const result = await fetchPage(url);
        row.publicListing.status = result.status;
        row.publicListing.httpStatus = result.httpStatus || null;
        if (result.status === "blocked") { blocked = true; continue; }
        if (result.status !== "fetched") continue;
        await parserPage.setContent(result.html, { waitUntil: "domcontentloaded", timeout: REQUEST_TIMEOUT_MS });
        const data = await parserPage.evaluate(parseProductPage);
        if (!data.title) { row.publicListing.status = "unrecognized_page"; continue; }
        if (!data.asin || data.asin !== String(book.asin).toUpperCase()) { row.publicListing.status = "identity_unverified"; continue; }
        row.publicListing.status = "captured";
        row.publicListing.data = data;
        row.publicListing.fieldAvailability = Object.fromEntries(Object.entries(data).map(([key, value]) => {
          const available = Array.isArray(value) ? value.length > 0 :
            value && typeof value === "object" ? Object.keys(value).length > 0 :
              value !== null && value !== undefined && Boolean(String(value).trim());
          return [key, available ? "captured" : "not_captured"];
        }));
        row.comparisons = compareListing(book, data);
      } catch (error) {
        row.publicListing.status = "fetch_or_parse_error";
        row.publicListing.error = String(error?.name === "TimeoutError" ? "timeout" : error?.message || "unknown").slice(0, 200);
      }
    }
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
  const counts = {};
  for (const row of listings) counts[row.publicListing.status] = (counts[row.publicListing.status] || 0) + 1;
  const comparisonSummary = { match: 0, different: 0, not_captured: 0 };
  for (const row of listings) {
    for (const comparison of Object.values(row.comparisons || {})) comparisonSummary[comparison.status]++;
  }
  return { marketplace, catalogueBooks: books.length, captured: counts.captured || 0, notCaptured: books.length - (counts.captured || 0), statusCounts: counts, comparisonSummary, listings };
}
