import { D1Client } from "../comms-hub/clients/d1Client.js";

let client;

function getKdpD1Client() {
  const databaseId = String(process.env.KDP_D1_DATABASE_ID || "5f42a55b-c2bc-42a0-8337-1318e2c48ae7").trim();
  const apiToken = String(process.env.D1_API_KEY || "").trim();
  if (!apiToken) {
    const error = new Error("D1_API_KEY is required to read the KDP catalogue.");
    error.statusCode = 503;
    error.code = "kdp_catalogue_not_configured";
    throw error;
  }
  if (!client) {
    client = new D1Client({
      d1DatabaseId: databaseId,
      d1ApiToken: apiToken,
      cloudflareAccountId: process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || "",
      cloudflareApiBaseUrl: process.env.CLOUDFLARE_API_BASE_URL || "https://api.cloudflare.com/client/v4",
      d1TimeoutMs: Number(process.env.KDP_D1_TIMEOUT_MS || 15000),
      providerRetryAttempts: 3,
      providerRetryBaseMs: 350,
      providerRetryMaxMs: 2000,
      d1ProxyUrl: "",
      d1ProxyToken: "",
    });
  }
  return client;
}

function mapBook(row) {
  return {
    ebookId: Number(row.ebook_id),
    slug: String(row.slug || ""),
    title: String(row.title || ""),
    description: String(row.description || ""),
    summary: String(row.summary || ""),
    keywords: parseJsonArray(row.keywords_json),
    author: String(row.author || ""),
    identifier: String(row.identifier || ""),
    asin: String(row.asin || ""),
    pageCount: Number.isFinite(Number(row.page_count)) && row.page_count != null ? Number(row.page_count) : null,
    publicationDate: row.publication_date || null,
    shortDescription: String(row.short_description || ""),
    topic: String(row.topic || ""),
    tags: parseJsonArray(row.tags_json),
    audience: String(row.audience || ""),
    whoFor: String(row.who_for || ""),
    whatBookCovers: String(row.what_book_covers || ""),
    whatYoullLearn: parseJsonArray(row.what_youll_learn_json),
    whyItMatters: String(row.why_it_matters || ""),
    tone: String(row.tone || ""),
    bookUrl: String(row.book_url || ""),
    buyNowUrl: String(row.buy_now_url || ""),
    redirectUrl: String(row.redirect_url || ""),
    coverArtUrl: String(row.cover_art_url || ""),
    legacyAliasUrl: String(row.legacy_alias_url || ""),
    manuscriptFilename: String(row.manuscript_filename || ""),
    manuscriptUrl: row.manuscript_url || null,
    manuscriptTitleObserved: String(row.manuscript_title_observed || ""),
    titleAlignmentStatus: String(row.title_alignment_status || ""),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    manuscriptR2Key: String(row.manuscript_r2_key || ""),
    manuscriptFormat: String(row.manuscript_format || "PDF"),
    contentType: String(row.content_type || "application/pdf"),
    storageBucket: String(row.storage_bucket || "kdp"),
  };
}

function parseJsonArray(value) {
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export async function listKdpEbooks() {
  const result = await getKdpD1Client().query(
    "SELECT * FROM ebooks ORDER BY ebook_id",
  );
  return (Array.isArray(result.results) ? result.results : []).map(mapBook);
}

export async function getKdpEbookById(ebookId) {
  const id = Number(ebookId);
  if (!Number.isSafeInteger(id) || id <= 0) {
    const error = new Error("ebookId must be a positive integer.");
    error.statusCode = 400;
    error.code = "validation";
    throw error;
  }
  const result = await getKdpD1Client().query(
    "SELECT * FROM ebooks WHERE ebook_id = ? LIMIT 1",
    [id],
  );
  const row = Array.isArray(result.results) ? result.results[0] : null;
  if (!row) {
    const error = new Error(`No KDP catalogue entry exists for ebookId ${id}.`);
    error.statusCode = 404;
    error.code = "kdp_ebook_not_found";
    throw error;
  }
  return mapBook(row);
}

export async function getKdpEbookByAsin(asin) {
  const normalized = String(asin || "").trim();
  if (!normalized) return null;
  const result = await getKdpD1Client().query(
    `SELECT * FROM ebooks WHERE lower(asin) = lower(?) LIMIT 1`,
    [normalized],
  );
  const row = Array.isArray(result.results) ? result.results[0] : null;
  return row ? mapBook(row) : null;
}

/** Compare-and-swap avoids overwriting a concurrent catalogue edit. */
export async function updateKdpEbookPageCount({ ebookId, asin, previousPageCount, pageCount }) {
  if (!Number.isSafeInteger(ebookId) || ebookId <= 0 || !/^B0[A-Z0-9]{8}$/.test(asin) ||
      !Number.isSafeInteger(pageCount) || pageCount < 1 || pageCount > 10000 ||
      !(previousPageCount === null || (Number.isSafeInteger(previousPageCount) && previousPageCount >= 0))) {
    throw new TypeError("Invalid verified ebook page-count update.");
  }
  const result = await getKdpD1Client().query(
    "UPDATE ebooks SET page_count = ?, updated_at = datetime('now') WHERE ebook_id = ? AND UPPER(asin) = ? AND page_count IS ?",
    [pageCount, ebookId, asin, previousPageCount],
  );
  if (Number(result.meta?.changes) === 1) return { status: "updated" };
  const current = await getKdpEbookById(ebookId);
  return { status: current.asin.toUpperCase() === asin && current.pageCount === pageCount ? "already_updated" : "conflict" };
}

export function kdpCatalogueConfiguration() {
  return {
    configured: Boolean(process.env.D1_API_KEY && (process.env.KDP_D1_DATABASE_ID || "5f42a55b-c2bc-42a0-8337-1318e2c48ae7")),
    databaseId: process.env.KDP_D1_DATABASE_ID || "5f42a55b-c2bc-42a0-8337-1318e2c48ae7",
  };
}

export const __kdpCatalogueTestHooks = {
  clearClient() { client = undefined; },
  mapBook,
  parseJsonArray,
};
