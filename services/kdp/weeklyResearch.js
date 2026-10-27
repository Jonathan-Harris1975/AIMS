// Deterministic guardrails for the weekly KDP research workflow. These helpers
// do not perform research, write to KDP, or schedule a job.
const ASIN = /^B0[A-Z0-9]{8}$/;
const MARKET = { US: { currency: "USD", floor: 400, host: "www.amazon.com" }, UK: { currency: "GBP", floor: 400, host: "www.amazon.co.uk" } };

export function londonTime(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new TypeError("Invalid date");
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "short", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(parts.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
}

export function inWeeklyWindow(date, phase) {
  const t = londonTime(date);
  const days = phase === "audit" ? ["Mon"] : phase === "update" ? ["Tue", "Wed", "Thu"] : [];
  const minutes = Number(t.hour) * 60 + Number(t.minute);
  return days.includes(t.weekday) && minutes >= 720 && minutes < 900;
}

/** A cursor is the last attempted ebook ID, persisted by the caller. */
export function selectWeeklyBatch(books, lastEbookId = 0, size = 15) {
  if (!Number.isSafeInteger(size) || size < 1 || size > 100) throw new RangeError("Invalid batch size");
  if (!Number.isSafeInteger(lastEbookId) || lastEbookId < 0) throw new RangeError("Invalid cursor");
  const byId = new Map();
  for (const book of books) {
    const id = Number(book.ebookId);
    if (!Number.isSafeInteger(id) || id <= 0 || !ASIN.test(String(book.asin || "").toUpperCase())) continue;
    if (byId.has(id)) throw new Error("Duplicate ebook ID");
    byId.set(id, book);
  }
  const ordered = [...byId.entries()].sort((a, b) => a[0] - b[0]);
  const selected = [...ordered.filter(([id]) => id > lastEbookId), ...ordered.filter(([id]) => id <= lastEbookId)].slice(0, size);
  return { books: selected.map(([, book]) => book), nextCursor: selected.at(-1)?.[0] ?? lastEbookId };
}

/** Evidence must already have been independently checked for comparability. */
export function priceFromComparables({ marketplace, ownAsin, comparables, observedAt = new Date(), discountMinor = 10, maxAgeHours = 48 }) {
  const market = MARKET[marketplace];
  if (!market || !Number.isSafeInteger(discountMinor) || discountMinor < 1 || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new TypeError("Invalid price settings");
  const now = new Date(observedAt).getTime();
  if (!Number.isFinite(now) || !Array.isArray(comparables)) throw new TypeError("Invalid evidence");
  const unique = new Map();
  for (const item of comparables) {
    const asin = String(item.asin || "").toUpperCase();
    let url;
    try { url = new URL(item.url); } catch { continue; }
    const at = Date.parse(item.observedAt);
    if (!ASIN.test(asin) || asin === String(ownAsin || "").toUpperCase() || unique.has(asin) ||
        url.protocol !== "https:" || url.hostname !== market.host || url.port || url.username || url.password ||
        !new RegExp(`/(?:dp|gp/product)/${asin}(?:/|$)`, "i").test(url.pathname) ||
        item.marketplace !== marketplace || item.currency !== market.currency || item.format !== "kindle" ||
        item.comparable !== true || item.promotional !== false || !Number.isSafeInteger(item.priceMinor) || item.priceMinor <= 0 ||
        !Number.isFinite(at) || at > now || now - at > maxAgeHours * 3600000) continue;
    unique.set(asin, item);
  }
  const valid = [...unique.values()];
  if (valid.length < 3) return { status: "insufficient_evidence", count: valid.length };
  const prices = valid.map((x) => x.priceMinor).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const medianMinor = prices.length % 2 ? prices[mid] : Math.floor((prices[mid - 1] + prices[mid]) / 2);
  return { status: "proposed", currency: market.currency, medianMinor, priceMinor: Math.max(market.floor, medianMinor - discountMinor), evidence: valid };
}

/** Exact unique ASIN match only; title IDs and ASINs are different identifiers. */
export function matchKdpMetadata(book, metadata) {
  const asin = String(book.asin || "").toUpperCase();
  if (!ASIN.test(asin)) return { status: "invalid_asin" };
  const matches = metadata.filter((entry) => entry.format === "kindle" && String(entry.asin || "").toUpperCase() === asin && String(entry.titleId || "").trim());
  return matches.length === 1 ? { status: "matched", metadata: matches[0] } : { status: matches.length ? "ambiguous" : "unmatched" };
}
