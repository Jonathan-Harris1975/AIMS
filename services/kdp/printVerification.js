// Independent public UK Amazon verification. The KDP Publish button is not
// retail availability. This module only exposes a format when signed-in KDP
// identity, ISBN, retail ASIN and an active purchasing control all match.
import { auditPublicCatalogue, fetchProductPage, productUrl } from "./publicListingAudit.js";
import { syncBookMetadata } from "./engine/kdpMetadata.ts";
import { queryKdpD1 } from "./catalogue.js";
import { getPrintJob, savePrintJob } from "./printState.js";

function clean(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function verifyPrintIdentity({ book, format, job, kdp, retail, hasPurchaseControl }) {
  if (!book || !["paperback", "hardcover"].includes(format) || !job?.titleId || !kdp) return false;
  const isbn = String(job.isbn || "").replace(/[-\s]/g, "");
  if (!/^(97[89])\d{10}$/.test(isbn)) return false;
  if (String(kdp.isbn || "").replace(/[-\s]/g, "") !== isbn) return false;
  const asin = String(kdp.asin || "").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin) || asin === String(book.asin || "").toUpperCase()) return false;
  if (!/live|published/i.test(String(kdp.publishingStatus || "")) ||
      /unpublished|not live|pending|review/i.test(String(kdp.publishingStatus || ""))) return false;
  if (clean(kdp.title) !== clean(book.title) || clean(retail?.title) !== clean(book.title)) return false;
  const retailIsbn = String(retail?.isbn13 || "").replace(/[-\s]/g, "");
  if (retailIsbn !== isbn || String(retail?.asin || "").toUpperCase() !== asin) return false;
  if (!hasPurchaseControl || !retail?.price || !/£\s*\d/.test(String(retail.price))) return false;
  return true;
}

export function publicPurchaseControls(html) {
  const text = String(html || "");
  if (/currently unavailable|temporarily out of stock|unavailable for purchase|out of stock/i.test(
    text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0,160000))) return false;
  return /\bid\s*=\s*["'](?:add-to-cart-button|buy-now-button)["']/i.test(text) ||
    /\bid\s*=\s*["']add-to-cart-button-ubb["']/i.test(text);
}

export async function verifyLivePrintListing(book, format, {
  signedInMetadata = syncBookMetadata, publicAudit = auditPublicCatalogue,
  fetchPublicPage = fetchProductPage, save = savePrintJob, d1Query = queryKdpD1,
} = {}) {
  const job = await getPrintJob(book.ebookId, format);
  if (!job || !["submitted","live_verified"].includes(job.state) || !job.titleId || !job.isbn) {
    return { status: "not_submitted" };
  }
  const kdp = await signedInMetadata(job.titleId, format);
  const asin = String(kdp.asin || "").toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(asin) || asin === String(book.asin || "").toUpperCase()) {
    return { status: "print_asin_unverified" };
  }
  const report = await publicAudit([{ ...book, asin, pageCount: null }], { marketplace: "UK" });
  const row = report.listings?.[0];
  if (row?.publicListing?.status !== "captured") {
    return { status: "public_listing_unverified", reason: row?.publicListing?.status || "no_result" };
  }
  const url = productUrl(asin, "UK");
  const purchase = await fetchPublicPage(url);
  if (purchase.status !== "fetched") return { status: "purchase_page_unverified" };
  if (!verifyPrintIdentity({ book, format, job, kdp, retail: row.publicListing.data,
    hasPurchaseControl: publicPurchaseControls(purchase.html) })) {
    return { status: "retail_identity_format_or_purchasability_unverified" };
  }
  // Publication state is public website data. Commit it only after live
  // retail identity/ISBN/marketplace verification, never on KDP submission.
  const response = await d1Query(
    "UPDATE kdp_print_editions SET state='live_verified', isbn=?, print_asin=?," +
      " purchase_url=?, verified_at=datetime('now'), updated_at=datetime('now')" +
      " WHERE ebook_id=? AND format=? AND isbn=? AND state IN ('submitted','live_verified')",
    [job.isbn,asin,url,book.ebookId,format,job.isbn]);
  if (Number(response.meta?.changes) !== 1) {
    return { status: "d1_verified_format_update_unconfirmed" };
  }
  await save(book.ebookId,format,{ state:"live_verified", titleId:job.titleId, isbn:job.isbn });
  return { status: "live_verified", ebookId:book.ebookId,format,isbn:job.isbn,printAsin:asin,purchaseUrl:url };
}

export async function reconcileLivePrintListings(books, { limit = 12, verify = verifyLivePrintListing } = {}) {
  const results = [];
  for (const book of books) {
    for (const format of ["paperback","hardcover"]) {
      const job = await getPrintJob(book.ebookId,format);
      if (job?.state !== "submitted") continue;
      try {
        results.push({ ebookId:book.ebookId,format,
          ...(await verify(book,format)) });
      } catch (error) {
        results.push({ ebookId:book.ebookId,format,status:"verification_error",
          reason:String(error?.message || error).slice(0,140) });
      }
      if (results.length >= limit) return results;
    }
  }
  return results;
}
