import { info, warn } from "../../../logger.js";
import { fetchWithTimeout } from "../../shared/http-client.js";

const DEFAULT_FEATURED_BOOK_API_URL =
  "https://jonathan-harris.online/api/v1/featured-book.json";

const FALLBACK_SPONSOR = Object.freeze({
  title: "Digital Diagnosis: How AI Is Revolutionizing Healthcare",
  url: "https://jonathan-harris.online",
  canonicalUrl: "https://jonathan-harris.online",
  buyUrl: "https://jonathan-harris.online",
  short: "",
  tags: [],
  filter: "",
  podcastSponsor: {
    label: "This week's sponsor",
    headline: "",
    cta: "",
    midroll_15: "",
    midroll_30: "",
  },
  selection: null,
  source: "fallback",
});

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function getFeaturedBookApiUrl() {
  return cleanString(process.env.FEATURED_BOOK_API_URL) || DEFAULT_FEATURED_BOOK_API_URL;
}

function getFeaturedBookTimeoutMs(timeoutOverride) {
  const timeout = Number(timeoutOverride ?? process.env.AI_TIMEOUT) || 15_000;
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 15_000;
}

function resolveSponsorUrl(book = {}) {
  return (
    cleanString(book?.buy_route_full) ||
    cleanString(book?.buy_url) ||
    cleanString(book?.canonical_url) ||
    ""
  );
}

export function buildSponsorFromPayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("featured-book payload must be an object");
  }

  const book = payload.book;
  if (!book || typeof book !== "object") {
    throw new Error("featured-book payload missing book object");
  }

  const title = cleanString(book.title);
  if (!title) {
    throw new Error("featured-book payload missing book.title");
  }

  const url = resolveSponsorUrl(book);
  if (!url) {
    throw new Error(
      "featured-book payload missing sponsor URL (buy_route_full, buy_url, canonical_url)"
    );
  }

  return {
    title,
    url,
    canonicalUrl: cleanString(book.canonical_url) || url,
    buyUrl: cleanString(book.buy_url) || cleanString(book.buy_route_full) || url,
    short: cleanString(book.short),
    tags: Array.isArray(book.tags) ? book.tags.filter((tag) => typeof tag === "string") : [],
    filter: cleanString(book.filter),
    podcastSponsor:
      payload.podcast_sponsor && typeof payload.podcast_sponsor === "object"
        ? payload.podcast_sponsor
        : FALLBACK_SPONSOR.podcastSponsor,
    selection:
      payload.selection && typeof payload.selection === "object" ? payload.selection : null,
    source: "featured-book-api",
  };
}

function buildFallbackSponsor(reason, meta = {}) {
  warn("script.sponsor.fallback", { reason, ...meta });
  return { ...FALLBACK_SPONSOR };
}

export default async function getSponsor(options = {}) {
  const url = cleanString(options?.apiUrl) || getFeaturedBookApiUrl();
  const timeout = getFeaturedBookTimeoutMs(options?.timeout);
  const fetchImpl = typeof options?.fetchImpl === "function" ? options.fetchImpl : fetchWithTimeout;

  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: {
        accept: "application/json",
      },
      timeout,
    });

    if (!response.ok) {
      return buildFallbackSponsor("http_error", {
        status: response.status,
        apiUrl: url,
      });
    }

    const body = await response.text();

    let payload;
    try {
      payload = JSON.parse(body);
    } catch (parseError) {
      return buildFallbackSponsor("invalid_json", {
        apiUrl: url,
        error: parseError.message,
      });
    }

    const sponsor = buildSponsorFromPayload(payload);
    info("script.sponsor.loaded", {
      title: sponsor.title,
      url: sponsor.url,
      source: sponsor.source,
      apiUrl: url,
      selectionMethod: sponsor.selection?.method,
      isoWeek: sponsor.selection?.iso_week,
      year: sponsor.selection?.year,
    });
    return sponsor;
  } catch (err) {
    return buildFallbackSponsor("request_failed", {
      apiUrl: url,
      error: err?.message || String(err),
    });
  }
}

export { DEFAULT_FEATURED_BOOK_API_URL, FALLBACK_SPONSOR, resolveSponsorUrl };
