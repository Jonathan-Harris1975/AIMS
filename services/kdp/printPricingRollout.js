// Published-print price maintenance. No new titles, ISBNs or content uploads.
// Reuses the Kindle royalty worker's R2 lease to prevent competing KDP writes.
// Exact title identity + saved print asset manifest determine pricing inputs.
import { getObjectAsText, putPrivateJson } from "../shared/utils/r2-client.js";
import { claimDurableLease, releaseDurableLease } from "../shared/utils/durableLease.js";
import { listKdpEbooks, queryKdpD1 } from "./catalogue.js";
import { syncBookMetadata } from "./engine/kdpMetadata.ts";
import { publishBook } from "./engine/kdpPublish.ts";
import { parseKdpPriceMinorUnits } from "./engine/kdpPriceRules.ts";
import { currentKdpPrice } from "./metadataValues.js";
import { calculatePrintPrice, KDP_PRINT_PRICING_POLICY_VERSION } from "./printPricePolicy.js";

const LEDGER_KEY = "pricing/print/ledger.json";
const REPORT_KEY = "pricing/print/latest.json";
const PRICE_VERIFY_WAIT_MS = 5 * 24 * 60 * 60_000; // Amazon advises 3–5 days for print price propagation.
const NEEDS_ATTENTION_MS = 8 * 24 * 60 * 60_000;
const REVIEW_INTERVAL_MS = 7 * 24 * 60 * 60_000;
const MIN_SUBMISSION_GAP_MS = 60 * 60_000;
const MAX_CHECKED_PER_RUN = 6;
const STATUS_PENDING = new Set(["submitting", "submitted", "submission_uncertain"]);

function normalise(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
function money(value) {
  return (value / 100).toFixed(2);
}
function minor(currency, book) {
  return parseKdpPriceMinorUnits(currentKdpPrice(book, currency));
}
function assertVerifiedPrintIdentity(book, job, signedIn) {
  if (!book || !job || !signedIn || !["paperback", "hardcover"].includes(job.format) ||
      job.state !== "live_verified" || !job.titleId || !job.isbn ||
      String(signedIn.titleId || "") !== job.titleId || signedIn.format !== job.format ||
      normalise(signedIn.title) !== normalise(book.title) ||
      String(signedIn.isbn || "").replace(/[\s-]/g, "") !== String(job.isbn).replace(/[\s-]/g, "") ||
      String(signedIn.asin || "").toUpperCase() === String(book.asin || "").toUpperCase() ||
      !/^(live|published)$/i.test(String(signedIn.publishingStatus || ""))) {
    throw new Error("Published print format identity and current KDP status are not verified.");
  }
}
function assertAssetManifest(book, job, manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.ebookId !== book.ebookId ||
      manifest.format !== job.format || normalise(manifest.title) !== normalise(book.title) ||
      manifest.sourceR2Key !== book.manuscriptR2Key ||
      !Number.isSafeInteger(manifest.finalPageCount)) {
    throw new Error("Print asset manifest is missing, invalid or not matched to the catalogue.");
  }
}

/** Pure, testable price decision. A price within the sensible band is retained
 * rather than repeatedly nudging already profitable titles upwards. */
export function planPublishedPrintPrice(book, job, manifest, signedIn) {
  assertVerifiedPrintIdentity(book, job, signedIn);
  assertAssetManifest(book, job, manifest);
  const targets = {
    GBP: calculatePrintPrice(job.format, manifest.finalPageCount, "GBP"),
    USD: calculatePrintPrice(job.format, manifest.finalPageCount, "USD"),
  };
  const changes = {};
  const observed = {};
  for (const currency of ["GBP", "USD"]) {
    const value = minor(currency, signedIn);
    if (value === null) throw new Error(currency + " signed-in KDP print price cannot be verified.");
    observed[currency] = money(value);
    const targetMinor = Math.round(Number(targets[currency].price) * 100);
    const ceilingMinor = Math.round(targets[currency].sensibleRetailCeiling * 100);
    // Repair an inadequate royalty OR implausibly expensive existing retail price.
    // Do not reduce prices within a sensible range merely because they earn more.
    if (value < targetMinor) changes[currency] = targets[currency].price;
    else if (value > ceilingMinor) changes[currency] = money(ceilingMinor);
  }
  return { ebookId: book.ebookId, format: job.format, titleId: job.titleId,
    observedPrices: observed, targetPrices: Object.fromEntries(
      Object.entries(targets).map(([key, value]) => [key, value.price])),
    changes, estimates: targets, policyVersion: KDP_PRINT_PRICING_POLICY_VERSION };
}

async function readR2(key) {
  try { return JSON.parse(await getObjectAsText("kdp", key)); }
  catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}
async function loadLivePrintJobs() {
  const response = await queryKdpD1(
    "SELECT ebook_id,format,state,title_id,isbn,manifest_key FROM kdp_print_automation" +
    " WHERE state='live_verified' AND title_id IS NOT NULL ORDER BY ebook_id,format");
  return (response.results || []).map(row => ({
    ebookId: Number(row.ebook_id), format: row.format, state: row.state,
    titleId: row.title_id, isbn: row.isbn, manifestKey: row.manifest_key,
  }));
}

export async function reconcilePrintPricing({
  dryRun = true, now = () => new Date(), catalogue = listKdpEbooks,
  jobs = loadLivePrintJobs, sync = syncBookMetadata, publish = publishBook,
  load = readR2, save = (key, value) => putPrivateJson("kdp", key, value),
  claim = claimDurableLease, release = releaseDurableLease,
} = {}) {
  const books = await catalogue();
  const byId = new Map(books.map(book => [book.ebookId, book]));
  if (byId.size !== books.length) throw new Error("Duplicate ebook IDs in print pricing catalogue.");
  const live = await jobs();
  if (!Array.isArray(live)) throw new Error("Published print job list is unavailable.");
  const seen = new Set();
  for (const row of live) {
    const key = String(row.ebookId) + ":" + String(row.format);
    if (seen.has(key)) throw new Error("Duplicate published print edition identity.");
    seen.add(key);
  }
  if (dryRun) return { ok: true, dryRun: true, kdpWritesPerformed: false,
    catalogueCount: books.length, publishedPrintEditions: live.length,
    pricingPolicyVersion: KDP_PRINT_PRICING_POLICY_VERSION,
    message: "Published-edition inventory only; no signed-in prices or KDP writes examined." };
  const lease = await claim({
    namespace: "kdp-research", key: "weekly-update-worker", pendingTtlMs: 60 * 60000,
  });
  if (!lease.claimed) return { ok: true, status: "already_running",
    kdpWritesPerformed: false, publishedPrintEditions: live.length };
  try {
    if (lease.lease.backend !== "r2") {
      return { ok: false, status: "durable_state_not_configured", kdpWritesPerformed: false };
    }
    const ledger = await load(LEDGER_KEY) || { version: 1, entries: {}, lastSubmissionAt: null };
    if (ledger.version !== 1 || !ledger.entries || typeof ledger.entries !== "object" ||
        Array.isArray(ledger.entries)) throw new Error("Invalid print pricing ledger.");
    const persist = async () => { ledger.updatedAt = now().toISOString(); await save(LEDGER_KEY, ledger); };
    // Age-based ordering prevents one bad listing from starving the other formats.
    const ordered = [...live].sort((left, right) => {
      const a = ledger.entries[left.ebookId + ":" + left.format];
      const b = ledger.entries[right.ebookId + ":" + right.format];
      const aTime = Date.parse(a?.checkedAt || a?.startedAt || "1970-01-01") || 0;
      const bTime = Date.parse(b?.checkedAt || b?.startedAt || "1970-01-01") || 0;
      return aTime - bTime || left.ebookId - right.ebookId ||
        left.format.localeCompare(right.format);
    });
    const results = [];
    let submitted = false;
    for (const job of ordered) {
      if (results.length >= MAX_CHECKED_PER_RUN) break;
      const key = job.ebookId + ":" + job.format;
      const book = byId.get(job.ebookId);
      const entry = ledger.entries[key];
      // Unknown remote submission outcomes remain blocked until verified.
      // Never infer permission to replay from the passage of seven days.
      if (entry?.status === "needs_attention") continue;
      const interval = entry?.status === "blocked" ? 24 * 60 * 60_000 : REVIEW_INTERVAL_MS;
      if (entry && !STATUS_PENDING.has(entry.status) &&
          entry.policyVersion === KDP_PRINT_PRICING_POLICY_VERSION &&
          Number.isFinite(Date.parse(entry.checkedAt)) &&
          +now() - Date.parse(entry.checkedAt) < interval) continue;
      if (STATUS_PENDING.has(entry?.status) && +now() - Date.parse(entry.startedAt) < PRICE_VERIFY_WAIT_MS) {
        results.push({ key, status: "awaiting_kdp_price_propagation" }); continue;
      }
      if (!book || !["paperback", "hardcover"].includes(job.format) ||
          job.state !== "live_verified" || !job.titleId || !job.isbn ||
          !String(job.manifestKey || "").startsWith("print/assets/" + job.ebookId + "/" + job.format + "/")) {
        ledger.entries[key] = { status: "needs_attention", reason: "unverifiable_print_identity",
          checkedAt: now().toISOString(), policyVersion: KDP_PRINT_PRICING_POLICY_VERSION };
        await persist(); results.push({ key, status: "needs_attention", reason: "unverifiable_print_identity" });
        continue;
      }
      let plan;
      try {
        const manifest = await load(job.manifestKey);
        const signedIn = await sync(job.titleId, job.format);
        plan = planPublishedPrintPrice(book, job, manifest, signedIn);
      } catch (error) {
        ledger.entries[key] = { status: "blocked",
          reason: String(error?.message || error).slice(0,400),
          checkedAt: now().toISOString(), policyVersion: KDP_PRINT_PRICING_POLICY_VERSION };
        await persist(); results.push({ key, status: "blocked", reason: ledger.entries[key].reason });
        continue;
      }
      const desired = entry?.changes || {};
      if (STATUS_PENDING.has(entry?.status)) {
        const exact = Object.entries(desired).every(([currency, amount]) =>
          plan.observedPrices[currency] === amount);
        if (exact) {
          ledger.entries[key] = { status: "verified_signed_in", checkedAt: now().toISOString(),
            policyVersion: KDP_PRINT_PRICING_POLICY_VERSION,
            previous: entry.previous, target: desired,
            retailPricePropagation: "not_independently_verified" };
          await persist(); results.push({ key, status: "verified_signed_in" });
        } else if (+now() - Date.parse(entry.startedAt) >= NEEDS_ATTENTION_MS) {
          ledger.entries[key] = { ...entry, status: "needs_attention",
            reason: "print_price_update_not_verified_after_eight_days", checkedAt: now().toISOString() };
          await persist(); results.push({ key, status: "needs_attention",
            reason: "print_price_update_not_verified_after_eight_days" });
        } else {
          results.push({ key, status: "awaiting_signed_in_price" });
        }
        continue;
      }
      const changes = plan.changes;
      if (!Object.keys(changes).length) {
        ledger.entries[key] = { status: "verified_signed_in", checkedAt: now().toISOString(),
          policyVersion: KDP_PRINT_PRICING_POLICY_VERSION,
          current: plan.observedPrices, target: plan.targetPrices,
          retailPricePropagation: "not_independently_verified" };
        await persist(); results.push({ key, status: "already_sensible" });
        continue;
      }
      if (submitted || +now() - Date.parse(ledger.lastSubmissionAt || "1970-01-01") < MIN_SUBMISSION_GAP_MS) {
        results.push({ key, status: "queued", changes }); continue;
      }
      // Record the exact target BEFORE the first remote side effect. Uncertain
      // outcomes are never replayed without signed-in reconciliation.
      ledger.entries[key] = { status: "submitting", titleId: job.titleId,
        format: job.format, previous: plan.observedPrices, changes,
        policyVersion: KDP_PRINT_PRICING_POLICY_VERSION, startedAt: now().toISOString() };
      ledger.lastSubmissionAt = now().toISOString();
      await persist();
      submitted = true;
      try {
        const outcome = await publish({ titleId: job.titleId, format: job.format,
          create: false, dryRun: false, publish: true, pricing: { prices: changes } });
        ledger.entries[key].status = outcome.published && !outcome.errors?.length ?
          "submitted" : "submission_uncertain";
        ledger.entries[key].errors = outcome.errors || [];
      } catch (error) {
        ledger.entries[key].status = "submission_uncertain";
        ledger.entries[key].errors = [String(error?.message || error).slice(0,400)];
      }
      await persist();
      results.push({ key, status: ledger.entries[key].status, changes });
    }
    const outstanding = Object.entries(ledger.entries).filter(([, entry]) =>
      ["blocked","needs_attention","submission_uncertain"].includes(entry.status))
      .map(([key, entry]) => ({ key, status: entry.status, reason: entry.reason || null }));
    const report = {
      ok: !results.some(row => ["blocked","needs_attention","submission_uncertain"].includes(row.status)) &&
        outstanding.length === 0,
      unresolved: outstanding,
      schemaVersion: 1, kdpWritesPerformed: submitted,
      publishedPrintEditions: live.length,
      examined: results.length, results, checkedAt: now().toISOString(),
      pricingPolicyVersion: KDP_PRINT_PRICING_POLICY_VERSION,
      confirmedSignedIn: results.filter(row => ["already_sensible","verified_signed_in"].includes(row.status)).length,
      pending: results.filter(row => ["queued","submitted","awaiting_signed_in_price","awaiting_kdp_price_propagation"].includes(row.status)).length,
      blocked: outstanding.length,
    };
    await save(REPORT_KEY, report);
    return report;
  } finally {
    await release(lease.lease);
  }
}
