// Reconcile interrupted KDP print operations using fresh signed-in Bookshelf
// metadata. Never infer that an absent title means creation did not happen.
// Published/reviewing titles resume the public listing verification pipeline;
// unambiguously saved drafts resume only after a review grace period.
import { listPrintJobsForReconciliation, savePrintJob, writePrintEditionState } from "./printState.js";
import { syncBookMetadata } from "./engine/kdpMetadata.ts";

const STALE_DRAFT_MS = 36 * 60 * 60 * 1000;

function normaliseTitle(value) {
  return String(value || "").normalize("NFKC").toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function classifyKdpPrintOutcome(value) {
  const status = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
  if (/^(?:live|published|in review|inreview|publishing|submitted|under review|in process)$/.test(status)) {
    return "submitted";
  }
  if (/^(?:draft|incomplete|setup in progress)$/.test(status)) return "draft";
  return "unresolved";
}

export function resolveInterruptedPrintTitle(job, book, shelf) {
  if (!job || !book || !Array.isArray(shelf?.refs) || !["paperback", "hardcover"].includes(job.format)) {
    return { status: "unverifiable_bookshelf" };
  }
  const formatRefs = shelf.refs.filter(ref => ref.format === job.format);
  if (formatRefs.some(ref => !ref.title)) return { status: "unverifiable_print_title" };
  const matching = formatRefs.filter(ref => normaliseTitle(ref.title) === normaliseTitle(book.title));
  if (job.titleId) {
    if (matching.length !== 1 || matching[0].titleId !== job.titleId) {
      return { status: "known_title_identity_conflict" };
    }
    return { status: "matched", titleId: job.titleId };
  }
  if (matching.length !== 1 || !/^[A-Z0-9]{10,14}$/i.test(String(matching[0]?.titleId || ""))) {
    return { status: matching.length > 1 ? "ambiguous_matching_titles" : "creation_outcome_unverifiable" };
  }
  return { status: "matched", titleId: matching[0].titleId };
}

export async function reconcileInterruptedPrintJobs(books, shelf, {
  list = listPrintJobsForReconciliation, read = syncBookMetadata,
  save = savePrintJob, write = writePrintEditionState, now = () => new Date(),
  draftGraceMs = STALE_DRAFT_MS, maxJobs = 80,
} = {}) {
  if (!Array.isArray(books) || !Array.isArray(shelf?.refs) ||
      !Number.isInteger(maxJobs) || maxJobs < 1 || maxJobs > 80) throw new TypeError("Invalid print reconciliation inputs.");
  const byId = new Map(books.map(book => [book.ebookId, book]));
  const jobs = await list();
  const results = [];
  for (const job of jobs.slice(0, maxJobs)) {
    const book = byId.get(job.ebookId);
    const result = { ebookId: job.ebookId, format: job.format, previousState: job.state };
    if (!book) {
      results.push({ ...result, status: "catalogue_missing" });
      continue;
    }
    const matched = resolveInterruptedPrintTitle(job, book, shelf);
    if (matched.status !== "matched") {
      results.push({ ...result, status: matched.status });
      continue;
    }
    try {
      const remote = await read(matched.titleId, job.format);
      const isbn = String(remote?.isbn || "").replace(/[-\s]/g, "");
      const priorIsbn = String(job.isbn || "").replace(/[-\s]/g, "");
      if (normaliseTitle(remote?.title) !== normaliseTitle(book.title) ||
          (priorIsbn && priorIsbn !== isbn) || !/^(?:97[89])\d{10}$/.test(isbn)) {
        results.push({ ...result, status: "remote_identity_or_isbn_unverified" });
        continue;
      }
      const outcome = classifyKdpPrintOutcome(remote.publishingStatus);
      if (outcome === "submitted") {
        await save(job.ebookId, job.format, { state: "submitted", titleId: matched.titleId, isbn });
        await write(job.ebookId, job.format, "submitted", isbn);
        results.push({ ...result, status: "submission_reconciled", titleId: matched.titleId });
      } else if (outcome === "draft") {
        const ageMs = +now() - Date.parse(String(job.updatedAt || ""));
        if (!Number.isFinite(ageMs) || ageMs < draftGraceMs) {
          results.push({ ...result, status: "awaiting_safe_draft_recheck" });
          continue;
        }
        // No blind re-create. A uniquely verified title remains a reusable KDP
        // draft; submission can be reserved again only after quota resets.
        await save(job.ebookId, job.format, { state: "draft", titleId: matched.titleId, isbn });
        await write(job.ebookId, job.format, "draft", isbn);
        results.push({ ...result, status: "saved_draft_recovered", titleId: matched.titleId });
      } else {
        results.push({ ...result, status: "remote_status_unverified" });
      }
    } catch (error) {
      results.push({ ...result, status: "reconciliation_pending",
        reason: String(error?.message || error).slice(0,180) });
    }
  }
  return {
    checked: results.length, recovered: results.filter(row =>
      ["submission_reconciled", "saved_draft_recovered"].includes(row.status)).length,
    pending: results.filter(row =>
      !["submission_reconciled", "saved_draft_recovered"].includes(row.status)).length,
    results,
  };
}
