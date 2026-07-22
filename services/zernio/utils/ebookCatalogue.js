import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_CATALOGUE_URL = new URL("../data/ebooks.json", import.meta.url);
const URL_FIELDS = ["bookUrl", "url", "buyUrl", "buy_url", "buy_route_full", "canonicalUrl", "canonical_url"];

let memoizedCatalogue = null;
let memoizedPath = null;

function cleanString(value) {
  if (value === undefined || value === null) return "";
  return String(value).trim();
}

function normaliseSpaces(value) {
  return cleanString(value).replace(/\s+/g, " ");
}

function lowerKey(value) {
  return normaliseSpaces(value).toLowerCase();
}

function arrayFromValue(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean);
  }
  return cleanString(value)
    .split(/\s*\|\s*|\s*,\s*/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function slugFromUrl(value) {
  const cleaned = cleanString(value).replace(/[#?].*$/, "").replace(/\/+$/, "");
  if (!cleaned) return "";
  return cleaned.split("/").pop() || "";
}

function pathFromOption(pathOption) {
  if (pathOption) return path.resolve(String(pathOption));
  if (process.env.ONEUP_EBOOK_CATALOGUE_PATH) return path.resolve(process.env.ONEUP_EBOOK_CATALOGUE_PATH);
  return fileURLToPath(DEFAULT_CATALOGUE_URL);
}

function readCataloguePayload(cataloguePath) {
  const raw = fs.readFileSync(cataloguePath, "utf8");
  const parsed = JSON.parse(raw);
  if (Array.isArray(parsed)) return { books: parsed, source: cataloguePath };
  if (Array.isArray(parsed?.books)) return parsed;
  throw new Error("Ebook catalogue JSON must contain a books array.");
}

export function normaliseEbookRecord(record = {}) {
  const bookUrl = cleanString(record.bookUrl) || cleanString(record.buy_route_full) || cleanString(record.buy_url) || cleanString(record.canonical_url);
  const coverArtUrl =
    cleanString(record.coverArtUrl) ||
    cleanString(record.socialPostImageUrl) ||
    cleanString(record.social_image_url) ||
    cleanString(record.socialImageUrl) ||
    cleanString(record.main_image) ||
    cleanString(record.cover) ||
    cleanString(record.image_url);
  const manuscriptUrl =
    cleanString(record.manuscriptUrl) ||
    cleanString(record.manuscript_url) ||
    cleanString(record.manuscript_pdf_url) ||
    cleanString(record.pdf_url) ||
    cleanString(record.google_drive_pdf_url);
  const keywords = arrayFromValue(record.keywords || record.keywordsText || record.tags);

  return {
    id: record.id ?? null,
    title: normaliseSpaces(record.title),
    shortDescription: normaliseSpaces(record.shortDescription || record.short_description || record.short),
    description: normaliseSpaces(record.description),
    summary: normaliseSpaces(record.summary || record.description || record.shortDescription || record.short),
    keywords,
    keywordsText: normaliseSpaces(record.keywordsText || keywords.join(" | ")),
    audience: normaliseSpaces(record.audience),
    whoThisBookIsFor: normaliseSpaces(record.whoThisBookIsFor || record.who_this_book_is_for),
    whatThisBookCovers: normaliseSpaces(record.whatThisBookCovers || record.what_this_book_covers),
    whatYouWillLearn: normaliseSpaces(record.whatYouWillLearn || record.what_you_will_learn),
    whyItMatters: normaliseSpaces(record.whyItMatters || record.why_it_matters),
    bookUrl,
    coverArtUrl,
    manuscriptUrl,
    slug: cleanString(record.slug) || slugFromUrl(bookUrl),
    source: cleanString(record.source) || "ebook-catalogue",
  };
}

export function loadEbookCatalogue(options = {}) {
  const cataloguePath = pathFromOption(options.cataloguePath);
  if (!options.forceReload && memoizedCatalogue && memoizedPath === cataloguePath) {
    return memoizedCatalogue;
  }

  const payload = readCataloguePayload(cataloguePath);
  const books = payload.books.map(normaliseEbookRecord).filter((book) => book.title && book.bookUrl);
  if (!books.length) {
    throw new Error("Ebook catalogue contains no usable book records.");
  }

  memoizedCatalogue = {
    source: payload.source || cataloguePath,
    sourceSheet: payload.sourceSheet || "",
    bookCount: books.length,
    books,
  };
  memoizedPath = cataloguePath;
  return memoizedCatalogue;
}

export function getIsoWeekSelection(dateString) {
  const cleaned = cleanString(dateString) || new Date().toISOString().slice(0, 10);
  const match = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error(`Invalid weekStartDate '${dateString}'. Expected YYYY-MM-DD.`);
  }

  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const isoWeek = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return { method: "iso_week_rotation", iso_week: isoWeek, year: isoYear };
}

function bookLookupTokens(book = {}) {
  const tokens = new Set();
  const title = lowerKey(book.title);
  if (title) tokens.add(`title:${title}`);
  const slug = cleanString(book.slug) || slugFromUrl(book.bookUrl || book.url || book.canonicalUrl);
  if (slug) tokens.add(`slug:${lowerKey(slug)}`);

  for (const field of URL_FIELDS) {
    const url = cleanString(book[field]);
    if (!url) continue;
    tokens.add(`url:${url.replace(/\/+$/, "").toLowerCase()}`);
    const urlSlug = slugFromUrl(url);
    if (urlSlug) tokens.add(`slug:${lowerKey(urlSlug)}`);
  }

  return tokens;
}

function findMatchingCatalogueBook(books, candidate = {}) {
  const candidateTokens = bookLookupTokens(candidate);
  if (!candidateTokens.size) return null;

  return books.find((book) => {
    const localTokens = bookLookupTokens(book);
    for (const token of candidateTokens) {
      if (localTokens.has(token)) return true;
    }
    return false;
  }) || null;
}

function mergeBookData(primary, secondary = {}) {
  const output = { ...normaliseEbookRecord(primary) };
  const fallback = normaliseEbookRecord(secondary);
  for (const [key, value] of Object.entries(fallback)) {
    if ((output[key] === "" || output[key] === null || (Array.isArray(output[key]) && !output[key].length)) && value) {
      output[key] = value;
    }
  }
  return output;
}

export function resolveFeaturedEbook(options = {}) {
  const catalogue = loadEbookCatalogue(options);
  const warnings = [];

  if (options.featuredBook && typeof options.featuredBook === "object") {
    const manual = normaliseEbookRecord(options.featuredBook);
    if (!manual.title || !manual.bookUrl) {
      throw new Error("featuredBook override must include at least title and bookUrl.");
    }
    return {
      book: mergeBookData(manual, findMatchingCatalogueBook(catalogue.books, manual) || {}),
      catalogue,
      selection: { method: "request_featured_book_override" },
      warnings,
    };
  }

  const sponsor = options.sponsor && typeof options.sponsor === "object" ? options.sponsor : null;
  if (sponsor && sponsor.source !== "fallback") {
    const matched = findMatchingCatalogueBook(catalogue.books, sponsor);
    if (matched) {
      return {
        book: mergeBookData(matched, sponsor),
        catalogue,
        selection: sponsor.selection || { method: "featured_book_api_match" },
        warnings,
      };
    }
    warnings.push("Podcast featured book could not be matched to the local ebook catalogue, so the spreadsheet ISO-week rotation was used.");
  }

  const selection = getIsoWeekSelection(options.weekStartDate);
  const index = selection.iso_week % catalogue.books.length;
  const book = catalogue.books[index];
  return {
    book,
    catalogue,
    selection: { ...selection, index, catalogueLength: catalogue.books.length },
    warnings,
  };
}
