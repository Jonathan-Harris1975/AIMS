import { createHash } from "node:crypto";
import getSponsor from "../../script/utils/getSponsor.js";
import { listKdpEbooks } from "../../kdp/catalogue.js";
import { getObjectAsBuffer, getObjectAsText, putPrivateJson } from "../../shared/utils/r2-client.js";
import { BookFeatureRepository } from "./repository.js";
import { candidateReferences, extractManuscript } from "./assessment.js";
import { scheduledLondonOccurrence, verifyBook } from "./core.js";

const EXTRACTION_CONFIG_VERSION = "book-feature-pdf-v1";
const MAX_PDF_BYTES = 30 * 1024 * 1024;

export async function resolveWeeklyBook(week, { sponsor = getSponsor, listBooks = listKdpEbooks } = {}) {
  const featured = await sponsor();
  if (featured?.source !== "featured-book-api" || !featured.title || !featured.url) {
    throw new Error("Authoritative featured-book API is unavailable; fallback selection is forbidden.");
  }
  if (featured.selection?.iso_week && Number(featured.selection.iso_week) !== Number(week.slice(-2))) {
    throw new Error("Featured-book selection is for a different ISO week.");
  }
  if (featured.selection?.year && Number(featured.selection.year) !== Number(week.slice(0, 4))) {
    throw new Error("Featured-book selection is for a different ISO year.");
  }
  const matches = (await listBooks()).filter((book) => book.title.trim().toLowerCase() === featured.title.trim().toLowerCase());
  if (matches.length !== 1) throw new Error(`Featured title matches ${matches.length} KDP records; expected exactly one.`);
  const book = verifyBook({ title: featured.title, bookUrl: featured.url }, matches[0]);
  return { book, selection: featured.selection || {}, featured };
}

export async function analysePublishedBook(book, {
  readObject = getObjectAsBuffer, readCache = getObjectAsText, writeCache = putPrivateJson,
  extract = extractManuscript,
} = {}) {
  const buffer = await readObject("kdp", book.manuscriptR2Key, { maxBytes: MAX_PDF_BYTES });
  if (!Buffer.isBuffer(buffer) || buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("Published manuscript is not a PDF.");
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const key = `outreach/book-feature/extractions/${sha256}/${EXTRACTION_CONFIG_VERSION}.json`;
  let extraction;
  try {
    const cached = JSON.parse(await readCache("kdp", key));
    if (cached.sha256 === sha256 && cached.configVersion === EXTRACTION_CONFIG_VERSION &&
        cached.totalPages === cached.pages?.length) extraction = cached;
  } catch (error) {
    if (!["NoSuchKey", "NotFound"].includes(error?.name) && error?.$metadata?.httpStatusCode !== 404) throw error;
  }
  if (!extraction) {
    extraction = { ...(await extract(buffer)), configVersion: EXTRACTION_CONFIG_VERSION };
    await writeCache("kdp", key, extraction);
  }
  if (!extraction.complete || extraction.pagesAnalysed !== extraction.totalPages) {
    throw new Error(`Incomplete PDF extraction: ${extraction.pagesAnalysed}/${extraction.totalPages} pages.`);
  }
  return { sha256, totalPages: extraction.totalPages, pagesAnalysed: extraction.pagesAnalysed,
    candidates: candidateReferences(extraction), cacheKey: key };
}

export async function runBookFeatureAssessment({ now = new Date(), d1, repository = d1 ? new BookFeatureRepository(d1) : null,
  resolveBook = resolveWeeklyBook, analyse = analysePublishedBook, persist = putPrivateJson } = {}) {
  const occurrence = scheduledLondonOccurrence(now);
  if (!occurrence) return { ok: false, status: "blocked", reason: "Outside Tuesday/Thursday 09:00–11:00 Europe/London assessment window." };
  if (!repository) throw new Error("Durable Book Feature repository is required.");
  const mode = await repository.mode();
  if (!["assessment", "shadow"].includes(mode.effective)) {
    return { ok: false, status: "suspended", mode: mode.effective, reason: "Configured mode forbids scheduled assessment." };
  }
  const { book, selection } = await resolveBook(occurrence.week);
  const campaign = await repository.campaign(occurrence.week, book, selection);
  const lease = await repository.claimOccurrence(occurrence, campaign.id);
  if (!lease) {
    const previous = await repository.getOccurrence(occurrence.id);
    const completed = ["completed", "completed_zero"].includes(previous?.status) && Boolean(previous.report_key);
    return { ok: completed, partialFailure: !completed, status: completed ? "already_completed" : "already_running_or_blocked",
      campaignId: campaign.id, occurrenceId: occurrence.id, dispatched: 0 };
  }
  try {
    const analysis = await analyse(book);
    const reportKey = `outreach/book-feature/campaigns/${occurrence.week}/${occurrence.localDate}.json`;
    await persist("kdp", reportKey, { campaignId: campaign.id, occurrenceId: occurrence.id, ebookId: book.ebookId,
      title: book.title, manuscriptSha256: analysis.sha256, totalPages: analysis.totalPages,
      pagesAnalysed: analysis.pagesAnalysed, candidates: analysis.candidates, extractionCacheKey: analysis.cacheKey,
      verifiedOrganisations: 0, qualifiedOpportunities: 0, contactEligibleOpportunities: 0,
      dispatched: 0, status: "assessment_pending_entity_validation", observedAt: now.toISOString() });
    await repository.finishOccurrence(lease, "completed_zero", { reportKey });
    return { ok: true, status: "completed_zero", campaignId: campaign.id, occurrenceId: occurrence.id,
      pagesAnalysed: analysis.pagesAnalysed, totalPages: analysis.totalPages, candidatePhrases: analysis.candidates.length,
      verifiedOrganisations: 0, qualifiedOpportunities: 0, dispatched: 0, privateReportKey: reportKey };
  } catch (error) {
    await repository.finishOccurrence(lease, "blocked", { errorCode: String(error?.code || "assessment_failed").slice(0, 100) });
    throw error;
  }
}
