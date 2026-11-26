import { createHash } from "node:crypto";
import getSponsor from "../../script/utils/getSponsor.js";
import { listKdpEbooks } from "../../kdp/catalogue.js";
import { getObjectAsBuffer, getObjectAsText, putPrivateJson } from "../../shared/utils/r2-client.js";
import { BookFeatureRepository } from "./repository.js";
import { candidateReferences, extractManuscript, validateExtraction } from "./assessment.js";
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
        validateExtraction(cached, { sha256, configVersion: EXTRACTION_CONFIG_VERSION })) extraction = cached;
  } catch (error) {
    if (!["NoSuchKey", "NotFound"].includes(error?.name) && error?.$metadata?.httpStatusCode !== 404) throw error;
  }
  if (!extraction) {
    extraction = { ...(await extract(buffer)), configVersion: EXTRACTION_CONFIG_VERSION };
    await writeCache("kdp", key, extraction);
  }
  if (!validateExtraction(extraction, { sha256, configVersion: EXTRACTION_CONFIG_VERSION })) {
    const processed = Number(extraction?.pagesProcessed ?? extraction?.pagesAnalysed ?? extraction?.pages?.length ?? 0);
    const total = Number(extraction?.totalPages || 0);
    throw new Error(`Incomplete or invalid PDF extraction: ${processed}/${total} pages processed; unreadable or missing page evidence remains.`);
  }
  return { sha256, totalPages: extraction.totalPages, pagesAnalysed: extraction.pagesAnalysed,
    pagesProcessed: extraction.pagesProcessed ?? extraction.pagesAnalysed,
    readablePages: extraction.readablePages ?? extraction.pages.filter((page) => page.readable).length,
    coverageManifest: extraction.coverageManifest ?? extraction.pages.map((page) => {
      const characters = page.characters ?? page.text?.length ?? 0;
      let status = page.status;
      if (!status) status = characters === 0 ? "no_text_content" : page.readable ? "readable" : "insufficient_text";
      return { pdfPage: page.pdfPage, characters, status };
    }),
    sourcePages: extraction.pages.map(({ pdfPage, text, textOffsetStart }) => ({ pdfPage, text, textOffsetStart })),
    candidates: candidateReferences(extraction), cacheKey: key };
}

export async function runBookFeatureAssessment({ now = new Date(), d1, repository = d1 ? new BookFeatureRepository(d1) : null,
  resolveBook = resolveWeeklyBook, analyse = analysePublishedBook, persist = putPrivateJson,
  heartbeatIntervalMs = 5 * 60_000 } = {}) {
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
  let leaseError = null;
  let renewalInFlight = null;
  const renewLease = async () => {
    if (leaseError) throw leaseError;
    if (renewalInFlight) return renewalInFlight;
    renewalInFlight = (async () => {
      if (!await repository.renewOccurrence(lease)) {
        leaseError = Object.assign(new Error("Book Feature occurrence lease was lost."), { code: "BOOK_FEATURE_LEASE_LOST" });
        throw leaseError;
      }
    })();
    try { await renewalInFlight; } finally { renewalInFlight = null; }
  };
  const assertLease = async () => {
    if (leaseError) throw leaseError;
    if (!await repository.assertOccurrenceOwned(lease)) {
      leaseError = Object.assign(new Error("Book Feature occurrence lease expired or was taken."), { code: "BOOK_FEATURE_LEASE_LOST" });
      throw leaseError;
    }
  };
  const heartbeat = setInterval(() => { void renewLease().catch(() => {}); },
    Math.max(10, Number(heartbeatIntervalMs) || 5 * 60_000));
  heartbeat.unref?.();
  try {
    await renewLease();
    const analysis = await analyse(book);
    await assertLease();
    const referenceEvidence = await repository.recordCandidateEvidence(campaign.id, analysis.sha256,
      analysis.candidates, analysis.sourcePages);
    const reportKey = `outreach/book-feature/campaigns/${occurrence.week}/${occurrence.localDate}.json`;
    await assertLease();
    await persist("kdp", reportKey, { campaignId: campaign.id, occurrenceId: occurrence.id, ebookId: book.ebookId,
      title: book.title, manuscriptSha256: analysis.sha256, totalPages: analysis.totalPages,
      pagesAnalysed: analysis.pagesAnalysed, candidates: analysis.candidates, extractionCacheKey: analysis.cacheKey,
      referenceEvidence, evidenceStatus: "candidate_only_identity_and_qualification_pending",
      verifiedOrganisations: 0, qualifiedOpportunities: 0, contactEligibleOpportunities: 0,
      dispatched: 0, status: "assessment_pending_entity_validation", observedAt: now.toISOString() });
    await assertLease();
    await repository.finishOccurrence(lease, "completed_zero", { reportKey });
    return { ok: true, status: "completed_zero", campaignId: campaign.id, occurrenceId: occurrence.id,
      pagesAnalysed: analysis.pagesAnalysed, totalPages: analysis.totalPages, candidatePhrases: analysis.candidates.length,
      candidateEvidenceRecorded: referenceEvidence.recorded,
      verifiedOrganisations: 0, qualifiedOpportunities: 0, dispatched: 0 };
  } catch (error) {
    try {
      await repository.finishOccurrence(lease, "blocked", { errorCode: String(error?.code || "assessment_failed").slice(0, 100) });
    } catch (cleanupError) {
      // Preserve the original failure while retaining the cleanup failure for diagnostics.
      if (error && typeof error === "object") error.cleanupError = cleanupError;
    }
    throw error;
  } finally {
    clearInterval(heartbeat);
  }
}
