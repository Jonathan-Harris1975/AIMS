// Live, bounded KDP paperback/hardcover production worker. The existing
// authenticated browser engine performs the remote KDP work; MAST merely
// dispatches this route. Every potentially ambiguous remote action consumes a
// durable quota reservation and is never retried blindly.
import { claimDurableLease, releaseDurableLease } from "../shared/utils/durableLease.js";
import { putPrivateJson } from "../shared/utils/r2-client.js";
import { listKdpEbooks } from "./catalogue.js";
import { createPrintAssets } from "./printAssets.js";
import { readKindleAiDeclaration } from "./printAiDisclosure.js";
import { reconcileLivePrintListings } from "./printVerification.js";
import { reconcileInterruptedPrintJobs } from "./printReconciliation.js";
import { planPrintPrices } from "./printPricePolicy.js";
import { getPrintRolloutCapacity, parsePrintWeeklyLimit } from "./printPreflight.js";
import { canAttemptPrintJob, ensurePrintStateTables, getPrintJob, listKnownPrintJobs, markPrintQuota,
  reservePrintQuota, savePrintJob, utcPrintWeek, writePrintEditionState } from "./printState.js";
import { publishBook } from "./engine/kdpPublish.ts";
import { listBookshelf, syncBookMetadata } from "./engine/kdpMetadata.ts";

const MAX_BOOKS = 2;
const MAX_FORMAT_START_MINUTE = 22 * 60 + 50;
const SPECIAL_FIRST_BOOK = 7;
const STORAGE_ROOT = "print/production/reports/";

export function localPrintClock(at = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", weekday: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(at);
  const fields = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return { weekday: fields.weekday.toLowerCase(), minute: Number(fields.hour) * 60 + Number(fields.minute) };
}

export function printWindowAllowsAction(at = new Date(), { start = false } = {}) {
  const clock = localPrintClock(at);
  if (!["monday", "tuesday", "wednesday", "thursday"].includes(clock.weekday)) return false;
  return clock.minute >= 22 * 60 + 15 && clock.minute < (start ? MAX_FORMAT_START_MINUTE : 23 * 60 + 45);
}

function cleanTitle(value) {
  return String(value || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function existingPrintMatches(shelf, book, format) {
  // Reports API is a valid complete Bookshelf source with pagesScanned=0;
  // browser scans have pagesScanned>=1. Either must contain usable refs.
  if (!Array.isArray(shelf?.refs) || !shelf.refs.length ||
      !Number.isInteger(shelf.pagesScanned) || shelf.pagesScanned < 0 ||
      shelf.refs.some(ref => !ref.titleId || !ref.format)) {
    throw new Error("Cannot establish a complete signed-in KDP Bookshelf inventory.");
  }
  const printRefs = shelf.refs.filter(r => r.format === format);
  // A print ref with no title cannot be safely ruled out as the same book.
  if (printRefs.some(r => !r.title)) throw new Error("KDP Bookshelf includes print editions with unverified title identity.");
  return printRefs.filter(r => cleanTitle(r.title) === cleanTitle(book.title));
}

export function choosePrintCandidates(books) {
  const seen = new Set();
  return [...books].filter(book => {
    if (!Number.isSafeInteger(book.ebookId) || seen.has(book.ebookId)) throw new Error("Invalid KDP catalogue identity.");
    seen.add(book.ebookId);
    return true;
  }).sort((a,b) => (a.ebookId === SPECIAL_FIRST_BOOK ? -1 : b.ebookId === SPECIAL_FIRST_BOOK ? 1 : a.ebookId - b.ebookId));
}

export function categorySpecsFromKindle(categories = []) {
  const specs = [];
  for (const entry of categories || []) {
    const path = String(entry).split(/\s*›\s*/).map(x => x.trim()).filter(Boolean);
    if (!["Books","Kindle Books"].includes(path[0]) || path.length < 3) continue;
    const nodes = path.slice(1).filter(x => x !== "Books").slice(0,4);
    if (nodes.length >= 2) specs.push({ path:nodes });
    if (specs.length >= 3) break;
  }
  // Preserve the signed-in Kindle hierarchy while stripping only the root;
  // the KDP print category wizard must itself confirm the matching path.
  if (!specs.length) throw new Error("Existing Kindle print-compatible categories cannot be verified.");
  return specs;
}

function bookMetadata(book) {
  const names = book.author.trim().split(/\s+/);
  return {
    title: book.title, description: book.description || book.summary,
    keywords: (book.keywords || []).filter(Boolean).slice(0, 7),
    primaryAuthor: { firstName: names.shift() || "", lastName: names.join(" ") },
  };
}

function printSettings(aiDisclosure) {
  return { ...aiDisclosure, trimWidthIn: 6, trimHeightIn: 9, inkAndPaper: "BW_WHITE",
    interiorHasBleed: false, coverFinish: "matte", hasPublisherBarcode: false };
}

function shortError(error) {
  return String(error?.message || error || "Unknown KDP print production failure.").slice(0, 900);
}

async function recordRun(data) {
  const day = new Date().toISOString().slice(0,10);
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const key = STORAGE_ROOT + day + "/" + timestamp + ".json";
  await putPrivateJson("kdp", key, data);
  return { bucket: "kdp", key };
}

async function produceOne(book, format, shelf, options) {
  let job = await getPrintJob(book.ebookId, format);
  if (!canAttemptPrintJob(job)) {
    return { ebookId: book.ebookId, format, status: "already_in_progress_or_submitted", state: job?.state };
  }
  if (!printWindowAllowsAction(options.now(), { start: true })) {
    return { ebookId: book.ebookId, format, status: "print_window_closed" };
  }
  let assets;
  let action = null;
  const week = utcPrintWeek(options.now());
  try {
    const matches = existingPrintMatches(shelf, book, format);
    if (matches.length && (!job?.titleId || matches.length !== 1 || matches[0].titleId !== job.titleId)) {
      await savePrintJob(book.ebookId, format, { state: "uncertain", errorCode: "existing_kdp_print_title_unreconciled" });
      return { ebookId: book.ebookId, format, status: "existing_kdp_print_title_unreconciled" };
    }
    // Reuse the existing verified Amazon Kindle questionnaire. Do not
    // fabricate AI declarations or create print drafts before identity checks.
    const sourceRefs = shelf.refs.filter(ref => ref.format === "kindle" &&
      String(ref.asin || "").toUpperCase() === String(book.asin || "").toUpperCase());
    if (sourceRefs.length !== 1) throw new Error("Existing Kindle KDP title identity could not be uniquely verified.");
    const kindle = await options.readKindle(sourceRefs[0].titleId, "kindle");
    if (cleanTitle(kindle?.title) !== cleanTitle(book.title) ||
      String(kindle.asin || "").toUpperCase() !== String(book.asin || "").toUpperCase()) {
      throw new Error("Signed-in Kindle source title or ASIN does not match the private catalogue.");
    }
    const categories = categorySpecsFromKindle(kindle.categories);
    const aiDisclosure = await options.aiDisclosure(sourceRefs[0].titleId);
    assets = await options.prepare(book, format);
    const manifest = assets.manifest;
    const manifestKey = "print/assets/" + book.ebookId + "/" + format + "/manifest.json";
    const plan = planPrintPrices(format, manifest.finalPageCount);
    const isNewTitle = !job?.titleId;
    await savePrintJob(book.ebookId, format,
      { state: isNewTitle ? "assets_ready" : "draft", manifestKey });
    await writePrintEditionState(book.ebookId, format, isNewTitle ? "qa_passed" : "draft");
    if (!printWindowAllowsAction(options.now(), { start: true })) {
      return { ebookId: book.ebookId, format, status: "assets_ready_window_closed" };
    }
    if (isNewTitle) {
      const reservedCreate = await reservePrintQuota(book.ebookId, format, "create",
        { week, limit: options.weeklyLimit });
      if (!reservedCreate.reserved) {
        return { ebookId: book.ebookId, format, status: reservedCreate.reason };
      }
    }
    const reservedSubmit = await reservePrintQuota(book.ebookId, format, "submit",
      { week, limit: options.weeklyLimit });
    if (!reservedSubmit.reserved) {
      return { ebookId: book.ebookId, format, status: reservedSubmit.reason };
    }
    action = isNewTitle ? "create_and_submit" : "submit";
    // A single existing AIMS browser transaction handles Create -> Details ->
    // actual title-ID resolution -> Cover/Interior -> Preview -> Price -> Submit.
    // Both independent weekly quotas were durably reserved BEFORE any click.
    await savePrintJob(book.ebookId, format, {
      state: isNewTitle ? "creating" : "submitting", titleId: job?.titleId || null,
      manifestKey,
    });
    const request = {
      format, ...(isNewTitle ? { create: true } : { create: false, titleId: job.titleId }),
      dryRun: false, publish: true,
      details: bookMetadata(book), categories,
      content: { interiorPath: assets.interiorPath, coverPath: assets.coverPath,
        forceReplaceFiles: true, printSettings: printSettings(aiDisclosure) },
      pricing: plan.pricing,
    };
    const result = await options.publish(request);
    const titleId = /^[A-Z0-9]{10,14}$/i.test(String(result?.titleId || ""))
      ? result.titleId : job?.titleId || null;
    if (isNewTitle && titleId) {
      await markPrintQuota(book.ebookId, format, "create", "done", week);
    }
    const isbn = result?.steps?.find(step => step.step === "content")?.detail?.isbn || null;
    if (!titleId || !result?.published || result.errors?.length || !isbn) {
      await markPrintQuota(book.ebookId, format, "submit", "uncertain", week);
      if (isNewTitle && !titleId) {
        await markPrintQuota(book.ebookId, format, "create", "uncertain", week);
      }
      await savePrintJob(book.ebookId, format, {
        state: "uncertain", titleId, isbn, manifestKey,
        errorCode: "kdp_submission_title_or_isbn_unverified",
      });
      await writePrintEditionState(book.ebookId, format, "uncertain", isbn);
      return { ebookId: book.ebookId, format, status: "submission_unverified",
        titleId, errors: result?.errors || [] };
    }
    await markPrintQuota(book.ebookId, format, "submit", "done", week);
    await savePrintJob(book.ebookId, format, { state: "submitted", titleId, isbn, manifestKey });
    await writePrintEditionState(book.ebookId, format, "submitted", isbn);
    return { ebookId: book.ebookId, format, status: "submitted_to_kdp_review",
      titleId, isbn, pages: manifest.finalPageCount,
      ukPrintPrice: plan.uk.price, usPrintPrice: plan.us.price };
  } catch (error) {
    const errorText = shortError(error);
    // A failure in source/cover production is safe to retry. A failure once
    // Create/Publish has been attempted must stay uncertain until reconciled.
    const uncertain = Boolean(action);
    if (uncertain) {
      const reservedActions = action === "create_and_submit" ? ["create","submit"] : [action];
      for (const reserved of reservedActions) {
        await markPrintQuota(book.ebookId, format, reserved, "uncertain", week).catch(() => {});
      }
    }
    const state = uncertain ? "uncertain" : job?.titleId ? "draft" : "blocked";
    try {
      await savePrintJob(book.ebookId, format, { state, titleId: job?.titleId || undefined, errorCode: errorText });
      await writePrintEditionState(book.ebookId, format, uncertain ? "uncertain" : "blocked");
    } catch { /* Keep the original error; any state write failure is also a terminal failure. */ }
    return { ebookId: book.ebookId, format, status: state, error: errorText };
  } finally {
    await assets?.cleanup?.().catch(() => {});
  }
}

export async function runPrintProduction({
  dryRun = false, ebookId = null, now = () => new Date(),
  listBooks = listKdpEbooks, inspectBookshelf = listBookshelf,
  prepare = createPrintAssets, publish = publishBook,
  aiDisclosure = readKindleAiDeclaration, readKindle = syncBookMetadata,
  reconcileListings = reconcileLivePrintListings,
  reconcileInterrupted = reconcileInterruptedPrintJobs,
  claimLease = claimDurableLease, releaseLease = releaseDurableLease,
} = {}) {
  if (dryRun) return { ok: true, dryRun: true, kdpWritesPerformed: false,
    message: "The production run is not a KDP write in dry-run mode." };
  if (!printWindowAllowsAction(now())) return { ok: false, status: "outside_print_window", kdpWritesPerformed: false };
  const lease = await claimLease({
    namespace: "kdp-print", key: "live-production", pendingTtlMs: 100 * 60_000,
  });
  if (!lease.claimed) return { ok: false, status: "already_running", kdpWritesPerformed: false };
  let report = null;
  try {
    if (lease.lease.backend !== "r2") throw new Error("Remote R2 lease is mandatory for live print publication.");
    await ensurePrintStateTables();
    const shelf = await inspectBookshelf(); // Signed-in KDP gate and duplicate check.
    const books = choosePrintCandidates(await listBooks());
    if (shelf.refs.length < books.length) {
      throw new Error("Signed-in KDP Bookshelf scan is smaller than the catalogue; completeness is not verified.");
    }
    // Bookshelf scan gives exact setup IDs but not reliable title labels. Read
    // existing known title IDs from D1, then interrogate any foreign print
    // draft's signed-in setup before allowing another creation.
    const knownRefs = await listKnownPrintJobs();
    for (const ref of shelf.refs.filter(item => item.format !== "kindle")) {
      const known = knownRefs.find(item => item.format === ref.format && item.titleId === ref.titleId);
      if (known) {
        const match = books.find(item => item.ebookId === known.ebookId);
        if (!match) throw new Error("KDP print draft references an unknown catalogue title.");
        ref.title = match.title;
      } else {
        const meta = await syncBookMetadata(ref.titleId, ref.format);
        if (!meta?.title || meta.title === "(untitled)") {
          throw new Error("Existing KDP print listing identity could not be reconciled.");
        }
        ref.title = meta.title;
      }
    }
    const interruptedReconciliation = await reconcileInterrupted(books, shelf, { now });
    const weekLimit = parsePrintWeeklyLimit(process.env.KDP_PRINT_WEEKLY_LIMIT_PER_FORMAT);
    const capacity = getPrintRolloutCapacity({ observedAt: now().toISOString(), weeklyLimit: weekLimit });
    const listingsReconciled = await reconcileListings(books, { limit: 12 });
    const eligible = ebookId == null ? books : books.filter(book => book.ebookId === Number(ebookId));
    if (!eligible.length) throw new Error("No matching existing KDP ebook found.");
    const outcomes = [];
    let booksTried = 0;
    let writes = false;
    for (const book of eligible) {
      if (booksTried >= MAX_BOOKS || !printWindowAllowsAction(now(), { start: true })) break;
      // Completed, submitted and uncertain titles cannot consume every future
      // scheduling slot. Skip them so the 40-book queue actually advances.
      const actionable = await Promise.all(["paperback","hardcover"].map(async format =>
        ({ format, allowed: canAttemptPrintJob(await getPrintJob(book.ebookId, format)) })));
      if (!actionable.some(row => row.allowed)) continue;
      booksTried++;
      for (const { format, allowed } of actionable) {
        if (!printWindowAllowsAction(now(), { start: true })) break;
        if (!allowed) continue;
        const item = await produceOne(book, format, shelf, {
          now, prepare, aiDisclosure, readKindle,
          publish: async request => { writes = true; return publish(request); },
          weeklyLimit: weekLimit,
        });
        outcomes.push(item);
      }
    }
    report = {
      ok: outcomes.every(x => [
        "submitted_to_kdp_review", "already_in_progress_or_submitted",
        "weekly_quota_exhausted", "draft_saved_window_closed", "assets_ready_window_closed",
      ].includes(x.status)),
      schemaVersion: 1, checkedAt: now().toISOString(), weekUtc: utcPrintWeek(now()),
      kdpWritesPerformed: writes, maxBooksPerRun: MAX_BOOKS, capacity,
      booksConsidered: booksTried, results: outcomes, listingsReconciled, interruptedReconciliation,
      submitted: outcomes.filter(x => x.status === "submitted_to_kdp_review").length,
      blocked: outcomes.filter(x => ["blocked","uncertain","submission_unverified"].includes(x.status)).length,
      publicPurchaseAvailabilityVerified: listingsReconciled.some(x => x.status === "live_verified"),
    };
    report.reportRef = await recordRun(report);
    return report;
  } finally {
    await releaseLease(lease.lease, { reportRef: report?.reportRef || null });
  }
}

// The scheduler must never treat a successful KDP Publish click as an Amazon
// retail page. Independent listing verification is handled separately.
export async function signedInPrintStatus(titleId, format) {
  const book = await syncBookMetadata(titleId, format);
  return { titleId, format, title: book.title, isbn: book.isbn,
    printAsin: book.asin || null, publishingStatus: book.publishingStatus,
    manuscriptStatus: book.manuscriptStatus, coverStatus: book.coverStatus };
}
